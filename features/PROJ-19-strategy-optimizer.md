# PROJ-19: Strategy Optimizer

## Status: Planned
**Created:** 2026-03-25
**Last Updated:** 2026-03-25

## Dependencies
- Requires: PROJ-2 (Backtesting Engine) — optimizer runs the engine in a loop
- Requires: PROJ-3 (Time-Range Breakout Strategy) — parameters are specific to this strategy
- Requires: PROJ-8 (Authentication) — optimizer page requires login
- Requires: PROJ-5 (Backtest UI) — inherits asset/strategy configuration

## User Stories
- As a trader, I want to find the optimal SL/TP values for my strategy so that I maximize my risk-reward ratio based on real trade data.
- As a trader, I want to optimize one parameter group at a time (step-by-step) so that I avoid over-fitting and understand the effect of each parameter in isolation.
- As a trader, I want to see the number of backtest combinations before starting so that I can adjust the parameter range if it's too large.
- As a trader, I want to see results as a heatmap and sortable table so that I can visually identify the best parameter region.
- As a trader, I want to apply the best parameters directly to my backtest configuration with one click so that I can immediately run a full backtest with the optimized values.
- As a trader, I want my optimization runs to be saved so that I can compare results across different assets and time periods.
- As a trader, I want to choose the optimization target metric (Profit Factor, Sharpe Ratio, Win Rate, Net Profit) so that I can optimize for what matters most to my strategy.

## Acceptance Criteria

### Configuration
- [ ] New "Optimizer" menu item in sidebar navigation (separate from Backtest and Data)
- [ ] Optimizer page inherits asset, date range, and strategy settings from the current backtest configuration
- [ ] User can select which parameter group to optimize (one at a time):
  - **CRV (SL/TP):** Define SL range (min, max, step) and TP range (min, max, step) in pips
  - **Time Exit:** Define exit time range (start time, end time, step in minutes)
  - **Trigger Deadline:** Define deadline range (start time, end time, step in minutes)
  - **Range Window:** Define range start/end time ranges with step in minutes
- [ ] User can select the optimization target metric: Profit Factor, Sharpe Ratio, Win Rate, Net Profit
- [ ] UI displays the total number of backtest combinations before the user starts (e.g., "This will run 240 backtests")
- [ ] If combinations exceed 500, a warning is shown and user must explicitly confirm to proceed
- [ ] "Start Optimization" button is disabled until a parameter group and target metric are selected

### Execution
- [ ] Optimizer runs all parameter combinations sequentially via the existing Python backtesting engine
- [ ] A progress bar shows current progress (e.g., "Running 47 / 240...")
- [ ] User can cancel an in-progress optimization run
- [ ] Each individual backtest result is aggregated; individual trade lists are not stored per combination (only summary metrics)

### Results
- [ ] Results are displayed as a **2D heatmap** when two continuous parameters are varied (e.g., SL on X-axis, TP on Y-axis), color-coded by target metric
- [ ] A **sortable table** below the heatmap shows all combinations with columns: parameters, Profit Factor, Sharpe Ratio, Win Rate, Total Trades, Net Profit
- [ ] The best result (highest target metric) is highlighted in the table
- [ ] User can click "Apply Best Params" to copy the best parameter values back to the backtest configuration panel
- [ ] User can click any table row to preview that combination's key metrics in a detail panel

### Persistence
- [ ] Each optimization run is saved to Supabase with: asset, date range, strategy, parameter group, target metric, timestamp, and all result rows
- [ ] Optimization history page shows past runs (date, asset, parameter group, best result achieved)
- [ ] User can reload a past optimization run to view its results again

## Edge Cases
- **No trades generated:** If a parameter combination produces 0 trades, it is shown in the table with N/A metrics and excluded from heatmap coloring.
- **All combinations fail:** If the backtesting engine returns errors for all combinations, show a clear error message with the last known error.
- **Single parameter varies:** If only one parameter varies (e.g., only TP with fixed SL), show a line chart instead of a heatmap.
- **Optimization cancelled mid-run:** Partial results up to the cancellation point are shown and can be saved.
- **Same parameters already tested:** If the exact same configuration was optimized before, show a warning and offer to load the previous result instead of re-running.
- **Very large step size:** If step size is larger than the range (e.g., range 500–600, step 200), the UI shows a validation error before starting.
- **Data not cached:** If the required market data is not yet in the cache, the optimizer triggers a data fetch first and shows a loading state.

## Technical Requirements
- Security: Authentication required (redirect to login if not authenticated)
- Performance: Each individual backtest in the loop must complete within the same time constraints as a regular backtest
- The optimizer must not block the UI — progress updates must be streamed (can reuse PROJ-10 SSE streaming pattern)
- Heatmap rendering must handle up to 1,000 cells without performance issues
- Optimization results stored in Supabase must be associated with the authenticated user (RLS)

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)
_To be added by /architecture_

## QA Test Results
_To be added by /qa_

## Deployment
_To be added by /deploy_
