"""Trade-level metrics: win rate, profit factor, R-multiples, streaks, avg duration (PROJ-4).

All functions accept a list of Trade dataclass instances from engine.models.
"""

import math
from datetime import timedelta
from typing import List, Optional, Tuple

import numpy as np

from engine.models import Trade


# ---------------------------------------------------------------------------
# Core counts
# ---------------------------------------------------------------------------

def total_trades(trades: List[Trade]) -> int:
    """Count of all closed trades."""
    return len(trades)


def winning_trades(trades: List[Trade]) -> List[Trade]:
    """Trades with PnL > 0 (currency)."""
    return [t for t in trades if t.pnl_currency > 0]


def losing_trades(trades: List[Trade]) -> List[Trade]:
    """Trades with PnL <= 0 (currency)."""
    return [t for t in trades if t.pnl_currency <= 0]


# ---------------------------------------------------------------------------
# Win / loss aggregates (currency-denominated)
# ---------------------------------------------------------------------------

def win_rate(trades: List[Trade]) -> Optional[float]:
    """Win Rate = Winning Trades / Total Trades * 100%.

    Returns None if total_trades == 0.
    """
    n = total_trades(trades)
    if n == 0:
        return None
    return len(winning_trades(trades)) / n * 100.0


def gross_profit_currency(trades: List[Trade]) -> float:
    """Sum of pnl_currency for winning trades."""
    return sum(t.pnl_currency for t in winning_trades(trades))


def gross_loss_currency(trades: List[Trade]) -> float:
    """Sum of |pnl_currency| for losing trades (returned as positive)."""
    return abs(sum(t.pnl_currency for t in losing_trades(trades)))


def profit_factor_currency(trades: List[Trade]) -> Optional[float]:
    """Profit Factor = Gross Profit / Gross Loss.

    Returns float('inf') when gross_loss == 0 and gross_profit > 0.
    Returns None when no trades.
    Returns 0.0 when gross_profit == 0.
    """
    n = total_trades(trades)
    if n == 0:
        return None
    gp = gross_profit_currency(trades)
    gl = gross_loss_currency(trades)
    if gl == 0:
        return float("inf") if gp > 0 else 1.0  # all-breakeven → neutral
    return gp / gl


def avg_win_currency(trades: List[Trade]) -> Optional[float]:
    """Average Win = Gross Profit / Winning Trades (currency)."""
    w = winning_trades(trades)
    if not w:
        return None
    return gross_profit_currency(trades) / len(w)


def avg_loss_currency(trades: List[Trade]) -> Optional[float]:
    """Average Loss = Gross Loss / Losing Trades (currency, positive value)."""
    lo = losing_trades(trades)
    if not lo:
        return None
    return gross_loss_currency(trades) / len(lo)


def avg_win_loss_ratio_currency(trades: List[Trade]) -> Optional[float]:
    """Avg Win / Avg Loss (currency). Returns None if either side is missing."""
    aw = avg_win_currency(trades)
    al = avg_loss_currency(trades)
    if aw is None or al is None or al == 0:
        return None
    return aw / al


def avg_win_loss_ratio_pips(trades: List[Trade]) -> Optional[float]:
    """Avg Win / Avg Loss (pips). Returns None if either side is missing."""
    aw = avg_win_pips(trades)
    al = avg_loss_pips(trades)
    if aw is None or al is None or al == 0:
        return None
    return aw / al


# ---------------------------------------------------------------------------
# Win / loss aggregates (pip-denominated)
# ---------------------------------------------------------------------------

def gross_profit_pips(trades: List[Trade]) -> float:
    """Sum of pnl_pips for winning trades (using currency to identify winners)."""
    return sum(t.pnl_pips for t in winning_trades(trades))


def gross_loss_pips(trades: List[Trade]) -> float:
    """Sum of |pnl_pips| for losing trades (returned as positive)."""
    return abs(sum(t.pnl_pips for t in losing_trades(trades)))


def profit_factor_pips(trades: List[Trade]) -> Optional[float]:
    """Profit Factor in pips = Gross Profit (pips) / Gross Loss (pips)."""
    n = total_trades(trades)
    if n == 0:
        return None
    gp = gross_profit_pips(trades)
    gl = gross_loss_pips(trades)
    if gl == 0:
        return float("inf") if gp > 0 else 1.0  # all-breakeven → neutral
    return gp / gl


def avg_win_pips(trades: List[Trade]) -> Optional[float]:
    """Average Win in pips."""
    w = winning_trades(trades)
    if not w:
        return None
    return gross_profit_pips(trades) / len(w)


def avg_loss_pips(trades: List[Trade]) -> Optional[float]:
    """Average Loss in pips (positive value)."""
    lo = losing_trades(trades)
    if not lo:
        return None
    return gross_loss_pips(trades) / len(lo)


# ---------------------------------------------------------------------------
# Best / worst trade
# ---------------------------------------------------------------------------

def best_trade_currency(trades: List[Trade]) -> Optional[float]:
    """Highest single trade PnL (currency)."""
    if not trades:
        return None
    return max(t.pnl_currency for t in trades)


def worst_trade_currency(trades: List[Trade]) -> Optional[float]:
    """Lowest single trade PnL (currency)."""
    if not trades:
        return None
    return min(t.pnl_currency for t in trades)


def best_trade_pips(trades: List[Trade]) -> Optional[float]:
    """Highest single trade PnL (pips)."""
    if not trades:
        return None
    return max(t.pnl_pips for t in trades)


def worst_trade_pips(trades: List[Trade]) -> Optional[float]:
    """Lowest single trade PnL (pips)."""
    if not trades:
        return None
    return min(t.pnl_pips for t in trades)


# ---------------------------------------------------------------------------
# Consecutive streaks
# ---------------------------------------------------------------------------

def consecutive_streaks(trades: List[Trade]) -> Tuple[int, int]:
    """Return (longest_win_streak, longest_loss_streak)."""
    if not trades:
        return (0, 0)

    max_wins = 0
    max_losses = 0
    cur_wins = 0
    cur_losses = 0

    for t in trades:
        if t.pnl_currency > 0:
            cur_wins += 1
            cur_losses = 0
        else:
            cur_losses += 1
            cur_wins = 0
        max_wins = max(max_wins, cur_wins)
        max_losses = max(max_losses, cur_losses)

    return (max_wins, max_losses)


# ---------------------------------------------------------------------------
# Average trade duration
# ---------------------------------------------------------------------------

def avg_trade_duration_hours(trades: List[Trade]) -> Optional[float]:
    """Mean time between entry_time and exit_time across all trades, in hours."""
    if not trades:
        return None
    total_seconds = sum(
        (t.exit_time - t.entry_time).total_seconds() for t in trades
    )
    return total_seconds / len(trades) / 3600.0


# ---------------------------------------------------------------------------
# R-Multiple calculations
# R-Multiple = pnl_currency / initial_risk_currency
# ---------------------------------------------------------------------------

def r_multiple(trade: Trade) -> Optional[float]:
    """R-Multiple for a single trade.

    For SL exits R is defined as -1.0 regardless of gap-fill,
    because the intended risk (1R) was the stop distance — not the slippage
    caused by an overnight/intrabar gap.
    For SL_TRAILED exits the actual pnl / initial_risk is used, because the
    trailing stop may have been locked in at a profit (positive lock_pips),
    resulting in a positive R-multiple.
    For TP and TIME exits the actual pnl / initial_risk is used.

    Returns None if initial_risk_currency == 0 (SL at entry).
    """
    if trade.initial_risk_currency == 0:
        return None
    if trade.exit_reason == "SL":
        return -1.0
    return trade.pnl_currency / trade.initial_risk_currency


def r_multiples(trades: List[Trade]) -> List[Optional[float]]:
    """R-Multiples for all trades."""
    return [r_multiple(t) for t in trades]


def _valid_r_multiples(trades: List[Trade]) -> List[float]:
    """R-Multiples excluding None entries (trades with zero risk)."""
    return [r for r in r_multiples(trades) if r is not None]


def total_r(trades: List[Trade]) -> Optional[float]:
    """Sum of all valid R-Multiples."""
    valid = _valid_r_multiples(trades)
    if not valid:
        return None
    return sum(valid)


def avg_r_per_trade(trades: List[Trade]) -> Optional[float]:
    """Total R / Total Trades (including trades with zero risk counted as 0 R).

    Returns None if no valid R-multiples exist (all trades have zero risk).
    """
    if not trades:
        return None
    valid = _valid_r_multiples(trades)
    if not valid:
        return None
    return sum(valid) / len(trades)


def expectancy_currency(trades: List[Trade]) -> Optional[float]:
    """Expectancy = (Win Rate * Avg Win) - (Loss Rate * Avg Loss) in currency.

    Returns None if no trades.
    """
    n = total_trades(trades)
    if n == 0:
        return None
    wr = len(winning_trades(trades)) / n
    lr = len(losing_trades(trades)) / n
    aw = avg_win_currency(trades) or 0.0
    al = avg_loss_currency(trades) or 0.0
    return wr * aw - lr * al


def expectancy_pips(trades: List[Trade]) -> Optional[float]:
    """Expectancy in pips = (Win Rate * Avg Win Pips) - (Loss Rate * Avg Loss Pips)."""
    n = total_trades(trades)
    if n == 0:
        return None
    wr = len(winning_trades(trades)) / n
    lr = len(losing_trades(trades)) / n
    aw = avg_win_pips(trades) or 0.0
    al = avg_loss_pips(trades) or 0.0
    return wr * aw - lr * al


# ---------------------------------------------------------------------------
# Direction breakdown (long / short)
# ---------------------------------------------------------------------------

def long_short_breakdown(trades: List[Trade]) -> dict:
    """Return counts and win rates for long and short trades.

    Returns dict with keys:
        buy_trades, buy_wins, buy_win_rate_pct,
        sell_trades, sell_wins, sell_win_rate_pct
    """
    longs = [t for t in trades if t.direction == "long"]
    shorts = [t for t in trades if t.direction == "short"]
    long_wins = [t for t in longs if t.pnl_currency > 0]
    short_wins = [t for t in shorts if t.pnl_currency > 0]

    return {
        "buy_trades": len(longs),
        "buy_wins": len(long_wins),
        "buy_win_rate_pct": (len(long_wins) / len(longs) * 100.0) if longs else None,
        "sell_trades": len(shorts),
        "sell_wins": len(short_wins),
        "sell_win_rate_pct": (len(short_wins) / len(shorts) * 100.0) if shorts else None,
    }


# ---------------------------------------------------------------------------
# Min / Max trade duration
# ---------------------------------------------------------------------------

def min_trade_duration_minutes(trades: List[Trade]) -> Optional[float]:
    """Shortest trade duration in minutes. Returns None if no trades."""
    if not trades:
        return None
    return min((t.exit_time - t.entry_time).total_seconds() / 60.0 for t in trades)


def max_trade_duration_minutes(trades: List[Trade]) -> Optional[float]:
    """Longest trade duration in minutes. Returns None if no trades."""
    if not trades:
        return None
    return max((t.exit_time - t.entry_time).total_seconds() / 60.0 for t in trades)


# ---------------------------------------------------------------------------
# Extended consecutive streak metrics
# ---------------------------------------------------------------------------

def consecutive_streaks_extended(trades: List[Trade]) -> dict:
    """Return extended consecutive streak metrics.

    Returns dict with keys:
        max_consec_wins_count, max_consec_wins_profit,
        max_consec_losses_count, max_consec_losses_loss,
        avg_consec_wins, avg_consec_losses
    """
    if not trades:
        return {
            "max_consec_wins_count": 0,
            "max_consec_wins_profit": 0.0,
            "max_consec_losses_count": 0,
            "max_consec_losses_loss": 0.0,
            "avg_consec_wins": 0.0,
            "avg_consec_losses": 0.0,
        }

    # Build list of all streaks
    win_streaks: List[Tuple[int, float]] = []   # (count, total_pnl)
    loss_streaks: List[Tuple[int, float]] = []

    cur_type: Optional[str] = None  # "win" or "loss"
    cur_count = 0
    cur_pnl = 0.0

    for t in trades:
        is_win = t.pnl_currency > 0
        streak_type = "win" if is_win else "loss"

        if streak_type == cur_type:
            cur_count += 1
            cur_pnl += t.pnl_currency
        else:
            # Save previous streak
            if cur_type == "win" and cur_count > 0:
                win_streaks.append((cur_count, cur_pnl))
            elif cur_type == "loss" and cur_count > 0:
                loss_streaks.append((cur_count, cur_pnl))
            cur_type = streak_type
            cur_count = 1
            cur_pnl = t.pnl_currency

    # Save final streak
    if cur_type == "win" and cur_count > 0:
        win_streaks.append((cur_count, cur_pnl))
    elif cur_type == "loss" and cur_count > 0:
        loss_streaks.append((cur_count, cur_pnl))

    # Max streaks
    if win_streaks:
        max_win = max(win_streaks, key=lambda s: s[0])
        avg_consec_wins = sum(s[0] for s in win_streaks) / len(win_streaks)
    else:
        max_win = (0, 0.0)
        avg_consec_wins = 0.0

    if loss_streaks:
        max_loss = max(loss_streaks, key=lambda s: s[0])
        avg_consec_losses = sum(s[0] for s in loss_streaks) / len(loss_streaks)
    else:
        max_loss = (0, 0.0)
        avg_consec_losses = 0.0

    return {
        "max_consec_wins_count": max_win[0],
        "max_consec_wins_profit": max_win[1],
        "max_consec_losses_count": max_loss[0],
        "max_consec_losses_loss": max_loss[1],
        "avg_consec_wins": avg_consec_wins,
        "avg_consec_losses": avg_consec_losses,
    }


# ---------------------------------------------------------------------------
# AHPR / GHPR (Average / Geometric Holding Period Return)
# ---------------------------------------------------------------------------

def ahpr(trades: List[Trade], initial_balance: float) -> Optional[float]:
    """Average Holding Period Return.

    AHPR = arithmetic mean of per-trade balance multipliers (1 + return_i).
    Return per trade = pnl_currency / balance_before_trade.

    Returns None if no trades or initial_balance <= 0.
    """
    if not trades or initial_balance <= 0:
        return None

    balance = initial_balance
    multipliers = []
    for t in trades:
        if balance <= 0:
            break
        mult = 1.0 + (t.pnl_currency / balance)
        multipliers.append(mult)
        balance += t.pnl_currency

    if not multipliers:
        return None

    return float(np.mean(multipliers))


def ghpr(trades: List[Trade], initial_balance: float) -> Optional[float]:
    """Geometric Holding Period Return.

    GHPR = geometric mean of per-trade balance multipliers.
    GHPR = (product of multipliers)^(1/n)

    Clamps multipliers at 0.001 to avoid log(0).
    Returns None if no trades or initial_balance <= 0.
    """
    if not trades or initial_balance <= 0:
        return None

    balance = initial_balance
    log_sum = 0.0
    count = 0
    for t in trades:
        if balance <= 0:
            break
        mult = max(1.0 + (t.pnl_currency / balance), 0.001)
        log_sum += math.log(mult)
        count += 1
        balance += t.pnl_currency

    if count == 0:
        return None

    return float(math.exp(log_sum / count))


# ---------------------------------------------------------------------------
# Z-Score (Wald-Wolfowitz Runs Test)
# ---------------------------------------------------------------------------

def z_score_runs_test(trades: List[Trade]) -> Tuple[Optional[float], Optional[float]]:
    """Z-Score using the MT5 Wald-Wolfowitz Runs Test formula.

    Z = (N*(R-0.5) - P) / sqrt(P*(P-N) / (N-1))
    where:
        N = total trades
        R = number of runs (consecutive sequences of wins or losses)
        P = 2 * wins * losses

    Returns:
        (z_score, confidence_pct) — both None if fewer than 2 trades
        or if all trades are wins/losses (P=0).
    """
    n = len(trades)
    if n < 2:
        return (None, None)

    wins = sum(1 for t in trades if t.pnl_currency > 0)
    losses = n - wins

    if wins == 0 or losses == 0:
        return (None, None)

    # Count runs
    runs = 1
    for i in range(1, n):
        prev_win = trades[i - 1].pnl_currency > 0
        curr_win = trades[i].pnl_currency > 0
        if prev_win != curr_win:
            runs += 1

    p = 2.0 * wins * losses
    denominator_sq = p * (p - n) / (n - 1)

    if denominator_sq <= 0:
        return (None, None)

    z = (n * (runs - 0.5) - p) / math.sqrt(denominator_sq)

    # Confidence: percentage from standard normal CDF
    # Using the error function approximation: Phi(x) = 0.5 * (1 + erf(x / sqrt(2)))
    confidence = (1.0 - 2.0 * (1.0 - 0.5 * (1.0 + math.erf(abs(z) / math.sqrt(2.0))))) * 100.0

    return (float(z), float(confidence))


# ---------------------------------------------------------------------------
# Net Profit, Recovery Factor, Expected Payoff
# ---------------------------------------------------------------------------

def net_profit(trades: List[Trade]) -> float:
    """Absolute net profit in account currency ($)."""
    return sum(t.pnl_currency for t in trades)


def recovery_factor(net_profit_val: float, max_dd_abs: Optional[float]) -> Optional[float]:
    """Recovery Factor = net_profit / max_drawdown_abs.

    Returns None if max_drawdown_abs is 0 or None.
    """
    if max_dd_abs is None or max_dd_abs == 0:
        return None
    return net_profit_val / max_dd_abs


def expected_payoff(trades: List[Trade]) -> Optional[float]:
    """Expected Payoff = net_profit / total_trades ($ per trade).

    Returns None if no trades.
    """
    n = len(trades)
    if n == 0:
        return None
    return sum(t.pnl_currency for t in trades) / n
