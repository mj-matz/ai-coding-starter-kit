"""Open-position management: trail trigger, SL/TP evaluation, position close."""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal, Optional

import pandas as pd

from .models import BacktestConfig, Trade
from .pip_utils import pips_to_price_offset, price_diff_to_pips, pip_value_for_lot


@dataclass
class OpenPosition:
    """State of the currently open trade."""

    direction: Literal["long", "short"]
    entry_time: datetime
    entry_price: float
    sl_price: float
    tp_price: Optional[float]
    lot_size: float
    initial_sl_price: float  # frozen at entry; used for initial-risk reporting
    order_trigger_price: Optional[float] = None  # original stop-order level (pre-slippage, pre-gap); used for entry-bar 1s zoom-in
    entry_gap_pips: float = 0.0  # pips gapped past stop level on entry
    trail_applied: bool = False
    trail_trigger_pips: Optional[float] = None  # per-signal override; falls back to BacktestConfig
    trail_lock_pips: Optional[float] = None     # per-signal override; falls back to BacktestConfig
    any_1s_used: bool = False  # True if a 1s zoom-in was performed at any point during this trade
    mae_adverse_price: float = 0.0  # Worst adverse price seen during the trade (min low for long, max high for short)
    # PROJ-30: Continuous trailing stop (per-signal overrides; None = use BacktestConfig)
    trail_type: Optional[str] = None
    trail_distance_pips: Optional[float] = None
    trail_dont_cross_entry: Optional[bool] = None
    # PROJ-30: Partial close
    partial_close_pct: Optional[float] = None    # e.g. 40.0 = close 40 % of position
    partial_at_pips: Optional[float] = None      # trigger: fixed pip distance
    partial_at_r: Optional[float] = None         # trigger: R-multiple of initial risk
    partial_close_done: bool = False             # True once partial close has fired
    pending_partial_pnl_currency: float = 0.0   # accumulated PnL from partial close(s); added to balance at final close


def apply_trail_if_triggered(
    position: OpenPosition,
    bar_high: float,
    bar_low: float,
    config: BacktestConfig,
) -> None:
    """
    Apply trailing stop logic for the current bar (in-place).

    Dispatches to step-trail (existing one-time SL move) or continuous-trail
    (permanent ratchet following the price) based on trail_type.
    """
    trail_type = position.trail_type if position.trail_type is not None else config.trail_type
    if trail_type == "continuous":
        _apply_continuous_trail(position, bar_high, bar_low, config)
    else:
        _apply_step_trail(position, bar_high, bar_low, config)


def _apply_step_trail(
    position: OpenPosition,
    bar_high: float,
    bar_low: float,
    config: BacktestConfig,
) -> None:
    """
    One-time SL step: move SL to trail_lock_pips from entry when unrealised profit
    reaches trail_trigger_pips.  Fires at most once per trade (trail_applied guard).
    """
    trigger_pips = (
        position.trail_trigger_pips
        if position.trail_trigger_pips is not None
        else config.trail_trigger_pips
    )
    if trigger_pips is None or position.trail_applied:
        return

    pip_size = config.instrument.pip_size

    if position.direction == "long":
        profit_pips = (bar_high - position.entry_price) / pip_size
    else:
        profit_pips = (position.entry_price - bar_low) / pip_size

    if profit_pips >= trigger_pips:
        lock_pips = (
            position.trail_lock_pips
            if position.trail_lock_pips is not None
            else (config.trail_lock_pips if config.trail_lock_pips is not None else 0.0)
        )
        offset = pips_to_price_offset(lock_pips, pip_size)
        if position.direction == "long":
            position.sl_price = position.entry_price + offset
        else:
            position.sl_price = position.entry_price - offset
        position.trail_applied = True


def _apply_continuous_trail(
    position: OpenPosition,
    bar_high: float,
    bar_low: float,
    config: BacktestConfig,
) -> None:
    """
    Continuous trailing stop: once the profit threshold is reached, the SL
    permanently follows the bar's favourable extreme at a fixed pip distance
    (monotonic ratchet — SL only ever moves in the favourable direction).

    Optional trail_trigger_pips acts as a minimum profit threshold before
    the trail activates.  If not set, trail is active from the first bar.

    Optional trail_dont_cross_entry prevents the SL from crossing entry price.
    """
    trail_distance = (
        position.trail_distance_pips
        if position.trail_distance_pips is not None
        else config.trail_distance_pips
    )
    if trail_distance is None:
        return  # should never happen (validated at startup for config-level; signals set it)

    pip_size = config.instrument.pip_size

    # Respect optional activation threshold
    trigger_pips = (
        position.trail_trigger_pips
        if position.trail_trigger_pips is not None
        else config.trail_trigger_pips
    )
    if trigger_pips is not None:
        if position.direction == "long":
            profit_pips = (bar_high - position.entry_price) / pip_size
        else:
            profit_pips = (position.entry_price - bar_low) / pip_size
        if profit_pips < trigger_pips:
            return

    # Compute candidate SL from this bar's favourable extreme
    offset = pips_to_price_offset(trail_distance, pip_size)
    if position.direction == "long":
        candidate_sl = bar_high - offset
    else:
        candidate_sl = bar_low + offset

    # Optionally prevent the SL from crossing the entry price
    dont_cross = (
        position.trail_dont_cross_entry
        if position.trail_dont_cross_entry is not None
        else config.trail_dont_cross_entry
    )
    if dont_cross:
        if position.direction == "long":
            candidate_sl = min(candidate_sl, position.entry_price)
        else:
            candidate_sl = max(candidate_sl, position.entry_price)

    # Ratchet: only move SL in the favourable direction
    if position.direction == "long":
        if candidate_sl > position.sl_price:
            position.sl_price = candidate_sl
            position.trail_applied = True
    else:
        if candidate_sl < position.sl_price:
            position.sl_price = candidate_sl
            position.trail_applied = True


def check_and_execute_partial_close(
    position: OpenPosition,
    bar_high: float,
    bar_low: float,
    bar_time: datetime,
    config: BacktestConfig,
) -> Optional[Trade]:
    """
    Check whether the partial-close trigger is reached on this bar.

    If triggered:
    - Creates and returns a Trade record with exit_reason="PARTIAL" for the closed lot.
    - Reduces position.lot_size to the remaining lot.
    - Marks position.partial_close_done = True (fires at most once per trade).
    - Stores the partial PnL in position.pending_partial_pnl_currency; this is
      added to balance only when the remaining position is finally closed.

    Returns None if partial close does not fire.
    """
    if position.partial_close_done:
        return None

    pct = position.partial_close_pct
    if pct is None or pct <= 0 or pct >= 100:
        return None

    pip_size = config.instrument.pip_size

    # Determine trigger in pips (partial_at_pips takes priority over partial_at_r)
    if position.partial_at_pips is not None:
        trigger_pips = position.partial_at_pips
    elif position.partial_at_r is not None:
        initial_risk_pips = abs(position.entry_price - position.initial_sl_price) / pip_size
        if initial_risk_pips == 0:
            return None  # guard against division by zero
        trigger_pips = position.partial_at_r * initial_risk_pips
    else:
        return None  # no trigger configured

    # Measure unrealised profit at bar's favourable extreme
    if position.direction == "long":
        profit_pips = (bar_high - position.entry_price) / pip_size
        exit_price_raw = bar_high
    else:
        profit_pips = (position.entry_price - bar_low) / pip_size
        exit_price_raw = bar_low

    if profit_pips < trigger_pips:
        return None

    # --- Trigger reached: compute partial Trade record ---
    pip_value_per_lot = config.instrument.pip_value_per_lot
    slippage_offset = pips_to_price_offset(config.slippage_pips, pip_size)

    partial_lot = round(position.lot_size * pct / 100, 2)
    remaining_lot = round(position.lot_size * (1.0 - pct / 100), 2)

    if position.direction == "long":
        actual_exit = exit_price_raw - slippage_offset
        pnl_pips = (actual_exit - position.entry_price) / pip_size
    else:
        actual_exit = exit_price_raw + slippage_offset
        pnl_pips = (position.entry_price - actual_exit) / pip_size

    pnl_currency = (
        pnl_pips * pip_value_for_lot(partial_lot, pip_value_per_lot)
        - config.commission_per_lot * partial_lot
    )

    initial_risk_pips = price_diff_to_pips(
        position.entry_price - position.initial_sl_price, pip_size
    )
    initial_risk_currency = initial_risk_pips * pip_value_for_lot(partial_lot, pip_value_per_lot)

    trade = Trade(
        entry_time=position.entry_time,
        entry_price=position.entry_price,
        exit_time=bar_time,
        exit_price=round(actual_exit, 5),
        exit_reason="PARTIAL",
        direction=position.direction,
        lot_size=partial_lot,
        pnl_pips=round(pnl_pips, 1),
        pnl_currency=round(pnl_currency, 2),
        initial_risk_pips=round(initial_risk_pips, 1),
        initial_risk_currency=round(initial_risk_currency, 2),
        entry_gap_pips=position.entry_gap_pips,
    )

    # Mutate position in-place
    position.lot_size = remaining_lot
    position.partial_close_done = True
    position.pending_partial_pnl_currency = round(pnl_currency, 2)

    return trade


def check_sl_tp(
    position: OpenPosition,
    bar_high: float,
    bar_low: float,
    spread_offset: float = 0.0,
) -> Optional[Literal["SL", "SL_TRAILED", "TP"]]:
    """
    Check whether SL or TP was hit in this bar.

    If both are hit in the same bar, SL wins (worst-case assumption).
    Returns the exit reason, or None if neither level was reached.

    PROJ-29 Bid/Ask-Split-Execution (spread_offset > 0):
      Long SL/TP: unchanged — long exits fill at Bid price (BID_low/high vs. level)
      Short SL:   Ask must reach sl_price, i.e. BID_high >= sl_price - spread_offset
      Short TP:   Ask must reach tp_price, i.e. BID_low  <= tp_price - spread_offset
    """
    if position.direction == "long":
        sl_hit = bar_low <= position.sl_price
        tp_hit = position.tp_price is not None and bar_high >= position.tp_price
    else:  # short
        sl_hit = bar_high >= position.sl_price - spread_offset
        tp_hit = (
            position.tp_price is not None
            and bar_low <= position.tp_price - spread_offset
        )

    if sl_hit:
        return "SL_TRAILED" if position.trail_applied else "SL"
    if tp_hit:
        return "TP"
    return None


def is_sl_tp_ambiguous(
    position: OpenPosition,
    bar_high: float,
    bar_low: float,
    spread_offset: float = 0.0,
) -> bool:
    """
    Return True if both SL and TP are hit on the same bar (ambiguous outcome).

    This is used to decide whether a 1-second zoom-in is needed.
    Uses the same spread-adjusted thresholds as check_sl_tp (PROJ-29).
    """
    if position.tp_price is None:
        return False

    if position.direction == "long":
        sl_hit = bar_low <= position.sl_price
        tp_hit = bar_high >= position.tp_price
    else:
        sl_hit = bar_high >= position.sl_price - spread_offset
        tp_hit = bar_low <= position.tp_price - spread_offset

    return sl_hit and tp_hit


def resolve_exit_with_1s_data(
    position: OpenPosition,
    ohlcv_1s: pd.DataFrame,
) -> Optional[Literal["SL", "SL_TRAILED", "TP"]]:
    """
    Iterate 1-second bars to determine which level (SL or TP) was hit first.

    Args:
        position: The open position with SL/TP levels.
        ohlcv_1s: 1-second OHLCV DataFrame with columns: datetime, open, high, low, close, volume.
                  Must be sorted by datetime.

    Returns:
        The exit reason ("SL", "SL_TRAILED", or "TP"), or None if neither was hit
        in the 1-second data (should not happen if called correctly).
    """
    for _, row in ohlcv_1s.iterrows():
        h = row["high"]
        l = row["low"]

        if position.direction == "long":
            sl_hit = l <= position.sl_price
            tp_hit = position.tp_price is not None and h >= position.tp_price
        else:
            sl_hit = h >= position.sl_price
            tp_hit = position.tp_price is not None and l <= position.tp_price

        if sl_hit and tp_hit:
            # Even at 1s resolution both hit: fall back to worst-case SL
            return "SL_TRAILED" if position.trail_applied else "SL"
        if sl_hit:
            return "SL_TRAILED" if position.trail_applied else "SL"
        if tp_hit:
            return "TP"

    return None


def resolve_entry_bar_exit_with_1s_data(
    position: OpenPosition,
    ohlcv_1s: pd.DataFrame,
    fallback_exit: Optional[Literal["SL", "SL_TRAILED", "TP"]],
) -> Optional[Literal["SL", "SL_TRAILED", "TP"]]:
    """
    Determine whether a SL hit on the entry bar occurred BEFORE or AFTER entry.

    Iterates 1-second bars to find the first moment the stop-order trigger price
    was reached (= trade opens). Then checks SL/TP only from that point onward.

    Returns:
        - Exit reason ("SL", "SL_TRAILED", "TP") if trade closes on the entry bar.
        - None if neither SL nor TP was hit after entry (trade continues).
        - fallback_exit if the entry trigger is not found in the 1s data (data gap).
    """
    trigger = position.order_trigger_price
    if trigger is None:
        # No trigger price stored — fall back to original result
        return fallback_exit

    entry_row_idx: Optional[int] = None
    rows = list(ohlcv_1s.itertuples(index=False))
    for i, row in enumerate(rows):
        if position.direction == "long" and row.high >= trigger:
            entry_row_idx = i
            break
        elif position.direction == "short" and row.low <= trigger:
            entry_row_idx = i
            break

    if entry_row_idx is None:
        # Entry trigger not found in 1s data — use fallback
        return fallback_exit

    # Check SL/TP from the 1s bar where entry was triggered onward
    post_entry_1s = ohlcv_1s.iloc[entry_row_idx:]
    return resolve_exit_with_1s_data(position, post_entry_1s)


def close_position(
    position: OpenPosition,
    exit_time: datetime,
    exit_price: float,
    exit_reason: Literal["SL", "SL_TRAILED", "TP", "TIME"],
    config: BacktestConfig,
    exit_gap: bool = False,
    used_1s_resolution: bool = False,
) -> Trade:
    """
    Close a position and return the completed Trade record.

    Applies adverse slippage to the exit price and deducts commission.
    """
    pip_size = config.instrument.pip_size
    pip_value_per_lot = config.instrument.pip_value_per_lot
    slippage_offset = pips_to_price_offset(config.slippage_pips, pip_size)

    # Adverse slippage: we receive a worse price than the order level
    if position.direction == "long":
        actual_exit = exit_price - slippage_offset
        pnl_pips = (actual_exit - position.entry_price) / pip_size
    else:
        actual_exit = exit_price + slippage_offset
        pnl_pips = (position.entry_price - actual_exit) / pip_size

    pnl_currency = (
        pnl_pips * pip_value_for_lot(position.lot_size, pip_value_per_lot)
        - config.commission_per_lot * position.lot_size
    )

    # price_diff_to_pips applies abs() internally, so this is correct for
    # both long (entry > sl → positive diff) and short (entry < sl → negative diff).
    initial_risk_pips = price_diff_to_pips(
        position.entry_price - position.initial_sl_price, pip_size
    )
    initial_risk_currency = initial_risk_pips * pip_value_for_lot(
        position.lot_size, pip_value_per_lot
    )

    # Compute MAE (Maximum Adverse Excursion) in pips
    if position.mae_adverse_price == 0.0:
        mae_pips = 0.0
    elif position.direction == "long":
        mae_pips = max(0.0, (position.entry_price - position.mae_adverse_price) / pip_size)
    else:
        mae_pips = max(0.0, (position.mae_adverse_price - position.entry_price) / pip_size)

    return Trade(
        entry_time=position.entry_time,
        entry_price=position.entry_price,
        exit_time=exit_time,
        exit_price=round(actual_exit, 5),
        exit_reason=exit_reason,
        direction=position.direction,
        lot_size=position.lot_size,
        pnl_pips=round(pnl_pips, 1),
        pnl_currency=round(pnl_currency, 2),
        initial_risk_pips=round(initial_risk_pips, 1),
        initial_risk_currency=round(initial_risk_currency, 2),
        entry_gap_pips=position.entry_gap_pips,
        exit_gap=exit_gap,
        used_1s_resolution=used_1s_resolution,
        mae_pips=round(mae_pips, 1),
    )
