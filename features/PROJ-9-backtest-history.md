# PROJ-9: Backtest History

## Status: Planned
**Created:** 2026-03-10
**Last Updated:** 2026-03-10

## Dependencies
- Requires: PROJ-5 (Backtest UI) — history is saved from the backtest run
- Requires: PROJ-8 (Authentication) — results are scoped to the authenticated user in Supabase

## User Stories
- As a trader, I want to save a backtest run with a custom name (e.g. "XAUUSD 3.5R TP") so that I can retrieve it later without re-running it.
- As a trader, I want to see a list of all my saved backtest runs so that I can review past experiments at any time.
- As a trader, I want to open a saved run and see its full results (metrics, equity curve, trade list) so that I can analyse it without re-running.
- As a trader, I want to load a saved run's configuration back into the backtest form so that I can use it as a starting point and tweak a parameter (e.g. change TP from 3.5R to 2R).
- As a trader, I want to delete saved runs I no longer need so that my history stays tidy.
- As a trader, I want to see key stats (Win Rate, Total R, Total Trades, asset, date range) in the history list so that I can compare runs at a glance without opening each one.

## Acceptance Criteria
- [ ] "Save Run" button appears after a backtest completes; clicking it opens a dialog to enter a name (default: `{asset} {strategy} {date}`)
- [ ] Saved run stored in Supabase (table: `backtest_runs`) with: user_id, name, created_at, config (JSON), results summary (JSON), full trade log (JSON)
- [ ] RLS policy: user can only read/write/delete own runs
- [ ] History page (or sidebar panel) lists all saved runs in reverse chronological order
- [ ] Each row in the list shows: name, asset, strategy, date range, Total Trades, Win Rate, Total R, Avg R/Month, created_at
- [ ] Clicking a row opens the full results view (same layout as PROJ-5 dashboard) populated with saved data
- [ ] "Load Config" button on a saved run loads its configuration back into the backtest form (does not overwrite without confirmation if form has unsaved data)
- [ ] Delete button on each row, requires confirmation; deleted runs are permanently removed
- [ ] Runs can be renamed inline

## Edge Cases
- User saves two runs with the same name → allowed, names are not unique; created_at differentiates them
- Saved run references a strategy or asset that no longer exists in the system → display stored results as-is with a warning "strategy/asset may be outdated"
- Trade log is very large (1000+ trades) → stored as compressed JSON; loading is still fast (< 2s)
- User has no saved runs → empty state with "Run a backtest and save it to start your history"

## Technical Requirements
- Requires: PROJ-8 (Authentication) — runs are scoped per user via RLS
- Supabase table: `backtest_runs` with columns: `id`, `user_id`, `name`, `asset`, `strategy`, `config` (jsonb), `summary` (jsonb), `trade_log` (jsonb), `created_at`
- API routes: `GET /api/backtest/runs`, `POST /api/backtest/runs`, `GET /api/backtest/runs/[id]`, `DELETE /api/backtest/runs/[id]`, `PATCH /api/backtest/runs/[id]` (rename)
- Config and results stored as JSONB — no separate columns for individual metrics (keeps schema stable as metrics evolve)
- All shadcn/ui components used (Table, Dialog, Button, Input, Badge)

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)
_To be added by /architecture_

## QA Test Results
_To be added by /qa_

## Deployment
_To be added by /deploy_
