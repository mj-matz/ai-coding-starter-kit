"""Time-Range Breakout Strategy (PROJ-3).

Computes a consolidation range from bars within [range_start, range_end) each
trading day, then emits OCO stop-entry signals on the first bar after
range_end.  The engine manages pending orders, OCO cancellation, and expiry.

Registry exports (PROJ-6):
    STRATEGY_ID, STRATEGY_NAME, STRATEGY_DESC, PARAMS_SCHEMA, StrategyClass
"""

from dataclasses import dataclass
from datetime import time
from typing import Literal, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import numpy as np
import pandas as pd
from pydantic import BaseModel, Field

from .base import BaseStrategy

# ── Registry metadata ───────────────────────────────────────────────────────
STRATEGY_ID = "time_range_breakout"
STRATEGY_NAME = "Time-Range Breakout"
STRATEGY_DESC = (
    "Berechnet eine Konsolidierungs-Range aus Bars innerhalb [rangeStart, rangeEnd) "
    "und setzt OCO-Stop-Entry-Orders oberhalb/unterhalb der Range."
)


class BreakoutParamsSchema(BaseModel):
    """Pydantic schema for UI JSON-Schema generation + validation."""

    rangeStart: str = Field(
        default="02:00",
        pattern=r"^([01]\d|2[0-3]):[0-5]\d$",
        json_schema_extra={"label": "Range Start", "ui_type": "time"},
    )
    rangeEnd: str = Field(
        default="06:00",
        pattern=r"^([01]\d|2[0-3]):[0-5]\d$",
        json_schema_extra={"label": "Range End", "ui_type": "time"},
    )
    triggerDeadline: str = Field(
        default="12:00",
        pattern=r"^([01]\d|2[0-3]):[0-5]\d$",
        json_schema_extra={"label": "Trigger Deadline", "ui_type": "time"},
    )
    timeExit: str = Field(
        default="20:00",
        pattern=r"^([01]\d|2[0-3]):[0-5]\d$",
        json_schema_extra={"label": "Time Exit", "ui_type": "time"},
    )
    stopLoss: float = Field(
        default=150, gt=0,
        json_schema_extra={"label": "Stop Loss (Pips)"},
    )
    takeProfit: float = Field(
        default=175, gt=0,
        json_schema_extra={"label": "Take Profit (Pips)"},
    )
    direction: Literal["long", "short", "both"] = Field(
        default="both",
        json_schema_extra={"label": "Direction"},
    )
    entryDelayBars: int = Field(
        default=1, ge=0,
        json_schema_extra={"label": "Entry Delay (Bars)"},
    )
    trailTriggerPips: Optional[float] = Field(
        default=None, gt=0,
        json_schema_extra={"label": "Trail Trigger (Pips)"},
    )
    trailLockPips: Optional[float] = Field(
        default=None, gt=0,
        json_schema_extra={"label": "Trail Lock (Pips)"},
    )


PARAMS_SCHEMA = BreakoutParamsSchema


@dataclass
class SkippedDay:
    """Represents a trading day that was skipped during signal generation."""

    date: str
    reason: str  # NO_BARS | NO_RANGE_BARS | FLAT_RANGE | NO_SIGNAL_BAR | DEADLINE_MISSED


@dataclass
class BreakoutParams:
    """All user-configurable parameters for the breakout strategy."""

    asset: str                 # instrument identifier, e.g. "XAUUSD", "GER40"
    range_start: time          # e.g. time(3, 0) for 03:00
    range_end: time            # e.g. time(8, 0) for 08:00
    trigger_deadline: time     # e.g. time(17, 0) for 17:00
    stop_loss_pips: float      # fixed pip offset from entry price for SL
    take_profit_pips: float    # fixed pip offset from entry price for TP
    pip_size: float            # instrument pip size from engine config
    timezone: str = "UTC"      # IANA timezone, e.g. "Europe/Berlin" for CET
    direction_filter: Literal["long_only", "short_only", "both"] = "both"
    trail_trigger_pips: Optional[float] = None  # profit level (pips) that activates the lock
    trail_lock_pips: Optional[float] = None     # pips from entry to which SL is moved on trigger
    entry_offset_pips: float = 0.0
    entry_delay_bars: int = 1  # bars to wait after range_end before entry is possible;
                               # 0 = first bar at range_end, 1 = one bar later (default), N = N bars later


class BreakoutStrategy(BaseStrategy):
    """Time-Range Breakout: buy stop above / sell stop below the range."""

    def validate_params(self, params: BreakoutParams) -> None:
        """Validate breakout parameters. Raises ValueError on invalid input."""
        if params.range_end == params.range_start:
            raise ValueError(
                f"range_end ({params.range_end}) must differ from "
                f"range_start ({params.range_start}); zero-width ranges are not allowed"
            )
        # Compute effective range duration in minutes.
        # For overnight ranges (range_start > range_end) the window wraps midnight,
        # e.g. 22:00–02:00 = 4 h. A "range" of 10:00–08:00 would be 22 h — not a
        # legitimate overnight window, so we cap at MAX_RANGE_MINUTES (12 h).
        start_min = params.range_start.hour * 60 + params.range_start.minute
        end_min = params.range_end.hour * 60 + params.range_end.minute
        duration_min = end_min - start_min if end_min > start_min else end_min - start_min + 24 * 60
        MAX_RANGE_MINUTES = 12 * 60  # 12 hours
        if duration_min > MAX_RANGE_MINUTES:
            raise ValueError(
                f"range_end ({params.range_end}) results in a range duration of "
                f"{duration_min // 60}h {duration_min % 60}m, which exceeds the "
                f"maximum of {MAX_RANGE_MINUTES // 60}h. "
                f"For overnight ranges use e.g. range_start=22:00, range_end=02:00."
            )
        # For overnight ranges (range_start > range_end) trigger_deadline is on the next
        # calendar day, so the simple time comparison still works (deadline must follow
        # range_end on that next day, e.g. range_end=02:00, deadline=04:00).
        if params.trigger_deadline <= params.range_end:
            raise ValueError(
                f"trigger_deadline ({params.trigger_deadline}) must be after "
                f"range_end ({params.range_end})"
            )
        if params.stop_loss_pips <= 0:
            raise ValueError(
                f"stop_loss_pips must be > 0, got {params.stop_loss_pips}"
            )
        if params.take_profit_pips <= 0:
            raise ValueError(
                f"take_profit_pips must be > 0, got {params.take_profit_pips}"
            )
        if params.entry_offset_pips < 0:
            raise ValueError(
                f"entry_offset_pips must be >= 0, got {params.entry_offset_pips}"
            )
        if params.trail_trigger_pips is not None or params.trail_lock_pips is not None:
            if params.trail_trigger_pips is None or params.trail_lock_pips is None:
                raise ValueError(
                    "Both trail_trigger_pips and trail_lock_pips must be set together"
                )
            if params.trail_lock_pips <= 0:
                raise ValueError(
                    f"trail_lock_pips must be > 0, got {params.trail_lock_pips}"
                )
            if params.trail_trigger_pips <= params.trail_lock_pips:
                raise ValueError(
                    f"trail_trigger_pips ({params.trail_trigger_pips}) must be > "
                    f"trail_lock_pips ({params.trail_lock_pips})"
                )
            if params.trail_trigger_pips >= params.take_profit_pips:
                raise ValueError(
                    f"trail_trigger_pips ({params.trail_trigger_pips}) must be < "
                    f"take_profit_pips ({params.take_profit_pips})"
                )
        if not params.asset or not params.asset.strip():
            raise ValueError("asset must not be empty")
        try:
            ZoneInfo(params.timezone)
        except (ZoneInfoNotFoundError, KeyError):
            raise ValueError(f"Unknown timezone: '{params.timezone}'")
        if params.pip_size <= 0:
            raise ValueError(f"pip_size must be > 0, got {params.pip_size}")
        if not isinstance(params.entry_delay_bars, int) or params.entry_delay_bars < 0:
            raise ValueError(
                f"entry_delay_bars must be a non-negative integer, got {params.entry_delay_bars}"
            )

    def generate_signals(
        self, df: pd.DataFrame, params: BreakoutParams, mt5_mode: bool = False,
        already_past_rejection: bool = False,
    ) -> tuple[pd.DataFrame, list[SkippedDay], list[str]]:
        """
        Generate breakout signals from OHLCV data.

        Parameters
        ----------
        df : pd.DataFrame
            OHLCV data with UTC DatetimeIndex. Must have columns:
            open, high, low, close.
        params : BreakoutParams

        Returns
        -------
        tuple[pd.DataFrame, list[SkippedDay], list[str]]
            - DataFrame: Same index as df. Signal columns are NaN / NaT except on
              the first bar after range_end for each valid trading day.
            - list[SkippedDay]: Days that were skipped with reason codes.
            - list[str]: PROJ-29 Already-Past Rejection dates (only populated when mt5_mode=True).
        """
        self.validate_params(params)

        # Prepare output DataFrame
        sig_cols = [
            "long_entry", "long_sl", "long_tp",
            "short_entry", "short_sl", "short_tp",
            "trail_trigger_pips", "trail_lock_pips",
        ]
        signals = pd.DataFrame(np.nan, index=df.index, columns=sig_cols, dtype=float)
        signals["signal_expiry"] = pd.Series(
            pd.NaT, index=df.index, dtype="datetime64[ns, UTC]"
        )

        skipped_days: list[SkippedDay] = []
        rejected_order_dates: list[str] = []

        if df.empty:
            return (signals, skipped_days, rejected_order_dates)

        tz = ZoneInfo(params.timezone)
        from datetime import datetime as dt

        # Convert index to the instrument timezone for grouping by trading day
        local_times = df.index.tz_convert(tz)
        dates = local_times.date
        unique_dates = sorted(set(dates))

        is_overnight = params.range_start > params.range_end

        # ── Option C: Vectorised intraday path ─────────────────────────────
        # Overnight ranges keep the iterative path (they span two calendar days;
        # vectorising them is complex for minimal gain since we only iterate over
        # ~252 days, not 250 000 bars).
        if not is_overnight:
            return self._generate_signals_intraday(
                df, params, tz, local_times, dates, unique_dates, signals, skipped_days,
                mt5_mode=mt5_mode, already_past_rejection=already_past_rejection,
                rejected_order_dates=rejected_order_dates,
            )

        # ── Overnight path (iterative — unchanged) ─────────────────────────
        for day_idx, day in enumerate(unique_dates):
            day_mask = dates == day
            day_local = local_times[day_mask]
            day_bar_times = day_local.time
            day_indices = df.index[day_mask]

            # Overnight range: range_start on `day`, range_end on the next calendar day.
            if day_idx + 1 >= len(unique_dates):
                skipped_days.append(SkippedDay(date=str(day), reason="NO_BARS"))
                continue
            next_day = unique_dates[day_idx + 1]
            next_mask = dates == next_day
            next_local = local_times[next_mask]
            next_bar_times = next_local.time
            next_indices = df.index[next_mask]

            today_range_indices = day_indices[day_bar_times >= params.range_start]
            next_range_indices = next_indices[next_bar_times < params.range_end]
            range_indices = today_range_indices.union(next_range_indices).sort_values()

            after_range_indices = next_indices[next_bar_times >= params.range_end]
            expiry_naive = dt.combine(next_day, params.trigger_deadline)

            if len(range_indices) == 0:
                skipped_days.append(SkippedDay(date=str(day), reason="NO_RANGE_BARS"))
                continue

            range_bars = df.loc[range_indices]
            range_high = float(range_bars["high"].max())
            range_low = float(range_bars["low"].min())

            if range_high == range_low:
                skipped_days.append(SkippedDay(date=str(day), reason="FLAT_RANGE"))
                continue

            if params.entry_delay_bars == 0:
                if len(after_range_indices) == 0:
                    skipped_days.append(SkippedDay(date=str(day), reason="NO_SIGNAL_BAR"))
                    continue
                signal_bar_idx = range_indices[-1]
            else:
                if len(after_range_indices) < params.entry_delay_bars:
                    skipped_days.append(SkippedDay(date=str(day), reason="NO_SIGNAL_BAR"))
                    continue
                signal_bar_idx = after_range_indices[params.entry_delay_bars - 1]
                signal_bar_local_time = pd.Timestamp(signal_bar_idx).tz_convert(tz).time()
                if signal_bar_local_time > params.trigger_deadline:
                    skipped_days.append(SkippedDay(date=str(day), reason="DEADLINE_MISSED"))
                    continue

            # PROJ-29: Already-Past Rejection
            range_close = float(df.loc[range_indices[-1], "close"])
            direction_override = self._apply_already_past_rejection(
                params.direction_filter, range_close, range_high, range_low,
                already_past_rejection, rejected_order_dates, str(day),
            )
            if direction_override is None:
                continue  # both sides rejected — skip day

            self._write_signal(signals, signal_bar_idx, params, range_high, range_low,
                               expiry_naive, tz, direction_override=direction_override)

        return signals, skipped_days, rejected_order_dates

    # ------------------------------------------------------------------
    def _generate_signals_intraday(
        self,
        df: pd.DataFrame,
        params: "BreakoutParams",
        tz,
        local_times,
        dates,
        unique_dates: list,
        signals: pd.DataFrame,
        skipped_days: list,
        mt5_mode: bool = False,
        already_past_rejection: bool = False,
        rejected_order_dates: Optional[list] = None,
    ) -> tuple[pd.DataFrame, list, list]:
        """Vectorised signal generation for normal (intraday) ranges."""
        if rejected_order_dates is None:
            rejected_order_dates = []
        from datetime import datetime as dt

        # Precompute per-bar minute-of-day in local tz
        local_minutes = local_times.hour * 60 + local_times.minute  # NumPy int array

        range_start_min = params.range_start.hour * 60 + params.range_start.minute
        range_end_min   = params.range_end.hour   * 60 + params.range_end.minute
        deadline_min    = params.trigger_deadline.hour * 60 + params.trigger_deadline.minute

        # ── Range bars: [range_start, range_end) ──────────────────────────
        range_mask = (local_minutes >= range_start_min) & (local_minutes < range_end_min)
        # Attach calendar date for grouping
        all_dates_arr = np.array(dates)  # object array of date objects

        range_idx_pos = np.where(range_mask)[0]
        if len(range_idx_pos) == 0:
            # No range bars at all → every day skipped
            for day in unique_dates:
                skipped_days.append(SkippedDay(date=str(day), reason="NO_RANGE_BARS"))
            return signals, skipped_days, rejected_order_dates

        range_dates = all_dates_arr[range_idx_pos]
        range_highs = df["high"].to_numpy(dtype=float)[range_idx_pos]
        range_lows  = df["low"].to_numpy(dtype=float)[range_idx_pos]
        range_closes = df["close"].to_numpy(dtype=float)[range_idx_pos]  # PROJ-29

        # groupby day: compute max(high), min(low), last close per day
        # Use pandas groupby on a small temp frame
        range_frame = pd.DataFrame(
            {"_date": range_dates, "h": range_highs, "l": range_lows, "c": range_closes}
        )
        range_agg = range_frame.groupby("_date").agg(
            range_high=("h", "max"),
            range_low=("l", "min"),
            range_close=("c", "last"),  # close of the last range bar (for Already-Past Rejection)
        )
        # Filter flat ranges
        flat_mask = range_agg["range_high"] == range_agg["range_low"]
        flat_days = set(range_agg.index[flat_mask])
        range_agg = range_agg[~flat_mask]
        valid_range_days = set(range_agg.index)

        # ── After-range bars: >= range_end ────────────────────────────────
        after_mask = local_minutes >= range_end_min
        after_idx_pos = np.where(after_mask)[0]
        after_dates   = all_dates_arr[after_idx_pos]
        after_minutes_arr = local_minutes[after_idx_pos]

        # Build a frame: position within day's after-range group (0-based)
        after_frame = pd.DataFrame(
            {"_pos": after_idx_pos, "_date": after_dates, "_min": after_minutes_arr}
        )
        # Rank within each day (0 = first bar after range_end)
        after_frame["_rank"] = after_frame.groupby("_date").cumcount()

        # entry_delay_bars = 0: signal bar = last range bar index (handled below)
        # entry_delay_bars = N ≥ 1: rank N-1 within after-range
        if params.entry_delay_bars >= 1:
            target_rank = params.entry_delay_bars - 1
            signal_candidates = after_frame[after_frame["_rank"] == target_rank].set_index("_date")
        else:
            # delay=0: we need the last range bar per day
            last_range_frame = pd.DataFrame(
                {"_pos": range_idx_pos, "_date": range_dates}
            )
            signal_candidates = last_range_frame.groupby("_date").last().rename(
                columns={"_pos": "_pos"}
            )
            # We still need at least one after-range bar for the engine to enter
            after_has_bars = set(after_frame["_date"].unique())

        # ── Per-day assembly (O(252), not O(250000)) ───────────────────────
        for day in unique_dates:
            if day not in valid_range_days:
                if day in flat_days:
                    skipped_days.append(SkippedDay(date=str(day), reason="FLAT_RANGE"))
                else:
                    skipped_days.append(SkippedDay(date=str(day), reason="NO_RANGE_BARS"))
                continue

            row = range_agg.loc[day]
            range_high = float(row["range_high"])
            range_low  = float(row["range_low"])
            range_close = float(row["range_close"])  # PROJ-29

            # Find signal bar
            if params.entry_delay_bars == 0:
                # Need at least one after-range bar; signal written on last range bar
                if day not in after_has_bars:
                    skipped_days.append(SkippedDay(date=str(day), reason="NO_SIGNAL_BAR"))
                    continue
                if day not in signal_candidates.index:
                    skipped_days.append(SkippedDay(date=str(day), reason="NO_SIGNAL_BAR"))
                    continue
                bar_pos = int(signal_candidates.loc[day, "_pos"])
            else:
                if day not in signal_candidates.index:
                    skipped_days.append(SkippedDay(date=str(day), reason="NO_SIGNAL_BAR"))
                    continue
                cand = signal_candidates.loc[day]
                bar_pos = int(cand["_pos"])
                bar_local_min = int(cand["_min"])
                # Deadline check (Frage 3: nach dem Join als Filter)
                if bar_local_min > deadline_min:
                    skipped_days.append(SkippedDay(date=str(day), reason="DEADLINE_MISSED"))
                    continue

            # PROJ-29: Already-Past Rejection
            direction_override = self._apply_already_past_rejection(
                params.direction_filter, range_close, range_high, range_low,
                already_past_rejection, rejected_order_dates, str(day),
            )
            if direction_override is None:
                continue  # both sides rejected — skip day

            signal_bar_idx = df.index[bar_pos]
            expiry_naive = dt.combine(day, params.trigger_deadline)
            self._write_signal(signals, signal_bar_idx, params, range_high, range_low,
                               expiry_naive, ZoneInfo(params.timezone),
                               direction_override=direction_override)

        return signals, skipped_days, rejected_order_dates

    # ------------------------------------------------------------------
    def _apply_already_past_rejection(
        self,
        direction_filter: str,
        range_close: float,
        range_high: float,
        range_low: float,
        already_past_rejection: bool,
        rejected_order_dates: list,
        day_str: str,
    ) -> Optional[str]:
        """PROJ-29: Apply Already-Past Rejection logic.

        When the close of the last range bar has already passed a breakout level,
        MT5 brokers reject the stop order for that direction.

        Returns the effective direction_filter after rejection, or None if both
        sides are rejected (caller should skip the day entirely).
        """
        if not already_past_rejection:
            return direction_filter  # no-op

        reject_long = (
            direction_filter != "short_only"
            and range_close > range_high  # strictly past (spec: "exakt auf Niveau → keine Rejection")
        )
        reject_short = (
            direction_filter != "long_only"
            and range_close < range_low   # strictly past
        )

        if reject_long and reject_short:
            rejected_order_dates.append(f"{day_str} (both)")
            return None  # signal day fully skipped

        if reject_long:
            rejected_order_dates.append(f"{day_str} (long)")
            if direction_filter == "both":
                return "short_only"
            return direction_filter  # direction_filter was already long_only — shouldn't reach here given guard above

        if reject_short:
            rejected_order_dates.append(f"{day_str} (short)")
            if direction_filter == "both":
                return "long_only"
            return direction_filter

        return direction_filter  # no rejection

    # ------------------------------------------------------------------
    def _write_signal(
        self,
        signals: pd.DataFrame,
        signal_bar_idx,
        params: "BreakoutParams",
        range_high: float,
        range_low: float,
        expiry_naive,
        tz,
        direction_override: Optional[str] = None,
    ) -> None:
        """Compute prices and write one signal row into `signals`."""
        direction = direction_override if direction_override is not None else params.direction_filter

        entry_offset = params.entry_offset_pips * params.pip_size
        sl_offset    = params.stop_loss_pips    * params.pip_size
        tp_offset    = params.take_profit_pips  * params.pip_size

        long_entry  = range_high + entry_offset
        short_entry = range_low  - entry_offset
        long_sl     = long_entry  - sl_offset
        short_sl    = short_entry + sl_offset
        long_tp     = long_entry  + tp_offset
        short_tp    = short_entry - tp_offset

        expiry_utc = pd.Timestamp(expiry_naive, tz=tz).tz_convert("UTC")

        if direction != "short_only":
            signals.at[signal_bar_idx, "long_entry"] = long_entry
            signals.at[signal_bar_idx, "long_sl"]    = long_sl
            signals.at[signal_bar_idx, "long_tp"]    = long_tp

        if direction != "long_only":
            signals.at[signal_bar_idx, "short_entry"] = short_entry
            signals.at[signal_bar_idx, "short_sl"]    = short_sl
            signals.at[signal_bar_idx, "short_tp"]    = short_tp

        signals.at[signal_bar_idx, "signal_expiry"] = expiry_utc

        if params.trail_trigger_pips is not None:
            signals.at[signal_bar_idx, "trail_trigger_pips"] = params.trail_trigger_pips
            signals.at[signal_bar_idx, "trail_lock_pips"]    = params.trail_lock_pips


# Registry alias
StrategyClass = BreakoutStrategy
