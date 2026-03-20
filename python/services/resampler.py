"""OHLCV resampling service.

Resamples base-resolution OHLCV data (e.g., 1-minute bars) to higher timeframes
using correct aggregation rules:
  - open:   first
  - high:   max
  - low:    min
  - close:  last
  - volume: sum
"""

import logging

import pandas as pd

logger = logging.getLogger(__name__)

# Mapping of timeframe strings to pandas resample rule
TIMEFRAME_TO_RULE = {
    "1m": "1min",
    "2m": "2min",
    "3m": "3min",
    "5m": "5min",
    "15m": "15min",
    "30m": "30min",
    "1h": "1h",
    "4h": "4h",
    "1d": "1D",
    "1wk": "1W",
    "1mo": "1ME",
}


def resample_ohlcv(df: pd.DataFrame, target_timeframe: str) -> pd.DataFrame:
    """
    Resample an OHLCV DataFrame to a higher timeframe.

    Args:
        df: DataFrame with columns: datetime, open, high, low, close, volume.
            The 'datetime' column must be timezone-aware (UTC).
        target_timeframe: Target timeframe string (e.g., "5m", "1h", "1d").

    Returns:
        Resampled DataFrame with the same column structure.

    Raises:
        ValueError: If the target timeframe is not recognized.
    """
    if target_timeframe not in TIMEFRAME_TO_RULE:
        raise ValueError(
            f"Unsupported timeframe '{target_timeframe}'. "
            f"Supported: {', '.join(sorted(TIMEFRAME_TO_RULE.keys()))}"
        )

    rule = TIMEFRAME_TO_RULE[target_timeframe]

    # Set datetime as index for resampling
    work = df.copy()
    if "datetime" in work.columns:
        work = work.set_index("datetime")

    logger.info(f"Resampling {len(work)} rows to {target_timeframe} (rule={rule})")

    resampled = pd.DataFrame()
    resampled["open"] = work["open"].resample(rule).first()
    resampled["high"] = work["high"].resample(rule).max()
    resampled["low"] = work["low"].resample(rule).min()
    resampled["close"] = work["close"].resample(rule).last()
    resampled["volume"] = work["volume"].resample(rule).sum()

    # Drop periods with no data (weekends, holidays)
    resampled = resampled.dropna(subset=["open"])

    # Reset index to return datetime as a column
    resampled = resampled.reset_index()
    resampled = resampled.rename(columns={"index": "datetime"} if "index" in resampled.columns else {})

    logger.info(f"Resampled to {len(resampled)} bars at {target_timeframe}")

    return resampled
