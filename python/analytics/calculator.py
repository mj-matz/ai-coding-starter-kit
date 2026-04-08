"""Main analytics orchestrator (PROJ-4).

Entry point: calculate_analytics(result) -> AnalyticsResult

Collects metrics from trade_metrics, equity_metrics, risk_metrics,
and monthly_metrics into a single structured output.
"""

from typing import List, Optional

from engine.models import BacktestResult

from .models import AnalyticsResult, Metric
from .trade_metrics import (
    total_trades,
    winning_trades,
    losing_trades,
    win_rate,
    gross_profit_currency,
    gross_loss_currency,
    profit_factor_currency,
    avg_win_currency,
    avg_loss_currency,
    avg_win_loss_ratio_currency,
    avg_win_loss_ratio_pips,
    gross_profit_pips,
    gross_loss_pips,
    profit_factor_pips,
    avg_win_pips,
    avg_loss_pips,
    best_trade_currency,
    worst_trade_currency,
    best_trade_pips,
    worst_trade_pips,
    consecutive_streaks,
    avg_trade_duration_hours,
    total_r,
    avg_r_per_trade,
    expectancy_currency,
    expectancy_pips,
    long_short_breakdown,
    min_trade_duration_minutes,
    max_trade_duration_minutes,
    consecutive_streaks_extended,
    ahpr,
    ghpr,
    z_score_runs_test,
    net_profit,
    recovery_factor,
    expected_payoff,
)
from .equity_metrics import total_return_pct, cagr, max_drawdown, lr_correlation, lr_standard_error
from .risk_metrics import sharpe_ratio, sortino_ratio
from .monthly_metrics import monthly_r_breakdown, avg_r_per_month


def _round_opt(value, decimals: int = 4):
    """Round a value if it is a finite float, otherwise pass through."""
    if value is None:
        return None
    if isinstance(value, float):
        if value == float("inf"):
            return value
        return round(value, decimals)
    return value


def calculate_analytics(result: BacktestResult) -> AnalyticsResult:
    """Compute all performance metrics from a BacktestResult.

    Parameters
    ----------
    result : BacktestResult
        Output of run_backtest(), containing trades, equity_curve,
        final_balance, and initial_balance.

    Returns
    -------
    AnalyticsResult
        summary (list of Metric) + monthly_r (list of MonthlyR).
    """
    trades = result.trades
    equity = result.equity_curve
    initial = result.initial_balance
    final = result.final_balance

    # Streaks
    cons_wins, cons_losses = consecutive_streaks(trades)

    # Extended streaks
    streaks_ext = consecutive_streaks_extended(trades)

    # Drawdown (now returns 3 values)
    dd_pct, dd_duration, dd_abs = max_drawdown(equity)

    # Direction breakdown
    dir_breakdown = long_short_breakdown(trades)

    # Net profit, recovery factor, expected payoff
    net_profit_val = net_profit(trades)
    recovery_factor_val = recovery_factor(net_profit_val, dd_abs)
    expected_payoff_val = expected_payoff(trades)

    # AHPR / GHPR
    ahpr_val = ahpr(trades, initial)
    ghpr_val = ghpr(trades, initial)

    # Z-Score
    z_score_val, z_score_conf = z_score_runs_test(trades)

    # LR metrics
    lr_corr_val = lr_correlation(equity)
    lr_se_val = lr_standard_error(equity)

    # CAGR sub-year note
    cagr_note: Optional[str] = None
    if len(equity) >= 2:
        from datetime import datetime as _dt
        first_time = _dt.fromisoformat(equity[0]["time"])
        last_time = _dt.fromisoformat(equity[-1]["time"])
        days_elapsed = (last_time - first_time).total_seconds() / 86400.0
        if 0 < days_elapsed < 365.25:
            cagr_note = "Annualised estimate (period < 1 year)"

    # Monthly R
    monthly = monthly_r_breakdown(trades)
    avg_r_month = avg_r_per_month(trades, monthly)

    # Build summary metrics list
    summary: List[Metric] = [
        # -- Count metrics --
        Metric("Total Trades", total_trades(trades), "count"),
        Metric("Winning Trades", len(winning_trades(trades)), "count"),
        Metric("Losing Trades", len(losing_trades(trades)), "count"),
        Metric("Win Rate", _round_opt(win_rate(trades), 2), "%"),

        # -- Currency metrics --
        Metric("Gross Profit", _round_opt(gross_profit_currency(trades), 2), "currency"),
        Metric("Gross Loss", _round_opt(gross_loss_currency(trades), 2), "currency"),
        Metric("Profit Factor", _round_opt(profit_factor_currency(trades), 2), "ratio"),
        Metric("Avg Win", _round_opt(avg_win_currency(trades), 2), "currency"),
        Metric("Avg Loss", _round_opt(avg_loss_currency(trades), 2), "currency"),
        Metric("Avg Win / Avg Loss", _round_opt(avg_win_loss_ratio_currency(trades), 2), "ratio"),
        Metric("Expectancy", _round_opt(expectancy_currency(trades), 2), "currency"),
        Metric("Best Trade", _round_opt(best_trade_currency(trades), 2), "currency"),
        Metric("Worst Trade", _round_opt(worst_trade_currency(trades), 2), "currency"),

        # -- Pip metrics --
        Metric("Gross Profit (Pips)", _round_opt(gross_profit_pips(trades), 1), "pips"),
        Metric("Gross Loss (Pips)", _round_opt(gross_loss_pips(trades), 1), "pips"),
        Metric("Profit Factor (Pips)", _round_opt(profit_factor_pips(trades), 2), "ratio"),
        Metric("Avg Win (Pips)", _round_opt(avg_win_pips(trades), 1), "pips"),
        Metric("Avg Loss (Pips)", _round_opt(avg_loss_pips(trades), 1), "pips"),
        Metric("Avg Win / Avg Loss (Pips)", _round_opt(avg_win_loss_ratio_pips(trades), 2), "ratio"),
        Metric("Expectancy (Pips)", _round_opt(expectancy_pips(trades), 1), "pips"),
        Metric("Best Trade (Pips)", _round_opt(best_trade_pips(trades), 1), "pips"),
        Metric("Worst Trade (Pips)", _round_opt(worst_trade_pips(trades), 1), "pips"),

        # -- Equity curve metrics --
        Metric("Total Return", _round_opt(total_return_pct(initial, final), 2), "%"),
        Metric("CAGR", _round_opt(cagr(initial, final, equity), 2), "%", note=cagr_note),
        Metric("Max Drawdown", _round_opt(dd_pct, 2), "%"),
        Metric("Max Drawdown Duration", _round_opt(dd_duration, 1), "days"),

        # -- Risk-adjusted metrics --
        Metric("Sharpe Ratio", _round_opt(sharpe_ratio(equity), 2), "ratio",
               note="Requires ≥ 2 days of data; null when insufficient data or zero variance"),
        Metric("Sortino Ratio", _round_opt(sortino_ratio(equity), 2), "ratio",
               note="Requires ≥ 2 days of data with negative returns; null otherwise"),

        # -- Duration --
        Metric("Avg Trade Duration", _round_opt(avg_trade_duration_hours(trades), 1), "hours"),

        # -- Streaks --
        Metric("Consecutive Wins", cons_wins, "count"),
        Metric("Consecutive Losses", cons_losses, "count"),

        # -- R-Multiple metrics --
        Metric("Total R", _round_opt(total_r(trades), 2), "R"),
        Metric("Avg R per Trade", _round_opt(avg_r_per_trade(trades), 2), "R"),
        Metric("Avg R per Month", _round_opt(avg_r_month, 2), "R"),

        # -- PROJ-31: Extended metrics --
        Metric("Net Profit", _round_opt(net_profit_val, 2), "currency"),
        Metric("Max Drawdown Abs", _round_opt(dd_abs, 2), "currency"),
        Metric("Recovery Factor", _round_opt(recovery_factor_val, 2), "ratio"),
        Metric("Expected Payoff", _round_opt(expected_payoff_val, 2), "currency"),

        # Direction breakdown
        Metric("Buy Trades", dir_breakdown["buy_trades"], "count"),
        Metric("Buy Win Rate", _round_opt(dir_breakdown["buy_win_rate_pct"], 2), "%"),
        Metric("Sell Trades", dir_breakdown["sell_trades"], "count"),
        Metric("Sell Win Rate", _round_opt(dir_breakdown["sell_win_rate_pct"], 2), "%"),

        # Min / Max duration
        Metric("Min Trade Duration", _round_opt(min_trade_duration_minutes(trades), 1), "minutes"),
        Metric("Max Trade Duration", _round_opt(max_trade_duration_minutes(trades), 1), "minutes"),

        # Extended streaks
        Metric("Max Consec Wins Count", streaks_ext["max_consec_wins_count"], "count"),
        Metric("Max Consec Wins Profit", _round_opt(streaks_ext["max_consec_wins_profit"], 2), "currency"),
        Metric("Max Consec Losses Count", streaks_ext["max_consec_losses_count"], "count"),
        Metric("Max Consec Losses Loss", _round_opt(streaks_ext["max_consec_losses_loss"], 2), "currency"),
        Metric("Avg Consec Wins", _round_opt(streaks_ext["avg_consec_wins"], 2), "count"),
        Metric("Avg Consec Losses", _round_opt(streaks_ext["avg_consec_losses"], 2), "count"),

        # AHPR / GHPR
        Metric("AHPR", _round_opt(ahpr_val, 6), "ratio"),
        Metric("GHPR", _round_opt(ghpr_val, 6), "ratio"),

        # LR metrics
        Metric("LR Correlation", _round_opt(lr_corr_val, 4), "ratio"),
        Metric("LR Standard Error", _round_opt(lr_se_val, 2), "currency"),

        # Z-Score
        Metric("Z-Score", _round_opt(z_score_val, 2), "ratio"),
        Metric("Z-Score Confidence", _round_opt(z_score_conf, 2), "%"),
    ]

    return AnalyticsResult(summary=summary, monthly_r=monthly)
