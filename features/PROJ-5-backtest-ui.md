# PROJ-5: Backtest UI (Configuration + Results)

## Status: Planned
**Created:** 2026-03-09
**Last Updated:** 2026-03-09

## Dependencies
- Requires: PROJ-1 (Data Fetcher) — UI triggers data download
- Requires: PROJ-2 (Backtesting Engine) — UI triggers backtest run
- Requires: PROJ-3 (Time-Range Breakout Strategy) — UI exposes strategy parameters
- Requires: PROJ-4 (Performance Analytics) — UI displays computed metrics
- Requires: PROJ-8 (Authentication) — all routes are protected; user session required
- Extended by: PROJ-9 (Backtest History) — adds "Save Run" button and history view to this UI

## User Stories
- As a trader, I want a configuration form where I select strategy template, asset, timeframe, date range, and strategy parameters so that I can define a backtest in one place.
- As a trader, I want to click "Run Backtest" and see a loading indicator while the backend processes data so that I know the system is working.
- As a trader, I want to see an Equity Curve chart so that I can visually assess the strategy's performance over time.
- As a trader, I want to see a Drawdown chart below the Equity Curve so that I can see drawdown periods at a glance.
- As a trader, I want to see all performance metrics in a structured summary card so that I can assess the strategy at a glance.
- As a trader, I want to see a trade list with entry time, exit time, direction, PnL, and exit reason so that I can inspect individual trades.
- As a trader, I want to change a parameter (e.g. Take Profit from 175 to 200 pips) and re-run the backtest immediately so that I can quickly iterate on strategy settings.
- As a trader, I want the last used configuration to be remembered so that I don't have to re-enter all parameters after a page refresh.

## Acceptance Criteria

### Configuration Form
- [ ] Strategy template selector (initially only "Time-Range Breakout"; extensible for future strategies)
- [ ] Asset input field with validation (e.g. XAUUSD, GER30)
- [ ] Timeframe selector: 1m, 5m, 15m, 1h, 1d
- [ ] Date range picker: start date and end date
- [ ] Strategy-specific parameter fields rendered dynamically based on selected template:
  - Range Start time, Range End time
  - Trigger Deadline time
  - Time Exit time
  - Stop Loss (pips/points)
  - Take Profit (pips/points)
  - Direction (Long / Short / Both)
  - Commission (pips), Slippage (pips)
- [ ] Initial Capital field (default: 10,000)
- [ ] Position sizing mode selector: "Risk %" or "Fixed Lot"
  - If "Risk %": input field for risk per trade in % (e.g. 1.0 = 1% of current balance per trade); lot size is calculated automatically by the engine
  - If "Fixed Lot": input field for lot size (e.g. 0.1); risk % is informational only
- [ ] "Run Backtest" button — disabled while a backtest is running
- [ ] Form validation: all required fields filled, times are valid, SL > 0, TP > 0, end date > start date, risk % between 0.01 and 100
- [ ] Last configuration is persisted in localStorage and restored on page load

### Results Dashboard
- [ ] Loading state shown while backtest runs (spinner + "Running backtest…" message)
- [ ] Error state shown if backtest fails (clear message, no crash)
- [ ] Empty state shown if no trades were generated
- [ ] Equity Curve chart: line chart, x-axis = date, y-axis = account balance
- [ ] Drawdown chart: area chart below equity curve, shows drawdown % over time
- [ ] Metrics summary card with all metrics from PROJ-4 (grouped: Overview, Trade Stats, Risk)
- [ ] Trade list table: sortable by date, PnL, duration; columns: #, Date, Direction, Entry, Exit, Lot Size, PnL (pips), PnL (€/$), R-Multiple, Exit Reason, Duration
- [ ] Trade list is paginated (50 trades per page) for long backtests
- [ ] Charts are interactive: hover shows exact values; zoom/pan on time axis
- [ ] "Save Run" button visible after a completed backtest (implemented by PROJ-9; placeholder shown in PROJ-5 with "coming soon" if PROJ-9 not yet built)

### UX
- [ ] Mobile responsive (375px, 768px, 1440px)
- [ ] Configuration and results visible without horizontal scrolling on desktop
- [ ] All shadcn/ui components used for form elements (Input, Select, Button, Card, Table, Tabs)

## Edge Cases
- Backtest runs longer than 30 seconds → show timeout warning, allow cancellation
- Backend returns an error (e.g. symbol not found on Dukascopy) → show user-friendly error, keep form intact
- Zero trades returned → show "No trades in this period" message instead of empty charts
- User changes parameters while results are displayed → results stay visible until new backtest is explicitly run

## Technical Requirements
- Next.js App Router page at `/` or `/backtest`
- API route at `POST /api/backtest` — accepts config JSON, returns results JSON
- Chart library: Recharts (already compatible with shadcn/ui ecosystem)
- Form state managed with react-hook-form + Zod validation
- Backtest runs asynchronously; frontend polls or uses streaming response

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)
_To be added by /architecture_

## QA Test Results
_To be added by /qa_

## Deployment
_To be added by /deploy_
