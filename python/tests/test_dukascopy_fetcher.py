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
    _decode_candle_bi5,
    _download_candle_raw,
    _download_hour_async,
    _fetch_all_candles,
    fetch_dukascopy,
)


# ── Helpers ──────────────────────────────────────────────────────────────────

DT = datetime(2024, 1, 15, 10, tzinfo=timezone.utc)
SYMBOL = "XAUUSD"
POINT = 1000


def _make_bi5_bytes(n_ticks: int = 2) -> bytes:
    """Create minimal valid LZMA-compressed .bi5 tick data (20 bytes/record)."""
    fmt = ">IIIff"
    raw = b""
    for i in range(n_ticks):
        raw += struct.pack(fmt, i * 1000, 2300000, 2299900, 1.0, 1.0)
    return lzma.compress(raw)


def _make_candle_bi5_bytes(n_candles: int = 2) -> bytes:
    """Create minimal valid LZMA-compressed .bi5 candle data (24 bytes/record).

    ts_sec values start at 0 (00:00 UTC) stepping by 60s — always within hour 0,
    so they pass the default hour_from=0, hour_to=23 filter.
    """
    fmt = ">IIIIIf"  # ts_sec, open, close, low, high, volume (O,C,L,H binary order)
    raw = b""
    for i in range(n_candles):
        ts_sec = i * 60
        raw += struct.pack(fmt, ts_sec, 2300000, 2299900, 2299800, 2300100, 1.0)
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
        # Must use candle format: fetch_dukascopy now tries candle endpoint first.
        patcher, _ = _patch_async_client([_make_response(200, _make_candle_bi5_bytes(5))])
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
        # Must use candle format: fetch_dukascopy now tries candle endpoint first.
        patcher, _ = _patch_async_client([_make_response(200, _make_candle_bi5_bytes(5))])
        with patcher:
            df1 = fetch_dukascopy("XAUUSD", date(2024, 1, 15), date(2024, 1, 15))
            df2 = fetch_dukascopy("XAUUSD", date(2024, 1, 16), date(2024, 1, 16))
        assert len(df1) > 0
        assert len(df2) > 0


# ── _decode_candle_bi5 ───────────────────────────────────────────────────────

class TestDecodeCandelBi5:
    def test_basic_decode_returns_ohlcv_dataframe(self):
        raw = _make_candle_bi5_bytes(3)
        df = _decode_candle_bi5(raw, 2024, 1, 15, 1000, 0, 23)
        assert df is not None
        assert list(df.columns) == ["datetime", "open", "high", "low", "close", "volume"]
        assert len(df) == 3

    def test_price_scaling(self):
        """open=2300000 / point=1000 → 2300.0"""
        raw = _make_candle_bi5_bytes(1)
        df = _decode_candle_bi5(raw, 2024, 1, 15, 1000, 0, 23)
        assert abs(df.iloc[0]["open"] - 2300.0) < 1e-6

    def test_hour_filter_excludes_out_of_range_bars(self):
        """Only bars within [hour_from, hour_to] are returned."""
        fmt = ">IIIIIf"
        raw = b""
        for ts_sec in [0, 3600, 7200]:  # hours 0, 1, 2
            raw += struct.pack(fmt, ts_sec, 2300000, 2299900, 2299800, 2300100, 1.0)
        compressed = lzma.compress(raw)
        df = _decode_candle_bi5(compressed, 2024, 1, 15, 1000, hour_from=1, hour_to=1)
        assert df is not None
        assert len(df) == 1
        assert df.iloc[0]["datetime"].hour == 1

    def test_all_bars_filtered_returns_none(self):
        raw = _make_candle_bi5_bytes(1)  # ts_sec=0 → hour 0
        result = _decode_candle_bi5(raw, 2024, 1, 15, 1000, hour_from=5, hour_to=10)
        assert result is None

    def test_empty_data_returns_none(self):
        result = _decode_candle_bi5(lzma.compress(b""), 2024, 1, 15, 1000, 0, 23)
        assert result is None

    def test_corrupt_lzma_raises_runtime_error(self):
        with pytest.raises(RuntimeError, match="LZMA decode error"):
            _decode_candle_bi5(b"not valid lzma", 2024, 1, 15, 1000, 0, 23)


# ── _download_candle_raw ─────────────────────────────────────────────────────

class TestDownloadCandleRaw:
    def test_200_returns_raw_bytes(self):
        content = _make_candle_bi5_bytes()
        client = _make_mock_client(_make_response(200, content))
        sem = asyncio.Semaphore(CONCURRENT_REQUESTS)
        result = asyncio.run(_download_candle_raw(client, sem, "XAUUSD", date(2024, 1, 15), "BID"))
        assert result == content

    def test_404_returns_none(self):
        client = _make_mock_client(_make_response(404))
        sem = asyncio.Semaphore(CONCURRENT_REQUESTS)
        result = asyncio.run(_download_candle_raw(client, sem, "XAUUSD", date(2024, 1, 15), "BID"))
        assert result is None
        assert client.get.call_count == 1

    def test_empty_content_returns_none(self):
        client = _make_mock_client(_make_response(200, b""))
        sem = asyncio.Semaphore(CONCURRENT_REQUESTS)
        result = asyncio.run(_download_candle_raw(client, sem, "XAUUSD", date(2024, 1, 15), "BID"))
        assert result is None

    def test_429_retries_and_raises_after_exhaustion(self):
        client = _make_mock_client(_make_response(429, b"rate limited"))
        sem = asyncio.Semaphore(CONCURRENT_REQUESTS)
        with patch("fetchers.dukascopy_fetcher.asyncio.sleep", new_callable=AsyncMock):
            with pytest.raises(RuntimeError):
                asyncio.run(_download_candle_raw(client, sem, "XAUUSD", date(2024, 1, 15), "BID"))
        assert client.get.call_count == 1 + MAX_RETRIES

    def test_429_succeeds_on_retry(self):
        content = _make_candle_bi5_bytes()
        client = _make_mock_client(
            _make_response(429, b"rate limited"),
            _make_response(200, content),
        )
        sem = asyncio.Semaphore(CONCURRENT_REQUESTS)
        with patch("fetchers.dukascopy_fetcher.asyncio.sleep", new_callable=AsyncMock):
            result = asyncio.run(_download_candle_raw(client, sem, "XAUUSD", date(2024, 1, 15), "BID"))
        assert result == content
        assert client.get.call_count == 2

    def test_connection_error_retries_and_raises(self):
        client = AsyncMock()
        client.get = AsyncMock(side_effect=httpx.ConnectError("refused"))
        sem = asyncio.Semaphore(CONCURRENT_REQUESTS)
        with patch("fetchers.dukascopy_fetcher.asyncio.sleep", new_callable=AsyncMock):
            with pytest.raises(RuntimeError):
                asyncio.run(_download_candle_raw(client, sem, "XAUUSD", date(2024, 1, 15), "BID"))
        assert client.get.call_count == 1 + MAX_RETRIES


# ── _fetch_all_candles ───────────────────────────────────────────────────────

class TestFetchAllCandles:
    def test_returns_mid_dataframes(self):
        """Both sides return valid candle data → one merged MID DataFrame per day."""
        candle_bytes = _make_candle_bi5_bytes(5)
        patcher, _ = _patch_async_client([_make_response(200, candle_bytes)])
        with patcher:
            frames = asyncio.run(
                _fetch_all_candles("XAUUSD", [date(2024, 1, 15)], 1000, 0, 23, "XAUUSD")
            )
        assert len(frames) == 1
        df = frames[0]
        assert set(["datetime", "open", "high", "low", "close", "volume"]).issubset(df.columns)
        assert len(df) == 5

    def test_both_sides_404_skips_day(self):
        """If both BID and ASK return 404, the day is skipped (holiday)."""
        patcher, _ = _patch_async_client([_make_response(404)])
        with patcher:
            frames = asyncio.run(
                _fetch_all_candles("XAUUSD", [date(2024, 1, 15)], 1000, 0, 23, "XAUUSD")
            )
        assert frames == []

    def test_mid_price_calculation(self):
        """MID = (BID + ASK) / 2 per bar — verified with distinct BID/ASK prices."""
        fmt = ">IIIIIf"
        bid_raw = struct.pack(fmt, 0, 2300000, 2299000, 2298000, 2301000, 1.0)
        ask_raw = struct.pack(fmt, 0, 2302000, 2301000, 2300000, 2303000, 2.0)
        bid_bytes = lzma.compress(bid_raw)
        ask_bytes = lzma.compress(ask_raw)

        async def route_by_url(url, **kwargs):
            return _make_response(200, bid_bytes if "BID" in url else ask_bytes)

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(side_effect=route_by_url)
        mock_cm = MagicMock()
        mock_cm.__aenter__ = AsyncMock(return_value=mock_client)
        mock_cm.__aexit__ = AsyncMock(return_value=None)

        with patch("fetchers.dukascopy_fetcher.httpx.AsyncClient", return_value=mock_cm):
            frames = asyncio.run(
                _fetch_all_candles("XAUUSD", [date(2024, 1, 15)], 1000, 0, 23, "XAUUSD")
            )

        assert len(frames) == 1
        row = frames[0].iloc[0]
        assert abs(row["open"] - 2301.0) < 1e-6   # (2300.0 + 2302.0) / 2
        assert abs(row["volume"] - 3.0) < 1e-6    # 1.0 + 2.0
