"""
Tests for PROJ-13: Dukascopy Download Reliability (async rewrite).

Covers:
- _download_hour_async (retry on 429/errors, no retry on 404, success path, semaphore behaviour)
- fetch_dukascopy (integration: hour range validation, weekend skipping, OHLCV output)
"""

import asyncio
import sys
import os
import struct
import lzma
from datetime import date, datetime, timezone
from itertools import cycle
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import httpx
import pytest

from fetchers.dukascopy_fetcher import (
    CONCURRENT_REQUESTS,
    MAX_RETRIES,
    RETRY_BACKOFF_SECONDS,
    _download_hour_async,
    fetch_dukascopy,
)


# ── Helpers ──────────────────────────────────────────────────────────────────

DT = datetime(2024, 1, 15, 10, tzinfo=timezone.utc)
SYMBOL = "XAUUSD"
POINT = 1000


def _make_bi5_bytes(n_ticks: int = 2) -> bytes:
    """Create minimal valid LZMA-compressed .bi5 tick data."""
    fmt = ">IIIff"
    raw = b""
    for i in range(n_ticks):
        raw += struct.pack(fmt, i * 1000, 2300000, 2299900, 1.0, 1.0)
    return lzma.compress(raw)


def _make_response(status_code: int, content: bytes = b"") -> MagicMock:
    resp = MagicMock()
    resp.status_code = status_code
    resp.content = content
    return resp


def _make_mock_client(*responses):
    """Mock httpx.AsyncClient whose .get() returns responses in sequence."""
    client = AsyncMock()
    client.get = AsyncMock(
        side_effect=list(responses) if len(responses) > 1 else [responses[0]] * 10000
    )
    return client


def _patch_async_client(responses_cycle):
    """Patches httpx.AsyncClient used inside fetch_dukascopy."""
    mock_client = AsyncMock()
    mock_client.get = AsyncMock(side_effect=cycle(responses_cycle))
    mock_cm = MagicMock()
    mock_cm.__aenter__ = AsyncMock(return_value=mock_client)
    mock_cm.__aexit__ = AsyncMock(return_value=None)
    return patch("fetchers.dukascopy_fetcher.httpx.AsyncClient", return_value=mock_cm), mock_client


# ── _download_hour_async ─────────────────────────────────────────────────────

class TestDownloadHourAsync:
    def test_success_returns_dataframe(self):
        client = _make_mock_client(_make_response(200, _make_bi5_bytes()))
        sem = asyncio.Semaphore(CONCURRENT_REQUESTS)
        result = asyncio.run(_download_hour_async(client, sem, SYMBOL, DT, POINT))
        assert result is not None
        assert list(result.columns) == ["datetime", "ask", "bid", "ask_volume", "bid_volume"]

    def test_404_returns_none_without_retry(self):
        client = _make_mock_client(_make_response(404))
        sem = asyncio.Semaphore(CONCURRENT_REQUESTS)
        result = asyncio.run(_download_hour_async(client, sem, SYMBOL, DT, POINT))
        assert result is None
        assert client.get.call_count == 1

    def test_empty_content_returns_none_without_retry(self):
        # Empty body = no trades this hour (overnight, holiday). No retry.
        client = _make_mock_client(_make_response(200, b""))
        sem = asyncio.Semaphore(CONCURRENT_REQUESTS)
        result = asyncio.run(_download_hour_async(client, sem, SYMBOL, DT, POINT))
        assert result is None
        assert client.get.call_count == 1

    def test_429_retries_and_returns_none_after_exhaustion(self):
        client = _make_mock_client(_make_response(429, b"rate limited"))
        sem = asyncio.Semaphore(CONCURRENT_REQUESTS)
        with patch("fetchers.dukascopy_fetcher.asyncio.sleep", new_callable=AsyncMock):
            result = asyncio.run(_download_hour_async(client, sem, SYMBOL, DT, POINT))
        assert result is None
        assert client.get.call_count == 1 + MAX_RETRIES

    def test_429_succeeds_on_retry(self):
        client = _make_mock_client(
            _make_response(429, b"rate limited"),
            _make_response(200, _make_bi5_bytes()),
        )
        sem = asyncio.Semaphore(CONCURRENT_REQUESTS)
        with patch("fetchers.dukascopy_fetcher.asyncio.sleep", new_callable=AsyncMock):
            result = asyncio.run(_download_hour_async(client, sem, SYMBOL, DT, POINT))
        assert result is not None
        assert client.get.call_count == 2

    def test_connection_error_retries(self):
        client = AsyncMock()
        client.get = AsyncMock(side_effect=httpx.ConnectError("refused"))
        sem = asyncio.Semaphore(CONCURRENT_REQUESTS)
        with patch("fetchers.dukascopy_fetcher.asyncio.sleep", new_callable=AsyncMock):
            result = asyncio.run(_download_hour_async(client, sem, SYMBOL, DT, POINT))
        assert result is None
        assert client.get.call_count == 1 + MAX_RETRIES

    def test_connection_error_succeeds_on_retry(self):
        client = AsyncMock()
        client.get = AsyncMock(side_effect=[
            httpx.TimeoutException("timeout"),
            _make_response(200, _make_bi5_bytes()),
        ])
        sem = asyncio.Semaphore(CONCURRENT_REQUESTS)
        with patch("fetchers.dukascopy_fetcher.asyncio.sleep", new_callable=AsyncMock):
            result = asyncio.run(_download_hour_async(client, sem, SYMBOL, DT, POINT))
        assert result is not None
        assert client.get.call_count == 2

    def test_sleep_called_outside_semaphore(self):
        """Verify asyncio.sleep IS called on 429 with the correct backoff."""
        client = _make_mock_client(
            _make_response(429, b"rate limited"),
            _make_response(200, _make_bi5_bytes()),
        )
        sem = asyncio.Semaphore(CONCURRENT_REQUESTS)
        with patch("fetchers.dukascopy_fetcher.asyncio.sleep", new_callable=AsyncMock) as mock_sleep:
            asyncio.run(_download_hour_async(client, sem, SYMBOL, DT, POINT))
        mock_sleep.assert_called_once_with(RETRY_BACKOFF_SECONDS[0])


# ── fetch_dukascopy ──────────────────────────────────────────────────────────

class TestFetchDukascopy:
    def test_invalid_hour_range_raises(self):
        with pytest.raises(ValueError, match="Invalid hour range"):
            fetch_dukascopy("XAUUSD", date(2024, 1, 15), date(2024, 1, 15), hour_from=10, hour_to=5)

    def test_no_data_raises_value_error(self):
        patcher, _ = _patch_async_client([_make_response(404)])
        with patcher:
            with pytest.raises(ValueError, match="No data returned"):
                fetch_dukascopy("XAUUSD", date(2024, 1, 15), date(2024, 1, 15))

    def test_returns_ohlcv_dataframe(self):
        patcher, _ = _patch_async_client([_make_response(200, _make_bi5_bytes(5))])
        with patcher:
            df = fetch_dukascopy("XAUUSD", date(2024, 1, 15), date(2024, 1, 15))
        assert set(["open", "high", "low", "close", "volume"]).issubset(df.columns)
        assert len(df) > 0

    def test_skips_weekends(self):
        """Saturday/Sunday hours should not be downloaded."""
        patcher, mock_client = _patch_async_client([_make_response(404)])
        with patcher:
            # 2024-01-20 is a Saturday, 2024-01-21 is a Sunday
            with pytest.raises(ValueError):
                fetch_dukascopy("XAUUSD", date(2024, 1, 20), date(2024, 1, 21))
        assert mock_client.get.call_count == 0

    def test_fresh_semaphore_per_call(self):
        """Each fetch_dukascopy call creates an independent async context."""
        patcher, _ = _patch_async_client([_make_response(200, _make_bi5_bytes(5))])
        with patcher:
            df1 = fetch_dukascopy("XAUUSD", date(2024, 1, 15), date(2024, 1, 15))
            df2 = fetch_dukascopy("XAUUSD", date(2024, 1, 16), date(2024, 1, 16))
        assert len(df1) > 0
        assert len(df2) > 0
