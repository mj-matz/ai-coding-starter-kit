"""
Tests for PROJ-13: Dukascopy Download Reliability.

Covers:
- AdaptiveConcurrencyController (limit adjustment, streak logic, thread-safety)
- _download_hour (retry on 429/errors, no retry on 404, success path)
- fetch_dukascopy (fresh controller per call, basic integration)
"""

import sys
import os
import struct
import lzma
import threading
from datetime import date, datetime, timezone
from unittest.mock import MagicMock, patch, call

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from fetchers.dukascopy_fetcher import (
    AdaptiveConcurrencyController,
    INITIAL_CONCURRENCY_LIMIT,
    MAX_CONCURRENCY_LIMIT,
    MIN_CONCURRENCY_LIMIT,
    SUCCESS_STREAK_THRESHOLD,
    MAX_RETRIES,
    _download_hour,
    fetch_dukascopy,
)


# ── AdaptiveConcurrencyController ────────────────────────────────────────────

class TestAdaptiveConcurrencyController:
    def test_initial_limit(self):
        ctrl = AdaptiveConcurrencyController()
        assert ctrl.limit == INITIAL_CONCURRENCY_LIMIT

    def test_on_error_halves_limit(self):
        ctrl = AdaptiveConcurrencyController(initial_limit=12)
        ctrl.on_error()
        assert ctrl.limit == 6

    def test_on_error_respects_minimum(self):
        ctrl = AdaptiveConcurrencyController(initial_limit=1)
        ctrl.on_error()
        assert ctrl.limit == MIN_CONCURRENCY_LIMIT

    def test_on_success_streak_increases_limit(self):
        ctrl = AdaptiveConcurrencyController(initial_limit=10)
        for _ in range(SUCCESS_STREAK_THRESHOLD):
            ctrl.on_success()
        assert ctrl.limit == 11

    def test_on_success_streak_respects_maximum(self):
        ctrl = AdaptiveConcurrencyController(initial_limit=MAX_CONCURRENCY_LIMIT)
        for _ in range(SUCCESS_STREAK_THRESHOLD):
            ctrl.on_success()
        assert ctrl.limit == MAX_CONCURRENCY_LIMIT

    def test_on_error_resets_success_streak(self):
        ctrl = AdaptiveConcurrencyController(initial_limit=10)
        # Build up partial streak
        for _ in range(SUCCESS_STREAK_THRESHOLD - 1):
            ctrl.on_success()
        ctrl.on_error()
        # One more success should NOT trigger an increase (streak was reset)
        ctrl.on_success()
        assert ctrl.limit == 5  # halved by on_error, not increased

    def test_acquire_release_counts(self):
        ctrl = AdaptiveConcurrencyController(initial_limit=2)
        ctrl.acquire()
        ctrl.acquire()
        # Third acquire would block — release one first
        ctrl.release()
        ctrl.acquire()  # should not block
        ctrl.release()
        ctrl.release()

    def test_thread_safety(self):
        """Multiple threads calling on_success concurrently should not corrupt state."""
        ctrl = AdaptiveConcurrencyController(initial_limit=5)
        errors = []

        def worker():
            try:
                for _ in range(SUCCESS_STREAK_THRESHOLD * 3):
                    ctrl.on_success()
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=worker) for _ in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert not errors
        assert MIN_CONCURRENCY_LIMIT <= ctrl.limit <= MAX_CONCURRENCY_LIMIT


# ── _download_hour ────────────────────────────────────────────────────────────

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


DT = datetime(2024, 1, 15, 10, tzinfo=timezone.utc)
SYMBOL = "XAUUSD"
POINT = 1000


class TestDownloadHour:
    def test_success_returns_dataframe(self):
        ctrl = AdaptiveConcurrencyController()
        with patch("fetchers.dukascopy_fetcher.httpx.get") as mock_get:
            mock_get.return_value = _make_response(200, _make_bi5_bytes())
            result = _download_hour(SYMBOL, DT, POINT, ctrl)
        assert result is not None
        assert list(result.columns) == ["datetime", "ask", "bid", "ask_volume", "bid_volume"]

    def test_404_returns_none_without_retry(self):
        ctrl = AdaptiveConcurrencyController()
        with patch("fetchers.dukascopy_fetcher.httpx.get") as mock_get:
            mock_get.return_value = _make_response(404)
            result = _download_hour(SYMBOL, DT, POINT, ctrl)
        assert result is None
        assert mock_get.call_count == 1  # no retry

    def test_empty_content_returns_none(self):
        ctrl = AdaptiveConcurrencyController()
        with patch("fetchers.dukascopy_fetcher.httpx.get") as mock_get:
            mock_get.return_value = _make_response(200, b"")
            result = _download_hour(SYMBOL, DT, POINT, ctrl)
        assert result is None
        assert mock_get.call_count == 1

    def test_429_retries_and_signals_error(self):
        ctrl = AdaptiveConcurrencyController()
        with patch("fetchers.dukascopy_fetcher.httpx.get") as mock_get, \
             patch("fetchers.dukascopy_fetcher.time.sleep"):
            mock_get.return_value = _make_response(429, b"rate limited")
            result = _download_hour(SYMBOL, DT, POINT, ctrl)
        assert result is None
        assert mock_get.call_count == 1 + MAX_RETRIES

    def test_429_succeeds_on_retry(self):
        ctrl = AdaptiveConcurrencyController()
        with patch("fetchers.dukascopy_fetcher.httpx.get") as mock_get, \
             patch("fetchers.dukascopy_fetcher.time.sleep"):
            mock_get.side_effect = [
                _make_response(429, b"rate limited"),
                _make_response(200, _make_bi5_bytes()),
            ]
            result = _download_hour(SYMBOL, DT, POINT, ctrl)
        assert result is not None
        assert mock_get.call_count == 2

    def test_connection_error_retries(self):
        import httpx as _httpx
        ctrl = AdaptiveConcurrencyController()
        with patch("fetchers.dukascopy_fetcher.httpx.get") as mock_get, \
             patch("fetchers.dukascopy_fetcher.time.sleep"):
            mock_get.side_effect = _httpx.ConnectError("refused")
            result = _download_hour(SYMBOL, DT, POINT, ctrl)
        assert result is None
        assert mock_get.call_count == 1 + MAX_RETRIES

    def test_connection_error_succeeds_on_retry(self):
        import httpx as _httpx
        ctrl = AdaptiveConcurrencyController()
        with patch("fetchers.dukascopy_fetcher.httpx.get") as mock_get, \
             patch("fetchers.dukascopy_fetcher.time.sleep"):
            mock_get.side_effect = [
                _httpx.TimeoutException("timeout"),
                _make_response(200, _make_bi5_bytes()),
            ]
            result = _download_hour(SYMBOL, DT, POINT, ctrl)
        assert result is not None
        assert mock_get.call_count == 2

    def test_429_reduces_controller_limit(self):
        ctrl = AdaptiveConcurrencyController(initial_limit=12)
        with patch("fetchers.dukascopy_fetcher.httpx.get") as mock_get, \
             patch("fetchers.dukascopy_fetcher.time.sleep"):
            mock_get.return_value = _make_response(429, b"rate limited")
            _download_hour(SYMBOL, DT, POINT, ctrl)
        assert ctrl.limit < 12


# ── fetch_dukascopy ───────────────────────────────────────────────────────────

class TestFetchDukascopy:
    def test_fresh_controller_per_call(self):
        """Each fetch_dukascopy call creates an independent controller (BUG-2)."""
        controllers_seen = []
        original_init = AdaptiveConcurrencyController.__init__

        def tracking_init(self, initial_limit=INITIAL_CONCURRENCY_LIMIT):
            original_init(self, initial_limit)
            controllers_seen.append(self)

        with patch("fetchers.dukascopy_fetcher.httpx.get") as mock_get, \
             patch.object(AdaptiveConcurrencyController, "__init__", tracking_init):
            mock_get.return_value = _make_response(200, _make_bi5_bytes())
            fetch_dukascopy("XAUUSD", date(2024, 1, 15), date(2024, 1, 15))
            fetch_dukascopy("XAUUSD", date(2024, 1, 16), date(2024, 1, 16))

        assert len(controllers_seen) == 2
        assert controllers_seen[0] is not controllers_seen[1]

    def test_invalid_hour_range_raises(self):
        with pytest.raises(ValueError, match="Invalid hour range"):
            fetch_dukascopy("XAUUSD", date(2024, 1, 15), date(2024, 1, 15), hour_from=10, hour_to=5)

    def test_no_data_raises_value_error(self):
        with patch("fetchers.dukascopy_fetcher.httpx.get") as mock_get:
            mock_get.return_value = _make_response(404)
            with pytest.raises(ValueError, match="No data returned"):
                fetch_dukascopy("XAUUSD", date(2024, 1, 15), date(2024, 1, 15))

    def test_returns_ohlcv_dataframe(self):
        with patch("fetchers.dukascopy_fetcher.httpx.get") as mock_get:
            mock_get.return_value = _make_response(200, _make_bi5_bytes(5))
            df = fetch_dukascopy("XAUUSD", date(2024, 1, 15), date(2024, 1, 15))
        assert set(["open", "high", "low", "close", "volume"]).issubset(df.columns)
        assert len(df) > 0

    def test_skips_weekends(self):
        """Saturday/Sunday hours should not be downloaded."""
        with patch("fetchers.dukascopy_fetcher.httpx.get") as mock_get:
            mock_get.return_value = _make_response(404)
            # 2024-01-20 is a Saturday, 2024-01-21 is a Sunday
            with pytest.raises(ValueError):
                fetch_dukascopy("XAUUSD", date(2024, 1, 20), date(2024, 1, 21))
        assert mock_get.call_count == 0
