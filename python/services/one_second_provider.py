"""Provider for 1-second OHLCV data used by the engine's zoom-in logic (PROJ-15).

Creates a callback function that the engine can call with a bar timestamp
to get 1-second OHLCV data for that minute. Handles caching via cache_service.
"""

import logging
from datetime import date, timezone
from typing import Callable, Dict, List, Optional, Tuple

import pandas as pd

logger = logging.getLogger(__name__)


def create_1s_data_provider(
    symbol: str,
    bar_duration_minutes: int = 1,
) -> Callable[[pd.Timestamp], Optional[pd.DataFrame]]:
    """
    Create a callback that returns 1-second OHLCV data for a given bar.

    The callback:
    1. Checks the local 1s Parquet cache for each required hour.
    2. On cache miss, fetches tick data for that hour from Dukascopy,
       resamples to 1-second bars, and caches the result.
    3. Filters the 1-second data to the full bar time range.

    Args:
        symbol: Instrument symbol (e.g. "XAUUSD")
        bar_duration_minutes: Duration of one OHLCV bar in minutes (e.g. 2 for "2m").
            Used to return the correct slice of 1s data when bars are wider than 1 minute.

    Returns:
        A callable(bar_time: pd.Timestamp) -> Optional[pd.DataFrame]
    """
    # In-memory cache: (date, hour) -> DataFrame of 1s bars for that hour
    _hour_cache: Dict[Tuple[date, int], Optional[pd.DataFrame]] = {}

    def _load_hour(bar_date: date, bar_hour: int) -> Optional[pd.DataFrame]:
        """Load (and cache) 1s data for a single calendar hour."""
        from services.cache_service import find_cached_1s_entry, load_cached_data, save_1s_to_cache
        from fetchers.dukascopy_fetcher import fetch_tick_data_for_hour, resample_ticks_to_1s

        cache_key = (bar_date, bar_hour)
        if cache_key in _hour_cache:
            return _hour_cache[cache_key]

        # Check disk/Supabase cache
        cached_path = find_cached_1s_entry(symbol, bar_date, bar_hour)
        if cached_path is not None:
            try:
                hour_df = load_cached_data(str(cached_path))
                if "datetime" in hour_df.columns and hour_df["datetime"].dt.tz is None:
                    hour_df["datetime"] = pd.to_datetime(hour_df["datetime"]).dt.tz_localize("UTC")
                _hour_cache[cache_key] = hour_df
            except Exception as exc:
                logger.warning("Failed to load cached 1s data for %s h%02d: %s", bar_date, bar_hour, exc)
                _hour_cache[cache_key] = None
        else:
            # Fetch tick data for this hour and resample to 1s
            try:
                from datetime import datetime as dt_cls
                hour_dt = dt_cls(bar_date.year, bar_date.month, bar_date.day, bar_hour, tzinfo=timezone.utc)
                ticks = fetch_tick_data_for_hour(symbol, hour_dt)
                if ticks is not None and not ticks.empty:
                    hour_1s = resample_ticks_to_1s(ticks)
                    save_1s_to_cache(hour_1s, symbol, bar_date, bar_hour)
                    _hour_cache[cache_key] = hour_1s
                else:
                    _hour_cache[cache_key] = None
            except Exception as exc:
                logger.warning("Failed to fetch/resample 1s data for %s h%02d: %s", bar_date, bar_hour, exc)
                _hour_cache[cache_key] = None

        return _hour_cache.get(cache_key)

    def _get_1s_data(bar_time: pd.Timestamp) -> Optional[pd.DataFrame]:
        """Get 1-second OHLCV data covering the full bar starting at bar_time."""
        if bar_time.tzinfo is None:
            bar_time = bar_time.tz_localize("UTC")

        minute_start = bar_time.floor("min")
        minute_end = minute_start + pd.Timedelta(minutes=bar_duration_minutes)

        # Collect data from all calendar hours that overlap with [minute_start, minute_end).
        # A bar wider than ~60 min (e.g. 1h timeframe) may span two consecutive hours.
        start_hour_ts = minute_start.floor("h")
        end_hour_ts = (minute_end - pd.Timedelta(seconds=1)).floor("h")

        frames: List[pd.DataFrame] = []
        cur = start_hour_ts
        while cur <= end_hour_ts:
            h_df = _load_hour(cur.date(), cur.hour)
            if h_df is not None and not h_df.empty:
                frames.append(h_df)
            cur += pd.Timedelta(hours=1)

        if not frames:
            return None

        combined = pd.concat(frames, ignore_index=True) if len(frames) > 1 else frames[0].copy()

        # Filter to exactly [minute_start, minute_end)
        if "datetime" in combined.columns:
            mask = (combined["datetime"] >= minute_start) & (combined["datetime"] < minute_end)
            result = combined.loc[mask].copy()
        else:
            # datetime is the index
            mask = (combined.index >= minute_start) & (combined.index < minute_end)
            result = combined.loc[mask].copy().reset_index()

        return result if not result.empty else None

    return _get_1s_data
