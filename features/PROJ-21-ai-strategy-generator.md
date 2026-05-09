# PROJ-21: AI Strategy Generator

## Status: In Progress
**Created:** 2026-03-25
**Last Updated:** 2026-05-09

## Dependencies
- Requires: PROJ-2 (Backtesting Engine) — generated Python strategies run inside the engine
- Requires: PROJ-3 (Time-Range Breakout Strategy) — reference for parameter-mapping path
- Requires: PROJ-6 (Strategy Library / Plugin System) — generated code strategies register as plugins
- Requires: PROJ-8 (Authentication) — page requires login
- Requires: PROJ-1 (Data Fetcher) — backtesting generated Python strategies needs cached market data
- Requires: PROJ-26 (Strategy Export to MT5 EA) — MQL5 plumbing templates (OnInit/OnTick/OCO/Trailing/Partial Close) reused for the MQL5 output path
- Requires: PROJ-33 (MQL Converter — MT5 EA Export) — parameter-replacement regex reused for MQL5 inputs
- Requires: PROJ-37 (MT5 Bridge Worker — Strategy Tester) — required when iteration target is MT5 (MQL5-only mode and final-validation pass in Both mode)
- Requires: PROJ-40 (MT5 EA Auto-Deploy) — Bridge compile endpoint (validation + deploy) and the existing `DeployToMt5Button` component
- External: Anthropic Claude API (claude-sonnet-4-6 with Vision support)

## Overview
A new "AI Agent" section of the platform where the user describes a trading strategy idea in plain language and optionally attaches chart screenshots (TradingView, hand-drawn sketches, or backtest results from other tools). An AI agent — framed as an expert trader, MQL developer, and Expert Adviser specialist — analyzes the input and generates a working strategy. The agent uses a hybrid output model: it maps the idea to an existing strategy's parameters if possible, or generates executable Python strategy code otherwise. The generated strategy is automatically backtested, and the agent self-iterates 1–2 rounds based on the results before presenting the final output to the user.

## Agent Persona (System Prompt)
The AI agent is framed as:
> "An expert algorithmic trader with 15+ years of experience in systematic trading, MQL4/MQL5 Expert Adviser development, and quantitative strategy research. You know all industry best practices for strategy design, risk management, and avoiding common pitfalls like look-ahead bias, curve-fitting, and overfitting. You always build rule-based, deterministic strategies that can be backtested reliably."

## Output Target (User-Selected Before Generation)

Before each generation, the user picks **one** of three output targets via a toggle in the input area:

### Target: Python
The agent generates a Python strategy that runs inside the platform's backtesting engine (PROJ-2). Fast iteration (seconds), but uses the engine's approximations — not MT5-accurate. Best for fast idea-screening.

### Target: MQL5
The agent generates a `.mq5` Expert Advisor that runs in the actual MT5 Strategy Tester via PROJ-37. Tick-accurate, deployable, and identical to live behaviour — but each iteration takes 1–5 minutes depending on data range. Best when the goal is "develop something for MT5 directly".

### Target: Both
The agent generates Python first (fast preview iteration), and after the iteration loop converges, the same strategy is also rendered as MQL5 and validated against MT5 via PROJ-37 once. Best of both: fast refinement, accurate ground-truth final result. Highest AI cost per session.

## Output Modes (Hybrid)

The mode (A or B) is decided by the agent based on whether the strategy idea maps to an existing template. The chosen **target** above interacts with the **mode** as follows:

### Mode A: Parameter Mapping
Used when the user's idea clearly maps to an existing strategy (e.g., Breakout, SMC Price Action). Agent returns a JSON parameter object.
- **Python target:** parameters fed to the existing backtesting engine.
- **MQL5 target:** parameters fed to PROJ-26's templated MQL5 export — deterministic, always compiles.
- **Both target:** parameters drive both paths.

### Mode B: Code Generation
Used when the idea requires logic not covered by existing strategies.
- **Python target:** agent generates a Python class implementing the BaseStrategy interface. Runs in a sandboxed subprocess (60s timeout, restricted imports: `pandas`, `numpy`, `ta-lib`, `math`, `datetime`).
- **MQL5 target:** agent generates the MQL5 strategy-logic block that the AI fills into PROJ-26's plumbing template (OnInit/OnTick/OCO/Trailing Stop/Partial Close are template-provided; only entry/exit logic is AI-generated). The assembled `.mq5` is compile-validated through the PROJ-40 Bridge endpoint; one auto-retry on compile error with the error log fed back to Claude.
- **Both target:** Python is generated first; after the iteration loop converges, the Python is mapped to MQL5 (Mode A path if possible, Mode B if not) for the final validation run.

## Iteration Loop

The iteration target depends on the user's output-target selection:

| Output target | Iteration runs against | Per-iteration latency | Final-validation pass |
|---|---|---|---|
| **Python only** | Python engine (PROJ-2) | seconds | none |
| **MQL5 only** | MT5 Strategy Tester (PROJ-37) | 1–5 min | the iteration result *is* the validation |
| **Both** | Python engine for iteration | seconds | one MT5 Tester run (PROJ-37) on the final strategy |

After each backtest result during iteration:
1. Agent receives the backtest metrics (Profit Factor, Win Rate, Sharpe, Total Trades, Max Drawdown)
2. Agent evaluates whether results meet a minimum quality threshold (Profit Factor > 1.2, Total Trades > 20)
3. If not: agent automatically refines the strategy (adjust SL/TP, filter conditions, parameter values) and runs another backtest against the same target
4. **Maximum 2 automatic iterations for Python targets**, **maximum 1 for MQL5 targets** (MT5 runs are too slow to do many) — then the result is presented regardless of quality
5. For "Both" target: after the Python iteration loop ends, the strategy is rendered as MQL5 and run **once** through MT5 as a final ground-truth validation. The final UI shows both result sets side by side
6. User can continue refining manually by sending follow-up messages — same target as the original session (cannot switch targets mid-session; user must start a new session for a different target)

## User Stories
- As a trader, I want to describe a strategy idea in simple words so that I don't need programming knowledge to test it.
- As a trader, I want to attach TradingView screenshots or sketches so that the AI can understand visual patterns I've observed.
- As a trader, I want to choose **before generating** whether I want a Python preview, an MQL5 EA, or both, so that the platform optimises the workflow for my real goal.
- As a trader, I want the AI to automatically backtest the generated strategy so that I can evaluate its performance immediately.
- As a trader, I want the agent to self-improve the strategy based on initial results so that I get a refined version without manual iteration.
- As a trader who selected the MQL5 target, I want each iteration to run in the actual MT5 Strategy Tester so that the final strategy is tick-accurate and deployable as-is.
- As a trader who selected "Both", I want the iteration loop to use the fast Python engine and only the final result to be validated in MT5 so that I get speed during refinement and accuracy at the end.
- As a trader, I want to continue refining via follow-up prompts ("reduce the stop loss", "only trade during London session") so that I can steer the strategy iteratively.
- As a trader, I want a "Deploy to MT5" button after a successful MQL5 generation so that I can move the EA into MT5 with one click.
- As a trader, I want a "Test in MT5" button so that I can re-run the generated EA in MT5 with different parameters before deploying.
- As a trader, I want a ".mq5 download" button so that I can review or share the generated EA outside the platform.
- As a trader, I want to save a successful AI-generated strategy with a name so that I can re-run it later on different assets or time periods.
- As a trader, I want to see the generated strategy's logic explained in plain language alongside the backtest results so that I understand what the AI built.

## Acceptance Criteria

### AI Agent Page
- [ ] New "AI Agent" menu item in the sidebar navigation
- [ ] Text input area with placeholder: "Describe your trading strategy idea in your own words..."
- [ ] **Output Target toggle** (segmented control): `Python` / `MQL5` / `Both` — required selection before "Generate Strategy" is enabled (default: `Both` after the user has been onboarded; remembered across sessions in localStorage)
- [ ] When `MQL5` or `Both` is selected and the MT5 Bridge (PROJ-37) is offline, the toggle row shows an inline warning "MT5 Bridge offline — switch to Python or open Settings to enable MT5"
- [ ] Drag & drop zone for screenshots (max 4 images, supported formats: PNG, JPG, WEBP, max 10 MB each)
- [ ] Image thumbnails shown after upload with option to remove individual images
- [ ] "Generate Strategy" button triggers the agent workflow
- [ ] A conversation-style history shows the user's inputs and agent responses in order
- [ ] Each agent response shows a badge for the active target (`Python`, `MQL5`, or `Both`)
- [ ] Follow-up prompt field allows the user to send refinement instructions after seeing results — uses the **same target** as the original session (target cannot be switched mid-session; a new session must be started)

### Agent Workflow — Python Target

- [ ] Request to Claude API includes: system prompt (expert persona, "produce Python BaseStrategy" instruction), user text, images (base64-encoded), and the active target
- [ ] Agent response includes: (1) Mode A or Mode B decision, (2) parameters or Python code, (3) plain-language explanation
- [ ] If Mode A: parameters are validated against the target strategy's schema before backtesting
- [ ] If Mode B: generated Python code is executed in a sandboxed subprocess with restricted imports and a 60-second timeout
- [ ] Sandbox blocks: `os`, `sys`, `subprocess`, `requests`, `socket`, `open`, `exec`, `eval`, and all network/file access
- [ ] If sandbox execution fails (syntax error, timeout, forbidden import): agent is informed of the error and generates a corrected version (counted as one iteration)
- [ ] After first backtest, agent receives the results summary and decides whether to iterate
- [ ] **Maximum 2 automatic iterations** for Python target; then final result is shown regardless of quality

### Agent Workflow — MQL5 Target

- [ ] Request to Claude API instructs "produce MQL5 EA strategy logic" — system prompt is augmented with the PROJ-26 plumbing-template skeleton and explicit `<<<INSERT STRATEGY LOGIC>>>` markers
- [ ] **Mode A path:** parameters are filled into the existing PROJ-26 templated `.mq5` (deterministic, always compiles)
- [ ] **Mode B path:** AI fills only the strategy-logic markers in the PROJ-26 plumbing skeleton; the assembled `.mq5` is sent to the PROJ-40 Bridge `/mt5/ea/deploy` endpoint with a synthetic name (`__aigen_<uuid>`) for **compile-only validation**
- [ ] On compile error in Mode B: errors are fed back to Claude with a fix-it prompt; **exactly one auto-retry** before surfacing the failure
- [ ] On successful compile: the EA is enqueued to PROJ-37 for a Strategy Tester run on the user's selected asset and date range
- [ ] **Maximum 1 automatic iteration** for MQL5 target (MT5 Tester runs are slow); the user can manually iterate via follow-up prompts
- [ ] After the iteration completes, the synthetic validation EA is removed from the MT5 Experts folder (cleanup non-blocking)

### Agent Workflow — Both Target

- [ ] Python iteration loop runs first (up to 2 auto-iterations against the Python engine)
- [ ] After Python loop converges, the final strategy is rendered as MQL5 (Mode A if possible, Mode B otherwise)
- [ ] The MQL5 is compile-validated via PROJ-40, then run **exactly once** through PROJ-37 as a ground-truth validation pass
- [ ] Final UI shows **both result sets side by side**: Python preview metrics + MT5 ground-truth metrics with a clear discrepancy badge if they diverge by more than 25% on Profit Factor or Total Trades
- [ ] Total session latency target: P95 under 6 minutes (Python iterations seconds + MQL5 compile <10s + MT5 run 1–5 min)

### Cost & Rate Limit Awareness

- [ ] Per-user rate limit is target-aware: Python = 10 generations/hour; MQL5 = 4 generations/hour; Both = 4 generations/hour (limits the slower MT5-bound flows separately)
- [ ] Estimated session cost shown in the cost badge is target-aware (Both costs ~2x of Python because two AI passes happen)

### Backtest / Test Integration
- [ ] Generated strategy runs on the same asset and date range configured in the current Backtest panel
- [ ] If no backtest configuration is set, the AI Agent page prompts the user to select an asset and date range before generating
- [ ] **Python target:** progress shown with the same streaming progress bar as PROJ-10; full results (metrics + trade list + charts) inline
- [ ] **MQL5 target:** progress shown with the same poll-based status indicator as PROJ-37 (`Queued → Running → Done`); when the MT5 Tester finishes, the metrics + trade list (parsed from the MT5 XML report) are inline
- [ ] **Both target:** Python results render first, then a "Validating in MT5…" placeholder block appears; the MT5 result fills in when ready

### Deploy / Test Actions (after a successful MQL5 generation)

After a successful generation with `MQL5` or `Both` target, the result card shows the following action buttons (reusing the existing PROJ-37/PROJ-40 components):

- [ ] **"Deploy to MT5"** — wraps the existing `DeployToMt5Button` (PROJ-40) with the generated `.mq5` pre-loaded; same confirm dialog and compile-error handling
- [ ] **"Test in MT5"** — re-runs the EA in PROJ-37 with the same / a different asset+date range (lets the user re-test before deploying)
- [ ] **"Download .mq5"** — direct file download with name `{strategy_name}_{YYYY-MM-DD}.mq5`
- [ ] **"Save to My Strategies"** — opens the save-name dialog; saved record persists Python source (if any), MQL5 source, parameters, and the chat history

### Strategy Persistence
- [ ] "Save Strategy" button appears after successful generation (any target)
- [ ] User must provide a name before saving (max 100 characters)
- [ ] Saved strategies include: name, input prompt, attached image references, **output target** (`python` / `mql5` / `both`), Mode (A/B), parameters and/or Python code and/or MQL5 code (whichever the target produced), strategy explanation, and linked backtest result(s) (Python preview AND/OR MT5)
- [ ] Saved AI strategies are stored in Supabase with RLS (user-scoped)
- [ ] A "My AI Strategies" list shows all saved strategies with name, creation date, target badge, Mode badge, and last result summary
- [ ] Saved strategies can be re-run on a different asset or date range — the target is **inherited** from the original session
- [ ] For saved strategies with `mql5` or `both` targets, the row exposes "Deploy to MT5" / "Test in MT5" / "Download .mq5" actions directly without opening the chat
- [ ] Saved strategies can be deleted

### Transparency
- [ ] Every agent response includes a "Strategy Logic" section in plain language (not code)
- [ ] If the agent used Mode B with `Python` target, the generated Python code is shown in a collapsible code block
- [ ] If the agent used Mode B with `MQL5` target, the generated MQL5 source is shown in a collapsible code block (syntax-highlighted, read-only)
- [ ] If the target was `Both`, both code blocks appear, with the "Validated in MT5" badge on the MQL5 block once the validation pass succeeded
- [ ] Each iteration is visible in the conversation history (user can see what was changed between iterations and which target each iteration ran against)
- [ ] The number of Claude API calls made and approximate cost (in USD) is shown per session, broken down by target if `Both` was used

## Edge Cases
- **Vague input ("make me a profitable strategy"):** Agent responds with a clarifying message asking for more specifics (asset class, time of day, indicator preference, etc.) before generating anything.
- **Screenshot contains no trading chart:** Agent informs the user that the image does not appear to be a chart and asks for a different image; generation can still proceed based on text alone.
- **Generated Python code causes infinite loop in sandbox:** The 60-second timeout terminates the process; agent is informed and attempts a fix in the next iteration.
- **Generated code produces 0 trades:** Agent receives this metric and adjusts entry conditions (looser filters, different parameters) in the next iteration.
- **API rate limit or Claude API error:** Show a user-friendly error message; do not retry automatically. User can retry manually.
- **User attaches 4 large images:** Total payload to Claude API may exceed limits; backend compresses/resizes images to max 1024px on the long edge before sending.
- **Follow-up prompt changes asset class:** Agent updates the strategy accordingly but warns the user that the saved strategy name should be updated to reflect the change.
- **Mode B code attempts to import a forbidden module:** Sandbox raises ImportError; this is caught, reported to the agent as an error, and counts as one iteration.
- **MQL5 target chosen, MT5 Bridge offline at submit time:** "Generate Strategy" button is disabled with the same tooltip pattern as PROJ-40's deploy button. If the bridge goes offline mid-session, the next iteration fails fast with a transport-error toast and the iteration counter is **not** incremented (the user can retry once the bridge is back).
- **MQL5 target — generated `.mq5` fails compile twice:** the user sees the latest `.mq5` plus the compile errors via the existing PROJ-40 `CompileErrorDialog`. They can save the (broken) source for manual editing or start a new session with a more specific prompt.
- **MQL5 target — compile succeeds but MT5 Tester returns "no trades":** identical to the Python "0 trades" edge case — agent receives this metric and adjusts entry conditions in the (one allowed) iteration. If the second pass also produces 0 trades, the user sees the result and can refine manually.
- **MQL5 target — MT5 Tester run fails with a runtime error** (e.g. invalid symbol on the broker, missing data range): the bridge surfaces the error log, the agent is informed and attempts a single fix-it iteration. Common fixes: change `Symbol` parameter, broaden date range.
- **Both target — Python iteration converges but MQL5 validation diverges by >25%:** UI shows a discrepancy badge with the two metric sets side by side. Agent does **not** auto-iterate further — the user is given the choice to either accept the divergence as expected (Python ≠ MT5 by approximation) or refine manually with a follow-up prompt.
- **Both target — Python iteration succeeds but MQL5 compile fails twice:** the result card shows the Python results (intact) plus an error banner explaining that the MT5 validation failed. User can still save the Python version and Deploy/Test buttons are disabled with an explanatory tooltip.
- **User saves a `Both` strategy but later only wants the MQL5 part:** the saved record has both, the "My Strategies" row shows both, all Deploy/Test buttons reference the MQL5 source — Python is auxiliary metadata only.
- **Synthetic validation EA cleanup fails** (file lock, MT5 holding the `.ex5`): the failure is logged but not surfaced to the user; the next deploy with the same name overwrites it (consistent with PROJ-40's overwrite policy).
- **User switches output target between iterations**: not allowed — the follow-up prompt always inherits the original session's target. To change target, user starts a new session. UI tooltip on the disabled toggle: "Target is locked for this session".

## Technical Requirements
- Security: Authentication required; generated **Python** code MUST run in sandbox — never executed directly in the main Python process
- Generated **MQL5** code is sent to the Bridge Worker for compilation and execution; never `eval`'d or executed server-side
- Claude API key stored in server-side environment variable only (never exposed to the browser)
- Images uploaded by the user are stored temporarily in Supabase Storage for the session; only image references (not raw data) are stored in the database
- API rate limits per user, per target (target-aware to handle the MT5-bound flow's slower lifecycle):
  - Python target: 10 generations / hour
  - MQL5 target: 4 generations / hour
  - Both target: 4 generations / hour (counts against the MQL5 quota)
- Total Claude API cost per session is calculated and stored alongside each saved strategy, broken down by Python vs MQL5 if Both was used
- **Source-handling parity with PROJ-40:** generated Python source AND generated MQL5 source are never logged in full server-side; only metadata (length, hash, target) is logged
- **Compile-validation pass for MQL5 Mode B** uses the same Bridge `/mt5/ea/deploy` contract as PROJ-40 — no new endpoint required
- Generated MQL5 must compile cleanly under the project's reference build (MT5 Build 5833) — same constraint as PROJ-26/PROJ-33/PROJ-40

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)

> **⚠ Revision Needed (2026-05-09):** the original Tech Design below was written for Python-target only.
> The Output Target / iteration / deploy-actions changes added on 2026-05-09 (Python / MQL5 / Both) need to be reflected:
> - Add MQL5 generation path (Mode A → PROJ-26 templates; Mode B → AI-fills-into-PROJ-26-skeleton + PROJ-40 compile validation)
> - Add MT5-iteration path via PROJ-37 for MQL5 target
> - Add the "Both" target's Python-then-MT5-validation flow
> - Extend `ai_strategies` table with `output_target`, `mql5_source`, `mt5_validation_result` columns
> - New Next.js / Python routes for the MQL5 path (or extend `/api/ai-agent/generate` with a target field)
> - Reuse PROJ-37 status-polling + PROJ-40 deploy/compile components
>
> Run `/architecture PROJ-21` again before the next implementation pass to update this section.

### Relationship to PROJ-22 (MQL Converter)
PROJ-22 builds the **Python sandbox infrastructure** (already decided in PROJ-22 architecture). PROJ-21 **inherits this sandbox** and should be developed after PROJ-22. Both features also share the Claude API integration layer.

**Recommended development order:** PROJ-22 first → PROJ-21 second.

---

### Page Structure (Visual Tree)

```
/ai-agent  (new page, login required)
+-- Tabs: "Generator" | "My Strategies"
|
+-- [Tab: Generator]
|   +-- Asset & Date Range Selector (reused, required before generating)
|   |
|   +-- Conversation Area (scrollable, grows downward)
|   |   +-- User Message Card (text + image thumbnails)
|   |   +-- Agent Response Card
|   |   |   +-- Mode Badge ("Parameter Mapping" or "Code Generation")
|   |   |   +-- Strategy Logic (plain-language explanation)
|   |   |   +-- [Mode B] Collapsible: Generated Python Code
|   |   |   +-- Iteration Badge (e.g. "Iteration 1 of 2 — auto-refined")
|   |   |   +-- Progress Bar (while backtest runs)
|   |   |   +-- Backtest Results (Metrics + Equity Curve + Trade List, inline)
|   |   |   +-- "Save Strategy" Button + Name Input
|   |   |
|   |   +-- (further iteration/refinement cards below)
|   |
|   +-- Session Cost Badge (top right: "3 API calls · ~$0.02")
|   |
|   +-- Input Area (bottom, fixed)
|       +-- Text Input ("Describe your strategy idea...")
|       +-- Image Upload Zone (drag & drop, max 4 images)
|       |   +-- Image Thumbnails with "Remove" button
|       +-- "Generate Strategy" Button
|       +-- (after first result:) Follow-up Prompt Field
|
+-- [Tab: My Strategies]
    +-- Strategies List
        +-- Strategy Card (name, date, type, key metrics)
        +-- "Re-run" Button (loads strategy into Generator tab)
        +-- "Delete" Button
```

---

### Data Model (Plain Language)

**Table: `ai_strategies`**

Each saved strategy stores:
- Unique ID
- Owning user (user-scoped via RLS)
- Name (max 100 characters)
- Original input prompt
- Image references (list of Supabase Storage paths)
- Output type (parameter_mapping or code_generation)
- Parameters as JSON **or** Python code (depending on type)
- Plain-language explanation of the strategy logic
- Last backtest result (JSON: metrics + trade count)
- Number of Claude API calls in the session
- Estimated API cost in USD
- Created timestamp

**Supabase Storage Bucket: `ai-agent-images`**
- Temporary images for active sessions
- Only path references stored in DB (no base64)
- Images are compressed to max 1024px on the long edge before the Claude API call

---

### API Routes

| Route | Purpose |
|---|---|
| `POST /api/ai-agent/generate` | Full generation loop (text + images → Claude → backtest → auto-iterate → result) |
| `POST /api/ai-agent/refine` | Process follow-up prompt (Claude + backtest, no new session) |
| `POST /api/ai-agent/images` | Upload image to Supabase Storage, returns path |
| `GET /api/ai-agent/strategies` | Load saved strategies for the current user |
| `POST /api/ai-agent/strategies` | Save a strategy with a name |
| `DELETE /api/ai-agent/strategies/[id]` | Delete a strategy |

---

### Agent Workflow (Server-Side)

The full iteration loop runs server-side within a single `generate` request:

```
Client sends prompt + images
        │
        ▼
[1] Check rate limit (max 10 requests/hour/user)
        │
        ▼
[2] Compress images (max 1024px, server-side)
        │
        ▼
[3] Claude API — Iteration 1
        Agent decides: Mode A or Mode B?
        │
        ├── Mode A: validate params → run backtest directly
        └── Mode B: Python code → execute in sandbox → run backtest
                    (sandbox error counts as one iteration)
        │
        ▼
[4] Send backtest metrics to Claude
        "Profit Factor > 1.2 and Total Trades > 20?"
        │ yes → proceed to [6]
        │ no  →
        ▼
[5] Claude API — Iteration 2 (auto-refinement)
        Adjust strategy → sandbox → backtest
        │
        ▼
[6] Stream final result to client
        (metrics + strategy logic + code + iteration log)
```

**Streaming:** Client receives incremental updates via SSE (Server-Sent Events) — same technique used for backtest progress.

---

### Hybrid Output Modes in Detail

| | Mode A: Parameter Mapping | Mode B: Code Generation |
|---|---|---|
| **When** | Idea maps to existing strategy (Breakout, SMC, etc.) | New logic not covered by any existing plugin |
| **Claude output** | JSON with parameters | Python class |
| **Execution** | Directly in backtest engine | Sandbox first, then engine |
| **Risk** | Minimal | Sandbox isolation required |
| **Display** | Parameter badge list | Collapsible code block |

---

### Tech Decisions

| Decision | Why |
|---|---|
| Full loop in backend | Client-state across iterations would be error-prone; backend orchestrates atomically and can control retries |
| SSE instead of polling | Real-time updates without overhead; already used for backtest progress |
| Conversation history in React state only | Session history is ephemeral — only saved strategies go to DB; reduces complexity significantly |
| Images in Supabase Storage | Base64 in DB is too large and costly; storage paths are lightweight |
| Reuse sandbox from PROJ-22 | Don't build twice — PROJ-22 must be developed first |
| Track API costs | User transparency; useful for future rate limits or cost caps |

---

### New Dependencies

| Package | Purpose |
|---|---|
| `@anthropic-ai/sdk` | Claude API with Vision support (server-side) — already installed via PROJ-22 |
| `react-dropzone` | Drag & drop image upload |
| `sharp` | Server-side image compression (max 1024px) |

---

### Reused Components

- `src/components/backtest/configuration-panel.tsx` — Asset + date range selector
- `src/components/backtest/results-panel.tsx` — Inline results in the chat
- `src/components/backtest/metrics-summary-card.tsx`
- `src/components/backtest/equity-curve-chart.tsx`
- `src/components/backtest/trade-list-table.tsx`
- `src/components/auth/app-sidebar.tsx` — new "AI Agent" navigation entry
- Python sandbox infrastructure from PROJ-22

## QA Test Results
_To be added by /qa_

## Deployment
_To be added by /deploy_
