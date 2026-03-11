# PROJ-7: Trade Journal (Manual)

## Status: Planned
**Created:** 2026-03-09
**Last Updated:** 2026-03-09

## Dependencies
- Requires: PROJ-5 (Backtest UI) — journal lives in the same web app
- Requires: PROJ-8 (Authentication) — entries are stored per authenticated user in Supabase

## User Stories
- As a trader, I want to manually log my real trades (entry, exit, asset, direction, PnL) so that I can track my live trading performance separately from backtests.
- As a trader, I want to add free-text notes to each trade so that I can capture my reasoning, emotions, or observations.
- As a trader, I want to add tags to trades (e.g. "followed rules", "revenge trade", "missed entry") so that I can filter and identify patterns in my behaviour.
- As a trader, I want to see a summary of my journal (Win Rate, Total PnL, trade count) so that I can compare my real execution to backtest results.
- As a trader, I want to filter the journal by asset, date range, tag, or direction so that I can analyse specific subsets of my trading.
- As a trader, I want to manually enter the R-Multiple for a trade (e.g. +3R, −1R) so that I can track my reward-to-risk outcomes independently of price calculations.
- As a trader, I want to edit or delete journal entries so that I can correct mistakes.

## Acceptance Criteria
- [ ] "Add Trade" form with fields: date, asset, direction (Long/Short), entry price, exit price, size/lots, PnL (auto-calculated or manual override), R-Multiple (manual entry, e.g. +3.5 or −1), exit reason, notes (free text), tags (multi-select)
- [ ] R-Multiple field accepts positive and negative decimals; displayed with sign (e.g. "+3.5R", "−1.0R")
- [ ] Summary bar includes Total R (sum of all R-Multiples in filtered view) alongside Win Rate and Total PnL
- [ ] Journal entries are persisted in Supabase database (per authenticated user)
- [ ] Trade list displays all journal entries in reverse chronological order
- [ ] Trade list is filterable by: asset, direction, tag, date range
- [ ] Summary bar shows: Total Trades, Win Rate, Total PnL for currently filtered view
- [ ] Edit and delete actions available on each entry
- [ ] Delete requires confirmation (no accidental deletions)
- [ ] Tags are user-defined and reusable across entries
- [ ] Journal data can be exported as CSV

## Edge Cases
- User deletes a tag that is used in existing entries → tag is removed from those entries
- PnL entered manually contradicts entry/exit price calculation → show warning but allow manual override
- Journal is empty → show empty state with "Add your first trade" prompt
- Large number of entries (500+) → list is paginated, filters remain fast

## Technical Requirements
- Requires: PROJ-8 (Authentication) — journal entries are scoped to the authenticated user
- Data stored in Supabase database (table: `journal_trades`, RLS policy: user can only read/write own rows)
- API routes: `GET/POST /api/journal/trades`, `PUT/DELETE /api/journal/trades/[id]`
- Export to CSV via client-side Blob download (data fetched from API first)
- All shadcn/ui components used (Table, Dialog, Input, Select, Badge for tags, Button)

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)
_To be added by /architecture_

## QA Test Results
_To be added by /qa_

## Deployment
_To be added by /deploy_
