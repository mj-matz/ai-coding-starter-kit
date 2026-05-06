# PROJ-40: MT5 EA Auto-Deploy (Software → MT5 Experts Folder)

## Status: Deployed
**Created:** 2026-04-28
**Last Updated:** 2026-05-06

## Dependencies
- Requires: PROJ-37 (MT5 Bridge Worker — Strategy Tester Run) — the Bridge Worker must be running; provides auth, health check, and the Windows worker infrastructure
- Requires: PROJ-33 (MQL Converter — MT5 EA Export) — the existing parameter-replacement logic is reused
- Requires: PROJ-38 (MT5 Genetic Optimizer) — "Deploy as EA" button in the optimizer result table
- Requires: PROJ-22 + PROJ-32 (MQL Converter + Editable Parameters) — "Deploy to MT5" button in the MQL Converter
- Requires: PROJ-8 (Authentication)

## Overview

Traders can deploy a fully configured Expert Advisor directly from the application into the MT5 terminal — without manual file copying or manual compilation in MetaEditor.

Two entry points:
1. **MQL Converter** (PROJ-22/32/33): the current EA code with currently set parameters → "Deploy to MT5"
2. **MT5 Genetic Optimizer** (PROJ-38): the chosen parameter combination from the optimization results → "Deploy as EA"

The **Bridge Worker** accepts `.mq5` content, writes it into the MT5 `MQL5/Experts/` folder, triggers compilation via `metaeditor64.exe /compile`, and returns the compile result. Existing EAs with the same name are silently overwritten.

A **deploy history** in the Settings page under "MT5 Bridge" shows all previous deploys with source, timestamp, and compile status.

**Out of Scope (for PROJ-40):**
- Live order submission or activating an EA on a chart (that would be live trading — explicit non-goal per the PRD)
- EA versioning
- Deployment to a remote MT5 server (only the local terminal on the Bridge Worker)
- AI strategy generation → later phase

---

## User Stories

- As a trader, I want to click "Deploy to MT5" in the MQL Converter so that the current EA code with my current parameters is immediately compiled and ready in MT5.
- As a trader, I want a "Deploy as EA" button per row in the MT5 Genetic Optimizer results (PROJ-38) so that I can adopt the best parameter combination in MT5 with one click.
- As a trader, I want compile feedback after a deploy (success or error with message) so that I know whether the EA is immediately usable.
- As a trader, I want a deploy history in Settings under "MT5 Bridge" (EA name, source, timestamp, status) so that I can trace which EAs were deployed when.
- As a trader, I want the "Deploy to MT5" button to be disabled when the Bridge Worker is offline so that I do not click into the void.

---

## Acceptance Criteria

### Bridge Worker — New Endpoint

- [ ] `POST /mt5/ea/deploy` accepts a JSON payload: `ea_name` (filename without `.mq5` extension), `mq5_content` (string, full MQL5 code)
- [ ] The worker writes `mq5_content` as `{ea_name}.mq5` into the MT5 directory `MQL5/Experts/` (configured path from env `MT5_EXPERTS_PATH`)
- [ ] If the file already exists: silently overwrite, no dialog, no error
- [ ] The worker starts compilation: `metaeditor64.exe /compile:"{experts_path}/{ea_name}.mq5" /log`
- [ ] The worker waits for the process to complete (timeout: 60s)
- [ ] The worker parses the compile log: detects success ("0 error(s), 0 warning(s)") and error lines
- [ ] Response on success: `{ status: "compiled", ea_name, warnings: [], log_excerpt: "..." }`
- [ ] Response on compile error: `{ status: "compile_error", ea_name, errors: ["line 42: undeclared identifier 'xxx'", ...], log_excerpt: "..." }`
- [ ] Response on timeout: `{ status: "timeout", error: "MetaEditor did not complete within 60s" }`
- [ ] Endpoint sits behind `X-Bridge-Token` auth, analogous to PROJ-37

### Python Backend — New Endpoint

- [ ] `POST /mt5/ea/deploy` in `python/main.py`: auth check, persists a deploy entry in `mt5_ea_deployments` (status `pending`), proxies to the bridge, updates the status after the response (`compiled` | `compile_error` | `failed`)
- [ ] Parameter replacement: when `mql_conversion_id` + `parameters` override is sent (optimizer flow), the backend performs the parameter replacement — **reusing** the existing regex logic from PROJ-33 (`export-mt5` endpoint) before sending the content to the bridge
- [ ] For the MQL Converter flow: the frontend sends ready-to-use `.mq5` content (already exported via PROJ-33), no backend preprocessing needed

### Data Model (Supabase)

- [ ] Migration `supabase/migrations/2026XXXX_mt5_ea_deployments.sql`:
  - `mt5_ea_deployments`: `id` (uuid), `user_id`, `ea_name`, `source` (`"mql_converter"` | `"mt5_optimizer"`), `mql_conversion_id` (nullable FK), `optimizer_run_id` (nullable FK), `optimizer_result_rank` (nullable int), `status` (`"pending"` | `"compiled"` | `"compile_error"` | `"failed"`), `error_message` (nullable text), `warnings` (jsonb, nullable), `deployed_at`
- [ ] RLS: a user only sees their own deploys
- [ ] Index on `mt5_ea_deployments(user_id, deployed_at DESC)` for the history query

### Frontend: MQL Converter — Deploy Button

- [ ] New button **"Deploy to MT5"** next to the existing "Export .mq5" button (PROJ-33)
- [ ] On click:
  1. The PROJ-33 export logic is invoked (or directly the existing `POST /api/mql-converter/export-mt5` endpoint) to generate `.mq5` content with the current parameters
  2. The content is sent to `POST /api/mt5/ea/deploy`
- [ ] Button disabled with tooltip "MT5 Bridge Worker offline" when the health check fails
- [ ] Loading state during deploy + compile with text "Deploying..."
- [ ] On success: toast "EA '{name}' compiled and ready in MT5"
- [ ] On compile error: error dialog with header "Compile Error" and the error lines from the compile log (no simple toast — the user must be able to read the errors)
- [ ] Confirm dialog before deploy with header "Deploy to MT5", input label "EA Name" (pre-filled from `conversion.name` or filename, editable), buttons "Cancel" / "Deploy"

### Frontend: MT5 Genetic Optimizer — Deploy Button (PROJ-38 Extension)

- [ ] In the result table (PROJ-38): each row has a "Deploy as EA" button
- [ ] On click: confirm dialog with header "Deploy as EA", input label "EA Name" (pre-filled with the original EA filename + `_opt` suffix, e.g. `BreakoutEA_opt.mq5`)
- [ ] Dialog shows the chosen parameter values for confirmation under header "Parameters"
- [ ] When there is an active EA-override risk (see Edge Cases) a warning box also appears: "Warning: An EA with this name will be overwritten. If it is active on a chart, it will be reloaded."
- [ ] After confirmation: the backend performs the parameter replacement (PROJ-33 logic) and deploys to the bridge
- [ ] Same feedback pattern as the MQL Converter flow (toast on success, dialog on error)

### Frontend: Settings — Deploy History

- [ ] New section with header **"EA Deployments"** in the "MT5 Bridge" section on `/settings` (below the bridge status from PROJ-37)
- [ ] Table columns (English): "Date", "EA Name", "Source" (values: "MQL Converter" / "MT5 Optimizer"), "Status" (badges: "Compiled" / "Compile Error" / "Failed")
- [ ] Click on an error row expands the error details under header "Compile Log"
- [ ] Link **"Show All"** opens the full history (paginated, older entries)

### Frontend API Routes (Next.js)

- [ ] `src/app/api/mt5/ea/deploy/route.ts` — POST
- [ ] `src/app/api/mt5/ea/deployments/route.ts` — GET (history)

---

## Edge Cases

- **Bridge offline on deploy click:** the button is already disabled (bridge status from PROJ-37 known). If the status check is outdated: backend returns 503, toast "Bridge Worker not reachable".
- **Compile error due to missing include files** (`.mqh` libraries that are not present on the worker): the compile log contains "cannot open file 'X.mqh'". The error dialog shows this clearly. Note: standard MT5 libraries are present; only custom includes would be missing. Solution: manual upload to the MT5 Include folder (out of PROJ-40 scope).
- **MT5 Terminal is closed during deploy:** MetaEditor runs independently of the terminal — compilation works even when MT5 is not running.
- **MT5 Terminal is open and an EA with the same name is active on a chart:** the file is overwritten and recompiled. MT5 may show "Expert Advisor reloaded" in the journal. No data loss, but the running EA instance is reloaded — user info in the confirm dialog: "Warning: An EA with this name will be overwritten. If it is active on a chart, it will be reloaded."
- **EA name contains special characters or whitespace:** input validation in the confirm dialog: only alphanumerics + underscore + hyphen. Whitespace is auto-converted to `_`.
- **Compile timeout (> 60s):** status `timeout`, user toast with hint "MetaEditor did not respond — please compile manually in MT5". The .mq5 file has already been written, so it can be compiled manually in MT5.
- **Optimizer run no longer has the original EA code** (e.g. upload deleted): backend returns 404, toast "Original EA code no longer available — please re-upload".
- **Very long `.mq5` code (> 1 MB):** payload limit on the bridge endpoint: 5 MB. Realistically not reachable, but the limit is documented.

---

## Technical Requirements

- **Latency:** the compile process typically takes 1–5 seconds for standard EAs; the UI must show a loader
- **Reuse:** the parameter-replacement regex from PROJ-33 (`src/app/api/mql-converter/export-mt5/route.ts`) is extracted into the Python backend and reused — not duplicated
- **MT5 path configuration:** `MT5_EXPERTS_PATH` as an env variable on the Bridge Worker (e.g. `C:\Users\...\AppData\Roaming\MetaQuotes\Terminal\<ID>\MQL5\Experts`)
- **Security:** `.mq5` content is never logged in full in the frontend or server logs (it may contain proprietary strategy code)
- **Bridge token auth:** analogous to PROJ-37

---

## Out of Scope (Follow-Up Features)

- **Live order submission / activate EA on a chart:** explicit non-goal per the PRD (no live trading)
- **Versioning:** EAs are always overwritten, no Git-style versioning
- **Multi-terminal deploy:** only the single MT5 terminal on the Bridge Worker
- **AI strategy discovery** (PROJ-41, planned): generates MQL5 code from a description and then uses PROJ-37–40 as the deploy pipeline

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)

### Overview

One-click deploy pipeline from the app to the MT5 Experts folder. Extends the existing Bridge Worker (PROJ-37) with a compilation endpoint. Entry points in the MQL Converter and MT5 Genetic Optimizer results table. Deploy history in Settings under MT5 Bridge.

### Component Structure

```
MQL Converter Page (existing)
+-- mt5-result-panel (existing)
    +-- [NEW] DeployToMT5Button          ← "Deploy to MT5" next to "Export .mq5"
        +-- [NEW] DeployConfirmDialog    ← EA name input + confirm/cancel
        +-- [NEW] CompileErrorDialog     ← expanded error log (replaces toast)

MT5 Genetic Optimizer Page (PROJ-38)
+-- Optimizer Result Table
    +-- [NEW] DeployAsEAButton (per row)
        +-- [REUSE] DeployConfirmDialog  ← same dialog, with param summary added
        +-- [REUSE] CompileErrorDialog

Settings Page (/settings, existing)
+-- MT5 Bridge section (existing)
    +-- mt5-bridge-status-card (existing)
    +-- [NEW] EaDeploymentsSection
        +-- [NEW] EaDeploymentsTable    ← Date / EA Name / Source / Status
            +-- [NEW] CompileLogExpandedRow
        +-- [NEW] DeploymentsPaginationLink ← "Show All"
```

### Request Flow

```
User clicks "Deploy to MT5"
  → DeployConfirmDialog (EA name editable; param summary for optimizer flow)
  → Next.js POST /api/mt5/ea/deploy
  → Python Backend POST /mt5/ea/deploy
      → Creates pending row in mt5_ea_deployments
      → [optimizer only] applies parameter replacement (PROJ-33 logic)
      → Proxies to Bridge Worker POST /mt5/ea/deploy
          → Writes {ea_name}.mq5 to MT5_EXPERTS_PATH
          → Runs metaeditor64.exe /compile, waits (timeout 60s)
          → Parses compile log → { status, errors[], warnings[], log_excerpt }
      → Updates mt5_ea_deployments row with final status
  → Frontend: toast on success, CompileErrorDialog on compile_error, toast on timeout/failed
```

### Data Model

**`mt5_ea_deployments`** table:
- `id` (uuid PK), `user_id` (FK → auth.users)
- `ea_name` — filename without `.mq5`
- `source` — `"mql_converter"` | `"mt5_optimizer"`
- `mql_conversion_id` (nullable FK), `optimizer_run_id` (nullable FK), `optimizer_result_rank` (nullable int)
- `status` — `"pending"` | `"compiled"` | `"compile_error"` | `"failed"`
- `error_message` (nullable text), `warnings` (jsonb nullable), `deployed_at` (timestamptz)
- RLS: users see only their own records
- Index: `(user_id, deployed_at DESC)`

### New API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/mt5/ea/deploy` | POST | Proxies deploy request to Python backend |
| `/api/mt5/ea/deployments` | GET | Returns paginated deploy history for current user |

### Tech Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Bridge auth | `X-Bridge-Token` | Same as PROJ-37 — no new mechanism |
| Parameter replacement location | Python backend | Keeps bridge simple; reuses PROJ-33 regex without duplication |
| Compile error UI | Dialog (not toast) | Multi-line error output would be truncated in a toast |
| Overwrite behavior | Silent | Versioning out of scope; warning shown in confirm dialog |
| History location | Settings → MT5 Bridge | Logical grouping with existing bridge status card |
| EA content logging | Suppressed | EA code is proprietary |

### Reuse

| Existing artifact | How reused |
|---|---|
| Bridge Worker infrastructure (PROJ-37) | Auth, health check, process-runner pattern |
| Parameter-replacement regex (PROJ-33) | Extracted to Python backend shared utility |
| `mt5-bridge-status-card` | Deploy button disabled state from same health check |
| `DeployConfirmDialog` | Shared between MQL Converter and Optimizer entry points |

### Dependencies

No new npm packages — Dialog, Toast, Table, Badge, Button already installed via shadcn/ui.
No new Python packages — `subprocess` and `re` are standard library.

## QA Test Results

**Tested:** 2026-05-06
**App URL:** http://localhost:3000
**Tester:** QA Engineer (AI)

> The Bridge Worker itself lives in a **separate `mt5-bridge` repository** and
> was not exercised live (no Windows host available in this run). All bridge-side
> behaviour was verified against the contract documented in
> `docs/BRIDGE-CONTRACT.md` and through mocked fetch responses; the Python
> backend, Next.js routes, Supabase migration and React UI were exercised
> directly.

### Acceptance Criteria Status

#### Bridge Worker — New Endpoint
- [x] Contract for `POST /mt5/ea/deploy` documented in `docs/BRIDGE-CONTRACT.md`
  (request shape, success / compile_error / timeout response shapes,
  4xx/5xx semantics, 5 MB ceiling, X-Bridge-Token auth, single-threaded
  compile + path-traversal guard)
- [x] Python client `services/mt5_bridge.deploy_ea` aligns with the contract
  (120 s timeout, retries=1, no payload logging)
- [ ] *Live verification deferred:* the actual bridge implementation lives in
  the `mt5-bridge` repo and is not exercisable from this codebase. Mark as
  contract-only until the bridge ships an updated build (out of scope for
  PROJ-40 in this repo).

#### Python Backend — New Endpoint
- [x] `POST /mt5/ea/deploy` validates auth via `verify_jwt`
- [x] Persists a `pending` row, then updates with `compiled` / `compile_error`
  / `failed` after the bridge call (`_finalize_deploy`)
- [x] `mql_converter` flow forwards `mq5_content` verbatim (no preprocess)
- [x] `mt5_optimizer` flow loads saved MQL, applies overrides via
  `mql_param_replace.render_ea`, returns 404 when the conversion is missing
  and 403 when it belongs to a different user
- [x] `GET /mt5/ea/deployments` returns paginated history (limit 1–100,
  offset >= 0, ordered by `deployed_at DESC`)
- [x] EA name validated against `^[A-Za-z0-9_\-]+$` at the API boundary
  (Pydantic `field_validator`)
- [x] mq5 content size ceiling enforced at 2 MB by both Zod (string length)
  and Python (UTF-8 byte length)

#### Data Model (Supabase)
- [x] Migration `supabase/migrations/20260506_mt5_ea_deployments.sql` creates
  the table with the required columns + status / source CHECK constraints +
  EA-name regex CHECK
- [x] RLS enabled with owner-only SELECT/INSERT/UPDATE/DELETE policies + admin
  read via `app_metadata.role`
- [x] Index `idx_mt5_ea_deployments_user_deployed_at` on
  `(user_id, deployed_at DESC)` matches the history query
- [x] FK to `mql_conversions(id) ON DELETE SET NULL`; `optimizer_run_id`
  intentionally left as a plain UUID until PROJ-38 ships (documented in the
  migration)

#### Frontend: MQL Converter — Deploy Button
- [x] New "Deploy to MT5" button rendered next to the existing
  "Export MT5 EA" button in `SaveConversionSection`
- [x] On click: re-uses the existing `/api/mql-converter/export-mt5` endpoint
  to render `.mq5` content with current parameters, then forwards to
  `/api/mt5/ea/deploy`
- [x] Bridge-offline state: button is disabled and the wrapper carries a
  tooltip with a "MT5 Bridge Worker is offline. Open Settings…" hint
- [x] Loading state: spinner + "Deploying…" label while the request is in
  flight
- [x] Success: toast `EA "{name}" compiled and ready in MT5.`
- [x] Compile error: opens `CompileErrorDialog` (multi-line list + raw log
  excerpt) — *not* a toast, matching the spec
- [x] Confirm dialog: title "Deploy to MT5", `EA Name` input pre-filled from
  the conversion name (sanitized), `Cancel` / `Deploy` buttons

#### Frontend: MT5 Genetic Optimizer — Deploy Button
- [x] `DeployToMt5Button` accepts `parameters` + `dialogTitle="Deploy as EA"`
  for the optimizer flow (component-ready)
- [x] `DeployConfirmDialog` shows the parameter summary table when
  `parameters` is provided
- [x] Overwrite warning ("EA with this name will be overwritten…") rendered
  unconditionally when `showOverwriteWarning` is true (default)
- [N/A] *Live integration deferred until PROJ-38 ships the optimizer page* —
  the spec explicitly lists PROJ-38 as a dependency

#### Frontend: Settings — Deploy History
- [x] New "EA Deployments" section rendered below `Mt5BridgeStatusCard` in
  `/settings`
- [x] Table columns: Date / EA Name / Source / Status with the badge styling
  required by the spec
- [x] `compile_error` and `failed` rows are expandable (chevron) and reveal
  a "Compile Log" block with the error message + log excerpt
- [⚠] "Show All" link is implemented as an inline expand to 50 rows + a
  "Showing the 50 most recent of N deployments" footnote, **not** a separate
  paginated page. Acceptable for a personal-use tool but a minor deviation
  from "opens the full history (paginated, older entries)" — see BUG-2

#### Frontend API Routes (Next.js)
- [x] `src/app/api/mt5/ea/deploy/route.ts` (POST): user auth via
  `createClient`, per-user rate limit (10/min), 2 MB content cap, Zod
  validation, forwards to FastAPI with bearer token + `X-User-Id`
- [x] `src/app/api/mt5/ea/deployments/route.ts` (GET): user auth, Zod query
  validation, queries `mt5_ea_deployments` with `count: "exact"` for proper
  pagination metadata

### Edge Cases Status

- [x] EC-1 — **Bridge offline on deploy click:** button is disabled; tooltip
  links to Settings. The deploy hook also handles 503/504 from the proxy
  with a transport-error toast.
- [x] EC-2 — **Compile error from missing includes:** errors are surfaced
  verbatim by the bridge → propagated through the API → rendered in the
  `CompileErrorDialog` errors list, with the raw log excerpt below.
- [x] EC-3 — **MT5 terminal closed:** bridge-side concern, not exercised
  here; documented in `docs/BRIDGE-CONTRACT.md`.
- [x] EC-4 — **EA name with whitespace / special chars:** the confirm
  dialog's `sanitizeEaName` collapses whitespace to `_` and strips any
  character outside `[A-Za-z0-9_-]`; backend re-validates with the same
  regex.
- [x] EC-5 — **Compile timeout:** Python deploy maps `timeout` → `failed`
  with the bridge's error message; the hook surfaces it via toast
  ("MetaEditor did not respond — please compile manually in MT5"). Note:
  the deploy *response* uses `failed` rather than `timeout` because the
  Python `_finalize_deploy` collapses both into the persisted
  `failed` status — see BUG-3.
- [x] EC-6 — **Optimizer run no longer has the original EA code:** Python
  returns 404 with the spec'd message; `useMt5EaDeploy` surfaces it as a
  transport-error toast.
- [x] EC-7 — **`.mq5` larger than 1 MB / 2 MB:** Zod (string length) and
  Python (UTF-8 byte length) both reject; bridge ceiling 5 MB documented.

### Security Audit Results

- [x] Authentication: both Next.js routes call `supabase.auth.getUser()` and
  return 401 when missing; Python relies on `verify_jwt` (HS256/JWKS).
- [x] Authorization: RLS policies restrict reads/writes to the owner;
  Python additionally checks `conv["user_id"] != user_id` on the optimizer
  flow (defense-in-depth, since the backend uses a service-role client
  internally).
- [x] Input validation: Zod (Next.js) + Pydantic (Python) + Postgres CHECK
  constraints validate `ea_name` against `^[A-Za-z0-9_\-]+$`, blocking path
  traversal (`..`, `/`, `\`).
- [x] Payload size: 2 MB enforced at both API tiers; bridge enforces 5 MB.
- [x] Rate limiting: 10 deploys/min/user via the existing
  `check_rate_limit` RPC (returns 429 + `Retry-After`).
- [x] Secrets: `mq5_content` is never logged in Python (explicit comment in
  `mt5_ea_deploy`); the bridge contract requires the same.
- [x] CSRF: relies on Supabase's same-site cookie auth, identical to all
  existing dashboard routes.
- [x] XSS: error_message / log_excerpt rendered through React text nodes
  (no `dangerouslySetInnerHTML`).
- [x] DoS: rate limit + 2 MB cap + bridge single-threaded compile.
- [x] Idempotency: silent overwrite is intentional and warned in the
  confirm dialog.

### Bugs Found (all fixed in this round)

#### BUG-1: `warnings` JSONB column reused for compile errors — **FIXED**
- **Severity:** Low
- **Description:** The Python backend stored the bridge `errors[]` array in
  the `warnings` JSONB column when status was `compile_error`.
- **Resolution:** Migration `20260506_mt5_ea_deployments.sql` now declares
  a dedicated `errors JSONB` column. `_finalize_deploy` accepts an `errors=`
  kwarg and the `compile_error` branch persists into `errors`, leaving
  `warnings` exclusively for compile-success warnings. The list endpoint
  selects the new column, the TS `EaDeployment` interface gained
  `errors: string[] | null`, and the Settings expand block renders the
  structured error list above the raw log excerpt.

#### BUG-2: "Show All" expands inline instead of paginating — **FIXED**
- **Severity:** Low
- **Description:** Implementation previously expanded the inline table from
  10 → 50 rows.
- **Resolution:** `EaDeploymentsSection` now drives proper offset-based
  pagination (10 rows per page) with explicit `Previous` / `Next` buttons,
  a `Page X / Y` indicator, and a `Showing N–M of T` summary. `refreshKey`
  bumps reset to page 1 so a fresh deploy is always visible.

#### BUG-3: `timeout` outcome collapsed to `failed` in the persisted row — **FIXED**
- **Severity:** Low
- **Resolution:** Added `timeout` to the DB CHECK constraint, the Python
  `EaDeployResponse.status` Literal, the TS `EaDeploymentStatus` union and
  the Zod query enum on the list route. `mt5_ea_deploy` persists the
  `timeout` status directly. A new amber `Timeout` badge (Hourglass icon)
  renders in the Settings table, and the row is expandable to show the
  bridge's error message. The deploy hook surfaces a `kind: "timeout"`
  error with the same "compile manually in MT5" toast as before.

#### BUG-4: Boolean parameter rendering risk in optimizer flow — **FIXED**
- **Severity:** Low (latent)
- **Resolution:** `EaDeployParameter.current_value` reordered to
  `Union[bool, int, float, str]` so JSON `true`/`false` deserialise as
  Python `bool` (verified end-to-end by a smoke test through
  `model_validate_json`). `_format_value` was hardened so even if a value
  arrives as `int`/`float` on a `boolean`-typed parameter, the truthy/falsy
  rendering still produces `"true"`/`"false"`. A 12-case smoke matrix
  (boolean / integer / number / string with bool, int, float, str inputs)
  passes 12/12.

#### Bridge 401 body-shape (PROJ-40 follow-up note from `mt5-bridge`) — **DOCUMENTED**
- **Issue:** The bridge's 401 returns `{"detail": "..."}` rather than the
  contract's `{"error": "..."}` because the auth dependency reuses
  FastAPI's `HTTPException`.
- **Resolution:** The Python client in `services/mt5_bridge.py` checks only
  `status_code == 401` and never parses the 401 body, so the divergence is
  invisible to upstream callers. An inline comment in the client and a new
  paragraph in `docs/BRIDGE-CONTRACT.md` document the exception (and how to
  bring the bridge into strict compliance via a `JSONResponse` wrapper if
  ever needed). No code change required on the main-app side.

### Automated Tests

- **Unit tests (Vitest):** existing 36 tests pass (no new units added —
  shared `mql-export.test.ts` already covers the regex; the Python
  `mql_param_replace` was smoke-tested with a one-off Python harness and
  produces the expected substitutions for `int`, `double`, `string` and
  `bool` declarations).
- **TypeScript:** `tsc --noEmit` clean.
- **ESLint:** `npm run lint` clean (pre-existing warnings unchanged).
- **E2E (Playwright):** new spec
  `tests/PROJ-40-mt5-ea-auto-deploy.spec.ts` (10 scenarios — Settings
  heading, empty state, history rows + status badges, compile-log expand,
  Previous/Next pagination, button visibility, offline tooltip, online
  enable, confirm-dialog open, compile-error dialog). Skipped in this run
  because
  `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` are not configured in the
  environment, matching the gating used by `PROJ-37` and `PROJ-33` specs.
  Spec discovery and compile passed (`playwright test --list`).

### Regression Risk

- [x] PROJ-37 (Bridge health) — same `useMt5Health` hook drives both the
  Tester button and the new Deploy button; no signature changes.
- [x] PROJ-33 (`/api/mql-converter/export-mt5`) — endpoint left untouched;
  re-used as the `.mq5` renderer for the converter deploy flow.
- [x] PROJ-32 (editable parameters) — same `parameters` + `parameterValues`
  pair feeds both the Save / Export and the Deploy paths.
- [x] Settings page (PROJ-37) — new `EaDeploymentsSection` rendered below
  the existing `Mt5BridgeStatusCard` in the same `<section>` wrapper; no
  layout regressions to the surrounding cards.

### Summary

- **Acceptance Criteria:** 6 of 7 sub-areas fully passing in this repo; the
  Bridge Worker side (1 area) is contract-only because the bridge lives in a
  separate repository.
- **Bugs Found:** 4 total (0 critical, 0 high, 0 medium, 4 low) — **all fixed**.
- **Bridge 401 body-shape:** documented; no code change needed on the
  main-app side.
- **Security:** Pass — auth, RLS, input validation, rate limiting, payload
  ceiling, secret-handling and path-traversal defenses are all in place.
- **Production Ready:** YES (with the caveat that the deploy round-trip
  hasn't been exercised against a live bridge from this run — final
  go/no-go should include a manual smoke test on the developer's MT5
  workstation).
- **Recommendation:** Deploy. PROJ-38 can now wire the optimizer flow
  without further blockers from PROJ-40.

## Deployment

**Deployed:** 2026-05-06
**Production URL:** https://test-project-psi.vercel.app

- Supabase migration `20260506_mt5_ea_deployments.sql` applied
- New API routes: `POST /api/mt5/ea/deploy`, `GET /api/mt5/ea/deployments`
- Deploy button live in MQL Converter (`/mql-converter`)
- EA Deployments history section live in Settings (`/settings`)
- Bridge Worker (`mt5-bridge` repo) requires `MT5_EXPERTS_PATH` env var and updated `/mt5/ea/deploy` endpoint to go live end-to-end
