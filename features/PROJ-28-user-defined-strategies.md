# PROJ-28: User-Defined Strategies (MQL → Strategy Library)

## Status: Planned
**Created:** 2026-04-01
**Last Updated:** 2026-04-01

## Dependencies
- Requires: PROJ-22 (MQL Converter) — source of converted Python strategy code and parameter extraction
- Requires: PROJ-6 (Strategy Library / Plugin System) — user strategies appear alongside built-in strategies in the selector
- Requires: PROJ-2 (Backtesting Engine) — user strategies are executed by the same engine
- Requires: PROJ-8 (Authentication) — strategies are user-scoped

## Overview
After converting an MQL Expert Adviser via PROJ-22, the user can promote the converted strategy to their personal Strategy Library. Claude automatically extracts MQL `extern`/`input` variable declarations as a configurable parameter schema. Once in the library, the strategy appears in the backtest configuration panel's strategy selector alongside built-in strategies — with its own parameter form — and can be re-run on any asset or date range just like a built-in strategy. Strategies are private to the owning account.

## User Stories
- As a trader, I want to add a successfully converted MQL strategy to my Strategy Library so that I can use it in the standard backtest UI without copy-pasting code each time.
- As a trader, I want Claude to automatically detect the configurable parameters (e.g. StopLoss, TakeProfit, MAPeriod) from my MQL code so that I don't have to define a parameter schema manually.
- As a trader, I want my user-defined strategies to appear in the strategy selector alongside built-in strategies so that I have a single consistent workflow.
- As a trader, I want to adjust the extracted parameter defaults and run a backtest with different values so that I can optimize the strategy without re-converting.
- As a trader, I want to rename or delete strategies from my library so that I can keep it organised.
- As a trader, I want to see which strategies in the list are my own (user-defined) vs. built-in so that I can tell them apart.

## Acceptance Criteria

### Parameter Extraction (Extension to PROJ-22 /convert endpoint)
- [ ] Claude's conversion prompt is extended to also return a `parameter_schema` array alongside `python_code` and `mapping_report`
- [ ] Each extracted parameter contains: `name`, `label`, `type` (number | integer | boolean), `default_value`, `min` (optional), `max` (optional), `step` (optional), `description` (from inline MQL comments if present)
- [ ] MQL `extern` and `input` variable declarations are the source: `extern double StopLoss = 50;` → `{ name: "stop_loss", label: "Stop Loss", type: "number", default_value: 50 }`
- [ ] If no `extern`/`input` variables are found, `parameter_schema` is an empty array (strategy runs with no configurable params)
- [ ] The extracted schema is shown to the user in the Code Review Panel (PROJ-22 UI) before they add to library, with the option to edit param names/defaults inline

### Add to Strategy Library
- [ ] "Add to Strategy Library" button appears in the PROJ-22 Code Review Panel after a successful conversion+backtest
- [ ] Clicking the button opens a dialog with: strategy name input (pre-filled from EA filename / Claude-detected EA name, max 80 chars), description input (optional, max 300 chars), and a read-only preview of the extracted parameter schema
- [ ] User can edit the strategy name and description in the dialog before confirming
- [ ] On confirm, the strategy is saved to Supabase and immediately appears in the strategy selector
- [ ] If a strategy with the same name already exists, the user is warned and can overwrite or rename

### Strategy Selector Integration
- [ ] `GET /api/strategies` returns built-in strategies AND the authenticated user's saved strategies in a single list
- [ ] User-defined strategies are visually distinguished with a "Custom" badge in the selector dropdown
- [ ] Selecting a user-defined strategy renders its parameter form using the same `DynamicParamForm` component as built-in strategies
- [ ] Parameter defaults from the saved schema are pre-filled in the form

### Backtest Execution
- [ ] Running a backtest with a user-defined strategy works identically to built-in strategies from the user's perspective
- [ ] The Next.js API resolves the user strategy by ID, fetches its Python code from Supabase (server-side), and routes execution through the existing sandbox infrastructure (same safety layer as PROJ-22)
- [ ] The sandbox receives `params` as a dict derived from the user's form input, matching the extracted parameter schema
- [ ] The generated Python code's `generate_signals(df, params)` must handle the passed params dict (Claude is instructed to use `params.get("stop_loss", 50)` style access in the generated code)

### Strategy Management
- [ ] A "My Strategies" section is accessible from the sidebar (or the existing PROJ-22 "My Conversions" tab is extended with a "Library" sub-tab)
- [ ] Each entry shows: strategy name, description, parameter count, creation date, "Custom" badge
- [ ] "Edit" action: allows renaming the strategy and editing the description; does NOT re-convert
- [ ] "Delete" action: removes from library with a confirmation dialog; does not affect saved MQL conversions in PROJ-22
- [ ] "Open in Converter" action: loads the original MQL code back into the PROJ-22 converter tab

### Data & Security
- [ ] New Supabase table `user_strategies` with RLS: SELECT/INSERT/UPDATE/DELETE only for owning user
- [ ] Python code stored server-side only; never returned to the client in API responses (only the parameter schema and metadata are exposed)
- [ ] Backtest execution uses the sandbox (import whitelist, 60-second timeout) — identical to PROJ-22 `/run`
- [ ] Max 50 user-defined strategies per account

## Edge Cases
- **EA has no `extern`/`input` variables:** `parameter_schema` is empty; strategy appears without a parameter form (fixed-logic strategy). The user is informed: "No configurable parameters were detected. This strategy will run with its built-in defaults."
- **Claude extracts a parameter with an ambiguous type** (e.g. `extern int Shift = 0` used as a boolean): defaults to `integer`; user can edit it in the dialog before saving.
- **User edits Python code in PROJ-22 Code Review Panel before adding to library:** The edited (not the original Claude-generated) code is saved. Warning shown: "You are saving manually edited code. Ensure the parameters match the schema below."
- **User deletes a user strategy that is currently selected in an open backtest session:** The backtest session becomes invalid; user sees an error on next run: "Strategy no longer exists. Please select another."
- **Strategy name collision with a built-in strategy:** Not possible at the UI level (built-in names are reserved); API returns a 409 with a clear message if attempted via direct API call.
- **Sandbox timeout during backtest of a user strategy:** Same handling as PROJ-22 — 504 error with message "Strategy execution timed out (60s)."
- **`generate_signals` ignores the `params` argument (hardcoded logic):** Runs successfully but the parameter form has no effect. No error — this is valid behaviour. The mapping report should note if Claude detected this.
- **User has 50 strategies and tries to add another:** Button disabled once limit is reached; tooltip: "Library limit reached (50). Delete a strategy to add a new one."

## Technical Requirements
- Python code is never sent to the browser; strategy execution is always server-side
- `GET /api/strategies` must not add more than 50ms latency (user strategies fetched with a single Supabase query, joined to the in-memory built-in list)
- The PROJ-22 `/convert` prompt extension must not break existing callers (parameter_schema defaults to `[]` if not returned by Claude)
- Sandbox execution path is identical to PROJ-22 `/run` — no new execution infrastructure required

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)
_To be added by /architecture_

## QA Test Results
_To be added by /qa_

## Deployment
_To be added by /deploy_
