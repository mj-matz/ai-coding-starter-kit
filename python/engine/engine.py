"""Core backtesting engine (PROJ-2).

Public entry point: run_backtest(ohlcv, signals, config) -> BacktestResult
"""

from datetime import time
from typing import Callable, List, Optional
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from .models import BacktestConfig, BacktestResult, Trade
from .order_manager import PendingOrder, evaluate_pending_orders
from .pip_utils import pips_to_price_offset
from .position_tracker import (
    OpenPosition,
    apply_trail_if_triggered,
    check_and_execute_partial_close,
    check_sl_tp,
    close_position,
    is_sl_tp_ambiguous,
    resolve_entry_bar_exit_with_1s_data,
    resolve_exit_with_1s_data,
)
from .sizing import calculate_lot_size


def _parse_time_exit(time_exit_str: Optional[str]) -> Optional[time]:
    if time_exit_str is None:
        return None
    try:
        h, m = time_exit_str.split(":")
        return time(int(h), int(m))
    except (ValueError, TypeError) as exc:
        raise ValueError(f"Invalid time_exit '{time_exit_str}': must be HH:MM with valid hours (00-23) and minutes (00-59).") from exc


def _extract_pending_orders(sig_row: pd.Series) -> List[PendingOrder]:
    """
    Convert one row of the signals DataFrame into a list of PendingOrder objects.

    Recognised columns (all optional / NaN-able):
        long_entry, long_sl, long_tp
        short_entry, short_sl, short_tp
    """
    orders: List[PendingOrder] = []

    # Parse the optional signal_expiry (pd.Timestamp or NaT)
    raw_expiry = sig_row.get("signal_expiry", pd.NaT)
    expiry: Optional[pd.Timestamp] = None
    if pd.notna(raw_expiry):
        _ts = pd.Timestamp(raw_expiry)
        expiry = _ts if _ts.tzinfo is not None else _ts.tz_localize("UTC")

    trail_trigger_raw = sig_row.get("trail_trigger_pips", np.nan)
    trail_lock_raw = sig_row.get("trail_lock_pips", np.nan)
    trail_trigger_pips = float(trail_trigger_raw) if pd.notna(trail_trigger_raw) else None
    trail_lock_pips = float(trail_lock_raw) if pd.notna(trail_lock_raw) else None
    # PROJ-30
    tt_raw = sig_row.get("trail_type", None)
    trail_type = str(tt_raw) if pd.notna(tt_raw) and tt_raw is not None else None
    td_raw = sig_row.get("trail_distance_pips", np.nan)
    trail_distance_pips = float(td_raw) if pd.notna(td_raw) else None
    dce_raw = sig_row.get("trail_dont_cross_entry", np.nan)
    trail_dont_cross_entry = bool(dce_raw) if pd.notna(dce_raw) else None
    pct_raw = sig_row.get("partial_close_pct", np.nan)
    partial_close_pct = float(pct_raw) if pd.notna(pct_raw) else None
    ap_raw = sig_row.get("partial_at_pips", np.nan)
    partial_at_pips = float(ap_raw) if pd.notna(ap_raw) else None
    ar_raw = sig_row.get("partial_at_r", np.nan)
    partial_at_r = float(ar_raw) if pd.notna(ar_raw) else None

    long_entry = sig_row.get("long_entry", np.nan)
    if pd.notna(long_entry):
        long_tp_raw = sig_row.get("long_tp", np.nan)
        orders.append(
            PendingOrder(
                direction="long",
                entry_price=float(long_entry),
                sl_price=float(sig_row.get("long_sl", np.nan)),
                tp_price=float(long_tp_raw) if pd.notna(long_tp_raw) else None,
                expiry=expiry,
                trail_trigger_pips=trail_trigger_pips,
                trail_lock_pips=trail_lock_pips,
                trail_type=trail_type,
                trail_distance_pips=trail_distance_pips,
                trail_dont_cross_entry=trail_dont_cross_entry,
                partial_close_pct=partial_close_pct,
                partial_at_pips=partial_at_pips,
                partial_at_r=partial_at_r,
            )
        )

    short_entry = sig_row.get("short_entry", np.nan)
    if pd.notna(short_entry):
        short_tp_raw = sig_row.get("short_tp", np.nan)
        orders.append(
            PendingOrder(
                direction="short",
                entry_price=float(short_entry),
                sl_price=float(sig_row.get("short_sl", np.nan)),
                tp_price=float(short_tp_raw) if pd.notna(short_tp_raw) else None,
                expiry=expiry,
                trail_trigger_pips=trail_trigger_pips,
                trail_lock_pips=trail_lock_pips,
                trail_type=trail_type,
                trail_distance_pips=trail_distance_pips,
                trail_dont_cross_entry=trail_dont_cross_entry,
                partial_close_pct=partial_close_pct,
                partial_at_pips=partial_at_pips,
                partial_at_r=partial_at_r,
            )
        )

    return orders


import logging as _logging

_engine_logger = _logging.getLogger(__name__)


def run_backtest(
    ohlcv: pd.DataFrame,
    signals: pd.DataFrame,
    config: BacktestConfig,
    get_1s_data: Optional[Callable[[pd.Timestamp], Optional[pd.DataFrame]]] = None,
) -> BacktestResult:
    """
    Simulate a trading strategy bar-by-bar.

    Parameters
    ----------
    ohlcv : DataFrame
        Columns: open, high, low, close, volume.  DatetimeIndex (UTC).
    signals : DataFrame
        Same index as ohlcv.  Columns (all float, NaN = no signal):
            long_entry, long_sl, long_tp
            short_entry, short_sl, short_tp
        A bar with both long_entry and short_entry set forms an OCO pair.
        Signals on bar N become active (i.e. checked for entry) on bar N+1.
    config : BacktestConfig

    Returns
    -------
    BacktestResult

    Simulation rules
    ----------------
    Per bar (in order):
      1. If position open:
         a. Time exit  — close at bar open if bar_time >= exit_time.
         b. Trail trigger — move SL once when peak profit >= trigger threshold.
         c. SL / TP check — if both hit in same bar, SL wins (worst case).
      2. If no position and pending orders exist:
         — Evaluate entry trigger; if fired, open position, cancel OCO partner.
      3. If no position:
         — Record new signal from this bar as pending for the NEXT bar.
    End of data: close any remaining open position at the last bar's close.
    Maximum one open position at a time; new signals while a position is open
    are ignored.
    """
    # PROJ-30: Pre-validation — continuous trail requires trail_distance_pips
    if config.trail_type == "continuous" and config.trail_distance_pips is None:
        raise ValueError(
            "BacktestConfig: trail_type='continuous' requires trail_distance_pips to be set."
        )

    exit_time = _parse_time_exit(config.time_exit)
    exit_tz = ZoneInfo(config.timezone)
    slippage_offset = pips_to_price_offset(
        config.slippage_pips, config.instrument.pip_size
    )
    # PROJ-29: pre-compute spread offset (0.0 when mt5_mode=False or spread_pips=0)
    spread_offset = (
        pips_to_price_offset(config.spread_pips, config.instrument.pip_size)
        if config.mt5_mode else 0.0
    )

    if ohlcv.empty:
        return BacktestResult(
            trades=[],
            equity_curve=[],
            final_balance=config.initial_balance,
            initial_balance=config.initial_balance,
            expired_order_dates=[],
        )

    # ── Option A: Extract OHLCV + signal columns as NumPy arrays ─────────────
    _opens         = ohlcv["open"].to_numpy(dtype=float)
    _highs         = ohlcv["high"].to_numpy(dtype=float)
    _lows          = ohlcv["low"].to_numpy(dtype=float)
    _closes        = ohlcv["close"].to_numpy(dtype=float)
    _long_entry    = signals["long_entry"].to_numpy(dtype=float)
    _long_sl       = signals["long_sl"].to_numpy(dtype=float)
    _long_tp       = signals["long_tp"].to_numpy(dtype=float) if "long_tp"    in signals.columns else np.full(len(signals), np.nan)
    _short_entry   = signals["short_entry"].to_numpy(dtype=float)
    _short_sl      = signals["short_sl"].to_numpy(dtype=float)
    _short_tp      = signals["short_tp"].to_numpy(dtype=float) if "short_tp"  in signals.columns else np.full(len(signals), np.nan)
    _nan_col       = np.full(len(signals), np.nan)
    _trail_trigger = signals["trail_trigger_pips"].to_numpy(dtype=float) if "trail_trigger_pips" in signals.columns else _nan_col
    _trail_lock    = signals["trail_lock_pips"].to_numpy(dtype=float)    if "trail_lock_pips"    in signals.columns else _nan_col
    _nat_col       = np.array([pd.NaT] * len(signals))
    _sig_expiry    = signals["signal_expiry"].to_numpy() if "signal_expiry" in signals.columns else _nat_col
    _signal_exit   = signals["signal_exit"].to_numpy(dtype=float) if "signal_exit" in signals.columns else _nan_col
    # PROJ-30: New signal columns
    _none_col         = np.full(len(signals), None, dtype=object)
    _trail_type_arr   = signals["trail_type"].to_numpy(dtype=object)        if "trail_type"            in signals.columns else _none_col
    _trail_dist       = signals["trail_distance_pips"].to_numpy(dtype=float) if "trail_distance_pips"  in signals.columns else _nan_col
    _trail_dce        = signals["trail_dont_cross_entry"].to_numpy(dtype=float) if "trail_dont_cross_entry" in signals.columns else _nan_col
    _partial_pct      = signals["partial_close_pct"].to_numpy(dtype=float)  if "partial_close_pct"     in signals.columns else _nan_col
    _partial_at_pips  = signals["partial_at_pips"].to_numpy(dtype=float)    if "partial_at_pips"       in signals.columns else _nan_col
    _partial_at_r     = signals["partial_at_r"].to_numpy(dtype=float)       if "partial_at_r"          in signals.columns else _nan_col
    # Opt-in once-per-day guard (PROJ-22 follow-up). Default 0.0 (disabled).
    _zero_col        = np.zeros(len(signals), dtype=float)
    _max_per_day_arr = signals["max_per_day"].to_numpy(dtype=float) if "max_per_day" in signals.columns else _zero_col

    # ── Option B: Pre-compute local-tz dates + time-exit flags ────────────────
    # _local_dates is always computed (used by both time-exit gap detection and
    # the once-per-day guard).
    _local_idx   = ohlcv.index.tz_convert(exit_tz)
    _local_dates = np.array(_local_idx.date)
    if exit_time is not None:
        _exit_min    = exit_time.hour * 60 + exit_time.minute
        _bar_min     = _local_idx.hour * 60 + _local_idx.minute
        exit_flags: Optional[np.ndarray] = (_bar_min >= _exit_min)
    else:
        exit_flags = None

    def _str_val(v) -> Optional[str]:
        """Return string value from object array cell, or None if NaN/None."""
        if v is None:
            return None
        if isinstance(v, float) and v != v:  # NaN check (NaN != NaN)
            return None
        s = str(v)
        return s if s and s.lower() != "nan" else None

    balance: float = config.initial_balance
    trades: List[Trade] = []
    equity_curve = [{"time": ohlcv.index[0].isoformat(), "balance": balance}]
    position: Optional[OpenPosition] = None
    pending_orders: List[PendingOrder] = []
    expired_order_dates: List[str] = []
    # Once-per-day guard: local-tz date on which a max_per_day-tagged order
    # last filled. Subsequent max_per_day orders on the same date are blocked.
    last_max_per_day_date = None

    for i in range(len(ohlcv)):
        bar_time = ohlcv.index[i]
        bar_open = _opens[i]
        bar_high = _highs[i]
        bar_low  = _lows[i]

        # ── 1a. Time exit ───────────────────────────────────────────────────
        if position is not None and exit_flags is not None:
            if exit_flags[i]:
                # Normal case: first bar at or after exit_time → close at bar open
                trade = close_position(position, bar_time, bar_open, "TIME", config,
                                       used_1s_resolution=position.any_1s_used)
                trades.append(trade)
                balance += trade.pnl_currency + position.pending_partial_pnl_currency
                equity_curve.append(
                    {"time": bar_time.isoformat(), "balance": round(balance, 2)}
                )
                position = None
                pending_orders = []
            elif i > 0 and _local_dates[i] != _local_dates[i - 1] and not exit_flags[i - 1]:
                # Gap detection: day boundary crossed without exit_time being reached.
                # The market closed before exit_time (e.g. data ends at 20:27, exit=21:00)
                # and resumes next day before exit_time (e.g. 13:00 < 21:00).
                # Close at the last bar's close before the gap.
                prev_close = _closes[i - 1]
                prev_time = ohlcv.index[i - 1]
                trade = close_position(position, prev_time, prev_close, "TIME", config,
                                       used_1s_resolution=position.any_1s_used)
                trades.append(trade)
                balance += trade.pnl_currency + position.pending_partial_pnl_currency
                equity_curve.append(
                    {"time": prev_time.isoformat(), "balance": round(balance, 2)}
                )
                position = None
                pending_orders = []

        # ── 1a2. Signal exit (PROJ-6) ──────────────────────────────────────
        # If the strategy placed a signal_exit flag on this bar (or the
        # previous bar — signals are one bar delayed like entries), close
        # the position at bar open.
        if position is not None and i > 0 and not np.isnan(_signal_exit[i - 1]):
            trade = close_position(position, bar_time, bar_open, "SIGNAL", config,
                                   used_1s_resolution=position.any_1s_used)
            trades.append(trade)
            balance += trade.pnl_currency + position.pending_partial_pnl_currency
            equity_curve.append(
                {"time": bar_time.isoformat(), "balance": round(balance, 2)}
            )
            position = None
            pending_orders = []
            # BUG-3 fix: if the signal_exit bar also carried a new entry signal
            # (flip trade, e.g. MA Crossover direction=both), queue it now so
            # section 2 can evaluate it on this same bar.
            _le_flip = _long_entry[i - 1]
            _se_flip = _short_entry[i - 1]
            if not (np.isnan(_le_flip) and np.isnan(_se_flip)):
                _raw_exp_flip = _sig_expiry[i - 1]
                _expiry_flip: Optional[pd.Timestamp] = None
                if not pd.isnull(_raw_exp_flip):
                    _ts_flip = pd.Timestamp(_raw_exp_flip)
                    _expiry_flip = _ts_flip if _ts_flip.tzinfo is not None else _ts_flip.tz_localize("UTC")
                _ttp_flip = float(_trail_trigger[i - 1]) if not np.isnan(_trail_trigger[i - 1]) else None
                _tlp_flip = float(_trail_lock[i - 1]) if not np.isnan(_trail_lock[i - 1]) else None
                # PROJ-30
                _flip_trail_type = _str_val(_trail_type_arr[i - 1])
                _flip_trail_dist = float(_trail_dist[i - 1]) if not np.isnan(_trail_dist[i - 1]) else None
                _flip_dce_raw = _trail_dce[i - 1]
                _flip_dce = bool(_flip_dce_raw) if not np.isnan(_flip_dce_raw) else None
                _flip_pct = float(_partial_pct[i - 1]) if not np.isnan(_partial_pct[i - 1]) else None
                _flip_at_pips = float(_partial_at_pips[i - 1]) if not np.isnan(_partial_at_pips[i - 1]) else None
                _flip_at_r = float(_partial_at_r[i - 1]) if not np.isnan(_partial_at_r[i - 1]) else None
                _flip_mpd = bool(_max_per_day_arr[i - 1])
                # Once-per-day guard: skip flip orders that are tagged max_per_day
                # if today already had a max_per_day fill.
                _flip_blocked = (
                    _flip_mpd
                    and last_max_per_day_date is not None
                    and _local_dates[i] == last_max_per_day_date
                )
                flip_orders: List[PendingOrder] = []
                if not _flip_blocked and not np.isnan(_le_flip):
                    _ltp_flip = _long_tp[i - 1]
                    flip_orders.append(PendingOrder(
                        direction="long",
                        entry_price=float(_le_flip),
                        sl_price=float(_long_sl[i - 1]),
                        tp_price=float(_ltp_flip) if not np.isnan(_ltp_flip) else None,
                        expiry=_expiry_flip,
                        trail_trigger_pips=_ttp_flip,
                        trail_lock_pips=_tlp_flip,
                        trail_type=_flip_trail_type,
                        trail_distance_pips=_flip_trail_dist,
                        trail_dont_cross_entry=_flip_dce,
                        partial_close_pct=_flip_pct,
                        partial_at_pips=_flip_at_pips,
                        partial_at_r=_flip_at_r,
                        max_per_day=_flip_mpd,
                    ))
                if not _flip_blocked and not np.isnan(_se_flip):
                    _stp_flip = _short_tp[i - 1]
                    flip_orders.append(PendingOrder(
                        direction="short",
                        entry_price=float(_se_flip),
                        sl_price=float(_short_sl[i - 1]),
                        tp_price=float(_stp_flip) if not np.isnan(_stp_flip) else None,
                        expiry=_expiry_flip,
                        trail_trigger_pips=_ttp_flip,
                        trail_lock_pips=_tlp_flip,
                        trail_type=_flip_trail_type,
                        trail_distance_pips=_flip_trail_dist,
                        trail_dont_cross_entry=_flip_dce,
                        partial_close_pct=_flip_pct,
                        partial_at_pips=_flip_at_pips,
                        partial_at_r=_flip_at_r,
                        max_per_day=_flip_mpd,
                    ))
                if flip_orders:
                    pending_orders = flip_orders

        # ── 1b & 1c. Trail trigger + SL/TP (with PROJ-15 ambiguity resolution)
        if position is not None:
            apply_trail_if_triggered(position, bar_high, bar_low, config)

            # Update MAE: track worst adverse price seen during the trade
            if position.direction == "long":
                if position.mae_adverse_price == 0.0:
                    position.mae_adverse_price = bar_low
                else:
                    position.mae_adverse_price = min(position.mae_adverse_price, bar_low)
            else:
                if position.mae_adverse_price == 0.0:
                    position.mae_adverse_price = bar_high
                else:
                    position.mae_adverse_price = max(position.mae_adverse_price, bar_high)

            exit_reason = check_sl_tp(position, bar_high, bar_low, spread_offset=spread_offset)
            if exit_reason is not None:
                used_1s = False
                # PROJ-15: If both SL and TP are hit on the same bar, try to
                # resolve the ambiguity using 1-second data.
                if (
                    is_sl_tp_ambiguous(position, bar_high, bar_low, spread_offset=spread_offset)
                    and get_1s_data is not None
                ):
                    ohlcv_1s = get_1s_data(bar_time)
                    if ohlcv_1s is not None and not ohlcv_1s.empty:
                        resolved = resolve_exit_with_1s_data(position, ohlcv_1s)
                        if resolved is not None:
                            exit_reason = resolved
                            used_1s = True
                            _engine_logger.info(
                                "[1sec-zoom] %s ambiguous-bar %s | SL=%.5f TP=%.5f | resolved → %s",
                                position.direction.upper(), bar_time.isoformat(),
                                position.sl_price, position.tp_price, exit_reason,
                            )
                    else:
                        _engine_logger.warning(
                            "1s data unavailable for ambiguous bar %s — falling back to worst-case SL",
                            bar_time.isoformat(),
                        )

                exit_gap = False
                if exit_reason in ("SL", "SL_TRAILED"):
                    sl = position.sl_price
                    if config.gap_fill:
                        if position.direction == "long" and bar_open < sl:
                            exit_price = bar_open
                            exit_gap = True
                        elif position.direction == "short" and bar_open > sl:
                            exit_price = bar_open
                            exit_gap = True
                        else:
                            exit_price = sl
                    else:
                        exit_price = sl
                else:  # TP
                    tp = position.tp_price
                    if config.gap_fill:
                        if position.direction == "long" and bar_open > tp:
                            exit_price = bar_open
                            exit_gap = True
                        elif position.direction == "short" and bar_open < tp:
                            exit_price = bar_open
                            exit_gap = True
                        else:
                            exit_price = tp
                    else:
                        exit_price = tp
                trade = close_position(
                    position, bar_time, exit_price, exit_reason, config,
                    exit_gap=exit_gap, used_1s_resolution=position.any_1s_used or used_1s,
                )
                trades.append(trade)
                balance += trade.pnl_currency + position.pending_partial_pnl_currency
                equity_curve.append(
                    {"time": bar_time.isoformat(), "balance": round(balance, 2)}
                )
                position = None
                pending_orders = []
            else:
                # ── 1c. Partial close (PROJ-30) — only when SL/TP not hit ──
                partial_trade = check_and_execute_partial_close(
                    position, bar_high, bar_low, bar_time, config
                )
                if partial_trade is not None:
                    trades.append(partial_trade)

        # ── 1d. Expire pending orders past their deadline ─────────────────
        if pending_orders:
            active = [o for o in pending_orders if o.expiry is None or bar_time <= o.expiry]
            if len(active) < len(pending_orders):
                # One or more orders expired — record the local-tz date from the expiry timestamp
                for o in pending_orders:
                    if o.expiry is not None and bar_time > o.expiry:
                        expired_order_dates.append(str(o.expiry.tz_convert(exit_tz).date()))
                        break  # OCO pair shares the same expiry; one record per day is enough
            pending_orders = active

        # ── 1e. Once-per-day guard: prune max_per_day-tagged pendings if today
        # already had a max_per_day fill.  Untagged orders pass through.
        if (
            pending_orders
            and last_max_per_day_date is not None
            and _local_dates[i] == last_max_per_day_date
        ):
            pending_orders = [o for o in pending_orders if not o.max_per_day]

        # ── 2. Check pending orders ─────────────────────────────────────────
        if position is None and pending_orders:
            triggered = evaluate_pending_orders(pending_orders, bar_high, bar_low, bar_open, spread_offset=spread_offset)
            if triggered is not None:
                # Entry fill logic.
                # gap_fill=True:  if bar opens beyond the stop level, fill at bar_open (realistic).
                # gap_fill=False: always fill at the exact entry_price (TradingView-mode).
                # Slippage is applied additively in both modes.
                # Lot sizing always uses the theoretical entry/SL (pre-gap/slippage).
                if config.gap_fill:
                    if triggered.direction == "long":
                        fill_base = max(bar_open, triggered.entry_price)
                    else:
                        fill_base = min(bar_open, triggered.entry_price)
                else:
                    fill_base = triggered.entry_price  # TradingView-mode: exact entry

                if triggered.direction == "long":
                    # PROJ-29: Long fills at Ask price; in BID data Ask = BID + spread
                    actual_entry = fill_base + slippage_offset + spread_offset
                else:
                    actual_entry = fill_base - slippage_offset

                entry_gap_pips = round(
                    abs(fill_base - triggered.entry_price) / config.instrument.pip_size, 1
                )

                lot_size = calculate_lot_size(
                    config, triggered.entry_price, triggered.sl_price, balance
                )
                position = OpenPosition(
                    direction=triggered.direction,
                    entry_time=bar_time,
                    entry_price=actual_entry,
                    order_trigger_price=triggered.entry_price,
                    sl_price=triggered.sl_price,
                    tp_price=triggered.tp_price,
                    lot_size=lot_size,
                    initial_sl_price=triggered.sl_price,
                    entry_gap_pips=entry_gap_pips,
                    trail_trigger_pips=triggered.trail_trigger_pips,
                    trail_lock_pips=triggered.trail_lock_pips,
                    trail_type=triggered.trail_type,
                    trail_distance_pips=triggered.trail_distance_pips,
                    trail_dont_cross_entry=triggered.trail_dont_cross_entry,
                    partial_close_pct=triggered.partial_close_pct,
                    partial_at_pips=triggered.partial_at_pips,
                    partial_at_r=triggered.partial_at_r,
                )
                pending_orders = []  # cancel OCO partner
                if triggered.max_per_day:
                    last_max_per_day_date = _local_dates[i]

                # Initialize MAE with the entry bar's adverse extreme
                if position.direction == "long":
                    position.mae_adverse_price = bar_low
                else:
                    position.mae_adverse_price = bar_high

                # ── PROJ-15: Entry-Bar SL/TP check ────────────────────────
                # Immediately check SL/TP on the same bar where the trade opened.
                # Apply trail logic first (per user requirement), then check SL/TP.
                apply_trail_if_triggered(position, bar_high, bar_low, config)

                entry_bar_exit = check_sl_tp(position, bar_high, bar_low, spread_offset=spread_offset)
                if entry_bar_exit is not None:
                    used_1s = False
                    # PROJ-15 (BUG-6 fix): On the entry bar, a SL hit may have
                    # occurred BEFORE the entry was triggered (bar moved to SL
                    # first, then reversed to entry price). In that case the SL
                    # does NOT apply — the trade continues.
                    # Zoom in with 1s data whenever SL is in range so we can
                    # determine whether entry happened before SL.
                    # TP-only hits need no zoom-in: TP is on the same side as
                    # the entry movement, so entry is always reached first.
                    if entry_bar_exit in ("SL", "SL_TRAILED") and get_1s_data is not None:
                        ohlcv_1s = get_1s_data(bar_time)
                        if ohlcv_1s is not None and not ohlcv_1s.empty:
                            entry_bar_exit = resolve_entry_bar_exit_with_1s_data(
                                position, ohlcv_1s, fallback_exit=entry_bar_exit
                            )
                            used_1s = True
                            position.any_1s_used = True  # persist across bars if trade continues
                            if entry_bar_exit is None:
                                _engine_logger.info(
                                    "[1sec-zoom] %s entry-bar %s | trigger=%.5f | SL(%.5f) not hit after entry → trade continues",
                                    position.direction.upper(), bar_time.isoformat(),
                                    position.order_trigger_price or position.entry_price, position.sl_price,
                                )
                            else:
                                _engine_logger.info(
                                    "[1sec-zoom] %s entry-bar %s | trigger=%.5f | SL(%.5f) hit after entry → exit %s",
                                    position.direction.upper(), bar_time.isoformat(),
                                    position.order_trigger_price or position.entry_price, position.sl_price,
                                    entry_bar_exit,
                                )
                        else:
                            _engine_logger.warning(
                                "1s data unavailable for entry-bar %s — cannot verify entry/SL sequence, assuming entry first",
                                bar_time.isoformat(),
                            )

                    if entry_bar_exit is not None:
                        # Determine exit price — apply gap_fill consistently
                        # with the normal SL/TP exit logic (lines 240-266).
                        entry_exit_gap = False
                        if entry_bar_exit in ("SL", "SL_TRAILED"):
                            sl = position.sl_price
                            if config.gap_fill:
                                if position.direction == "long" and bar_open < sl:
                                    exit_price = bar_open
                                    entry_exit_gap = True
                                elif position.direction == "short" and bar_open > sl:
                                    exit_price = bar_open
                                    entry_exit_gap = True
                                else:
                                    exit_price = sl
                            else:
                                exit_price = sl
                        else:  # TP
                            tp = position.tp_price
                            if config.gap_fill:
                                if position.direction == "long" and bar_open > tp:
                                    exit_price = bar_open
                                    entry_exit_gap = True
                                elif position.direction == "short" and bar_open < tp:
                                    exit_price = bar_open
                                    entry_exit_gap = True
                                else:
                                    exit_price = tp
                            else:
                                exit_price = tp

                        trade = close_position(
                            position, bar_time, exit_price, entry_bar_exit, config,
                            exit_gap=entry_exit_gap, used_1s_resolution=used_1s,
                        )
                        trades.append(trade)
                        # pending_partial_pnl_currency is 0 here (partial can't fire before entry-bar SL/TP)
                        balance += trade.pnl_currency + position.pending_partial_pnl_currency
                        equity_curve.append(
                            {"time": bar_time.isoformat(), "balance": round(balance, 2)}
                        )
                        position = None
                    else:
                        # ── PROJ-30: Partial close on entry bar (SL/TP not hit) ──
                        partial_trade = check_and_execute_partial_close(
                            position, bar_high, bar_low, bar_time, config
                        )
                        if partial_trade is not None:
                            trades.append(partial_trade)

        # ── 3. New signal for next bar ──────────────────────────────────────
        # Signals are intentionally discarded while a position is open (max 1
        # trade per day for PROJ-3).  Future multi-signal strategies (PROJ-6)
        # may need to queue signals here instead of dropping them.
        if position is None:
            # Option A: build pending orders directly from pre-extracted arrays
            _le = _long_entry[i]
            _se = _short_entry[i]
            if not (np.isnan(_le) and np.isnan(_se)):
                _sig_mpd = bool(_max_per_day_arr[i])
                # Once-per-day guard: drop max_per_day signals on a date that
                # already had a max_per_day fill.  Non-tagged signals proceed.
                if _sig_mpd and last_max_per_day_date is not None and _local_dates[i] == last_max_per_day_date:
                    continue
                _raw_exp = _sig_expiry[i]
                _expiry: Optional[pd.Timestamp] = None
                if not pd.isnull(_raw_exp):
                    _ts = pd.Timestamp(_raw_exp)
                    _expiry = _ts if _ts.tzinfo is not None else _ts.tz_localize("UTC")
                _tt = _trail_trigger[i]
                _tl = _trail_lock[i]
                _ttp = float(_tt) if not np.isnan(_tt) else None
                _tlp = float(_tl) if not np.isnan(_tl) else None
                # PROJ-30 fields
                _sig_trail_type = _str_val(_trail_type_arr[i])
                _sig_trail_dist = float(_trail_dist[i]) if not np.isnan(_trail_dist[i]) else None
                _dce_raw = _trail_dce[i]
                _sig_dce = bool(_dce_raw) if not np.isnan(_dce_raw) else None
                _sig_pct = float(_partial_pct[i]) if not np.isnan(_partial_pct[i]) else None
                _sig_at_pips = float(_partial_at_pips[i]) if not np.isnan(_partial_at_pips[i]) else None
                _sig_at_r = float(_partial_at_r[i]) if not np.isnan(_partial_at_r[i]) else None
                new_orders: List[PendingOrder] = []
                if not np.isnan(_le):
                    _ltp = _long_tp[i]
                    new_orders.append(PendingOrder(
                        direction="long",
                        entry_price=float(_le),
                        sl_price=float(_long_sl[i]),
                        tp_price=float(_ltp) if not np.isnan(_ltp) else None,
                        expiry=_expiry,
                        trail_trigger_pips=_ttp,
                        trail_lock_pips=_tlp,
                        trail_type=_sig_trail_type,
                        trail_distance_pips=_sig_trail_dist,
                        trail_dont_cross_entry=_sig_dce,
                        partial_close_pct=_sig_pct,
                        partial_at_pips=_sig_at_pips,
                        partial_at_r=_sig_at_r,
                        max_per_day=_sig_mpd,
                    ))
                if not np.isnan(_se):
                    _stp = _short_tp[i]
                    new_orders.append(PendingOrder(
                        direction="short",
                        entry_price=float(_se),
                        sl_price=float(_short_sl[i]),
                        tp_price=float(_stp) if not np.isnan(_stp) else None,
                        expiry=_expiry,
                        trail_trigger_pips=_ttp,
                        trail_lock_pips=_tlp,
                        trail_type=_sig_trail_type,
                        trail_distance_pips=_sig_trail_dist,
                        trail_dont_cross_entry=_sig_dce,
                        partial_close_pct=_sig_pct,
                        partial_at_pips=_sig_at_pips,
                        partial_at_r=_sig_at_r,
                        max_per_day=_sig_mpd,
                    ))
                if new_orders:
                    pending_orders = new_orders

    # ── End of data: close any open position ───────────────────────────────
    if position is not None:
        last_time = ohlcv.index[-1]
        trade = close_position(
            position, last_time, _closes[-1], "TIME", config,
            used_1s_resolution=position.any_1s_used,
        )
        trades.append(trade)
        balance += trade.pnl_currency + position.pending_partial_pnl_currency
        equity_curve.append(
            {"time": last_time.isoformat(), "balance": round(balance, 2)}
        )

    return BacktestResult(
        trades=trades,
        equity_curve=equity_curve,
        final_balance=round(balance, 2),
        initial_balance=config.initial_balance,
        expired_order_dates=expired_order_dates,
    )
