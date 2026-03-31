# PROJ-21: AI Strategy Generator

## Status: Planned
**Created:** 2026-03-25
**Last Updated:** 2026-03-25

## Dependencies
- Requires: PROJ-2 (Backtesting Engine) — generated strategies run inside the engine
- Requires: PROJ-3 (Time-Range Breakout Strategy) — reference for parameter-mapping path
- Requires: PROJ-6 (Strategy Library / Plugin System) — generated code strategies register as plugins
- Requires: PROJ-8 (Authentication) — page requires login
- Requires: PROJ-1 (Data Fetcher) — backtesting generated strategies needs cached market data
- External: Anthropic Claude API (claude-sonnet-4-6 with Vision support)

## Overview
A new "AI Agent" section of the platform where the user describes a trading strategy idea in plain language and optionally attaches chart screenshots (TradingView, hand-drawn sketches, or backtest results from other tools). An AI agent — framed as an expert trader, MQL developer, and Expert Adviser specialist — analyzes the input and generates a working strategy. The agent uses a hybrid output model: it maps the idea to an existing strategy's parameters if possible, or generates executable Python strategy code otherwise. The generated strategy is automatically backtested, and the agent self-iterates 1–2 rounds based on the results before presenting the final output to the user.

## Agent Persona (System Prompt)
The AI agent is framed as:
> "An expert algorithmic trader with 15+ years of experience in systematic trading, MQL4/MQL5 Expert Adviser development, and quantitative strategy research. You know all industry best practices for strategy design, risk management, and avoiding common pitfalls like look-ahead bias, curve-fitting, and overfitting. You always build rule-based, deterministic strategies that can be backtested reliably."

## Output Modes (Hybrid)

### Mode A: Parameter Mapping
Used when the user's idea clearly maps to an existing strategy (e.g., Breakout, SMC Price Action). Agent returns a JSON parameter object that is passed directly to the existing backtesting engine.

### Mode B: Python Code Generation
Used when the idea requires logic not covered by existing strategies. Agent generates a Python class implementing the strategy plugin interface. The code runs in a sandboxed subprocess with a 60-second timeout and restricted imports (only: pandas, numpy, ta-lib, math, datetime).

## Iteration Loop
After the first backtest result:
1. Agent receives the backtest metrics (Profit Factor, Win Rate, Sharpe, Total Trades, Max Drawdown)
2. Agent evaluates whether results meet a minimum quality threshold (Profit Factor > 1.2, Total Trades > 20)
3. If not: agent automatically refines the strategy (adjust SL/TP, filter conditions, parameter values) and runs a second backtest
4. Maximum 2 automatic iterations — then the result (good or not) is presented to the user
5. User can continue refining manually by sending follow-up messages in the same session

## User Stories
- As a trader, I want to describe a strategy idea in simple words so that I don't need programming knowledge to test it.
- As a trader, I want to attach TradingView screenshots or sketches so that the AI can understand visual patterns I've observed.
- As a trader, I want the AI to automatically backtest the generated strategy so that I can evaluate its performance immediately.
- As a trader, I want the agent to self-improve the strategy based on initial results so that I get a refined version without manual iteration.
- As a trader, I want to continue refining via follow-up prompts ("reduce the stop loss", "only trade during London session") so that I can steer the strategy iteratively.
- As a trader, I want to save a successful AI-generated strategy with a name so that I can re-run it later on different assets or time periods.
- As a trader, I want to see the generated strategy's logic explained in plain language alongside the backtest results so that I understand what the AI built.

## Acceptance Criteria

### AI Agent Page
- [ ] New "AI Agent" menu item in the sidebar navigation
- [ ] Text input area with placeholder: "Describe your trading strategy idea in your own words..."
- [ ] Drag & drop zone for screenshots (max 4 images, supported formats: PNG, JPG, WEBP, max 10 MB each)
- [ ] Image thumbnails shown after upload with option to remove individual images
- [ ] "Generate Strategy" button triggers the agent workflow
- [ ] A conversation-style history shows the user's inputs and agent responses in order
- [ ] Follow-up prompt field allows the user to send refinement instructions after seeing results

### Agent Workflow
- [ ] Request to Claude API includes: system prompt (expert persona), user text, and images (base64-encoded)
- [ ] Agent response includes: (1) strategy type decision (parameter mapping or code), (2) the parameters/code, (3) a plain-language explanation of the strategy logic
- [ ] If Mode A: parameters are validated against the target strategy's schema before backtesting
- [ ] If Mode B: generated Python code is executed in a sandboxed subprocess with restricted imports and a 60-second timeout
- [ ] Sandbox blocks: os, sys, subprocess, requests, socket, open, exec, eval, and all network/file access
- [ ] If sandbox execution fails (syntax error, timeout, forbidden import): agent is informed of the error and generates a corrected version (counted as one iteration)
- [ ] After first backtest, agent receives the results summary and decides whether to iterate
- [ ] Maximum 2 automatic iterations; then final result is shown regardless of quality

### Backtest Integration
- [ ] Generated strategy runs on the same asset and date range configured in the current Backtest panel
- [ ] If no backtest configuration is set, the AI Agent page prompts the user to select an asset and date range before generating
- [ ] Backtest progress is shown with the same streaming progress bar as PROJ-10
- [ ] Full backtest results (metrics + trade list + charts) are shown inline in the AI Agent conversation

### Strategy Persistence
- [ ] "Save Strategy" button appears after successful backtest
- [ ] User must provide a name before saving (max 100 characters)
- [ ] Saved strategies include: name, input prompt, attached image references, output type (params/code), parameters or code, strategy explanation, and linked backtest result
- [ ] Saved AI strategies are stored in Supabase with RLS (user-scoped)
- [ ] A "My AI Strategies" list shows all saved strategies with name, creation date, and last backtest result summary
- [ ] Saved strategies can be re-run on a different asset or date range
- [ ] Saved strategies can be deleted

### Transparency
- [ ] Every agent response includes a "Strategy Logic" section in plain language (not code)
- [ ] If the agent used Mode B (code generation), the generated Python code is shown in a collapsible code block
- [ ] Each iteration is visible in the conversation history (user can see what was changed between iterations)
- [ ] The number of Claude API calls made and approximate cost (in USD) is shown per session

## Edge Cases
- **Vague input ("make me a profitable strategy"):** Agent responds with a clarifying message asking for more specifics (asset class, time of day, indicator preference, etc.) before generating anything.
- **Screenshot contains no trading chart:** Agent informs the user that the image does not appear to be a chart and asks for a different image; generation can still proceed based on text alone.
- **Generated code causes infinite loop in sandbox:** The 60-second timeout terminates the process; agent is informed and attempts a fix in the next iteration.
- **Generated code produces 0 trades:** Agent receives this metric and adjusts entry conditions (looser filters, different parameters) in the next iteration.
- **API rate limit or Claude API error:** Show a user-friendly error message; do not retry automatically. User can retry manually.
- **User attaches 4 large images:** Total payload to Claude API may exceed limits; backend compresses/resizes images to max 1024px on the long edge before sending.
- **Follow-up prompt changes asset class:** Agent updates the strategy accordingly but warns the user that the saved strategy name should be updated to reflect the change.
- **Mode B code attempts to import a forbidden module:** Sandbox raises ImportError; this is caught, reported to the agent as an error, and counts as one iteration.

## Technical Requirements
- Security: Authentication required; generated code MUST run in sandbox — never executed directly in the main Python process
- Claude API key stored in server-side environment variable only (never exposed to the browser)
- Images uploaded by the user are stored temporarily in Supabase Storage for the session; only image references (not raw data) are stored in the database
- API route for agent calls must have a per-user rate limit (max 10 generation requests per hour) to control costs
- Total Claude API cost per session is calculated and stored alongside each saved strategy

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)

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
