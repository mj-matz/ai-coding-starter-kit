"""Provider for 1-second OHLCV data used by the engine's zoom-in logic (PROJ-15).

Creates a callback function that the engine can call with a bar timestamp
to get 1-second OHLCV data for that minute. Handles caching via cache_service.
"""

import logging
from datetime import date, timezone
from typing import Callable, Dict, Optional, Tuple

import pandas as pd

logger = logging.getLogger(__name__)


def create_1s_data_provider(
    symbol: str,
) -> Callable[[pd.Timestamp], Optional[pd.DataFrame]]:
    """
    Create a callback that returns 1-second OHLCV data for a given 1-minute bar.

    The callback:
    1. Checks the local 1s Parquet cache for the relevant hour.
    2. If cache miss, fetches tick data for that hour from Dukascopy,
       resamples to 1-second bars, and caches the result.
    3. Filters the 1-second data to the specific minute requested.

    Args:
        symbol: Instrument symbol (e.g. "XAUUSD")

    Returns:
        A callable(bar_time: pd.Timestamp) -> Optional[pd.DataFrame]
    """
    # In-memory cache: (date, hour) -> DataFrame of 1s bars for that hour
    _hour_cache: Dict[Tuple[date, int], Optional[pd.DataFrame]] = {}

    def _get_1s_data(bar_time: pd.Timestamp) -> Optional[pd.DataFrame]:
        """Get 1-second OHLCV data for the minute starting at bar_time."""
        # Lazy imports to avoid circular dependencies
        from services.cache_service import find_cached_1s_entry, load_cached_data, save_1s_to_cache
        from fetchers.dukascopy_fetcher import fetch_tick_data_for_hour, resample_ticks_to_1s

        # Ensure bar_time is UTC
        if bar_time.tzinfo is None:
            bar_time = bar_time.tz_localize("UTC")

        bar_date = bar_time.date()
        bar_hour = bar_time.hour

        cache_key = (bar_date, bar_hour)

        # Check in-memory cache first
        if cache_key not in _hour_cache:
            # Check disk/Supabase cache
            cached_path = find_cached_1s_entry(symbol, bar_date, bar_hour)
            if cached_path is not None:
                try:
                    hour_df = load_cached_data(str(cached_path))
                    # Ensure datetime column is timezone-aware
                    if "datetime" in hour_df.columns and hour_df["datetime"].dt.tz is None:
                        hour_df["datetime"] = pd.to_datetime(hour_df["datetime"]).dt.tz_localize("UTC")
                    _hour_cache[cache_key] = hour_df
                except Exception as exc:
                    logger.warning("Failed to load cached 1s data for %s h%02d: %s", bar_date, bar_hour, exc)
                    _hour_cache[cache_key] = None
            else:
                # Fetch tick data for this hour and resample
                try:
                    from datetime import datetime as dt_cls
                    hour_dt = dt_cls(bar_date.year, bar_date.month, bar_date.day, bar_hour, tzinfo=timezone.utc)
                    ticks = fetch_tick_data_for_hour(symbol, hour_dt)
                    if ticks is not None and not ticks.empty:
                        hour_1s = resample_ticks_to_1s(ticks)
                        # Cache to disk
                        save_1s_to_cache(hour_1s, symbol, bar_date, bar_hour)
                        _hour_cache[cache_key] = hour_1s
                    else:
                        _hour_cache[cache_key] = None
                except Exception as exc:
                    logger.warning("Failed to fetch/resample 1s data for %s h%02d: %s", bar_date, bar_hour, exc)
                    _hour_cache[cache_key] = None

        hour_df = _hour_cache.get(cache_key)
        if hour_df is None or hour_df.empty:
            return None

        # Filter to the specific minute
        minute_start = bar_time.floor("min")
        minute_end = minute_start + pd.Timedelta(minutes=1)

        if "datetime" in hour_df.columns:
            mask = (hour_df["datetime"] >= minute_start) & (hour_df["datetime"] < minute_end)
            minute_df = hour_df.loc[mask].copy()
        else:
            # datetime is the index
            mask = (hour_df.index >= minute_start) & (hour_df.index < minute_end)
            minute_df = hour_df.loc[mask].copy().reset_index()

        if minute_df.empty:
            return None

        return minute_df

    return _get_1s_data
