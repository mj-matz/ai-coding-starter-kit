"""Core backtesting engine (PROJ-2).

Public entry point: run_backtest(ohlcv, signals, config) -> BacktestResult
"""

from datetime import time
from typing import List, Optional
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from .models import BacktestConfig, BacktestResult, Trade
from .order_manager import PendingOrder, evaluate_pending_orders
from .pip_utils import pips_to_price_offset
from .position_tracker import (
    OpenPosition,
    apply_trail_if_triggered,
    check_sl_tp,
    close_position,
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
        expiry = pd.Timestamp(raw_expiry)

    trail_trigger_raw = sig_row.get("trail_trigger_pips", np.nan)
    trail_lock_raw = sig_row.get("trail_lock_pips", np.nan)
    trail_trigger_pips = float(trail_trigger_raw) if pd.notna(trail_trigger_raw) else None
    trail_lock_pips = float(trail_lock_raw) if pd.notna(trail_lock_raw) else None

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
            )
        )

    return orders


def run_backtest(
    ohlcv: pd.DataFrame,
    signals: pd.DataFrame,
    config: BacktestConfig,
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
    exit_time = _parse_time_exit(config.time_exit)
    exit_tz = ZoneInfo(config.timezone)
    slippage_offset = pips_to_price_offset(
        config.slippage_pips, config.instrument.pip_size
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

    # ── Option B: Pre-compute time-exit flags (avoid tz_convert per bar) ─────
    if exit_time is not None:
        _local_idx   = ohlcv.index.tz_convert(exit_tz)
        _exit_min    = exit_time.hour * 60 + exit_time.minute
        _bar_min     = _local_idx.hour * 60 + _local_idx.minute
        exit_flags: Optional[np.ndarray] = (_bar_min >= _exit_min)
    else:
        exit_flags = None

    balance: float = config.initial_balance
    trades: List[Trade] = []
    equity_curve = [{"time": ohlcv.index[0].isoformat(), "balance": balance}]
    position: Optional[OpenPosition] = None
    pending_orders: List[PendingOrder] = []
    expired_order_dates: List[str] = []

    for i in range(len(ohlcv)):
        bar_time = ohlcv.index[i]
        bar_open = _opens[i]
        bar_high = _highs[i]
        bar_low  = _lows[i]

        # ── 1a. Time exit ───────────────────────────────────────────────────
        if position is not None and exit_flags is not None and exit_flags[i]:
                trade = close_position(position, bar_time, bar_open, "TIME", config)
                trades.append(trade)
                balance += trade.pnl_currency
                equity_curve.append(
                    {"time": bar_time.isoformat(), "balance": round(balance, 2)}
                )
                position = None
                pending_orders = []

        # ── 1b & 1c. Trail trigger + SL/TP ─────────────────────────────────
        if position is not None:
            apply_trail_if_triggered(position, bar_high, bar_low, config)

            exit_reason = check_sl_tp(position, bar_high, bar_low)
            if exit_reason is not None:
                exit_gap = False
                if exit_reason in ("SL", "SL_TRAILED"):
                    sl = position.sl_price
                    if config.gap_fill:
                        # Gap fill: if bar opened past SL, use open price (worse fill)
                        if position.direction == "long" and bar_open < sl:
                            exit_price = bar_open
                            exit_gap = True
                        elif position.direction == "short" and bar_open > sl:
                            exit_price = bar_open
                            exit_gap = True
                        else:
                            exit_price = sl
                    else:
                        exit_price = sl  # TradingView-mode: exact fill at SL
                else:  # TP
                    tp = position.tp_price
                    if config.gap_fill:
                        # Gap fill: if bar opened past TP, use open price (better fill)
                        if position.direction == "long" and bar_open > tp:
                            exit_price = bar_open
                            exit_gap = True
                        elif position.direction == "short" and bar_open < tp:
                            exit_price = bar_open
                            exit_gap = True
                        else:
                            exit_price = tp
                    else:
                        exit_price = tp  # TradingView-mode: exact fill at TP
                trade = close_position(position, bar_time, exit_price, exit_reason, config, exit_gap=exit_gap)
                trades.append(trade)
                balance += trade.pnl_currency
                equity_curve.append(
                    {"time": bar_time.isoformat(), "balance": round(balance, 2)}
                )
                position = None
                pending_orders = []

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

        # ── 2. Check pending orders ─────────────────────────────────────────
        if position is None and pending_orders:
            triggered = evaluate_pending_orders(pending_orders, bar_high, bar_low, bar_open)
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
                    actual_entry = fill_base + slippage_offset
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
                    sl_price=triggered.sl_price,
                    tp_price=triggered.tp_price,
                    lot_size=lot_size,
                    initial_sl_price=triggered.sl_price,
                    entry_gap_pips=entry_gap_pips,
                    trail_trigger_pips=triggered.trail_trigger_pips,
                    trail_lock_pips=triggered.trail_lock_pips,
                )
                pending_orders = []  # cancel OCO partner

        # ── 3. New signal for next bar ──────────────────────────────────────
        # Signals are intentionally discarded while a position is open (max 1
        # trade per day for PROJ-3).  Future multi-signal strategies (PROJ-6)
        # may need to queue signals here instead of dropping them.
        if position is None:
            # Option A: build pending orders directly from pre-extracted arrays
            _le = _long_entry[i]
            _se = _short_entry[i]
            if not (np.isnan(_le) and np.isnan(_se)):
                _raw_exp = _sig_expiry[i]
                _expiry: Optional[pd.Timestamp] = (
                    pd.Timestamp(_raw_exp) if not pd.isnull(_raw_exp) else None
                )
                _tt = _trail_trigger[i]
                _tl = _trail_lock[i]
                _ttp = float(_tt) if not np.isnan(_tt) else None
                _tlp = float(_tl) if not np.isnan(_tl) else None
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
                    ))
                if new_orders:
                    pending_orders = new_orders

    # ── End of data: close any open position ───────────────────────────────
    if position is not None:
        last_time = ohlcv.index[-1]
        trade = close_position(
            position, last_time, _closes[-1], "TIME", config
        )
        trades.append(trade)
        balance += trade.pnl_currency
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
