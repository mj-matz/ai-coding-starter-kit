# PROJ-40: MT5 EA Auto-Deploy (Software → MT5 Experts Folder)

## Status: Planned
**Created:** 2026-04-28
**Last Updated:** 2026-04-28

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
_To be added by /architecture_

## QA Test Results
_To be added by /qa_

## Deployment
_To be added by /deploy_
