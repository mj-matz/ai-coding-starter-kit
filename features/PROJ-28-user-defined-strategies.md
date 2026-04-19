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

### Component Structure
```
MQL Converter Page (existing, extended)
+-- Tab: Converter (existing)
|   +-- Code Review Panel (existing)
|       +-- "Add to Strategy Library" Button  ← NEW
|           → opens AddToLibraryDialog        ← NEW
|               +-- Strategy name input (pre-filled from EA/Claude name)
|               +-- Description input (optional, max 300 chars)
|               +-- Parameter schema preview (read-only)
|               +-- [Cancel] [Save to Library]
|
+-- Tab: My Conversions (existing)
+-- Tab: My Library  ← NEW tab
    +-- UserStrategyList  ← NEW
        +-- StrategyCard (per saved strategy)
            +-- Name, description, param count, date, "Custom" badge
            +-- [Open in Converter] [Edit] [Delete]
        +-- Empty state: "No strategies yet…"
        +-- Disabled "Add" button with tooltip when limit of 50 reached

Backtest Page — Configuration Panel (existing, minimal change)
+-- Strategy Selector (existing dropdown)
    +-- Built-in strategies (existing)
    +-- ── separator ──
    +-- User strategies ← NEW entries, each with "Custom" badge

Settings Page (existing, admin section extended)
+-- [Admin only] User Strategies tab  ← NEW
    +-- All users' strategies table (read-only)
        +-- Columns: name, owner (user_id), param count, created date
```

### Data Model

**New Supabase table: `user_strategies`**

Each saved strategy stores:
- `id` — UUID primary key
- `user_id` — owner (foreign key to auth.users, RLS-enforced)
- `name` — display name, max 80 chars (unique per user)
- `description` — optional, max 300 chars
- `python_code` — full Python strategy code (never sent to the browser)
- `parameter_schema` — JSON in `StrategyParametersSchema` format (compatible with existing `DynamicParamForm`)
- `source_conversion_id` — optional UUID linking back to `mql_conversions` (enables "Open in Converter")
- `created_at`, `updated_at`

**RLS policies:**
- SELECT: owner (`user_id = auth.uid()`) OR admin (`app_metadata.is_admin = true` or `app_metadata.role = 'admin'`)
- INSERT / UPDATE / DELETE: owner only (`user_id = auth.uid()`) — admin has no write access

**50-strategy cap** enforced at the API level (not database constraint).

**Parameter schema:** reuses the existing `StrategyParametersSchema` JSON shape — no new rendering logic in `DynamicParamForm`.

### Request Flows

**Adding a strategy to the library:**
```
User clicks "Add to Strategy Library" in Code Review Panel
  → Dialog pre-fills name from EA/Claude-detected name
  → User edits name/description → clicks Save
  → POST /api/user-strategies  ← NEW
  → Supabase: INSERT into user_strategies (python_code server-side only)
  → Toast: "Strategy saved to library"
  → Immediately available in backtest selector
```

**Loading strategies in the backtest selector:**
```
Backtest page loads
  → GET /api/strategies (existing, extended)
  → Next.js: 1) fetch built-ins from FastAPI  2) fetch user rows from Supabase
  → Merge: user strategies tagged is_custom=true, id prefixed "user_"
  → Frontend: built-ins first, then user strategies with "Custom" badge
```

**Running a backtest with a user-defined strategy:**
```
User selects custom strategy + fills params + clicks Run
  → POST /api/backtest/run (existing, extended)
  → Next.js detects "user_" prefix in strategy_id
  → Fetches python_code from Supabase (server-side only, never to browser)
  → Forwards python_code + params to FastAPI /run (same sandbox as PROJ-22)
  → Result flows back identically to a built-in strategy backtest
```

### API Changes

| Route | Change |
|-------|--------|
| `POST /api/user-strategies` | NEW — save strategy; enforces name uniqueness + 50-cap |
| `GET /api/user-strategies` | NEW — list user strategies (metadata only, no python_code); admin gets ALL users' strategies with owner info |
| `PATCH /api/user-strategies/[id]` | NEW — rename / update description (owner only) |
| `DELETE /api/user-strategies/[id]` | NEW — delete; owner only |
| `GET /api/strategies` | EXTENDED — merge Supabase user strategies into built-in list |
| `POST /api/backtest/run` | EXTENDED — resolve python_code for "user_" prefixed strategy IDs |

### Tech Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Storage | Supabase `user_strategies` | Consistent with stack; RLS enforces ownership; no new infrastructure |
| Python code | Server-side only | Security requirement; established pattern from PROJ-22 |
| Parameter schema format | Reuse `StrategyParametersSchema` | `DynamicParamForm` already renders it — zero new UI rendering work |
| Strategy list merging | In Next.js `GET /api/strategies` | FastAPI stays unmodified; single browser API call |
| Execution path | Same FastAPI sandbox as PROJ-22 `/run` | No new execution infrastructure; same safety guarantees |
| Management UI | New "My Library" tab on MQL Converter page | Keeps MQL features together; no sidebar changes |
| Strategy ID format | `user_` prefix in API responses | Allows `POST /api/backtest/run` to route correctly without a new endpoint |

### No new packages required.

## QA Test Results
_To be added by /qa_

## Deployment
_To be added by /deploy_
