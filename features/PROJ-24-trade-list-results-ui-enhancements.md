---
id: PROJ-24
title: Trade List & Results UI Enhancements
status: Deployed
created: 2026-03-25
---

# PROJ-24: Trade List & Results UI Enhancements

## Overview

Several UX improvements to the Trade List and Results panel to give the trader faster visual orientation and richer per-trade analytics.

## Changes Implemented

### 1. Monthly Overview — Winrate & R per Month
**File:** `src/components/backtest/metrics-summary-card.tsx`

The monthly breakdown now renders a 4-column grid:
| Monat | Trades | Winrate | R |

- **Winrate** is colour-coded: green ≥ 50 %, red < 50 %
- **R** retains the existing GlowBadge (green/red)
- Backend computes `win_rate_pct` and `avg_loss_pips` per month in `python/analytics/monthly_metrics.py`

### 2. German Weekday Abbreviation in Trade List
**File:** `src/components/backtest/trade-list-table.tsx`

Every row (trade, skipped day) now shows the German weekday abbreviation next to the date:
`Mo Di Mi Do Fr`

### 3. Weekend Rows (Sa / So)
**File:** `src/components/backtest/trade-list-table.tsx`

After the last row of each calendar week two dimmed placeholder rows are inserted for Saturday and Sunday, giving a clear week-by-week visual structure — similar to existing No-Trade-Day rows.

**Bug fixed:** `toISOString()` was converting to UTC, shifting dates in UTC+1/+2 by one day. Fixed with `localDateStr()` helper using `getFullYear/Month/Date` (local time).

### 4. Trigger Deadline Days — Clickable Chart
**Files:** `src/components/backtest/trade-list-table.tsx`, `src/components/backtest/trade-chart-dialog.tsx`

`TRIGGER_EXPIRED` skipped days are now clickable. Clicking opens the Chart Dialog showing:
- Candles for the full trading day (rangeStart → 23:59)
- Blue Range Box (derived from candles within rangeStart–rangeEnd)
- Orange arrow marker at the Trigger Deadline time (e.g. "Trigger Deadline 17:00")
- No red/green SL/TP zones (trade never opened)

`triggerDeadline` prop is threaded from `BacktestPage` → `ResultsPanel` → `TradeListTable` → `TradeChartDialog`.

### 5. Full-Day Candles in All Charts
**File:** `src/components/backtest/trade-chart-dialog.tsx`

All trade charts now load candles from `rangeStart` to `23:59` (end of trading day) instead of stopping ~30 bars after trade exit. The entry/exit markers and SL/TP zones remain at their exact positions.

### 6. MAE (Maximum Adverse Excursion) Column
**Files:** `python/engine/models.py`, `python/engine/position_tracker.py`, `python/engine/engine.py`, `python/main.py`, `src/lib/backtest-types.ts`, `src/components/backtest/trade-list-table.tsx`

A new **MAE** column is shown in the Trade List after "Exit Reason":
- Format: `-Xp` in rose colour, or `—` if MAE = 0
- MAE = maximum adverse price movement in pips from entry during the lifetime of the trade
  - Long: `(entry_price − min(bar_low)) / pip_size`
  - Short: `(max(bar_high) − entry_price) / pip_size`
- Tracked bar-by-bar in `OpenPosition.mae_adverse_price`, computed in `close_position()`
- Initialised on the entry bar so entry-bar exits are covered correctly

## Acceptance Criteria

- [x] Monthly overview shows Trades, Winrate, R per month
- [x] Trade list shows Mo/Di/Mi/Do/Fr next to each date
- [x] Sa/So placeholder rows appear between weeks, correct dates in UTC+1/+2
- [x] TRIGGER_EXPIRED rows are clickable and open a chart with deadline marker
- [x] All trade charts show candles for the full trading day
- [x] MAE column shows correct adverse pips per trade
- [x] Build passes with no TypeScript errors
