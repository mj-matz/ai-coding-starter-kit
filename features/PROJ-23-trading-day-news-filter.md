---
id: PROJ-23
title: Trading Day & News Day Filter
status: Deployed
created: 2026-03-25
---

# PROJ-23 · Trading Day & News Day Filter

## Overview

Two new backtest configuration options under **Advanced Parameters** that allow the user to restrict which days are traded:

1. **Trading Day Selector** — Weekday toggles (Mo–Fr), all enabled by default
2. **News Day Filter** — Checkbox to skip or show days with high-impact economic events; yellow badge in the Trade List for affected trades

---

## User Stories

- As a trader, I want to exclude specific weekdays (e.g. Friday) from backtests so I can test strategies that avoid end-of-week volatility.
- As a trader, I want to exclude news days from backtests so I can measure strategy performance without high-impact event distortion.
- As a trader, I want to see which trades in my Trade List occurred on news days, even when I'm not filtering them out.

---

## Acceptance Criteria

### Trading Day Selector
- [ ] 5 toggle buttons (Mo Di Mi Do Fr) displayed horizontally in Advanced Parameters
- [ ] All 5 active by default (white = active, dark = inactive)
- [ ] At least 1 day must remain selected (last active day cannot be deselected)
- [ ] Selection is persisted in localStorage with the rest of the config
- [ ] Selected days are sent to FastAPI as `tradingDays: number[]` (0=Mo … 4=Fr, Python weekday convention)

### News Day Filter
- [ ] Checkbox "Handel an News-Tagen" in Advanced Parameters, checked by default
- [ ] When unchecked: resolves news dates from `economic_calendar` table for the backtest date range and sends them as `newsDates: string[]` to FastAPI for filtering
- [ ] Yellow "News-Tag" badge appears next to Exit Reason in Trade List for any trade whose entry date is in `economic_calendar` — regardless of filter setting
- [ ] Badge is always informational (shown even when `tradeNewsDays=true`)

### Economic Calendar Data
- [ ] Supabase table `economic_calendar(date, currency, impact, event, synced_at)` with RLS (authenticated read, service-role write)
- [ ] Pre-seeded with 152 verified USD news days Jan 2025 – Feb 2026 (source: TradingView / XAUUSD)
- [ ] Sync route `POST /api/admin/sync-calendar` fetches current week + next week from ForexFactory (`nfs.faireconomy.media`) and upserts into table
- [ ] Instrument → currency mapping in `src/lib/instrument-currencies.ts` (XAUUSD→USD, GER30→EUR, EURUSD→USD+EUR, etc.)

---

## Technical Design

### New Files
| File | Purpose |
|------|---------|
| `src/lib/instrument-currencies.ts` | Maps instrument symbols to relevant currency codes |
| `src/app/api/admin/sync-calendar/route.ts` | POST: fetches ForexFactory, upserts to Supabase |

### Modified Files
| File | Change |
|------|--------|
| `src/lib/backtest-types.ts` | Added `tradingDays`, `tradeNewsDays` fields |
| `src/components/backtest/strategy-params.tsx` | Toggle buttons + checkbox UI |
| `src/hooks/use-backtest.ts` | Fetches news dates from Supabase before stream; exposes `newsDates` |
| `src/app/(dashboard)/backtest/page.tsx` | Passes `newsDates` to ResultsPanel |
| `src/components/backtest/results-panel.tsx` | Passes `newsDates` to TradeListTable |
| `src/components/backtest/trade-list-table.tsx` | Shows yellow "News-Tag" badge |
| `src/app/api/backtest/route.ts` | Added `tradingDays`, `tradeNewsDays`, `newsDates` to validation |
| `.env.local.example` | Added `SUPABASE_SERVICE_ROLE_KEY` |

### Data Flow
```
User toggles weekdays / news checkbox
  → form state (react-hook-form)
  → runBacktestStream(config)
    → if !tradeNewsDays: query economic_calendar (Supabase) → resolvedNewsDates
    → always: setNewsDates(resolvedNewsDates) for badge display
    → POST /api/backtest/stream  { ...config, tradingDays, newsDates? }
      → FastAPI filters days by weekday + newsDates
```

### Economic Calendar Sync
```
POST /api/admin/sync-calendar  (authenticated)
  → fetch nfs.faireconomy.media/ff_calendar_thisweek.json
  → fetch nfs.faireconomy.media/ff_calendar_nextweek.json
  → filter impact === "High"
  → upsert into economic_calendar (onConflict: date,currency,event)
```

---

## Notes & Decisions
- **ForexFactory** used for ongoing weekly sync (no API key required, private use only)
- **Historical seed data** (Jan 2025–Feb 2026) sourced from user-verified TradingView data for XAUUSD (USD events)
- DAX/EUR historical data to be added manually by user
- FMP `/stable/economic-calendar` has no "Premium" label in docs — potential future alternative for historical backfill
- `tradingDays` uses Python `weekday()` convention (0=Mon, 4=Fri) for direct backend compatibility
