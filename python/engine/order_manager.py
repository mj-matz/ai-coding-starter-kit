"""Pending order tracking and OCO evaluation."""

from dataclasses import dataclass, field
from typing import List, Literal, Optional

import pandas as pd


@dataclass
class PendingOrder:
    """A stop/limit entry order waiting to be triggered."""

    direction: Literal["long", "short"]
    entry_price: float
    sl_price: float
    tp_price: Optional[float]
    expiry: Optional[pd.Timestamp] = field(default=None)  # UTC timestamp; order expires after this time
    trail_trigger_pips: Optional[float] = None  # overrides BacktestConfig when set
    trail_lock_pips: Optional[float] = None     # overrides BacktestConfig when set
    # PROJ-30: Continuous trailing stop (all optional; None = use BacktestConfig global)
    trail_type: Optional[str] = None             # "step" or "continuous"
    trail_distance_pips: Optional[float] = None  # pip distance for continuous trail
    trail_dont_cross_entry: Optional[bool] = None
    # PROJ-30: Partial close (all optional; None = disabled)
    partial_close_pct: Optional[float] = None    # e.g. 40.0 = close 40% of position
    partial_at_pips: Optional[float] = None      # trigger: fixed pip distance from entry
    partial_at_r: Optional[float] = None         # trigger: R-multiple of initial risk


def evaluate_pending_orders(
    orders: List[PendingOrder],
    bar_high: float,
    bar_low: float,
    bar_open: float = 0.0,
) -> Optional[PendingOrder]:
    """
    Return the order triggered first in this bar, or None.

    Long  orders trigger when bar_high  >= entry_price (buy stop).
    Short orders trigger when bar_low   <= entry_price (sell stop).

    For OCO pairs, if both sides trigger on the same bar the order whose
    entry_price is closer to bar_open is returned (i.e. triggered first).
    Ties are broken in favour of the long order.
    """
    triggered = [
        order for order in orders
        if (order.direction == "long" and bar_high >= order.entry_price)
        or (order.direction == "short" and bar_low <= order.entry_price)
    ]
    if not triggered:
        return None
    if len(triggered) == 1:
        return triggered[0]
    # Both sides triggered: pick the one whose entry is closest to bar_open
    return min(triggered, key=lambda o: (abs(o.entry_price - bar_open), o.direction != "long"))
