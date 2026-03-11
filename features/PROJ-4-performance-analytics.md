# PROJ-4: Performance Analytics

## Status: Planned
**Created:** 2026-03-09
**Last Updated:** 2026-03-09

## Dependencies
- Requires: PROJ-2 (Backtesting Engine) — analytics consumes the trade log and equity curve produced by the engine

## User Stories
- As a trader, I want to see my Total Return, CAGR, and final account balance so that I understand the absolute profitability of the strategy.
- As a trader, I want to see Sharpe Ratio and Sortino Ratio so that I can assess risk-adjusted returns.
- As a trader, I want to see Maximum Drawdown (absolute and %) so that I understand the worst capital decline I would have experienced.
- As a trader, I want to see Win Rate, Profit Factor, and Average Win/Loss so that I understand the trade-by-trade characteristics.
- As a trader, I want to see the number of total trades, winning trades, and losing trades so that I can assess statistical significance.
- As a trader, I want to see average trade duration so that I understand how long capital is at risk per trade.
- As a trader, I want to see the R-Multiple per trade so that I can evaluate each trade relative to the risk I took.
- As a trader, I want to see R earned per month so that I can track consistency and identify which months were productive (e.g. 3 wins × 3.5R + 2 losses × −1R = +8.5R in one month).
- As a trader, I want all metrics to be calculated with a transparent formula so that I can verify them manually on a sample.

## Acceptance Criteria
- [ ] All metrics are calculated from the trade log produced by the engine — no approximations
- [ ] The following metrics are calculated and returned:

| Metric | Formula / Definition |
|--------|---------------------|
| Total Trades | Count of all closed trades |
| Winning Trades | Trades with PnL > 0 |
| Losing Trades | Trades with PnL <= 0 |
| Win Rate | Winning Trades / Total Trades × 100% |
| Gross Profit | Sum of PnL for winning trades |
| Gross Loss | Sum of PnL for losing trades (absolute) |
| Profit Factor | Gross Profit / Gross Loss |
| Average Win | Gross Profit / Winning Trades |
| Average Loss | Gross Loss / Losing Trades |
| Avg Win / Avg Loss (R) | Average Win / Average Loss |
| Total Return % | (Final Balance − Initial Balance) / Initial Balance × 100% |
| CAGR | (Final Balance / Initial Balance)^(1/years) − 1 |
| Max Drawdown % | Max peak-to-trough decline of equity curve |
| Max Drawdown Duration | Longest time (days) from peak to recovery |
| Sharpe Ratio | Mean daily return / Std daily return × √252 (risk-free rate = 0) |
| Sortino Ratio | Mean daily return / Downside deviation × √252 |
| Avg Trade Duration | Mean time between entry and exit across all trades |
| Best Trade | Highest single trade PnL |
| Worst Trade | Lowest single trade PnL |
| Consecutive Wins | Longest streak of winning trades |
| Consecutive Losses | Longest streak of losing trades |
| R-Multiple per Trade | Trade PnL in currency / Initial Risk in currency (from trade log) |
| Total R | Sum of all R-Multiples across all trades |
| Avg R per Trade | Total R / Total Trades |
| R per Month | Sum of R-Multiples for all trades whose exit falls in that calendar month |
| Avg R per Month | Total R / Number of calendar months in backtest period |

- [ ] All metrics are returned as a structured object (dict/JSON) with metric name, value, and unit
- [ ] Metrics are calculated both in pips and in account currency (requires initial capital and pip value as inputs)
- [ ] If total trades = 0, all metrics return 0 or null with no division-by-zero error
- [ ] If all trades are winners (gross loss = 0), Profit Factor returns `∞` (infinity), not an error

## Edge Cases
- Single trade in backtest → metrics are returned but Sharpe/Sortino may be undefined (std = 0) → return null with note
- Initial risk = 0 for a trade (e.g. SL placed at entry) → R-Multiple for that trade = null, excluded from R aggregations
- All trades in a single calendar month → R per Month shows one row, Avg R per Month = Total R
- Backtest period under 1 year → CAGR extrapolated but labelled as annualised estimate
- All trades exit at time exit (no SL/TP hits) → still valid, metrics calculated normally
- Equity curve never recovers from drawdown to new high → Max Drawdown Duration = total backtest duration

## Technical Requirements
- Pure Python calculation module, no external analytics library required (numpy/pandas only)
- All formulas documented in code comments with references
- Module accepts: trade_log (list of trades), equity_curve (time series), initial_capital (float), pip_value (float)
- Returns: metrics dict + equity curve data ready for charting

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)
_To be added by /architecture_

## QA Test Results
_To be added by /qa_

## Deployment
_To be added by /deploy_
