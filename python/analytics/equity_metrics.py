"""Equity-curve metrics: Total Return, CAGR, Max Drawdown, Max DD Duration (PROJ-4).

Functions operate on the equity_curve list produced by BacktestResult,
which has the shape [{"time": str (ISO-8601), "balance": float}, ...].
"""

from datetime import datetime
from typing import Dict, List, Optional, Tuple

import numpy as np


# ---------------------------------------------------------------------------
# Total Return
# ---------------------------------------------------------------------------

def total_return_pct(initial_balance: float, final_balance: float) -> Optional[float]:
    """Total Return % = (Final - Initial) / Initial * 100.

    Returns None if initial_balance == 0.
    """
    if initial_balance == 0:
        return None
    return (final_balance - initial_balance) / initial_balance * 100.0


# ---------------------------------------------------------------------------
# CAGR (Compound Annual Growth Rate)
# ---------------------------------------------------------------------------

def cagr(
    initial_balance: float,
    final_balance: float,
    equity_curve: List[Dict],
) -> Optional[float]:
    """CAGR = (Final / Initial)^(1/years) - 1.

    Uses the first and last equity_curve timestamps to determine the period.
    Returns None if period is zero or initial_balance == 0.
    Result is a percentage (e.g. 12.5 for 12.5%).
    """
    if initial_balance <= 0 or final_balance <= 0 or len(equity_curve) < 2:
        return None

    first_time = datetime.fromisoformat(equity_curve[0]["time"])
    last_time = datetime.fromisoformat(equity_curve[-1]["time"])
    days = (last_time - first_time).total_seconds() / 86400.0

    if days <= 0:
        return None

    years = days / 365.25
    ratio = final_balance / initial_balance
    # For negative returns, use signed power:
    # (Final/Initial)^(1/years) - 1
    return (ratio ** (1.0 / years) - 1.0) * 100.0


# ---------------------------------------------------------------------------
# Maximum Drawdown (percentage and duration)
# ---------------------------------------------------------------------------

def max_drawdown(equity_curve: List[Dict]) -> Tuple[Optional[float], Optional[float], Optional[float]]:
    """Calculate Max Drawdown %, Max Drawdown Duration (days), and Max Drawdown absolute ($).

    Max Drawdown % = max peak-to-trough decline of the equity curve.
    Max Drawdown Duration = longest period from a peak until a new high is reached
                            (or end of data if never recovered).
    Max Drawdown Abs = max peak-to-trough decline in absolute currency ($).

    Returns:
        (max_dd_pct, max_dd_duration_days, max_dd_abs) — all None if equity_curve is empty.
    """
    if not equity_curve:
        return (None, None, None)

    balances = [point["balance"] for point in equity_curve]
    times = [datetime.fromisoformat(point["time"]) for point in equity_curve]

    if len(balances) < 2:
        return (0.0, 0.0, 0.0)

    peak = balances[0]
    max_dd_pct: float = 0.0
    max_dd_abs: float = 0.0

    # For duration tracking
    peak_time = times[0]
    max_dd_duration_seconds: float = 0.0

    for i in range(1, len(balances)):
        if balances[i] >= peak:
            # New high reached — record recovery duration
            duration_seconds = (times[i] - peak_time).total_seconds()
            max_dd_duration_seconds = max(max_dd_duration_seconds, duration_seconds)
            peak = balances[i]
            peak_time = times[i]
        else:
            # In a drawdown
            dd = (peak - balances[i]) / peak * 100.0
            dd_abs = peak - balances[i]
            max_dd_pct = max(max_dd_pct, dd)
            max_dd_abs = max(max_dd_abs, dd_abs)

    # If we never recovered, the drawdown duration extends to the last point
    if balances[-1] < peak:
        duration_seconds = (times[-1] - peak_time).total_seconds()
        max_dd_duration_seconds = max(max_dd_duration_seconds, duration_seconds)

    # If no actual drawdown occurred, duration is meaningless — return 0
    if max_dd_pct == 0.0:
        return (0.0, 0.0, 0.0)

    max_dd_duration_days = max_dd_duration_seconds / 86400.0

    return (max_dd_pct, max_dd_duration_days, max_dd_abs)


# ---------------------------------------------------------------------------
# Linear Regression of Equity Curve
# ---------------------------------------------------------------------------

def lr_correlation(equity_curve: List[Dict]) -> Optional[float]:
    """Pearson R-squared of the equity curve vs. its linear regression line.

    Returns a value between 0 and 1. Returns None if fewer than 2 data points.
    Returns 0.0 for a flat equity curve (zero variance).
    """
    if len(equity_curve) < 2:
        return None

    balances = np.array([point["balance"] for point in equity_curve], dtype=np.float64)
    n = len(balances)
    x = np.arange(n, dtype=np.float64)

    # Pearson correlation coefficient
    mean_x = np.mean(x)
    mean_y = np.mean(balances)
    dx = x - mean_x
    dy = balances - mean_y

    ss_xy = np.dot(dx, dy)
    ss_xx = np.dot(dx, dx)
    ss_yy = np.dot(dy, dy)

    if ss_xx == 0 or ss_yy == 0:
        return 0.0

    r = ss_xy / np.sqrt(ss_xx * ss_yy)
    return float(r * r)  # R-squared


def lr_standard_error(equity_curve: List[Dict]) -> Optional[float]:
    """Standard error of the linear regression of the equity curve (in $).

    SE = sqrt(sum((y_i - y_hat_i)^2) / (n - 2))

    Returns None if fewer than 3 data points.
    """
    if len(equity_curve) < 3:
        return None

    balances = np.array([point["balance"] for point in equity_curve], dtype=np.float64)
    n = len(balances)
    x = np.arange(n, dtype=np.float64)

    # Linear regression: y = a + b*x
    mean_x = np.mean(x)
    mean_y = np.mean(balances)
    dx = x - mean_x

    ss_xx = np.dot(dx, dx)
    if ss_xx == 0:
        return 0.0

    b = np.dot(dx, balances - mean_y) / ss_xx
    a = mean_y - b * mean_x

    y_hat = a + b * x
    residuals = balances - y_hat
    sse = np.dot(residuals, residuals)

    se = float(np.sqrt(sse / (n - 2)))
    return se
