# PROJ-41: MT5 Hub — Standalone Tester, Trade Drill-Down & Metrics Fix

## Status: Deployed
**Created:** 2026-05-20
**Last Updated:** 2026-05-20

## Dependencies
- Requires: PROJ-37 (MT5 Bridge Worker — Strategy Tester Run) — tables, hooks, and API routes
- Requires: PROJ-40 (MT5 EA-Auto-Deploy) — EA deployment infrastructure

## User Stories

- As a trader, I want the MT5 Tester History table to show Profit, Sharpe, DD%, and Trades for completed runs so that I can compare results at a glance without re-running.
- As a trader, I want to click a row in the MT5 Tester History to see all individual trades for that run, including open/close time, direction, volume, entry, close price, and profit.
- As a trader, I want to run any MT5 EA by name directly from a dedicated MT5 page without first converting MQL code to Python, because many of my EAs are already compiled in MT5.
- As a trader, I want a dedicated /mt5 top-level page with Tester, History, and Bridge tabs so that MT5 is a first-class feature alongside Backtests and Optimizer.
- As a trader, I want to monitor the Bridge connection status (online/offline, broker, build, queue) from the Bridge tab without navigating to Settings.

## Acceptance Criteria

- [ ] After a "Test in MT5" run completes (status = done), the MT5 Tester History row shows non-"—" values for Profit, Sharpe, DD%, and Trades without a page reload.
- [ ] Metrics persist in `mt5_tester_metrics` after the first poll that returns `status: "done"` — subsequent polls do not create duplicates (upsert is idempotent).
- [ ] Individual trades are stored in `mt5_tester_trades` when the bridge returns a `trades` array in the status payload.
- [ ] Clicking a completed-run row in the history table opens a detail drawer (Sheet) showing: run parameters (symbol, timeframe, from/to date, model, and all EA input variables as a Variable | Value table), metrics summary, and a trades table.
- [ ] The drawer has a "Use these settings" button that closes the drawer and pre-fills the Tester tab form with the same EA name, symbol, timeframe, dates, model, and parameters from that run.
- [ ] Runs with no trades show "No trades recorded" inside the drawer instead of an error.
- [ ] The delete button in the history table row still works and does NOT open the drawer (stopPropagation).
- [ ] A new top-level route `/mt5` exists and is reachable from the sidebar nav under "MT5".
- [ ] The /mt5 page has three tabs: Tester, History, Bridge. The active tab is reflected in the URL query param `?tab=`.
- [ ] The Tester tab contains a form where the user can enter EA name, symbol, timeframe, date range, model, and optional key-value parameters — and submit without any prior MQL conversion.
- [ ] After submitting the standalone tester form, a result panel appears showing live status polling and final MT5 metrics, matching the existing Mt5ResultPanel behavior.
- [ ] When a standalone run finishes, the History tab refresh key increments so the table reloads automatically.
- [ ] The Bridge tab shows online/offline status, broker, build number, and queue length using the existing `useMt5Health` hook.
- [ ] MQL Converter "Test in MT5" flow is unchanged and continues to work.

## Edge Cases

- If the status route is polled multiple times after `status: done`, the upsert must be idempotent — no duplicate metrics rows, no duplicate trade rows.
- If the bridge returns `status: done` but `metrics` is null (run crashed before JSON was written), skip the upsert gracefully.
- If `trades` array is absent or empty, insert nothing into `mt5_tester_trades` — do not fail.
- If the run row in `mt5_tester_runs` cannot be found by `bridge_job_id` (e.g., run was deleted), skip persistence silently — still return the status payload to the client.
- If the trades API is called for a run that belongs to a different user, return 403.
- Expert name normalisation: leading "Experts/" prefix and trailing ".ex5" extension should be stripped then re-added so the user can enter "myEA", "myEA.ex5", or "Experts/myEA.ex5" and always send the correct path.
- The standalone form must show a loading/disabled state while a run is in progress to prevent double-submit.

## Technical Requirements

- Security: All new API routes require authenticated session (Supabase auth.getUser()).
- Security: Run ownership must be verified before returning trades (check `user_id` on `mt5_tester_runs`).
- Performance: Trades query limited to 5,000 rows; ordered by `open_time ASC`.
- No new database migrations — `mt5_tester_runs`, `mt5_tester_metrics`, and `mt5_tester_trades` already exist with correct schema and RLS.
- Idempotency: metrics upsert uses `onConflict: "run_id"`; trades insertion guarded by COUNT check.
- Shared format helpers (formatDate, formatProfit, formatPct, formatInt) extracted to `src/lib/mt5-format.ts` to avoid duplication between the existing history section and the new components.

---

## Tech Design (Solution Architect)

### Why Three Things in One Feature
These three sub-problems share the same root cause: MT5 testing was built as an add-on inside MQL Converter (PROJ-37), not as a standalone feature. All three fixes flow from making MT5 a first-class part of the product.

---

### A) Component Structure

```
Sidebar
└── "MT5" nav item  ← new (between Strategies and MQL Converter)

/mt5 Page  ← new top-level page
├── Tabs: Tester | History | Bridge
│
├── Tester Tab
│   ├── StandaloneTesterForm  ← new
│   │   ├── Expert Name input (free text, auto-normalised to .ex5)
│   │   ├── Symbol input
│   │   ├── Timeframe select (M1/M5/M15/M30/H1/H4/D1)
│   │   ├── From Date / To Date inputs
│   │   ├── Model select (default: EveryTickRealistic)
│   │   ├── Dynamic key-value parameter rows (add/remove)
│   │   └── Run button (disabled while run is in progress)
│   └── Mt5ResultPanel  ← existing, reused with pythonResult=null
│
├── History Tab
│   ├── TesterHistoryTable  ← new (refactored from mt5-history-section)
│   │   ├── Table rows: Started, Expert, Symbol, TF, Profit, Sharpe, DD%, Trades, Status, Delete
│   │   ├── Clickable rows → opens drawer
│   │   └── Delete button (stops row click propagation)
│   └── RunDetailDrawer  ← new (Sheet)
│       ├── Header: Expert name + Status badge
│       ├── Run Settings: Symbol, Timeframe, From/To, Model
│       ├── Parameters table: Variable | Value  (matches MT5 Variables tab)
│       ├── "Use these settings" button → pre-fills Tester form + switches tab
│       ├── Metrics: Net Profit, Sharpe, Max DD, Profit Factor, Win Rate, Total Trades
│       └── Trades Table: Open Time, Direction, Volume, Entry, Close, Profit
│           (skeleton while loading; "No trades recorded" when empty)
│
└── Bridge Tab
    └── Mt5BridgeStatusCard  ← new (wraps existing useMt5Health hook)
        ├── Online/Offline indicator
        ├── Broker, Build number, Queue length
        └── Link → /settings

/mql-converter Page (existing, unchanged)
└── Mt5HistorySection  ← existing, updated to use shared format helpers
    └── Internally uses TesterHistoryTable (or just shared helpers)
```

---

### B) Data Model

**Existing tables (no migrations needed):**

`mt5_tester_runs` — one row per test run  
- Key columns: `id`, `bridge_job_id`, `user_id`, `expert_name`, `symbol`, `timeframe`, `from_date`, `to_date`, `status`, `started_at`, `finished_at`  
- `bridge_job_id` is the link between the status poll (which knows the job ID) and the database row (which knows the run ID used as a foreign key in metrics/trades)

`mt5_tester_metrics` — one row per completed run  
- Currently empty for runs started via the browser (root cause of the "—" bug)  
- Fix: the Next.js status proxy writes here the moment it first sees `status: "done"` from the bridge  
- Upsert (not insert) is used so repeated polls don't create duplicates

`mt5_tester_trades` — one row per trade  
- Currently always empty (deferred in PROJ-37)  
- Fix: written at the same time as metrics, using the `trades` array the bridge already includes in its status payload  
- A COUNT check before inserting ensures a second poll doesn't insert duplicate trades

**New in this feature:**  
No new tables. The only data-layer change is that the status proxy now *writes* to Supabase in addition to forwarding the response.

---

### C) Data Flow

**Current (broken) flow:**
```
Browser polls /api/mt5/tester/status/[jobId]
  → Next.js proxies to FastAPI
  → FastAPI returns { status: "done", metrics: {...}, trades: [...] }
  → Next.js forwards raw response to browser  ← metrics displayed in comparison panel
  ← Nothing written to Supabase              ← history table shows "—"
```

**Fixed flow:**
```
Browser polls /api/mt5/tester/status/[jobId]
  → Next.js proxies to FastAPI
  → FastAPI returns { status: "done", metrics: {...}, trades: [...] }
  → Next.js writes metrics to mt5_tester_metrics (upsert, idempotent)
  → Next.js writes trades to mt5_tester_trades (if not already stored)
  → Next.js marks run as "done" in mt5_tester_runs
  → Next.js forwards raw response to browser (unchanged)
```

**Trades drill-down flow (new):**
```
User clicks a row in TesterHistoryTable
  → RunDetailDrawer opens (Sheet component)
  → Fetches GET /api/mt5/tester/runs/[id]/trades
  → API verifies user owns the run, returns trades array
  → Drawer renders trades table (with skeleton while loading)
```

---

### D) Tech Decisions

| Decision | Choice | Reason |
|----------|--------|---------|
| Metrics persistence location | Next.js status proxy (not FastAPI) | FastAPI runs on Railway (shared infra); the Next.js layer already has Supabase access and is the correct write boundary for user-scoped data |
| Upsert vs insert for metrics | Upsert on `run_id` conflict | Status is polled every 2s — must be safe to call multiple times |
| Trades insertion guard | COUNT before insert | Trades are a bulk array; upsert on individual rows would require a composite unique key migration; COUNT avoids that |
| Sheet for drawer | shadcn `Sheet` | Already installed; standard pattern in this codebase for detail panels |
| Tab state in URL | `?tab=` query param | Allows deep-linking and back-button navigation |
| Existing `useMt5TesterRun` hook | Reused in StandaloneTesterForm | Hook already handles polling, phase tracking, and result state — no new logic needed |
| Format helpers | Extracted to `src/lib/mt5-format.ts` | Shared between existing MQL Converter history section and new MT5 Hub components |
| No new dashboard layout | Inherit from `(dashboard)/layout.tsx` | Auth check, sidebar, and toaster already provided |

---

### E) New Files Summary

| File | Type | Purpose |
|------|------|---------|
| `src/lib/mt5-format.ts` | Utility | Shared date/number formatters |
| `src/app/api/mt5/tester/runs/[id]/trades/route.ts` | API | Fetch trades for a run (auth + ownership check) |
| `src/components/mt5/tester-history-table.tsx` | Component | History table with clickable rows |
| `src/components/mt5/run-detail-drawer.tsx` | Component | Sheet drawer: params + metrics + trades |
| `src/components/mt5/standalone-tester-form.tsx` | Component | EA tester form without MQL conversion |
| `src/app/(dashboard)/mt5/page.tsx` | Page | Top-level MT5 hub (3 tabs) |

**Modified files:**
| File | Change |
|------|--------|
| `src/app/api/mt5/tester/status/[jobId]/route.ts` | Add persistence on `status === "done"` |
| `src/lib/mt5-bridge-types.ts` | Add `Mt5TesterTrade` type; extend existing interfaces |
| `src/components/auth/app-sidebar.tsx` | Add MT5 nav item |
| `src/components/mql-converter/mt5-history-section.tsx` | Import from shared format helpers |

---

### F) No New Dependencies
All required packages are already installed:
- shadcn/ui primitives: Sheet, Table, Tabs, Badge, Skeleton, Select, Input, Button — all present
- `lucide-react` — for icons
- Supabase client — already used throughout

## Implementation Notes

### Frontend (completed 2026-05-20)
- **`src/components/mt5/tester-history-table.tsx`** — New component extracted from `Mt5HistorySection`. Adds clickable rows (done runs only) that open `RunDetailDrawer`. Delete button calls `e.stopPropagation()` to prevent row-click. Accepts `onUseSettings` callback forwarded from the page.
- **`src/components/mt5/run-detail-drawer.tsx`** — New Sheet drawer. Fetches full run detail + trades in parallel when opened. Shows run settings, parameters table, "Use these settings" button, metrics, and trades table (skeleton while loading; "No trades recorded" when empty). Uses derived `isLoading` state (no synchronous setState in effects).
- **`src/components/mt5/standalone-tester-form.tsx`** — New EA tester form. Expert name normalises "Experts/" prefix and ".ex5" suffix. Dynamic key-value parameter rows. Accepts `initialValues` (applied at mount) — parent uses `key` to force remount when settings change. Calls `onRunComplete` when a run terminates. Shows `Mt5ResultPanel` (status/progress) and a standalone metrics card when done.
- **`src/app/(dashboard)/mt5/page.tsx`** — New top-level MT5 page. Three tabs (Tester, History, Bridge) with `?tab=` URL param via `useSearchParams`. "Use these settings" flow: increments `prefilledKey` → remounts `StandaloneTesterForm` with new `initialValues` → switches to Tester tab. History tab refresh key increments on run completion. Wrapped in Suspense for `useSearchParams`.

### Backend (completed 2026-05-20)
- **`src/lib/mt5-format.ts`** — New shared helpers: `formatDate`, `formatProfit`, `formatPct`, `formatInt`. Removes duplication between history section and new hub components.
- **`src/lib/mt5-bridge-types.ts`** — Added `Mt5TesterTrade` interface; extended `Mt5RunStatusResponse` with `trades` field (typed as `Omit<Mt5TesterTrade, "id" | "run_id">[]`); added `parameters`, `model`, `bridge_job_id`, `last_status_at` optional fields to `Mt5TesterRun`.
- **`src/app/api/mt5/tester/status/[jobId]/route.ts`** — On first `status === "done"` response: (1) looks up run by `bridge_job_id + user_id`, (2) updates run status in `mt5_tester_runs`, (3) upserts metrics via `onConflict: "run_id"`, (4) count-guards trade insert. Errors are caught and logged; they never block the status response forwarded to the client.
- **`src/app/api/mt5/tester/runs/[id]/trades/route.ts`** — New `GET` route. Explicit ownership check (returns 403 if `user_id` mismatch). Returns up to 5,000 trades ordered by `open_time ASC`.
- **`src/components/mql-converter/mt5-history-section.tsx`** — Replaced 4 local format functions with imports from `@/lib/mt5-format`.
- **`src/components/auth/app-sidebar.tsx`** — Added "MT5" nav item (Monitor icon) between Strategies and MQL Converter, pointing to `/mt5`.

## QA Test Results

**QA Date:** 2026-05-20
**Tester:** /qa skill (Claude Sonnet 4.6)
**Build:** ✅ Clean (no TypeScript errors, no lint warnings)

### Acceptance Criteria

| # | Criterion | Result |
|---|-----------|--------|
| AC-1 | History row shows non-"—" metrics after run completes (no page reload) | ✅ Pass |
| AC-2 | Metrics upsert is idempotent (`onConflict: "run_id"`) | ✅ Pass (code review) |
| AC-3 | Trades stored when bridge returns `trades` array | ✅ Pass (code review) |
| AC-4 | Clicking completed run opens Sheet drawer with params, metrics, trades | ✅ Pass |
| AC-5 | Drawer has "Use these settings" button that pre-fills Tester form | ✅ Pass |
| AC-6 | Runs with no trades show "No trades recorded" | ✅ Pass |
| AC-7 | Delete button does not open drawer (stopPropagation) | ✅ Pass |
| AC-8 | `/mt5` route exists and reachable from sidebar | ✅ Pass |
| AC-9 | Three tabs with `?tab=` URL param | ✅ Pass |
| AC-10 | Tester form has EA name, symbol, timeframe, dates, model, params | ✅ Pass |
| AC-11 | Result panel shows live status polling after submit | ✅ Pass |
| AC-12 | History tab refresh key increments on run completion | ✅ Pass (code review) |
| AC-13 | Bridge tab shows online/offline, broker, build, queue | ✅ Pass |
| AC-14 | MQL Converter "Test in MT5" flow unchanged | ✅ Pass |

**Result: 14 Pass (all criteria met after fixes)**

### Bugs Found and Fixed (2026-05-20)

| # | Severity | Description | Status |
|---|----------|-------------|--------|
| BUG-1 | Medium | Trades table missing `close_time` column | ✅ Fixed |
| BUG-2 | Low | `Mt5ResultPanel` heading "Comparison: Python vs MT5" misleading in standalone mode | ✅ Fixed |
| BUG-3 | Low | `RunDetailDrawer.loadData()` did not check HTTP status before parsing response | ✅ Fixed |
| BUG-4 | Low | `StatusBadge` component duplicated in two files | ✅ Fixed |

**BUG-1 fix:** Added `close_time` column (labeled "Close") between "Open" and "Dir" in the trades table. Renamed the close_price column header from "Close" to "Exit" to avoid ambiguity. File: [run-detail-drawer.tsx](src/components/mt5/run-detail-drawer.tsx)

**BUG-2 fix:** `Mt5ResultPanel` now renders "MT5 Results" as heading when `pythonResult` is null (standalone mode), "Comparison: Python vs MT5" when both results exist. File: [mt5-result-panel.tsx](src/components/mql-converter/mt5-result-panel.tsx)

**BUG-3 fix:** `loadData()` now throws with a descriptive message when `runRes.ok` is false, caught by the existing `.catch()` handler that sets `fetchError`. Trades response silently falls back to `[]` on non-2xx. File: [run-detail-drawer.tsx](src/components/mt5/run-detail-drawer.tsx)

**BUG-4 fix:** Extracted shared `Mt5StatusBadge` component to [mt5-status-badge.tsx](src/components/mt5/mt5-status-badge.tsx). Both `tester-history-table.tsx` and `run-detail-drawer.tsx` now import from this single source.

---

### Security Audit

| Check | Result |
|-------|--------|
| All new API routes require authenticated session | ✅ Pass |
| Explicit ownership check in trades route (user_id comparison + RLS) | ✅ Pass |
| Run/Job IDs validated as UUID before DB queries | ✅ Pass |
| No secrets exposed in client code | ✅ Pass |
| Input validation with Zod on query params | ✅ Pass |
| Parameterized DB queries (Supabase) — no SQL injection | ✅ Pass |
| Unauthenticated request to trades API returns 401 | ✅ Pass (code review) |
| Cross-user trades request returns 403 | ✅ Pass (code review) |

### Test Suite

- **Unit tests:** 59 passed (4 new for `mt5-format.ts` formatters)
- **E2E tests:** 22 new PROJ-41 tests written in `tests/PROJ-41-mt5-hub.spec.ts` (skipped without credentials — same pattern as existing test files)
- **Pre-existing E2E failures:** 24 Mobile Safari failures in PROJ-33/37/40 are pre-existing (not regressions from this feature)
- **Production build:** ✅ Clean

### Production-Ready Decision

**READY** — All 4 bugs fixed. Build clean, 59 unit tests pass. No Critical or High bugs remaining.

## Deployment

**Deployed:** 2026-05-20
**Commit:** e0875b7
**Branch:** main → Vercel auto-deploy

---

## UI Iteration — 2026-05-21

User feedback after using the deployed page:

1. **Bridge tab too narrow.** The `Mt5BridgeStatusCard` was wrapped in `max-w-xl` (~576 px), making the card feel cramped on normal monitors. Fix: removed the width cap so the card fills the available column. The card's own padding and grid keep it readable on ultra-wide screens. File: `src/app/(dashboard)/mt5/page.tsx`.

2. **History drill-down too narrow / text too small.** Clicking a completed run opened a right-side `Sheet` drawer capped at `sm:max-w-2xl` (~672 px) with `text-xs` cells. Replaced the drawer with an **inline detail view** that mirrors the PROJ-9 backtest history pattern: it replaces the table in place, uses the full page width (starting at the sidebar), and shows a "Back to history" button. Trade table fonts bumped from `text-xs` to `text-sm`, parameter table rows from `text-xs` to `text-sm`, and metric cards split into a 3-column responsive grid on `lg+`. Files: `src/components/mt5/run-detail-view.tsx` (renamed from `run-detail-drawer.tsx`), `src/components/mt5/tester-history-table.tsx`.

The `Sheet` shadcn dependency for this feature is no longer used — kept installed because other features rely on it.
**Route:** `/mt5` (new top-level page)
