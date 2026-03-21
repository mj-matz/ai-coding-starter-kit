"""Direct Dukascopy data fetcher — replaces the broken duka==0.2.0 library.

Downloads .bi5 tick data directly from Dukascopy's public datafeed API:
  https://datafeed.dukascopy.com/datafeed/{SYMBOL}/{YEAR}/{MONTH-1:02d}/{DAY:02d}/{HOUR:02d}h_ticks.bi5

Each .bi5 file is LZMA-compressed binary data. Each tick is 20 bytes:
  - uint32 big-endian: milliseconds from start of the hour
  - uint32 big-endian: ask price (raw integer, divide by POINT_VALUE)
  - uint32 big-endian: bid price (raw integer, divide by POINT_VALUE)
  - float32 big-endian: ask volume
  - float32 big-endian: bid volume
"""

import lzma
import struct
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from typing import Optional

import httpx
import pandas as pd

from config import FETCH_TIMEOUT_SECONDS

logger = logging.getLogger(__name__)

# ── Concurrency & Retry constants ────────────────────────────────────────────

THREAD_POOL_HARD_CEILING = 20
INITIAL_CONCURRENCY_LIMIT = 12
MAX_CONCURRENCY_LIMIT = 20
MIN_CONCURRENCY_LIMIT = 1
SUCCESS_STREAK_THRESHOLD = 10

MAX_RETRIES = 3
RETRY_BACKOFF_SECONDS = [1, 2, 4]


# ── Adaptive Concurrency Controller ─────────────────────────────────────────

class AdaptiveConcurrencyController:
    """Thread-safe adaptive concurrency controller using threading.Condition.

    Manages a soft concurrency limit that adjusts based on success/error signals.
    The ThreadPoolExecutor provides a hard ceiling; this controller provides a
    dynamic soft ceiling below it.
    """

    def __init__(self, initial_limit: int = INITIAL_CONCURRENCY_LIMIT):
        self._condition = threading.Condition()
        self._limit = initial_limit
        self._active = 0
        self._success_streak = 0

    @property
    def limit(self) -> int:
        with self._condition:
            return self._limit

    def acquire(self) -> None:
        """Block until a concurrency slot is available."""
        with self._condition:
            while self._active >= self._limit:
                self._condition.wait()
            self._active += 1

    def release(self) -> None:
        """Release a concurrency slot and notify waiting threads."""
        with self._condition:
            self._active -= 1
            self._condition.notify()

    def on_success(self) -> None:
        """Record a successful request. After SUCCESS_STREAK_THRESHOLD consecutive
        successes, increase the limit by 1 (up to MAX_CONCURRENCY_LIMIT)."""
        with self._condition:
            self._success_streak += 1
            if self._success_streak >= SUCCESS_STREAK_THRESHOLD:
                self._success_streak = 0
                old = self._limit
                self._limit = min(self._limit + 1, MAX_CONCURRENCY_LIMIT)
                if self._limit != old:
                    logger.debug(
                        "Concurrency limit increased: %d -> %d", old, self._limit
                    )
                self._condition.notify_all()

    def on_error(self) -> None:
        """Record a rate-limit or timeout error. Halve the limit immediately
        (down to MIN_CONCURRENCY_LIMIT) and reset the success streak."""
        with self._condition:
            self._success_streak = 0
            old = self._limit
            self._limit = max(self._limit // 2, MIN_CONCURRENCY_LIMIT)
            if self._limit != old:
                logger.info(
                    "Concurrency limit reduced: %d -> %d", old, self._limit
                )


# ── Symbol mapping ────────────────────────────────────────────────────────────

DUKASCOPY_SYMBOLS: dict[str, str] = {
    # Forex Majors
    "EURUSD": "EURUSD", "GBPUSD": "GBPUSD", "USDCHF": "USDCHF",
    "USDJPY": "USDJPY", "AUDUSD": "AUDUSD", "NZDUSD": "NZDUSD", "USDCAD": "USDCAD",
    # Forex Crosses
    "EURGBP": "EURGBP", "EURJPY": "EURJPY", "GBPJPY": "GBPJPY",
    "EURAUD": "EURAUD", "EURCHF": "EURCHF", "GBPCHF": "GBPCHF",
    "AUDCAD": "AUDCAD", "AUDJPY": "AUDJPY", "CADJPY": "CADJPY",
    "CHFJPY": "CHFJPY", "NZDJPY": "NZDJPY",
    # Indices
    "GER30": "DEUIDXEUR", "GER40": "DEUIDXEUR", "DAX": "DEUIDXEUR",
    "US30": "USA30IDXUSD", "US500": "USA500IDXUSD", "SPX500": "USA500IDXUSD",
    "NAS100": "USATECHIDXUSD", "USTEC": "USATECHIDXUSD",
    "UK100": "GBRIDXGBP", "FTSE100": "GBRIDXGBP",
    "FRA40": "FRAIDXEUR", "JPN225": "JPNIDXJPY", "AUS200": "AUSIDXAUD",
    # Precious Metals
    "XAUUSD": "XAUUSD", "GOLD": "XAUUSD",
    "XAGUSD": "XAGUSD", "SILVER": "XAGUSD",
    # Energy
    "WTIUSD": "LIGHTCMDUSD", "CRUDEOIL": "LIGHTCMDUSD", "WTI": "LIGHTCMDUSD",
    "BRENTUSD": "BRENTCMDUSD", "BRENT": "BRENTCMDUSD",
    # Agricultural
    "SOYBEANUSD": "SOYBEANCMDUSX", "SOYBEAN": "SOYBEANCMDUSX",
    # Industrial Metals
    "COPPERUSD": "COPPERCMDUSD", "COPPER": "COPPERCMDUSD",
}

# Raw price divisor: actual_price = raw_integer / POINT_VALUE[duka_symbol]
# Determined by the number of decimal places Dukascopy encodes for each instrument.
POINT_VALUES: dict[str, int] = {
    # Standard Forex — 5 decimal places (e.g. 1.08234 → raw 108234 / 100000)
    "EURUSD": 100000, "GBPUSD": 100000, "USDCHF": 100000,
    "AUDUSD": 100000, "NZDUSD": 100000, "USDCAD": 100000,
    "EURGBP": 100000, "EURAUD": 100000, "EURCHF": 100000,
    "GBPCHF": 100000, "AUDCAD": 100000,
    # JPY pairs — 3 decimal places (e.g. 150.123 → raw 150123 / 1000)
    "USDJPY": 1000, "EURJPY": 1000, "GBPJPY": 1000,
    "AUDJPY": 1000, "CADJPY": 1000, "CHFJPY": 1000, "NZDJPY": 1000,
    # Metals — 3 decimal places (e.g. XAUUSD 2300.123 → raw 2300123 / 1000)
    "XAUUSD": 1000, "XAGUSD": 1000,
    # Energy — 3 decimal places
    "LIGHTCMDUSD": 1000, "BRENTCMDUSD": 1000,
    # Indices — 3 decimal places (e.g. DAX 23653.000 → raw 23653000 / 1000)
    "DEUIDXEUR": 1000, "USA30IDXUSD": 1000, "USA500IDXUSD": 1000,
    "USATECHIDXUSD": 1000, "GBRIDXGBP": 1000, "FRAIDXEUR": 1000,
    "JPNIDXJPY": 1000, "AUSIDXAUD": 1000,
    # Agricultural
    "SOYBEANCMDUSX": 10000,
    # Industrial
    "COPPERCMDUSD": 100000,
}

_BASE_URL = "https://datafeed.dukascopy.com/datafeed"

# Binary format per tick: ms_uint32, ask_uint32, bid_uint32, ask_float32, bid_float32
_TICK_FMT = ">IIIff"
_TICK_SIZE = struct.calcsize(_TICK_FMT)  # 20 bytes


def resolve_symbol(symbol: str) -> str:
    """Resolve a user-friendly symbol to a Dukascopy ticker."""
    return DUKASCOPY_SYMBOLS.get(symbol.upper(), symbol.upper())


def get_supported_symbols() -> dict[str, str]:
    return dict(DUKASCOPY_SYMBOLS)


def _hour_url(duka_symbol: str, dt: datetime) -> str:
    """Build the .bi5 download URL for one hour. Month is 0-indexed in Dukascopy URLs."""
    return (
        f"{_BASE_URL}/{duka_symbol}/"
        f"{dt.year}/{dt.month - 1:02d}/{dt.day:02d}/"
        f"{dt.hour:02d}h_ticks.bi5"
    )


def _decode_bi5(raw: bytes, dt: datetime, point: int) -> Optional[pd.DataFrame]:
    """Decode LZMA-compressed .bi5 tick data into a DataFrame."""
    data = lzma.decompress(raw)
    n = len(data) // _TICK_SIZE
    if n == 0:
        return None

    hour_ms = int(dt.timestamp() * 1000)
    rows = []
    for i in range(n):
        ms, ask_raw, bid_raw, ask_vol, bid_vol = struct.unpack_from(
            _TICK_FMT, data, i * _TICK_SIZE
        )
        rows.append(
            {
                "datetime": pd.Timestamp(hour_ms + ms, unit="ms", tz="UTC"),
                "ask": ask_raw / point,
                "bid": bid_raw / point,
                "ask_volume": float(ask_vol),
                "bid_volume": float(bid_vol),
            }
        )
    return pd.DataFrame(rows)


def _download_hour(
    duka_symbol: str,
    dt: datetime,
    point: int,
    controller: AdaptiveConcurrencyController,
) -> Optional[pd.DataFrame]:
    """Download one hour of tick data with retry logic and adaptive concurrency.

    - Acquires a concurrency slot before making the HTTP request.
    - Retries up to MAX_RETRIES times with exponential backoff.
    - Does NOT retry on HTTP 404 (expected for weekends/holidays).
    - Signals success/error to the concurrency controller.
    """
    url = _hour_url(duka_symbol, dt)
    iso_ts = dt.isoformat()

    for attempt in range(1 + MAX_RETRIES):
        controller.acquire()
        try:
            resp = httpx.get(url, timeout=20, follow_redirects=True)

            if resp.status_code == 404 or len(resp.content) == 0:
                controller.on_success()
                return None  # Normal: weekend / holiday / no trading that hour

            if resp.status_code == 429:
                controller.on_error()
                if attempt < MAX_RETRIES:
                    backoff = RETRY_BACKOFF_SECONDS[attempt]
                    logger.info(
                        "HTTP 429 for %s (attempt %d/%d) — retrying in %ds",
                        iso_ts, attempt + 1, 1 + MAX_RETRIES, backoff,
                    )
                    time.sleep(backoff)
                    continue
                logger.warning(
                    "HTTP 429 for %s — all %d retries exhausted",
                    iso_ts, 1 + MAX_RETRIES,
                )
                return None

            if resp.status_code != 200:
                controller.on_error()
                if attempt < MAX_RETRIES:
                    backoff = RETRY_BACKOFF_SECONDS[attempt]
                    logger.info(
                        "HTTP %d for %s (attempt %d/%d) — retrying in %ds",
                        resp.status_code, iso_ts, attempt + 1, 1 + MAX_RETRIES, backoff,
                    )
                    time.sleep(backoff)
                    continue
                logger.warning(
                    "HTTP %d for %s — all %d retries exhausted",
                    resp.status_code, iso_ts, 1 + MAX_RETRIES,
                )
                return None

            # Successful HTTP 200
            try:
                result = _decode_bi5(resp.content, dt, point)
                controller.on_success()
                return result
            except lzma.LZMAError as exc:
                logger.warning("LZMA decode error for %s — hour skipped: %s", iso_ts, exc)
                controller.on_success()  # Not a server error, no need to throttle
                return None

        except (httpx.TimeoutException, httpx.ConnectError, httpx.ReadError) as exc:
            controller.on_error()
            if attempt < MAX_RETRIES:
                backoff = RETRY_BACKOFF_SECONDS[attempt]
                logger.info(
                    "Connection error for %s (attempt %d/%d): %s — retrying in %ds",
                    iso_ts, attempt + 1, 1 + MAX_RETRIES, type(exc).__name__, backoff,
                )
                time.sleep(backoff)
                continue
            logger.warning(
                "Connection error for %s — all %d retries exhausted: %s",
                iso_ts, 1 + MAX_RETRIES, exc,
            )
            return None

        except Exception as exc:
            logger.warning("Unexpected error for %s — hour skipped: %s", iso_ts, exc)
            return None

        finally:
            controller.release()

    return None


def fetch_dukascopy(
    symbol: str,
    date_from: date,
    date_to: date,
    hour_from: int = 0,
    hour_to: int = 23,
) -> pd.DataFrame:
    """
    Fetch tick data from Dukascopy and return a 1-minute OHLCV DataFrame.

    Args:
        symbol:    Instrument symbol (e.g. "XAUUSD", "EURUSD", "GER40")
        date_from: Start date (inclusive)
        date_to:   End date (inclusive)
        hour_from: First UTC hour to download, 0-23 inclusive (default 0)
        hour_to:   Last UTC hour to download, 0-23 inclusive (default 23)

    Returns:
        DataFrame with columns: datetime (UTC), open, high, low, close, volume.
        May be partial if a timeout occurred (warning is logged).

    Raises:
        ValueError: No data found or symbol unsupported.
    """
    if not (0 <= hour_from <= 23 and 0 <= hour_to <= 23 and hour_from <= hour_to):
        raise ValueError(f"Invalid hour range: hour_from={hour_from}, hour_to={hour_to} (must be 0-23, from <= to)")

    duka_symbol = resolve_symbol(symbol)
    point = POINT_VALUES.get(duka_symbol, 100000)

    # Generate all hours in [date_from, date_to] inclusive, skipping weekends
    # and optionally restricting to [hour_from, hour_to] (BUG-27).
    start = datetime(date_from.year, date_from.month, date_from.day, tzinfo=timezone.utc)
    end = datetime(date_to.year, date_to.month, date_to.day, 23, tzinfo=timezone.utc)
    hours = []
    cur = start
    while cur <= end:
        if cur.weekday() < 5 and hour_from <= cur.hour <= hour_to:  # 0=Mon … 4=Fri
            hours.append(cur)
        cur += timedelta(hours=1)

    hour_range_str = "all hours" if (hour_from == 0 and hour_to == 23) else f"h{hour_from:02d}-h{hour_to:02d} UTC"
    logger.info(
        "Downloading %d hours of %s (%s) from Dukascopy [%s]",
        len(hours),
        symbol,
        duka_symbol,
        hour_range_str,
    )

    controller = AdaptiveConcurrencyController()
    frames: list[pd.DataFrame] = []
    partial_timeout = False
    with ThreadPoolExecutor(max_workers=THREAD_POOL_HARD_CEILING) as executor:
        future_map = {
            executor.submit(_download_hour, duka_symbol, h, point, controller): h
            for h in hours
        }
        try:
            for future in as_completed(future_map, timeout=FETCH_TIMEOUT_SECONDS):
                result = future.result()
                if result is not None:
                    frames.append(result)
        except TimeoutError:
            partial_timeout = True
            logger.warning(
                "Timeout after %ds: partial fetch for %s — %d of %d hours downloaded",
                FETCH_TIMEOUT_SECONDS,
                symbol,
                len(frames),
                len(hours),
            )

    if not frames:
        raise ValueError(
            f"No data returned from Dukascopy for {symbol} ({duka_symbol}) "
            f"between {date_from} and {date_to}. "
            "The symbol may be unsupported or the date range may have no trading data."
        )

    if partial_timeout:
        logger.warning(
            "Returning partial data for %s (%d of %d hours) — cache will NOT be written for incomplete fetch",
            symbol,
            len(frames),
            len(hours),
        )

    ticks = pd.concat(frames, ignore_index=True).sort_values("datetime")

    # Mid price
    ticks["price"] = (ticks["ask"] + ticks["bid"]) / 2
    ticks["volume"] = ticks["ask_volume"] + ticks["bid_volume"]

    ticks = ticks.set_index("datetime")
    ticks = ticks[~ticks.index.duplicated(keep="first")]

    # Resample to 1-minute OHLCV
    ohlcv = pd.DataFrame(
        {
            "open": ticks["price"].resample("1min").first(),
            "high": ticks["price"].resample("1min").max(),
            "low": ticks["price"].resample("1min").min(),
            "close": ticks["price"].resample("1min").last(),
            "volume": ticks["volume"].resample("1min").sum(),
        }
    )
    ohlcv = ohlcv.dropna(subset=["open"]).reset_index()

    if partial_timeout:
        ohlcv.attrs["partial"] = True

    logger.info("Fetched %d 1-minute bars for %s", len(ohlcv), symbol)
    return ohlcv
