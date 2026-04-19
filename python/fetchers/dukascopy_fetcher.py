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

import asyncio
import lzma
import struct
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Optional

import httpx
import pandas as pd

from config import FETCH_TIMEOUT_SECONDS

logger = logging.getLogger(__name__)

# ── Concurrency & Retry constants ────────────────────────────────────────────

CONCURRENT_REQUESTS = 6

MAX_RETRIES = 3
RETRY_BACKOFF_SECONDS = [0.5, 1, 2]

# Circuit breaker: abort if this many consecutive HTTP 503/5xx responses are seen
# across all concurrent tasks. Prevents spending 60+ seconds retrying when
# Dukascopy is clearly unavailable.
CIRCUIT_BREAK_THRESHOLD = 10

_POOL_LIMITS = httpx.Limits(max_connections=25, max_keepalive_connections=20)


def _run_async(coro):
    """Run a coroutine safely from both sync and async calling contexts.

    asyncio.run() fails with 'This event loop is already running' when called
    from within a FastAPI async route handler. In that case, we spawn a dedicated
    thread with its own event loop instead.

    Also handles an edge case where asyncio.get_running_loop() reports no loop
    but asyncio.run() still raises RuntimeError (observed on Railway/uvicorn
    when the sync handler is called indirectly from an async context).
    """
    try:
        asyncio.get_running_loop()
        in_loop = True
    except RuntimeError:
        in_loop = False

    if in_loop:
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=1) as pool:
            return pool.submit(asyncio.run, coro).result()

    try:
        return asyncio.run(coro)
    except RuntimeError as exc:
        if "cannot be called from a running event loop" in str(exc):
            # get_running_loop() said no loop but asyncio.run() disagrees.
            # Delegate to a fresh thread which always has a clean event loop.
            from concurrent.futures import ThreadPoolExecutor
            with ThreadPoolExecutor(max_workers=1) as pool:
                return pool.submit(asyncio.run, coro).result()
        raise

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

# Candle format: ts_sec(u32), open(u32), close(u32), low(u32), high(u32), volume(f32)
_CANDLE_FMT = ">IIIIIf"
_CANDLE_SIZE = 24  # bytes per record


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


def _day_candle_url(duka_symbol: str, year: int, month: int, day: int, side: str = "BID") -> str:
    """Build the .bi5 candle URL for one trading day. Month is 0-indexed in Dukascopy URLs."""
    return (
        f"{_BASE_URL}/{duka_symbol}/"
        f"{year}/{month - 1:02d}/{day:02d}/"
        f"{side}_candles_min_1.bi5"
    )


def _decode_candle_bi5(
    raw: bytes,
    year: int,
    month: int,
    day: int,
    point: int,
    hour_from: int,
    hour_to: int,
) -> Optional[pd.DataFrame]:
    """Decode LZMA-compressed .bi5 candle data into a 1-minute OHLCV DataFrame.

    Binary format per record (24 bytes, big-endian):
      uint32 seconds from day start, uint32 open, uint32 close,
      uint32 low, uint32 high, float32 volume.
    Field order is O, C, L, H (not standard OHLC).
    """
    try:
        data = lzma.decompress(raw)
    except lzma.LZMAError as exc:
        raise RuntimeError(f"LZMA decode error for candle data: {exc}") from exc
    n = len(data) // _CANDLE_SIZE
    if n == 0:
        return None

    day_start = datetime(year, month, day, tzinfo=timezone.utc)
    rows = []
    for i in range(n):
        ts_sec, open_raw, close_raw, low_raw, high_raw, vol_float = struct.unpack_from(
            _CANDLE_FMT, data, i * _CANDLE_SIZE
        )
        dt = day_start + timedelta(seconds=ts_sec)
        if not (hour_from <= dt.hour <= hour_to):
            continue
        rows.append(
            {
                "datetime": pd.Timestamp(dt),  # dt is already UTC-aware
                "open": open_raw / point,
                "high": high_raw / point,
                "low": low_raw / point,
                "close": close_raw / point,
                "volume": float(vol_float),
            }
        )

    if not rows:
        return None
    return pd.DataFrame(rows)


async def _download_candle_raw(
    client: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
    duka_symbol: str,
    day: date,
    side: str,
    abort_event: Optional[asyncio.Event] = None,
    fail_counter: Optional[list] = None,
) -> Optional[bytes]:
    """Download raw .bi5 candle data for one day/side.

    Returns None on HTTP 404 or empty body (holiday / no data).
    Raises RuntimeError on HTTP errors or connection issues after all retries.
    """
    if abort_event and abort_event.is_set():
        raise RuntimeError("Circuit breaker triggered — Dukascopy returning 503")

    url = _day_candle_url(duka_symbol, day.year, day.month, day.day, side)
    day_str = str(day)

    for attempt in range(1 + MAX_RETRIES):
        if abort_event and abort_event.is_set():
            raise RuntimeError("Circuit breaker triggered — Dukascopy returning 503")

        backoff: Optional[float] = None

        async with semaphore:
            # Re-check after acquiring slot: a prior task may have tripped the breaker
            if abort_event and abort_event.is_set():
                raise RuntimeError("Circuit breaker triggered — Dukascopy returning 503")

            try:
                resp = await client.get(url, timeout=10)
            except (httpx.TimeoutException, httpx.ConnectError, httpx.ReadError) as exc:
                if attempt < MAX_RETRIES:
                    backoff = RETRY_BACKOFF_SECONDS[attempt]
                    logger.info(
                        "Connection error for %s %s (attempt %d/%d): %s — retry in %gs",
                        side, day_str, attempt + 1, 1 + MAX_RETRIES, type(exc).__name__, backoff,
                    )
                else:
                    # Persistent timeouts count toward the circuit breaker — same as 503s
                    if fail_counter is not None:
                        fail_counter[0] += 1
                        if fail_counter[0] >= CIRCUIT_BREAK_THRESHOLD and abort_event is not None:
                            logger.warning(
                                "Circuit breaker triggered: %d persistent timeout/error responses — aborting",
                                fail_counter[0],
                            )
                            abort_event.set()
                            raise RuntimeError(
                                f"Circuit breaker: {fail_counter[0]} persistent timeout/connection errors from Dukascopy"
                            )
                    raise RuntimeError(
                        f"Connection error for {side} candle {day_str} after {1 + MAX_RETRIES} attempts: {exc}"
                    ) from exc
            else:
                if resp.status_code == 404 or len(resp.content) == 0:
                    return None  # Holiday / no data

                if resp.status_code == 200:
                    return resp.content

                # Non-200, non-404 (e.g. 429, 503, 500)
                if fail_counter is not None:
                    fail_counter[0] += 1
                    if fail_counter[0] >= CIRCUIT_BREAK_THRESHOLD and abort_event is not None:
                        logger.warning(
                            "Circuit breaker triggered: %d HTTP %d responses — aborting candle fetch",
                            fail_counter[0], resp.status_code,
                        )
                        abort_event.set()
                        raise RuntimeError(
                            f"Circuit breaker: {fail_counter[0]} HTTP {resp.status_code} responses from Dukascopy"
                        )

                if attempt < MAX_RETRIES:
                    backoff = RETRY_BACKOFF_SECONDS[attempt]
                    logger.info(
                        "HTTP %d for %s %s (attempt %d/%d) — retry in %gs",
                        resp.status_code, side, day_str, attempt + 1, 1 + MAX_RETRIES, backoff,
                    )
                else:
                    raise RuntimeError(
                        f"HTTP {resp.status_code} for {side} candle {day_str} after {1 + MAX_RETRIES} attempts"
                    )

        if backoff is not None:
            await asyncio.sleep(backoff)

    return None


async def _fetch_all_candles(
    duka_symbol: str,
    days: list,
    point: int,
    hour_from: int,
    hour_to: int,
    symbol: str,
    price_type: str = "bid",
) -> list[pd.DataFrame]:
    """Download candles for all trading days concurrently.

    price_type="bid"  → BID-only candles (new default; matches TradingView/MT5 standard)
    price_type="mid"  → BID+ASK averaged (legacy behaviour)

    Raises RuntimeError if any download fails or the overall timeout is exceeded.
    Caller should catch RuntimeError and fall back to the tick endpoint.
    """
    semaphore = asyncio.Semaphore(CONCURRENT_REQUESTS)
    abort_event = asyncio.Event()
    fail_counter = [0]

    async with httpx.AsyncClient(limits=_POOL_LIMITS) as client:
        bid_tasks = {
            d: asyncio.create_task(
                _download_candle_raw(client, semaphore, duka_symbol, d, "BID", abort_event, fail_counter)
            )
            for d in days
        }

        if price_type == "mid":
            ask_tasks = {
                d: asyncio.create_task(
                    _download_candle_raw(client, semaphore, duka_symbol, d, "ASK", abort_event, fail_counter)
                )
                for d in days
            }
            all_tasks = list(bid_tasks.values()) + list(ask_tasks.values())
        else:
            ask_tasks = {}
            all_tasks = list(bid_tasks.values())

        done, pending = await asyncio.wait(all_tasks, timeout=FETCH_TIMEOUT_SECONDS)

        if pending:
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
            raise RuntimeError(
                f"Candle-API timeout after {FETCH_TIMEOUT_SECONDS}s: "
                f"{len(pending)} of {len(all_tasks)} requests still pending for {symbol}"
            )

        # Collect raw bytes per day — task.result() re-raises any exception from the task
        bid_raw: dict = {}
        ask_raw: dict = {}
        for d, task in bid_tasks.items():
            bid_raw[d] = task.result()
        for d, task in ask_tasks.items():
            ask_raw[d] = task.result()

    frames: list[pd.DataFrame] = []

    if price_type == "bid":
        # BID-only path: decode BID candles directly, no averaging
        for d in days:
            b = bid_raw[d]
            if b is None:
                continue  # Holiday / no data — expected
            bid_df = _decode_candle_bi5(b, d.year, d.month, d.day, point, hour_from, hour_to)
            if bid_df is not None:
                frames.append(bid_df)
    else:
        # MID path: merge BID + ASK per day → MID DataFrame
        for d in days:
            b = bid_raw[d]
            a = ask_raw[d]

            if b is None and a is None:
                continue  # Holiday / no data — expected

            if b is None or a is None:
                raise RuntimeError(f"Only one side available for {symbol} on {d} — cannot compute MID")

            bid_df = _decode_candle_bi5(b, d.year, d.month, d.day, point, hour_from, hour_to)
            ask_df = _decode_candle_bi5(a, d.year, d.month, d.day, point, hour_from, hour_to)

            if bid_df is None and ask_df is None:
                continue

            if bid_df is None or ask_df is None:
                raise RuntimeError(f"Only one side decoded for {symbol} on {d}")

            merged = bid_df.merge(ask_df, on="datetime", suffixes=("_bid", "_ask"))
            if merged.empty:
                continue

            frames.append(pd.DataFrame({
                "datetime": merged["datetime"],
                "open":   (merged["open_bid"]  + merged["open_ask"])  / 2,
                "high":   (merged["high_bid"]  + merged["high_ask"])  / 2,
                "low":    (merged["low_bid"]   + merged["low_ask"])   / 2,
                "close":  (merged["close_bid"] + merged["close_ask"]) / 2,
                "volume":  merged["volume_bid"] + merged["volume_ask"],
            }))

    return frames


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


async def _download_hour_async(
    client: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
    duka_symbol: str,
    dt: datetime,
    point: int,
    abort_event: Optional[asyncio.Event] = None,
    fail_counter: Optional[list] = None,
) -> Optional[pd.DataFrame]:
    """Download one hour of tick data with retry logic and semaphore-based concurrency.

    - Acquires a semaphore slot only for the HTTP request itself.
    - Retries up to MAX_RETRIES times with backoff.
    - Does NOT retry on HTTP 404 (expected for weekends/holidays).
    - Backoff sleep happens OUTSIDE the semaphore to free the slot for other tasks.
    """
    if abort_event and abort_event.is_set():
        return None

    url = _hour_url(duka_symbol, dt)
    iso_ts = dt.isoformat()

    for attempt in range(1 + MAX_RETRIES):
        if abort_event and abort_event.is_set():
            return None

        backoff: Optional[float] = None

        async with semaphore:  # slot acquired only for the HTTP request
            # Re-check after acquiring slot: a prior task may have tripped the breaker
            if abort_event and abort_event.is_set():
                return None

            try:
                resp = await client.get(url, timeout=20)
            except (httpx.TimeoutException, httpx.ConnectError, httpx.ReadError) as exc:
                if attempt < MAX_RETRIES:
                    backoff = RETRY_BACKOFF_SECONDS[attempt]
                    logger.info("Connection error for %s (attempt %d/%d): %s — retry in %gs",
                                iso_ts, attempt + 1, 1 + MAX_RETRIES, type(exc).__name__, backoff)
                else:
                    logger.warning("Connection error for %s — all %d retries exhausted: %s",
                                   iso_ts, 1 + MAX_RETRIES, exc)
                    return None
            else:
                if resp.status_code == 404 or len(resp.content) == 0:
                    return None  # Weekend / holiday / no trading this hour

                if resp.status_code == 200:
                    try:
                        return _decode_bi5(resp.content, dt, point)
                    except lzma.LZMAError as exc:
                        logger.warning("LZMA decode error for %s: %s", iso_ts, exc)
                        return None

                else:
                    # Non-200, non-404 (e.g. 429, 503, 500) — track for circuit breaker
                    if fail_counter is not None:
                        fail_counter[0] += 1
                        if fail_counter[0] >= CIRCUIT_BREAK_THRESHOLD and abort_event is not None:
                            logger.warning(
                                "Circuit breaker triggered: %d HTTP %d responses — aborting tick fetch",
                                fail_counter[0], resp.status_code,
                            )
                            abort_event.set()
                            return None

                    if attempt < MAX_RETRIES:
                        backoff = RETRY_BACKOFF_SECONDS[attempt]
                        logger.info("HTTP %d for %s (attempt %d/%d) — retry in %gs",
                                    resp.status_code, iso_ts, attempt + 1, 1 + MAX_RETRIES, backoff)
                    else:
                        logger.warning("HTTP %d for %s — all %d retries exhausted",
                                       resp.status_code, iso_ts, 1 + MAX_RETRIES)
                        return None

        # Semaphore released — sleep does NOT hold a concurrency slot
        if backoff is not None:
            await asyncio.sleep(backoff)

    return None


async def _fetch_all_hours(
    duka_symbol: str,
    hours: list[datetime],
    point: int,
    symbol: str,
    fail_counter: Optional[list] = None,
) -> tuple[list[pd.DataFrame], bool]:
    """Download all hours concurrently using an async client with connection pooling."""
    semaphore = asyncio.Semaphore(CONCURRENT_REQUESTS)
    abort_event = asyncio.Event()
    if fail_counter is None:
        fail_counter = [0]
    frames: list[pd.DataFrame] = []
    partial_timeout = False

    async with httpx.AsyncClient(limits=_POOL_LIMITS) as client:
        tasks = [
            asyncio.create_task(
                _download_hour_async(client, semaphore, duka_symbol, h, point, abort_event, fail_counter)
            )
            for h in hours
        ]

        done, pending = await asyncio.wait(tasks, timeout=FETCH_TIMEOUT_SECONDS)

        if pending:
            partial_timeout = True
            logger.warning(
                "Timeout after %ds: partial fetch for %s — %d of %d hours completed",
                FETCH_TIMEOUT_SECONDS, symbol, len(done), len(hours),
            )
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)

        for task in done:
            try:
                result = task.result()
                if result is not None:
                    frames.append(result)
            except Exception as exc:
                logger.warning("Unexpected task error: %s", exc)

    return frames, partial_timeout


def fetch_tick_data_for_hour(
    symbol: str,
    dt: datetime,
) -> Optional[pd.DataFrame]:
    """
    Fetch raw tick data for a single hour from Dukascopy.

    Args:
        symbol: Instrument symbol (e.g. "XAUUSD")
        dt: UTC datetime for the hour (minute/second are ignored; only date+hour used)

    Returns:
        DataFrame with columns: datetime (UTC), ask, bid, ask_volume, bid_volume, price, volume.
        None if no data is available.
    """
    duka_symbol = resolve_symbol(symbol)
    point = POINT_VALUES.get(duka_symbol, 100000)

    hour_dt = datetime(dt.year, dt.month, dt.day, dt.hour, tzinfo=timezone.utc)

    frames, _ = _run_async(_fetch_all_hours(duka_symbol, [hour_dt], point, symbol))
    if not frames:
        return None

    ticks = pd.concat(frames, ignore_index=True).sort_values("datetime")
    ticks["price"] = (ticks["ask"] + ticks["bid"]) / 2
    ticks["volume"] = ticks["ask_volume"] + ticks["bid_volume"]
    ticks = ticks.set_index("datetime")
    ticks = ticks[~ticks.index.duplicated(keep="first")]
    return ticks.reset_index()


def resample_ticks_to_1s(ticks: pd.DataFrame) -> pd.DataFrame:
    """
    Resample tick data to 1-second OHLCV bars.

    Args:
        ticks: DataFrame with columns: datetime, price, volume.
               datetime must be timezone-aware (UTC).

    Returns:
        DataFrame with columns: datetime (UTC), open, high, low, close, volume.
        Seconds with no ticks are dropped (NaN rows not included).
    """
    work = ticks.copy()
    if "datetime" in work.columns:
        work = work.set_index("datetime")

    ohlcv = pd.DataFrame({
        "open": work["price"].resample("1s").first(),
        "high": work["price"].resample("1s").max(),
        "low": work["price"].resample("1s").min(),
        "close": work["price"].resample("1s").last(),
        "volume": work["volume"].resample("1s").sum(),
    })
    ohlcv = ohlcv.dropna(subset=["open"]).reset_index()
    return ohlcv


def fetch_dukascopy(
    symbol: str,
    date_from: date,
    date_to: date,
    hour_from: int = 0,
    hour_to: int = 23,
    price_type: str = "bid",
) -> pd.DataFrame:
    """
    Fetch tick data from Dukascopy and return a 1-minute OHLCV DataFrame.

    Args:
        symbol:     Instrument symbol (e.g. "XAUUSD", "EURUSD", "GER40")
        date_from:  Start date (inclusive)
        date_to:    End date (inclusive)
        hour_from:  First UTC hour to download, 0-23 inclusive (default 0)
        hour_to:    Last UTC hour to download, 0-23 inclusive (default 23)
        price_type: "bid" (default) = BID-only candles; "mid" = legacy BID+ASK average

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

    hour_range_str = "all hours" if (hour_from == 0 and hour_to == 23) else f"h{hour_from:02d}-h{hour_to:02d} UTC"

    # ── Generate trading days (for candle endpoint) ───────────────────────────
    days = []
    cur_day = date_from
    while cur_day <= date_to:
        if cur_day.weekday() < 5:  # 0=Mon … 4=Fri
            days.append(cur_day)
        cur_day += timedelta(days=1)

    # ── Generate all hours (for tick fallback) ────────────────────────────────
    start = datetime(date_from.year, date_from.month, date_from.day, tzinfo=timezone.utc)
    end = datetime(date_to.year, date_to.month, date_to.day, 23, tzinfo=timezone.utc)
    hours = []
    cur = start
    while cur <= end:
        if cur.weekday() < 5 and hour_from <= cur.hour <= hour_to:
            hours.append(cur)
        cur += timedelta(hours=1)

    logger.info(
        "Downloading %s (%s) from Dukascopy [%s] — trying candle endpoint (%d days)",
        symbol, duka_symbol, hour_range_str, len(days),
    )

    # ── Try candle endpoint first (fast: 2 req/day vs 24) ────────────────────
    candle_fallback = False
    partial_timeout = False
    frames: list[pd.DataFrame] = []
    tick_fail_counter = [0]

    try:
        frames = _run_async(_fetch_all_candles(duka_symbol, days, point, hour_from, hour_to, symbol, price_type=price_type))
        logger.info("Candle-API: %d day-frames for %s", len(frames), symbol)
    except Exception as exc:
        exc_str = str(exc)
        # Circuit breaker or persistent timeouts = Dukascopy infrastructure is degraded.
        # The tick endpoint uses the same infrastructure, so a tick fallback would also
        # fail — or succeed but be far too slow for multi-month ranges → 504.
        # Fail fast with a user-friendly message instead of burning more time.
        if "Circuit breaker" in exc_str or "circuit breaker" in exc_str:
            raise ValueError(
                f"Dukascopy is temporarily unavailable for {symbol} — "
                f"too many HTTP 503 responses. Please try again in a few minutes."
            ) from exc
        if "timeout" in exc_str.lower() or "Connection error" in exc_str or "timed out" in exc_str.lower():
            raise ValueError(
                f"Dukascopy requests are timing out for {symbol} — "
                f"the server is temporarily slow. Please try again in a few minutes."
            ) from exc
        logger.warning(
            "Candle-API failed for %s — falling back to tick endpoint: %s", symbol, exc
        )
        candle_fallback = True
        frames, partial_timeout = _run_async(_fetch_all_hours(duka_symbol, hours, point, symbol, tick_fail_counter))

    if not frames:
        if candle_fallback and tick_fail_counter[0] >= CIRCUIT_BREAK_THRESHOLD:
            raise ValueError(
                f"Dukascopy is temporarily unavailable for {symbol} — "
                f"all requests returned HTTP 503. Please try again in a few minutes."
            )
        raise ValueError(
            f"No data returned from Dukascopy for {symbol} ({duka_symbol}) "
            f"between {date_from} and {date_to}. "
            "The symbol may be unsupported or the date range may have no trading data."
        )

    if partial_timeout:
        logger.warning(
            "Returning partial data for %s — cache will NOT be written for incomplete fetch",
            symbol,
        )

    # ── Build OHLCV DataFrame ─────────────────────────────────────────────────
    if candle_fallback:
        # Tick path: frames contain raw tick DataFrames — resample to 1-minute OHLCV
        ticks = pd.concat(frames, ignore_index=True).sort_values("datetime")
        ticks["price"] = (ticks["ask"] + ticks["bid"]) / 2
        ticks["volume"] = ticks["ask_volume"] + ticks["bid_volume"]
        ticks = ticks.set_index("datetime")
        ticks = ticks[~ticks.index.duplicated(keep="first")]
        ohlcv = pd.DataFrame(
            {
                "open":   ticks["price"].resample("1min").first(),
                "high":   ticks["price"].resample("1min").max(),
                "low":    ticks["price"].resample("1min").min(),
                "close":  ticks["price"].resample("1min").last(),
                "volume": ticks["volume"].resample("1min").sum(),
            }
        )
        ohlcv = ohlcv.dropna(subset=["open"]).reset_index()
    else:
        # Candle path: frames are already 1-minute OHLCV DataFrames
        ohlcv = pd.concat(frames, ignore_index=True).sort_values("datetime")
        ohlcv = ohlcv.drop_duplicates(subset=["datetime"]).reset_index(drop=True)

    if partial_timeout:
        ohlcv.attrs["partial"] = True
    if candle_fallback:
        ohlcv.attrs["candle_fallback"] = True

    logger.info("Fetched %d 1-minute bars for %s", len(ohlcv), symbol)
    return ohlcv
