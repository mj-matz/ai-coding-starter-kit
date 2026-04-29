# PROJ-38: MT5 Genetic Optimizer + MQL5 Cloud Network

## Status: Planned
**Created:** 2026-04-28
**Last Updated:** 2026-04-30

## Dependencies
- Requires: PROJ-37 (MT5 Bridge Worker — Strategy Tester Run) — the bridge must be deployed and stable
- Requires: PROJ-32 (MQL Converter — Editable Parameters) — saved conversions are used as a parameter source
- Requires: PROJ-8 (Authentication) — admin-only access
- Extends: PROJ-19 (Strategy Optimizer) — adds a new tab to the existing /optimizer

## Overview

The existing **Python Grid Search Optimizer** (PROJ-19) is extended with a second tab **"MT5 Genetic Optimizer"**. Instead of our own grid search, this tab fully delegates the optimization to the MT5 Strategy Tester in **Genetic Algorithm mode** — the same engine that is used for live trading.

**Key difference from the Python Grid Search:**
- MT5 Genetic does *not* evaluate every parameter combination. It iteratively finds good combinations through an evolutionary algorithm. This makes it dramatically faster for large parameter spaces (> 10,000 combinations).
- Optional: **MQL5 Cloud Network** distributes the evaluation across thousands of MetaQuotes agents worldwide — a run that takes hours locally completes in minutes in the cloud.
- Tick-accurate realism: results come from the same engine as MT5 live trading (no discrepancy risk).

**Strategy source:** The user either picks a **saved MQL conversion** (from PROJ-32) or **uploads their own .mq5 file**. Input parameters are extracted automatically; the user assigns Min/Max/Step to each parameter.

**Out of Scope (for PROJ-38):**
- Live data sync → PROJ-39
- EA auto-deploy after optimization → PROJ-40
- AI strategy generation → later phase
- Hetzner VPS migration of the Bridge Worker → infrastructure task, not a separate feature

---

## User Stories

- As a trader, I want to pick a saved MQL conversion or upload my own .mq5 file in the "MT5 Genetic Optimizer" tab so that the detected input parameters are auto-populated as optimization ranges.
- As a trader, I want to set Min, Max, and Step per parameter so that MT5 samples the parameter space correctly.
- As a trader, I want to pick the optimization target (e.g. Balance, Profit Factor, Sharpe Ratio) so that the Genetic Algorithm optimizes in the right direction.
- As a trader, I want to enable **MQL5 Cloud Network** via a toggle to distribute large parameter-space optimizations across MT5 agents and save hours.
- As a trader, I want to see the progress of the running optimization (passes completed, top candidates so far) so that I can estimate how long it will take.
- As a trader, I want a sortable result table with the best parameter combinations after completion so that I can pick the optimal configuration.
- As a trader, I want to verify a result with one click "Test in MT5" (single run via PROJ-37) before adopting the parameters.
- As a trader, I want the MT5 optimization history (all my previous MT5 optimizer runs) in the same tab, separated from the Python Grid Search history.
- As a trader, I want to cancel a running optimization so that I do not have to wait if the configuration is wrong.
- As a trader new to systematic optimization, I want a Claude-powered **AI Parameter Advisor** to suggest sensible Min/Max/Step ranges for each detected input plus *additional angles I might overlook* (time filters, spread filter, news-avoidance, cool-down logic, equity-pause), so that I do not curve-fit on the standard SL/TP only and accidentally produce a fragile strategy.
- As a trader, I want the optimization-target dropdown to include **composite metrics** (e.g. Profit Factor × Recovery Factor / sqrt(Max DD %)) so that I do not maximize Net Profit at the cost of catastrophic drawdowns.
- As a trader, I want a one-click **"Walk-Forward Check"** that re-runs the top-N candidates on a held-out time slice and flags overfit parameter sets, so that I only adopt parameters that generalize beyond the optimization window.

---

## Acceptance Criteria

### UI: New Tab in /optimizer

- [ ] `/optimizer` gets two tabs: **"Python Optimizer"** (existing, unchanged) and **"MT5 Genetic Optimizer"** (new)
- [ ] Tab change preserves the URL (`?tab=mt5` vs. no parameter) so deep links work
- [ ] The MT5 tab shows the bridge offline banner (analogous to PROJ-37 bridge status) when the worker is unreachable — form and start button disabled
- [ ] Overall layout in the MT5 tab: configuration panel (top/left) + results/progress (bottom/right), responsive analogous to the Python tab

### Strategy Source & Parameter Extraction

- [ ] **Option A — Saved MQL conversion:** dropdown lists all of the user's saved MQL conversions (source: `mql_conversions` table). On selection the `parameters` entries (from PROJ-32) are auto-populated into the parameter range form: name (read-only), default value as the suggested starting value, Min/Max/Step left blank for the user.
- [ ] **Option B — Upload .mq5 file:** file picker for `.mq5` files (max 1 MB). After upload the `input` declarations are extracted via regex (same logic as the PROJ-32 parser, client-side or via API route). Detected parameters are populated into the form analogous to Option A.
- [ ] Both sources are offered side by side (radio: **"From Conversion"** / **"Upload File"**), the user can switch between them
- [ ] Parameter range form shows: parameter name, type (int/float/bool), default, Min, Max, Step. Bool parameters have Min=0, Max=1, Step=1 (fixed, not editable).
- [ ] Combination counter shows the **estimated** combinations with the hint text "Genetic only evaluates a fraction of these"
- [ ] Validation: Min < Max, Step > 0, Step ≤ (Max−Min). On error: inline validation messages ("Min must be less than Max", "Step must be positive", "Step too large for range")

### AI Parameter Advisor (Claude-powered)

The Advisor is a separate, optional pre-step before the user assigns Min/Max/Step manually. It addresses two failure modes seen in beginner optimization runs: (a) defining ranges that are too narrow / too wide / too coarse, and (b) optimizing only the obvious SL/TP/CRV angles while ignoring filter dimensions that have a much larger Sharpe-impact (time filters, spread, news-avoidance, cool-down).

- [ ] After parameter extraction (Option A or B), an **"Analyze with AI"** button appears next to the parameter range form (icon: sparkles, label "Analyze with AI").
- [ ] On click: sends the MQL source + extracted parameter list + symbol + timeframe to a new endpoint `POST /api/mt5/optimizer/advisor`. Backend calls the Claude API (`claude-sonnet-4-6`, max-tokens 2k) with a curated system prompt that frames Claude as "a long-experienced systematic trader and MT5 EA expert".
- [ ] Claude returns a JSON response with two arrays:
  - `param_ranges`: per detected parameter `{ name, suggested_min, suggested_max, suggested_step, rationale }` — `rationale` is one short sentence explaining the reasoning ("InpTrailStartR: 0.3–2.0 in 0.1 steps; current 1.0 is the engine default but 0.5–0.8 typically dominates on range-breakout strategies").
  - `additional_angles`: parameters the EA does *not* expose but that an experienced trader would add. Each entry: `{ topic, why_it_matters, how_to_add }`. Standard topics Claude is prompted to look for:
    - **Time filters** — place hour/minute (current: 00:01), time exit / session-end close, day-of-week toggles
    - **Spread filter** — `InpMaxSpreadPoints` sweet spot 1.5–2× broker average; too tight misses fills, too wide eats slippage
    - **Entry buffer** — `InpEntryBufferPips` 5–15 pips reduces false breakouts, especially on XAUUSD and indices
    - **News-avoidance window** — skip 30 min before/after high-impact events (NFP, CPI, FOMC); usually loses 5–10 % trades and gains 20–40 % Sharpe
    - **Cool-down after losses** — skip the next signal after N consecutive SLs; protects against choppy regimes
    - **Trail-start R-multiple** — wider exploration than the default (range 0.3–2.0 instead of fixed 1.0)
    - **Multi-step partial close** — replace single 40 % @ 1R with 30 % @ 0.7R + 30 % @ 2R + runner
    - **ATR-adaptive SL/TP** — fixed-pip SL is naive on volatile instruments; ATR-multiplier adapts to regime
    - **Equity-pause** — block new trades when DD > X %, resume at recovery > Y %
    - **Risk-per-trade adaptivity** — reduce after consecutive losses, increase after consecutive wins
- [ ] On result: the suggested ranges populate the Min/Max/Step inputs (override-able by the user). Each row gets a small ⓘ icon → tooltip with `rationale`. A subtle visual marker ("AI Suggested") appears on rows whose values came from Claude.
- [ ] `additional_angles` are shown as a separate **"Suggested Additions"** panel below the parameter form — non-actionable in PROJ-38 (the EA does not yet expose those inputs). Each entry is rendered as a card: topic title, why-it-matters body, and a "How to add" code snippet showing the suggested MQL `input` declaration. Users copy the snippet, add it to the EA source, and re-convert.
- [ ] Each card has a "Dismiss" action that hides it from this run (per-user-per-conversion-id state, persisted in `localStorage`) so repeated analyses don't re-suggest the same angles the user already declined.
- [ ] Rate-limited: **5 advisor calls per user per hour** (analogous to `/api/mql-converter/convert`). Excess: 429 with `Retry-After`.
- [ ] Failure modes: (a) Claude returns invalid JSON → 502 with retry prompt in toast; (b) Anthropic 429 → 502 "AI service temporarily overloaded, please retry"; (c) MQL source > 50 k chars → reject upfront with 400.

### Optimization Configuration

- [ ] **Symbol + Timeframe + Date Range:** same inputs as the Python Optimizer and the existing backtest (Asset combobox + timeframe select + date range picker)
- [ ] **"Optimization Target" dropdown:** options
  - "Balance (maximize)"
  - "Profit Factor (maximize)"
  - "Sharpe Ratio (maximize)"
  - "Max Drawdown % (minimize)"
  - "Recovery Factor (maximize)"
  - **"Composite: PF × RF / √DD %" (maximize)** — penalises drawdown-heavy curves; recommended default for beginners
  - **"Composite: Sharpe × √Trades" (maximize)** — penalises curves with too few data points (statistically thin)
- [ ] Composite targets are computed **client-side as the sort key on the result table** — the MT5 Tester runs on its native target (Balance by default), and the composite is applied post-optimization so we don't depend on MT5 INI hacks.
- [ ] Each option has a tooltip explaining the trade-off: when to use it, what it penalises, what it rewards.
- [ ] **"MQL5 Cloud Network" toggle** (Switch): off by default. When on: info text "Uses MetaQuotes agents worldwide. Cost: ~0.05 USD per run." + link to MetaQuotes docs.
- [ ] **"Max Passes (optional)" number input:** default 10000. MT5 Genetic stops after this number of evaluations.

### Start, Progress & Cancel

- [ ] **Start button "Start MT5 Genetic Optimization":** sends the job to the bridge via `POST /mt5/tester/optimize`, receives `job_id`, switches to the progress view
- [ ] Progress display (2s polling, same mechanism as PROJ-19 and PROJ-37):
  - Progress bar: `completed_passes / max_passes`
  - Current best metrics (updated during the run)
  - Status text: "Pass 1,240 / 10,000 — best Sharpe: 1.42"
  - Estimated remaining time: label "ETA: 12 min" (when the Bridge Worker provides an estimate)
- [ ] **"Cancel" button** during the run: sends `POST /mt5/tester/optimize/cancel/{job_id}` to the bridge, the run is marked `cancelled`, results found so far are preserved and shown
- [ ] After cancel or completion: the result table appears

### Result Table

- [ ] Table shows the top-N parameter combinations (N = 50 default, configurable up to 200), sorted by the optimization-target metric descending
- [ ] Column headers (English): "Rank", all parameter names, "Balance", "Profit Factor", "Sharpe Ratio", "Max Drawdown %", "Trades", "Passed"
- [ ] **Hard constraint filter** (analogous to PROJ-35): client-side via the `isConstraintViolated()` utility. Violations are greyed out and tagged with badge "Constraint Violated".
- [ ] Columns sortable on click
- [ ] **"Test in MT5" button** per row: starts a PROJ-37 single run with this parameter combination, opens the result in the MQL Converter tab
- [ ] **"Apply Parameters" button** per row: opens a modal with header "Apply Parameters", shows the parameter set, confirms the takeover into the MQL Converter or as a new backtest preset
- [ ] **"Download CSV" button**: exports all visible result rows

### Walk-Forward Robustness Check

A common failure mode of any optimizer is *curve-fitting*: parameters that look great on the optimization window collapse out-of-sample. Walk-Forward explicitly tests this by re-running the top candidates on a held-out time slice that the Genetic never saw.

- [ ] After an optimization completes (status = `done`), a **"Walk-Forward Check"** button appears above the result table.
- [ ] On click: a modal asks the user to pick the split (default: 70 / 30, alternatives 60 / 40 and 50 / 50). Confirmation runs the top-N candidates (N = 10 default, max 25) on the held-out slice via PROJ-37 single runs, sequentially through the FIFO queue.
- [ ] Result columns added to the result table: **"OOS Sharpe"**, **"OOS DD %"**, **"OOS Trades"**, **"OOS PF"** (out-of-sample = held-out slice).
- [ ] Overfit flagging: a row is tagged **"Overfit Risk"** (orange badge) when **OOS Sharpe < 0.5 × IS Sharpe** OR **OOS DD % > 1.5 × IS DD %**. Tooltip explains the threshold.
- [ ] Walk-Forward is **opt-in and additive** — it does not auto-run because runtime grows by N × single-run cost (~5–60 min on top of the optimization).
- [ ] Progress indicator during Walk-Forward: "Walk-Forward 3/10 — current candidate Sharpe IS=1.42 / OOS=0.8".
- [ ] Cancellable mid-run; partial OOS results stay visible.
- [ ] DB persistence: walk-forward results extend `mt5_optimizer_results` with the OOS metric columns (nullable; populated only after a Walk-Forward run).

### History (MT5-Tab specific)

- [ ] Section with header "MT5 Optimization History" below the result table (or collapsible)
- [ ] Table columns (English): "Date", "Strategy/EA", "Symbol", "Timeframe", "Method", "Cloud Network", "Status" (done/cancelled/failed), "Best Sharpe", "Trades"
- [ ] Click on a run loads its result table (read-only, from Supabase)
- [ ] **Separated** from the Python Optimizer history in the "Python Optimizer" tab

### Bridge Worker — New Endpoint

- [ ] `POST /mt5/tester/optimize` on the Bridge Worker accepts: `expert_path`/`mq5_content`, `symbol`, `timeframe`, `from_date`, `to_date`, `parameter_ranges` (array of `{name, min, max, step}`), `optimization_target`, `max_passes`, `use_cloud_network`
- [ ] Worker generates `tester.ini` with optimization mode (`TestOptimization=1`, `TestOptimizationMode=0` = Genetic), cloud-network flag (`TestCloudOptimization=0/1`), all parameter ranges as `TestParam<name>=<min>;<max>;<step>`
- [ ] Worker starts `terminal64.exe /portable /config:tester.ini`, monitors progress via MT5 log polling
- [ ] Progress updates are exposed to the main backend via worker-side state polling: `GET /mt5/tester/optimize/status/{job_id}` → `{ completed_passes, max_passes, best_result }`
- [ ] On completion: the XML report with all evaluated combinations is parsed, the top-200 by optimization target are extracted, returned as JSON
- [ ] `POST /mt5/tester/optimize/cancel/{job_id}`: terminates the `terminal64.exe` process safely and returns the results found so far

### Python Backend — New Endpoints

- [ ] `POST /mt5/optimizer/run` in `python/main.py`: auth check, persists a `mt5_optimizer_runs` row, proxies to the bridge, returns `job_id`
- [ ] `GET /mt5/optimizer/status/{job_id}`: polls the bridge status, returns the current state
- [ ] `POST /mt5/optimizer/cancel/{job_id}`: proxies the cancel call to the bridge
- [ ] `GET /mt5/optimizer/runs`: lists the user's runs (paginated, `LIMIT 50`)
- [ ] `GET /mt5/optimizer/runs/{id}/results`: returns the top-N result rows from Supabase
- [ ] `POST /mt5/optimizer/advisor`: proxies to Claude API for the AI Parameter Advisor (see UI section). Validates auth, enforces 5-per-hour rate limit per user, sanitises the MQL source (strip null bytes, cap at 50 k chars), returns the structured `{param_ranges, additional_angles}` JSON. Errors map cleanly: 400 (input), 429 (rate limit), 502 (Anthropic upstream), 503 (no `ANTHROPIC_API_KEY`).
- [ ] `POST /mt5/optimizer/walk-forward`: takes a `run_id` + `top_n` + `split_ratio`, queues N single-runs through the bridge on the held-out slice, persists OOS metrics back to `mt5_optimizer_results`, returns a `walk_forward_id` for status polling.

### Data Model (Supabase)

- [ ] Migration `supabase/migrations/2026XXXX_mt5_optimizer.sql`:
  - `mt5_optimizer_runs`: `id`, `user_id`, `mql_conversion_id` (nullable FK), `ea_filename` (nullable), `symbol`, `timeframe`, `from_date`, `to_date`, `optimization_target`, `max_passes`, `use_cloud_network`, `status` (`pending`|`running`|`done`|`cancelled`|`failed`), `error_message`, `started_at`, `finished_at`, `completed_passes`, `total_combinations_estimated`
  - `mt5_optimizer_results`: `run_id` (FK), `rank`, `parameters` (jsonb), `balance`, `profit_factor`, `sharpe_ratio`, `max_drawdown_pct`, `total_trades`, `recovery_factor`, `oos_sharpe` (nullable), `oos_drawdown_pct` (nullable), `oos_trades` (nullable), `oos_profit_factor` (nullable), `walk_forward_run_id` (nullable, references a WF batch)
  - `mt5_walk_forward_runs`: `id`, `optimizer_run_id` (FK), `split_ratio` (e.g. 0.7), `top_n`, `status`, `started_at`, `finished_at` — one row per WF batch triggered against an optimizer run
- [ ] RLS: a user only sees their own runs/results
- [ ] Index on `mt5_optimizer_runs(user_id, started_at DESC)` and `mt5_optimizer_results(run_id, rank)`

### Frontend API Routes (Next.js)

- [ ] `src/app/api/mt5/optimizer/run/route.ts`
- [ ] `src/app/api/mt5/optimizer/status/[jobId]/route.ts`
- [ ] `src/app/api/mt5/optimizer/cancel/[jobId]/route.ts`
- [ ] `src/app/api/mt5/optimizer/runs/route.ts`
- [ ] `src/app/api/mt5/optimizer/runs/[id]/results/route.ts`
- [ ] `src/app/api/mt5/optimizer/advisor/route.ts` — POST proxied to Python backend; auth + rate-limit enforced server-side
- [ ] `src/app/api/mt5/optimizer/walk-forward/route.ts` — POST proxied; status polling reuses the standard `/mt5/optimizer/status/[jobId]` route with `walk_forward_id`

---

## Edge Cases

- **Bridge offline at start:** tab is disabled with a banner (analogous to PROJ-37). Start button disabled, no accidental click.
- **Cloud Network disabled on the MT5 account:** the worker detects the error in MT5 logs ("Cloud network authorization failed"), marks the run as `failed` with a specific message. The UI shows: "MQL5 Cloud Network not available on this account — enable it in MT5 under Tools → Options."
- **MT5 Terminal crashes during optimization:** analogous to PROJ-37 — the worker detects the missing process, returns the partial results found so far, run status `failed` with reason. Partial results are still persisted in Supabase.
- **Parameter range yields 0 valid combinations** (e.g. Min = Max = 10, Step = 1 → only one value): the worker immediately returns 400 with "No valid parameter combinations defined."
- **No trades in the best result:** the table shows the result, but with badge "0 trades — check parameter ranges".
- **Cloud Network run costs points, account has 0 points:** MT5 starts a local Genetic instead of cloud — the worker logs "Insufficient MQL5 Cloud points, fallback to local Genetic", the main backend records `use_cloud_network=false (fallback)` in the DB.
- **User cancels before any result is available:** the cancel returns an empty result list, the run is marked `cancelled`.
- **Very long cloud run (e.g. 6h):** frontend polling continues, no UI timeout. Worker timeout for optimization: 8h (configurable). After timeout: partial results returned.
- **Two running optimization runs** (FIFO queue from PROJ-37): the second run waits in the queue. The position is shown in the progress view: "Queued (position 1 of 1)".
- **Same expert + same ranges, second run:** no duplicate check — the trader is intentionally testing different periods or targets. New run ID, new history row.
- **CSV export with 200 results:** the export contains all 200 rows including parameter values, no truncation.
- **AI Advisor: Claude returns malformed JSON:** caught client-side, falls back to "AI service returned invalid response, please retry" toast — the parameter form remains editable manually so the user is never blocked.
- **AI Advisor: rate-limit reached (5/hour):** UI hides the "Analyze with AI" button and shows a small countdown ("Available again in 27 min") so the user understands without opening DevTools.
- **AI Advisor: Anthropic outage:** treated like any 502; the user is told to retry later and the `/optimizer` Genetic flow stays fully functional without the Advisor.
- **AI Advisor: misleading suggestions for an unfamiliar EA:** all suggested ranges are **editable** (Claude's output never auto-locks); the rationale tooltip is explicitly framed as "suggestion, not gospel". `additional_angles` are non-actionable in PROJ-38, so the user has no fast-path to applying questionable advice without going through a manual EA edit.
- **Walk-Forward on a too-short date range:** if the held-out slice contains < 10 trading days, the WF button is disabled with tooltip "Date range too short for a meaningful walk-forward split (minimum 30 days recommended)".
- **Walk-Forward: candidate produces 0 OOS trades:** row is flagged "No OOS Activity" rather than "Overfit Risk" — the threshold check requires `oos_trades > 0` to apply.
- **Walk-Forward bridge offline mid-batch:** partial OOS columns are persisted for the candidates that completed; remaining rows show "—". A "Resume Walk-Forward" button appears once the bridge is back online, picking up from the last unfinished candidate.

---

## Technical Requirements

- **Performance (Cloud Network on):** a run with 10,000 passes on 1 year of M1 data should complete in < 30 min (depends on cloud capacity)
- **Performance (local Genetic):** the same setup completes in < 2h on standard worker hardware (4 vCPU, 8 GB)
- **Concurrency:** the FIFO queue from PROJ-37 also applies to optimization runs — no parallel MT5 processes
- **Security:** MQL5 Cloud Network credentials live in the MT5 terminal (locally on the worker), never in the application. No API-key handling required.
- **Cost transparency:** MQL5 Cloud Network: ~0.05 USD per optimization run. Info text in the UI before start.
- **Reuse:** [combination-counter.tsx](src/components/optimizer/combination-counter.tsx), [parameter-range-form.tsx](src/components/optimizer/parameter-range-form.tsx), [hard-constraint-section.tsx](src/components/optimizer/hard-constraint-section.tsx), [metric-selector.tsx](src/components/optimizer/metric-selector.tsx), [progress-section.tsx](src/components/optimizer/progress-section.tsx), [results-table.tsx](src/components/optimizer/results-table.tsx) — reuse to the maximum extent
- **MT5 build compatibility:** INI syntax for optimization mode validated against Startrader build 5833
- **AI Advisor cost ceiling:** typical advisor call ≤ 2 k output tokens (Sonnet) ≈ $0.03 per call. With the 5/hour-per-user rate limit and a single-admin context, monthly cost stays well below $5. No streaming required — a single non-streaming completion is sufficient.
- **AI Advisor prompt versioning:** the system prompt is a constant in `src/app/api/mt5/optimizer/advisor/route.ts` (or its Python equivalent) with a leading version header (`# Advisor Prompt v1`). When the prompt is changed, the version is bumped — useful for telemetry / regression testing.
- **Walk-Forward runtime:** N candidates × single-run-cost. For N = 10 and a 1-year M1 EA: typically 30–90 min on real ticks. The UI shows an ETA and the user can cancel.

---

## Out of Scope (Follow-Up Features)

- **PROJ-40 (planned):** deploy the best optimization result as an EA directly into MT5 (`POST /mt5/ea/deploy`)
- **Brute Force mode:** intentionally omitted (too slow with real ticks for practical ranges)
- **Auto-edit MQL source from `additional_angles`:** the AI Advisor surfaces missing dimensions but does not modify the EA. A future feature could let users one-click apply suggested `input` declarations into the MQL source via Claude (essentially an extension of PROJ-22).
- **Multi-objective Pareto frontier:** composite targets in PROJ-38 are scalarised. True multi-objective optimisation (e.g. dominate Sharpe AND DD) is its own feature.
- **Parameter dependencies** (e.g. SL always < TP): no cross-constraint logic in PROJ-38

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)
_To be added by /architecture_

## QA Test Results
_To be added by /qa_

## Deployment
_To be added by /deploy_
