# PROJ-37: MT5 Bridge Worker — Strategy Tester Run

## Status: Planned
**Created:** 2026-04-28
**Last Updated:** 2026-04-30

## Dependencies
- Requires: PROJ-8 (Authentication) — admin-only access via Supabase Auth
- Requires: PROJ-22 (MQL Converter) — UI entry point for "Test in MT5"
- Requires: PROJ-32 (MQL Converter Editable Parameters) — current parameters are passed to MT5
- Requires: PROJ-34 (MT5 Broker Data Import) — MT5 Mode Toggle as the Settings anchor, pattern reused for the Settings section
- Affects: PROJ-19 (Strategy Optimizer) — followed up by PROJ-38 (MT5 Genetic Optimizer)

## Overview

Traders can run a MQL4/MQL5 Expert Advisor directly inside the MT5 Strategy Tester programmatically, without opening MT5 manually. The application triggers an external **Windows Bridge Worker** with an installed MT5 terminal. The worker starts the Strategy Tester via INI configuration, parses the resulting XML report, and returns it to the main application.

A new **"Test in MT5"** button is added to the **MQL Converter**. After clicking it, the Strategy Tester runs on the worker, the result is persisted to Supabase, and is shown **side-by-side** next to the existing Python backtest result — making it visible whether our Python engine and MT5 produce identical results for the same strategy.

This phase only establishes the run foundation. Optimization (Genetic + Cloud Network), live data sync, and EA auto-deploy follow as separate features (PROJ-38, PROJ-39, PROJ-40).

**Out of Scope (for PROJ-37):**
- Genetic Optimizer / MQL5 Cloud Network → PROJ-38
- MT5 live tick sync → PROJ-39
- EA deploy into the MT5 `Experts` folder → PROJ-40
- AI strategy generation → later phase

---

## User Stories

- As a trader, I want to click a "Test in MT5" button in the MQL Converter to run the current strategy with the current parameters directly inside the MT5 Strategy Tester, without opening MT5 manually.
- As a trader, I want to see the MT5 result **next to** the Python backtest result (Total Profit, Sharpe, Drawdown, Trades) after a run, so that I can spot discrepancies between our engine and MT5.
- As a trader, I want to see a progress indicator while a MT5 run is in progress (status: pending → running → done), so that I know the system is working.
- As a trader, I want to see the Bridge Worker status on the Settings page (online/offline, terminal login, last connection), so that I can diagnose problems quickly.
- As a trader, I want the "Test in MT5" button to be automatically disabled when the Bridge Worker is offline, so that I do not click into the void.
- As a trader, I want multiple runs to be serialized in a FIFO queue (the MT5 Tester is a single-instance process) and to see my position in the queue.
- As a trader, I want to see the history of all MT5 Tester runs after completion (analogous to the Backtest History from PROJ-9), so that I can compare iterations.
- As a trader, I want the Bridge Worker host to **not require 24/7 uptime** — when the Windows PC is shut down at night and started again the next morning, the worker comes back automatically (Windows Service auto-start), the MT5 terminal stays logged in, and queued jobs that were submitted while the host was offline resume from the database.
- As a trader, I want runs that were *in-flight* during a host shutdown to be cleanly marked `failed` (not stuck in `running` forever) so that I can spot and re-trigger them without sifting through stale UI state.
- As a trader, I want to receive a Telegram notification when a long-running optimization finishes, so that I do not have to babysit the UI for hours.

---

## Acceptance Criteria

### Bridge Worker (separate repo `mt5-bridge`)

- [ ] FastAPI service runs on a Windows host with an installed MT5 Terminal (build 5833 or higher), Startrader broker configured
- [ ] `POST /mt5/tester/run` accepts a JSON payload: `expert_path`, `symbol`, `timeframe`, `from_date`, `to_date`, `parameters` (dict), `model` (default: `EveryTickRealistic` = "Every tick based on real ticks")
- [ ] Worker dynamically generates a `tester.ini` file with all parameters and starts `terminal64.exe /portable /config:tester.ini`
- [ ] Worker polls the MT5 tester output directory (`MQL5/Tester/Reports/`) for the XML result
- [ ] XML result is parsed: Total Net Profit, Sharpe Ratio, Profit Factor, Max Drawdown (% + abs.), Total Trades, Won/Lost Trades, Average Trade, trade list with Open/Close, Profit, Comment
- [ ] `GET /mt5/health` responds with: `{ status: "online", terminal_logged_in: true, broker: "Startrader", build: 5833, queue_length: 0, current_run: null }`
- [ ] `POST /mt5/tester/run` is protected by the shared-secret header `X-Bridge-Token`; an invalid token returns 401
- [ ] Token comes from environment variable `BRIDGE_TOKEN`, identical on the worker and the main backend
- [ ] FIFO queue serializes incoming runs: parallel requests are queued; `GET /mt5/tester/status/{job_id}` shows the position
- [ ] Worker logs to stdout (for local debugging) and optionally to a file

#### Reboot Resilience (Windows Host May Power Off)

The Bridge Worker is expected to run on a non-24/7 Windows host. The following criteria ensure the system tolerates planned shutdowns and unexpected power loss without manual recovery work.

- [ ] Worker is installed as a **Windows Service** (via `nssm` or `pywin32`'s `pywintypes` service wrapper), set to **start automatically on boot** without requiring an interactive user login. README documents the install command.
- [ ] Recommended BIOS/Power setting documented in the README: **"Restore on AC Power Loss"** so the host comes back online after a power outage; **"Wake-on-LAN"** as an optional convenience for remote start.
- [ ] On worker start: detect any in-progress run (no XML report, no live `terminal64.exe` PID matching the recorded job) → mark them as orphaned and notify the main backend via a `POST /mt5/orphan-cleanup` callback (or a startup-time API call) so the database can transition them to `failed`.
- [ ] **MT5 Tester cache is preserved** across worker restarts: the cleanup job (daily) **never** touches `MQL5/Tester/cache/`. README explicitly calls this out — re-running an identical optimisation re-uses cached passes via MT5's native mechanism, dramatically reducing wall-clock cost.
- [ ] Symbol/broker login state is persisted in the MT5 terminal profile (default behaviour); the README documents that the user must enable "Save account information" the first time the terminal is launched.
- [ ] `GET /mt5/health` includes a `last_started_at` ISO timestamp (worker-process start time) so the main backend can detect worker restarts and trigger orphan cleanup proactively.

### Python Main Backend (Railway)

- [ ] New file `python/services/mt5_bridge.py`: HTTP client with retries (3×) and timeout (default 60s for health, 1h for run)
- [ ] New endpoint `POST /mt5/tester/run` in `python/main.py`: validates the auth user, generates a `job_id`, persists a `mt5_tester_runs` row with status `pending`, sends the run to the bridge, returns the `job_id`
- [ ] New endpoint `GET /mt5/tester/status/{job_id}`: polls the bridge status, updates Supabase, returns the current status and result (when finished)
- [ ] New endpoint `GET /mt5/health`: proxies the health check to the Bridge Worker, cached for 10s to avoid constant pinging
- [ ] Bridge URL and token come from environment variables (`MT5_BRIDGE_URL`, `MT5_BRIDGE_TOKEN`)
- [ ] On bridge timeout/offline: the endpoint returns a structured error and the run is marked `failed` in the DB with a reason

#### Stale-Run Cleanup + Notifications

- [ ] Background task on the Python backend (e.g. APScheduler, every 5 min): scans `mt5_tester_runs` for rows where `status IN ('running','queued')` AND `started_at < now() - INTERVAL '4 hours'` → transitions them to `failed` with `error_message: "Stale run cleared by automatic cleanup (host likely went offline)"`.
- [ ] On bridge reconnect (detected via the `last_started_at` field in `/mt5/health` increasing): the backend immediately runs the same cleanup pass, scoped to runs the bridge has no record of.
- [ ] **Telegram notification on completion / failure** (configurable per user, default off): when a run ends (status becomes `done` / `failed` / `cancelled`), send a Telegram message to the user's configured chat.
  - Setup: user-supplied bot token + chat ID, stored in `user_settings`.
  - Payload: run name, symbol, timeframe, status, key metrics (Profit, Sharpe, Trades), link to the result page.
  - Notification is **opt-in per-run-type**: trade runs default off (too chatty), optimisation runs default on (long-running so user wants to know).
- [ ] Notification settings live in `/settings` under a new "Notifications" section: Telegram on/off + bot token + chat ID + "Send test notification" button.

### Data Model (Supabase)

- [ ] Migration `supabase/migrations/2026XXXX_mt5_tester_runs.sql` creates these tables:
  - `mt5_tester_runs`: `id` (uuid), `user_id`, `mql_conversion_id` (FK, nullable), `expert_name`, `symbol`, `timeframe`, `from_date`, `to_date`, `parameters` (jsonb), `model`, `status` (`pending`|`queued`|`running`|`done`|`failed`|`cancelled`), `error_message` (nullable), `started_at`, `finished_at`, `last_status_at` (auto-updated via trigger; used by the stale-run cleanup task)
  - `mt5_tester_metrics`: `run_id` (FK), `total_net_profit`, `sharpe_ratio`, `profit_factor`, `max_drawdown_abs`, `max_drawdown_pct`, `total_trades`, `won_trades`, `lost_trades`, `average_trade`, `raw_xml` (text, for debug)
  - Optional: `mt5_tester_trades`: `run_id` (FK), `open_time`, `close_time`, `direction`, `volume`, `open_price`, `close_price`, `profit`, `comment`
  - `user_settings`: `user_id` (PK, FK auth.users), `telegram_enabled` (bool, default false), `telegram_bot_token` (text, nullable, encrypted at rest), `telegram_chat_id` (text, nullable), `notify_on_single_run` (bool, default false), `notify_on_optimisation` (bool, default true), `notify_on_walk_forward` (bool, default true), `last_notification_attempt_at`, `last_notification_error` (nullable text)
- [ ] RLS policies on all four tables analogous to `optimization_runs` (a user only sees their own rows)
- [ ] Index on `mt5_tester_runs (user_id, started_at DESC)` for the history query
- [ ] Index on `mt5_tester_runs (status, last_status_at)` for the stale-run cleanup task (5-min scan)

### Frontend: MQL Converter Integration

- [ ] New button **"Test in MT5"** in the MQL Converter next to the existing "Run Backtest" button
- [ ] Button is disabled with tooltip "MT5 Bridge Worker is offline — check Settings" when the health check fails
- [ ] On click: loading state, toast "MT5 run started", the job ID is held in the UI
- [ ] Polling pattern same as PROJ-19 Optimizer (2s polling on `/api/mt5/tester/status/{job_id}`)
- [ ] UI status text: "Queued (position 2)" → "Running for 0:12" → "Completed"
- [ ] After completion: result panel **side-by-side** with the Python backtest result, same metric columns (Profit, Sharpe, Drawdown, Trades)
- [ ] Discrepancy hint: when Python profit and MT5 profit differ by > 5%, show a small warning icon with tooltip "Discrepancy Python vs. MT5: X%"

### Frontend: Settings — MT5 Bridge Status

- [ ] New section on `/settings`: **"MT5 Bridge"**
- [ ] Status card shows: online/offline (red/green icon), terminal login status, broker name, MT5 build, queue length, last successful health check
- [ ] Labels (English): "Status", "Terminal Login", "Broker", "MT5 Build", "Queue Length", "Last Health Check"
- [ ] When offline: hint text "Bridge Worker not reachable. Make sure the worker is running and the MT5 terminal is logged in."
- [ ] Configuration display: bridge URL (read-only, from env)
- [ ] **Test button "Test Connection"**: triggers a direct health check, shows the result as a toast ("Connection successful" / "Connection failed: {reason}")

### Frontend: Settings — Notifications

- [ ] New section on `/settings` directly under "MT5 Bridge": **"Notifications"**.
- [ ] Sub-section "Telegram": toggle (default off) + bot token (password input) + chat ID + "Send test message" button. Helper link "How to set up a Telegram bot" pointing to a one-paragraph doc.
- [ ] Sub-section "When to notify": three checkboxes — "Single MT5 Tester run finishes", "Optimisation run finishes", "Walk-Forward batch finishes" (defaults: only optimisation = on).
- [ ] All settings persisted to a `user_settings` row in Supabase (one row per user, RLS scoped to `user_id = auth.uid()`).

### Frontend: API Routes (Next.js)

- [ ] `src/app/api/mt5/tester/run/route.ts` — POST proxied to the Python backend
- [ ] `src/app/api/mt5/tester/status/[jobId]/route.ts` — GET proxied to the Python backend
- [ ] `src/app/api/mt5/health/route.ts` — GET proxied, cached 10s

### Test Coverage

- [ ] Bridge Worker has unit tests for INI file generation and the XML parser
- [ ] Python service has mock-based tests for the bridge client (retry, timeout, offline)
- [ ] End-to-end smoke test: start the bridge locally → trigger a run via the frontend → verify the result in Supabase

---

## Edge Cases

- **Bridge Worker offline / network timeout:** "Test in MT5" button disabled, Settings shows offline status. Health check polls every 30s in the background (frugal, not aggressive). Polling is paused when the tab is not in the foreground.
- **MT5 Terminal crashes during a run:** worker detects the missing `terminal64.exe` process ID, sets the run status to `failed` with `error_message: "Terminal crashed during run"`. The queue continues with the next job.
- **MQL5 code has a compile error:** MT5 writes no XML report. After a timeout the worker detects the missing report (default: 5 min for compile + 1h for run, separate timeouts), parses `MQL5/Logs/` instead, and returns the compile-error lines in `error_message`.
- **Symbol not available on the broker (e.g. EA requests `EURUSD`, Startrader has `EURUSD.r`):** worker checks symbol existence before run start via the `MetaTrader5` module, returns 400 with `error_message: "Symbol 'EURUSD' not found on broker. Available similar: EURUSD.r, EURUSD.m"`.
- **Date range outside available tick data:** worker checks via `mt5.copy_rates_range()` whether data exists. On a gap: 400 with `error_message: "No tick data for [Symbol] between [from] and [to]. Available range: [actual_from] – [actual_to]"`.
- **Tester returns 0 trades:** run is marked `done`, but the UI shows the hint "Strategy generated no trades — check parameters and date range".
- **Worker disk full (XML reports stack up):** worker rotates old reports via a cleanup job (daily, anything older than 7 days is deleted).
- **Very long run (e.g. 5 years M1, real ticks):** frontend polling continues, no UI timeout. Worker run timeout is configurable (default 1h, max 4h).
- **Two users trigger simultaneously (FIFO queue):** the second request gets status `queued` and a position. The first runs through, the second starts automatically. The UI shows the position.
- **Bridge token mismatch (e.g. after rotation):** bridge responds 401, the main backend translates this into a clear error "Bridge authentication failed — check BRIDGE_TOKEN env on both sides".
- **MT5 update breaks INI syntax:** smoke test in CI/manual after each MT5 update. The worker has a fallback mode with a minimal INI for diagnostics.
- **Run result lost (worker restarted during run):** the run remains in the DB as `running`. Stale detection in the frontend polling: after 4h without an update → automatically mark as `failed`.
- **Host shut down overnight (planned):** queued jobs in Supabase remain `pending` (not lost — DB is the source of truth, not the bridge's in-memory queue). On boot, the worker pulls outstanding `pending` jobs from the backend via `GET /mt5/tester/pending-jobs` and seeds its in-memory FIFO. In-flight runs from before shutdown are detected by the orphan-cleanup pass and marked `failed`.
- **Host hard power loss (UPS not in place):** identical to planned shutdown — Supabase still has the job records, the orphan-cleanup pass on next boot transitions them. No data loss as long as the run had been submitted to the backend (the brief window between user click and DB persistence is negligible).
- **MT5 tester cache accidentally deleted by user / cleanup misconfiguration:** the next identical optimisation runs slower (recomputes from scratch) but produces the same result. Worker logs a warning if the cache directory is missing on startup so the user notices.
- **Notifications fail (user's Telegram bot token revoked or chat blocked):** the run status update is **not** blocked — notifications run in a background task. Failures are logged and surfaced as a small badge in `/settings` ("Last notification attempt failed: invalid Telegram token") so the user knows to re-configure.
- **User receives spam from a runaway optimisation that fails 50× in a row:** notifications are **rate-limited** at 10 per user per hour. Above that, a single aggregated message replaces individual ones ("12 runs failed in the last hour — open Settings → MT5 Bridge for diagnostics").

---

## Technical Requirements

- **Worker performance:** a 1-year M1 run with "Every tick based on real ticks" should complete in < 30 min on standard hardware (4 vCPU, 8 GB RAM)
- **Latency:** health check < 200ms, run submit < 500ms (excluding tester runtime)
- **Security:** the Bridge Worker is only reachable by the main backend (firewall rule or Tailscale/Cloudflare Tunnel), shared secret in env, never exposed in the frontend
- **Availability (Phase 1):** the worker runs on a local Windows PC, availability is best-effort. The host is **not required to run 24/7** — the system tolerates planned shutdowns and unexpected power loss without manual recovery (see Reboot Resilience criteria). Phase 2 migrates to a Hetzner Windows VPS (separate feature) for users who need higher availability.
- **Tester default:** "Every tick based on real ticks" (real-tick mode). Override via UI is not part of PROJ-37
- **MT5 build compatibility:** build 5833 (Startrader); current INI syntax is documented in `mt5-bridge/README.md`
- **Data residency:** run results in Supabase EU-West (consistent with the existing setup)
- **MT5 cache directory:** `MQL5/Tester/cache/` is the ground truth for incremental re-runs and **must not be cleaned** by the daily cleanup job. Only `MQL5/Tester/Reports/*.xml` files older than 7 days are deleted.
- **Windows Service config:** documented as a one-time install command in `mt5-bridge/README.md` (e.g. `nssm install MT5Bridge "C:\Python312\python.exe" "C:\mt5-bridge\main.py"` + `nssm set MT5Bridge AppDirectory "C:\mt5-bridge"` + `nssm set MT5Bridge Start SERVICE_AUTO_START`).
- **Notification cost:** Telegram is free for any volume. The 10/hour rate limit caps the worst-case runaway-failure scenario.

---

## Out of Scope (Follow-Up Features)

- **PROJ-38 (planned):** MT5 Genetic Optimizer + MQL5 Cloud Network — its own optimizer tab analogous to PROJ-19, uses the same bridge
- **PROJ-39 (planned):** live data sync (`POST /mt5/data/sync`)
- **PROJ-40 (planned):** EA auto-deploy (`POST /mt5/ea/deploy`)
- **High-availability (24/7) bridge:** out of scope for Phase 1. The reboot-resilience criteria above ensure the system is **tolerant** of host downtime, not that the host is always up. A future Hetzner Windows VPS migration covers that.
- **Email notifications:** intentionally omitted. Telegram is sufficient for a single-admin context — instant delivery, free, no spam folders.
- **Push notifications to a mobile app:** intentionally omitted.
- **Bridge multi-tenancy** (one bridge serving multiple users with separate MT5 logins): out of scope. PROJ-37 assumes one bridge = one MT5 account.
- **Later phase:** AI strategy discovery (Claude API generates MQL5 code from a description)
- **Optional / later:** Claude Code MCP server for direct CLI triggering of the bridge

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)

### System Overview

4-tier architecture. The Bridge Worker is the only component that can touch the MT5 Terminal — it runs on the same Windows machine. The rest of the stack never talks to MT5 directly.

```
Browser (Vercel)
  ↓ HTTPS
Next.js API Routes
  ↓ HTTPS
Python Backend (Railway)
  ↓ HTTPS + shared secret token (X-Bridge-Token)
Bridge Worker (Windows PC — new repo: mt5-bridge)
  ↓ local process spawn
MT5 Terminal (terminal64.exe)
```

---

### Component Structure

**A) Bridge Worker (new repo: `mt5-bridge`)**

```
mt5-bridge/
+-- FastAPI Service
|   +-- POST /mt5/tester/run              (trigger a tester run)
|   +-- GET  /mt5/tester/status/{job_id}  (check run status + queue position)
|   +-- GET  /mt5/health                  (worker status, terminal login, queue depth)
|
+-- FIFO Run Queue
|   +-- Serializes jobs (single MT5 instance runs one test at a time)
|   +-- Reports queue position back to callers
|
+-- INI File Generator
|   +-- Builds tester.ini from run parameters (symbol, timeframe, dates, EA path, params dict)
|
+-- MT5 Process Launcher
|   +-- Starts terminal64.exe /portable /config:tester.ini
|   +-- Watches for XML report in MQL5/Tester/Reports/
|   +-- Detects terminal crashes via process ID monitoring
|
+-- XML Report Parser
|   +-- Extracts: Total Net Profit, Sharpe, Drawdown, Trades, Won/Lost
|   +-- Optional: full trade list
|   +-- Falls back to MQL5/Logs/ on compile error
|
+-- Cleanup Job (daily)
|   +-- Deletes MQL5/Tester/Reports/*.xml older than 7 days
|   +-- Never touches MQL5/Tester/cache/ (preserved for incremental re-runs)
|
+-- Boot Hooks (run on worker startup)
    +-- POST /mt5/orphan-cleanup → backend marks any 'running' jobs from before the restart as failed
    +-- GET /mt5/tester/pending-jobs → seed in-memory FIFO from DB-side queued rows
```

**B) New Python Backend Modules (Railway)**

```
python/
+-- services/mt5_bridge.py  (new)
|   +-- HTTP client for all Bridge Worker calls
|   +-- 3× retry, configurable timeouts (60s health / 1h run)
|   +-- Translates 401 → clear "Bridge token mismatch" error
|
+-- services/notifications.py  (new)
|   +-- send_telegram(user_id, message)
|   +-- 10/hour/user rate limiter
|   +-- Aggregation logic for excess: digest message instead of dropped notifications
|
+-- jobs/stale_run_cleanup.py  (new)
|   +-- APScheduler: every 5 minutes
|   +-- Marks runs as failed when status='running' AND last_status_at < now()-4h
|   +-- Triggers notifications for cleared runs (so the user knows)
|
+-- main.py additions
    +-- POST /mt5/tester/run              → validate auth, create DB row, call bridge
    +-- GET  /mt5/tester/status/{job_id}  → poll bridge + update Supabase
    +-- GET  /mt5/health                  → proxy health check, cached 10s
    +-- GET  /mt5/tester/pending-jobs     → bridge calls this on startup to seed its FIFO from DB
    +-- POST /mt5/orphan-cleanup          → bridge calls this on startup to flag in-flight jobs that didn't survive a reboot
```

**C) New Next.js API Routes (Vercel)**

```
src/app/api/mt5/
+-- tester/run/route.ts                (POST — proxied to Python backend)
+-- tester/status/[jobId]/route.ts     (GET — used for 2s polling)
+-- health/route.ts                    (GET — cached 10s)
```

Pattern reused from `src/app/api/optimizer/run/route.ts` and `src/app/api/optimizer/status/[jobId]/route.ts`.

**D) Frontend UI**

```
MQL Converter Page
+-- Action Bar
|   +-- "Run Backtest" (existing)
|   +-- "Test in MT5" button (new)
|       +-- Disabled + tooltip when Bridge offline
|       +-- Status text: "Queued (pos 2)" → "Running 0:12" → "Completed"
|
+-- Results Area (extended)
    +-- Python Backtest Result panel (existing)
    +-- MT5 Tester Result panel (new, side-by-side)
        +-- Columns: Profit, Sharpe, Drawdown, Trades
        +-- Discrepancy warning icon when Python vs MT5 profit differs > 5%

Settings Page — new section "MT5 Bridge"
+-- Status card: online/offline indicator (green/red)
+-- Terminal login, Broker, MT5 Build, Queue Length, Last Health Check
+-- Offline hint text
+-- "Test Connection" button → toast with result
+-- Bridge URL display (read-only, from env)
```

---

### Data Model

**`mt5_tester_runs`** — one row per triggered run
- id, user_id, mql_conversion_id (FK nullable), expert_name, symbol, timeframe, from_date, to_date
- parameters (JSONB), model, status (`pending`|`queued`|`running`|`done`|`failed`)
- error_message, started_at, finished_at

**`mt5_tester_metrics`** — performance summary (1:1 with a run)
- run_id (FK), total_net_profit, sharpe_ratio, profit_factor
- max_drawdown_abs, max_drawdown_pct, total_trades, won_trades, lost_trades, average_trade
- raw_xml (for debugging)

**`mt5_tester_trades`** — optional trade list
- run_id (FK), open_time, close_time, direction, volume, open_price, close_price, profit, comment

RLS policies on all three tables mirror `optimization_runs` — users see only their own rows.

---

### Key Technical Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Bridge isolation | Separate `mt5-bridge` repo (FastAPI) | MT5 is Windows-only; fully isolated from Railway backend |
| Bridge security | Shared secret header `X-Bridge-Token` | Simple, battle-tested for internal service-to-service auth |
| Network access | Cloudflare Tunnel or firewall rule | Avoids port-forwarding; Railway backend reaches the Windows machine |
| Polling | 2s frontend polling (mirrors PROJ-19 Optimizer) | Consistent UX; no WebSocket complexity for a single-user tool |
| Queue | FIFO in-memory on Bridge Worker | MT5 Tester is single-instance; prevents race conditions |
| Stale run detection | Frontend auto-marks `running` jobs as `failed` after 4h | Handles worker restarts mid-run |
| Background health poll | Every 30s, paused when tab is hidden | Keeps button state accurate without hammering the bridge |
| Bridge auto-start | Windows Service via `nssm` | No interactive login needed — host can reboot unattended |
| Queue source of truth | Supabase (DB) — bridge in-memory FIFO is a cache | Survives host shutdowns; queued jobs replay on bridge boot |
| MT5 cache preservation | Cleanup never touches `MQL5/Tester/cache/` | Identical re-runs reuse pass results — ~10× speed-up on iterative optimisation |
| Backend stale-run sweeper | APScheduler 5-min cron in Railway | Single source of truth for orphaned jobs; bridge can't always self-report (e.g. hard power loss) |
| Notification transport | Telegram Bot API only | Free, near-instant delivery, no spam-folder issues; sufficient for a single-admin context |
| Notification rate limit | 10/hour/user, then aggregated digest | Prevents runaway-failure spam |

---

### Dependencies

- **Bridge Worker (new repo):** `fastapi`, `uvicorn`, `MetaTrader5` (Windows Python package), `lxml`, `nssm` (or `pywin32`) for the Windows Service install
- **Python backend:** `httpx` (already available on Railway, also used for Telegram Bot API calls), `apscheduler` (new, for the 5-min stale-run sweeper)
- **Frontend:** no new npm packages — reuses existing shadcn/ui components and Optimizer polling pattern

## QA Test Results
_To be added by /qa_

## Deployment
_To be added by /deploy_
