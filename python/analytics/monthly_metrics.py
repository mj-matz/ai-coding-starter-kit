"""Monthly R-Multiple breakdown (PROJ-4).

Groups trades by the calendar month of their exit_time and sums R-Multiples.
"""

from collections import defaultdict
from typing import Dict, List, Optional, Tuple

from engine.models import Trade
from .trade_metrics import r_multiple
from .models import MonthlyR


def monthly_r_breakdown(trades: List[Trade]) -> List[MonthlyR]:
    """Compute R earned per calendar month.

    Groups by exit_time month. Trades with initial_risk_currency == 0
    (R-Multiple = None) are included in trade_count but excluded from r_earned.

    Returns a list sorted by month ascending.
    """
    if not trades:
        return []

    # month_key -> [sum_r, count, win_count, sum_loss_pips, loss_count, sum_mae_pips, mae_count]
    monthly: Dict[str, list] = defaultdict(lambda: [0.0, 0, 0, 0.0, 0, 0.0, 0])

    for t in trades:
        month_key = t.exit_time.strftime("%Y-%m")
        r = r_multiple(t)
        monthly[month_key][1] += 1
        if r is not None:
            monthly[month_key][0] += r
        # Win/loss tracking based on pnl_pips
        if t.pnl_pips >= 0:
            monthly[month_key][2] += 1
        else:
            monthly[month_key][3] += abs(t.pnl_pips)
            monthly[month_key][4] += 1
        # MAE tracking
        if hasattr(t, "mae_pips") and t.mae_pips > 0:
            monthly[month_key][5] += t.mae_pips
            monthly[month_key][6] += 1

    result = []
    for month_key in sorted(monthly.keys()):
        r_sum, count, win_count, sum_loss_pips, loss_count, sum_mae_pips, mae_count = monthly[month_key]
        win_rate = (win_count / count * 100) if count > 0 else 0.0
        avg_loss = (sum_loss_pips / loss_count) if loss_count > 0 else None
        avg_mae = (sum_mae_pips / mae_count) if mae_count > 0 else None
        result.append(
            MonthlyR(
                month=month_key,
                r_earned=round(r_sum, 4),
                trade_count=count,
                win_rate_pct=round(win_rate, 1),
                avg_loss_pips=round(avg_loss, 1) if avg_loss is not None else None,
                avg_mae_pips=round(avg_mae, 0) if avg_mae is not None else None,
            )
        )

    return result


def avg_r_per_month(trades: List[Trade], monthly: List[MonthlyR]) -> Optional[float]:
    """Average R per Month = Total R / Number of calendar months.

    Returns None if no valid R-multiples exist or no months.
    """
    if not monthly:
        return None

    from .trade_metrics import total_r as calc_total_r
    tr = calc_total_r(trades)
    if tr is None:
        return None

    return tr / len(monthly)
