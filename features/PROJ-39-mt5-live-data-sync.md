# PROJ-39: MT5 Live Data Sync (Bridge → Supabase)

## Status: Planned
**Created:** 2026-04-28
**Last Updated:** 2026-04-28

## Dependencies
- Requires: PROJ-37 (MT5 Bridge Worker — Strategy Tester Run) — the Bridge Worker must be running, the `MetaTrader5` module must be installed on the worker
- Requires: PROJ-34 (MT5 Broker Data Import) — uses the same data model (`mt5_datasets`, `mt5_candles`) and the same Settings section "Market Data (MT5)"
- Requires: PROJ-8 (Authentication) — admin-only access

## Overview

The existing **CSV upload** from PROJ-34 is extended with a direct **bridge sync option**: instead of manually exporting from the MT5 History Center and uploading the file, the application pulls OHLCV data directly from the connected broker via the MT5 terminal on the Bridge Worker.

**On-demand:** the user picks symbol, timeframe, and date range in Settings, clicks "Sync via Bridge" — the Bridge Worker calls `mt5.copy_rates_range()`, the data is stored in the same Supabase tables as a CSV upload.

**The CSV upload remains as a fallback** (e.g. when the bridge is offline or for historical data before the broker account period).

**Key advantages over PROJ-34:**
- No manual MT5 export + upload. One click.
- No risk of CSV-export format errors.
- Broker-accurate data (spreads, real OHLCV from the broker) directly from the live account.
- Symbol list is fetched from the broker automatically — no manual searching.

**Out of Scope (for PROJ-39):**
- Auto-sync on backtest start → could be a follow-up
- Tick-level data (only OHLCV = bar data via `copy_rates_range`)
- Live streaming / real-time updates
- EA auto-deploy → PROJ-40

---

## User Stories

- As a trader, I want to click "Sync via Bridge" in the "Market Data (MT5)" section of the Settings page, specify symbol, timeframe, and date range, and pull data directly from the broker — without opening MT5 manually or exporting a CSV.
- As a trader, I want to see the available symbols pulled directly from the broker (dropdown from the Bridge Worker), so that I pick the correct symbol without manual typing.
- As a trader, I want to see which date range is available for a symbol on the broker so that I do not request data that does not exist.
- As a trader, I want to choose Merge or Replace when syncing data that already exists, analogous to the existing CSV upload dialog.
- As a trader, I want to see the sync progress (e.g. "Loading 24,320 bars...") so that I know the process is running.
- As a trader, I want the CSV upload to keep working in case the Bridge Worker is offline or for data outside the broker's coverage.
- As a trader, I want to see on the Settings page whether a dataset was added via CSV upload or bridge sync so that I can trace its source.

---

## Acceptance Criteria

### Bridge Worker — New Endpoints

- [ ] `GET /mt5/data/symbols` returns the full symbol list from the connected broker: `[{ name, description, currency_base, currency_profit, digits, trade_mode }]`. Cached for 5 minutes (no DB query on every call).
- [ ] `GET /mt5/data/symbol/{symbol}/availability` returns the available date range: `{ symbol, timeframe, first_date, last_date, bar_count }`. Determined via `mt5.copy_rates_from()` with a historic start date.
- [ ] `POST /mt5/data/sync` accepts: `symbol`, `timeframe` (`M1`|`M5`|`M15`|`M30`|`H1`|`H4`|`D1`), `from_date`, `to_date`. Calls `mt5.copy_rates_range(symbol, timeframe_const, from_date, to_date)`, returns an array of OHLCV bars: `[{ time, open, high, low, close, tick_volume, spread }]`.
- [ ] `POST /mt5/data/sync` validates: symbol exists on the broker, date range plausible (from < to, to ≤ today), timeframe supported.
- [ ] All three endpoints sit behind `X-Bridge-Token` auth, analogous to PROJ-37.

### Python Backend — New Endpoints

- [ ] `GET /mt5/data/symbols` in `python/main.py`: proxies the bridge call, returns the symbol list
- [ ] `GET /mt5/data/symbol/{symbol}/availability` in `python/main.py`: proxies the bridge call
- [ ] `POST /mt5/data/sync` in `python/main.py`: auth check, validates the payload (Zod/Pydantic), calls the bridge, processes the response, writes the data into Supabase (`mt5_datasets` + `mt5_candles`) — exactly the same logic as the existing CSV upload handler, only the data source is the bridge instead of CSV. The `source` field is set to `"bridge"` (vs. `"csv"` in PROJ-34).

### Data Model Extension (Supabase)

- [ ] Migration adds a `source` column (`"csv"` | `"bridge"`, default `"csv"`) to the existing `mt5_datasets` table
- [ ] No new tables — the existing `mt5_datasets` and `mt5_candles` from PROJ-34 are fully reused
- [ ] No RLS changes required

### Settings UI: "Market Data (MT5)" Section (PROJ-34 Extension)

- [ ] The existing "Market Data (MT5)" section on `/settings` gets two add-options: **"Upload CSV"** (existing, PROJ-34) and **"Sync via Bridge"** (new)
- [ ] **"Sync via Bridge"** option is disabled with tooltip "Bridge Worker offline" when the health check fails — analogous to the PROJ-37 pattern
- [ ] On clicking "Sync via Bridge" a dialog with header "Sync from MT5 Bridge" opens:
  1. **"Symbol" searchable dropdown:** filled with the broker symbol list (`GET /mt5/data/symbols`). On open the list is loaded from the bridge (loading spinner with text "Loading symbols...").
  2. **"Timeframe" select:** M1, M5, M15, M30, H1, H4, D1
  3. **Availability display:** as soon as symbol + timeframe are chosen, `GET /mt5/data/symbol/{symbol}/availability` is called. Shows: "Available: 2020-01-01 – 2026-04-28 (245,320 bars)"
  4. **"Date Range" picker:** From/To. Pre-filled with the full available range. The user can narrow it down.
  5. **"Start Sync" button**
- [ ] During sync: progress display "Loading 24,320 bars for EURUSD M1 from broker..."
- [ ] On conflict (symbol + timeframe + range already exists): dialog with options "Merge" / "Replace" analogous to PROJ-34
- [ ] After a successful sync: the dataset appears immediately in the overview table with badge **"Bridge"** (vs. no badge for CSV uploads). CSV uploads show badge **"CSV"** (retroactively, via the `source` column).
- [ ] Success toast: "Successfully synced {count} bars for {symbol} {timeframe}"
- [ ] Error toast on sync failure with concrete error text from the backend

### Frontend API Routes (Next.js)

- [ ] `src/app/api/mt5/data/symbols/route.ts` — GET
- [ ] `src/app/api/mt5/data/symbol/[symbol]/availability/route.ts` — GET
- [ ] `src/app/api/mt5/data/sync/route.ts` — POST

---

## Edge Cases

- **Bridge offline when opening the sync dialog:** the symbol dropdown shows the error "Bridge not reachable — symbol list unavailable". The "Start Sync" button is disabled. The CSV upload option remains available.
- **Symbol not available on the broker (e.g. Startrader suffix `EURUSD.r` instead of `EURUSD`):** the user sees the broker's actual symbol list in the dropdown — no symbol mapping needed, the user picks `EURUSD.r` directly.
- **Broker has no history for the chosen range** (e.g. `from_date` before broker onboarding): the availability display shows the earliest available date. The date picker does not allow selecting earlier than `first_date`.
- **Very large sync (e.g. 5 years of M1 = ~1.3M bars):** the bridge streams back in chunks (10,000 bars per batch), the backend writes batch by batch into Supabase. The UI shows progress in percent. Sync timeout: 30 min.
- **Sync interruption (browser tab closed):** the backend job continues. When the user comes back: the Settings page shows badge "Sync in progress" on the affected dataset.
- **Partial sync (bridge aborts after 50%):** bars already written stay in Supabase. The next sync with Merge fills in the missing bars.
- **Dataset already exists (Merge):** new bars are added (INSERT OR IGNORE on the timestamp unique constraint), no duplicates. Existing bars are not overwritten.
- **Dataset already exists (Replace):** old bars in the chosen range are deleted, new ones inserted. Bars outside the chosen range are kept.
- **Symbol list contains 500+ instruments:** searchable dropdown with client-side filter. No performance issue.
- **Timeframe M1 vs. H1 — same date range:** two separate datasets in `mt5_datasets`. No conflict.

---

## Technical Requirements

- **Performance:** syncing 1 year of M1 data (~525,600 bars) should take < 5 min (depends on Bridge Worker hardware)
- **Reuse:** the existing Supabase tables (`mt5_datasets`, `mt5_candles`) and the CSV upload logic are reused to the maximum extent — only the data source is swapped
- **No breaking change:** the PROJ-34 CSV upload keeps working unchanged; the `source` column is an additive field with default `"csv"` (existing rows untouched)
- **Bridge token auth:** analogous to PROJ-37
- **Supabase unique constraint:** `mt5_candles(dataset_id, timestamp)` — already in place from PROJ-34 (per migration `20260419_data_cache_unique_constraint.sql` visible in the git status)

---

## Out of Scope (Follow-Up Features)

- **PROJ-40 (planned):** EA auto-deploy (Software → MT5 Experts folder) — separate direction (output instead of input), its own feature
- **Auto-sync on backtest start:** could come as an extension of PROJ-39 or as its own feature
- **Tick-level data** (only OHLCV): MT5 `copy_ticks_range()` would be possible, but tick data is 100× larger and currently not needed for our engine
- **Live streaming / real-time:** out of scope

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)
_To be added by /architecture_

## QA Test Results
_To be added by /qa_

## Deployment
_To be added by /deploy_
