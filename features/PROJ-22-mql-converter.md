# PROJ-22: MQL Converter

## Status: Deployed
**Created:** 2026-03-25
**Last Updated:** 2026-04-02

## Dependencies
- Requires: PROJ-2 (Backtesting Engine) — converted strategies run inside the engine
- Requires: PROJ-6 (Strategy Library / Plugin System) — converted strategies register as plugins
- Requires: PROJ-8 (Authentication) — page requires login
- Requires: PROJ-21 (AI Strategy Generator) — shares sandbox execution infrastructure and Claude API integration
- Requires: PROJ-30 (Continuous Trailing Stop & Partial Close) — trailing stop and partial close from MQL EAs are mapped to PROJ-30 per-signal engine columns
- External: Anthropic Claude API (claude-sonnet-4-6)

## Overview
A dedicated "MQL Converter" page where the user pastes MQL4 or MQL5 Expert Adviser code. An AI agent (Claude API), acting as an expert MQL developer, translates the code into a Python strategy class compatible with the platform's backtesting engine. The converted strategy is automatically backtested against Dukascopy historical data. Broker-specific MQL functions that cannot be mapped are replaced with best-effort approximations and documented in a warning list. Successful conversions can be saved and re-run on different assets and time periods.

## Supported MQL Function Mappings

### Signal / Indicator Functions
| MQL Function | Python Equivalent |
|---|---|
| `iMA(symbol, tf, period, shift, method, price)` | `pandas_ta.ema()` / `sma()` / `wma()` |
| `iRSI(symbol, tf, period, price)` | `pandas_ta.rsi()` |
| `iMACD(...)` | `pandas_ta.macd()` |
| `iATR(symbol, tf, period)` | `pandas_ta.atr()` |
| `iBands(...)` | `pandas_ta.bbands()` |
| `iCCI(...)` | `pandas_ta.cci()` |
| `iStochastic(...)` | `pandas_ta.stoch()` |
| `iHigh`, `iLow`, `iOpen`, `iClose`, `iVolume` | DataFrame column access |

### Order Management Functions
| MQL Function | Mapping |
|---|---|
| `OrderSend(BUY/SELL, lots, price, sl, tp)` | Engine `open_trade(direction, sl, tp)` — lot size is ignored; engine sizing_mode handles it |
| `OrderClose(ticket, lots, price)` | Engine `close_trade()` |
| `OrderModify(ticket, price, sl, tp)` | Engine `update_sl_tp(sl, tp)` |
| `OrdersTotal()` | Engine `has_open_position()` |

### Trailing Stop & Partial Close (via PROJ-30 per-signal columns)
The engine natively supports both features. The converted strategy sets these columns in signals_df — no manual configuration needed.

| MQL Pattern | signals_df Column | Value |
|---|---|---|
| `trade.PositionModify` / `InpUseTrailing=true` | `trail_type` | `'continuous'` |
| `InpTrailStartR` (e.g. 1.0) × SL pips | `trail_trigger_pips` | float: pip distance to start trailing |
| `InpTrailDistancePips` (e.g. 250) | `trail_distance_pips` | float: distance of trailing SL from price |
| `InpTrailDontCrossEntry=true` | `trail_dont_cross_entry` | `1.0` |
| `ClosePartialByDeal` / `InpUsePartialTP=true` | `partial_close_pct` | float: e.g. `40.0` for 40% |
| `InpPartialAtR` (e.g. 1.0) | `partial_at_r` | float: R-multiple trigger |
| Fixed pip trigger | `partial_at_pips` | float: pip distance trigger (takes priority over partial_at_r) |

### Event Handlers
| MQL Handler | Mapping |
|---|---|
| `OnTick()` | Converted to bar-by-bar iteration |
| `OnInit()` | Strategy `__init__()` |
| `OnDeinit()` | Strategy cleanup (no-op if empty) |

### Broker-Specific (Best-Effort / Warning)
The following are approximated or flagged as unsupported:
- `MarketInfo(SYMBOL_SPREAD)` / `SymbolInfoInteger(SYMBOL_SPREAD)` — not available in backtesting; spread filter is skipped (documented in warning)
- `OrderProfit()`, `OrderSwap()` — not available; trade P&L calculated by engine at close
- Custom tick-based logic (`OnTick` with < 1-minute resolution) — downgraded to 1-minute bars; warning issued
- `SendMail()`, `Alert()`, `PlaySound()` — ignored with warning
- `OnTradeTransaction` — approximated by tracking placed dates in a Python set; documented in warning

The following are **NOT** approximated (engine handles them natively — no warnings generated):
- `AccountBalance()`, `AccountEquity()` — engine uses `initial_balance` + `sizing_mode` config
- `SymbolInfoDouble(SYMBOL_TRADE_TICK_VALUE/TICK_SIZE)` — engine uses `pip_value_per_lot` from instrument config
- `SymbolInfoDouble(SYMBOL_VOLUME_MIN/MAX/STEP)` — engine applies its own lot constraints
- Lot size calculation — engine handles via `sizing_mode`, `risk_percent`, `fixed_lot`
- `trade.PositionModify` (trailing stop) — mapped to PROJ-30 per-signal columns (see above)
- `ClosePartialByDeal` (partial close) — mapped to PROJ-30 per-signal columns (see above)

## User Stories
- As a trader, I want to paste my MQL4/MQL5 Expert Adviser code and receive a working Python backtest so that I can evaluate the strategy on historical Dukascopy data without MetaTrader.
- As a trader, I want to see a clear list of which MQL functions were converted and which were approximated or skipped so that I understand the accuracy of the conversion.
- As a trader, I want the converted strategy to be automatically backtested so that I don't need extra steps to see the results.
- As a trader, I want to save a successful conversion with a name so that I can re-run it on different assets or date ranges later.
- As a trader, I want to see the generated Python code in a collapsible code block so that I can review and understand what the AI produced.
- As a trader, I want to be warned if the conversion is likely inaccurate (many unsupported functions) so that I don't make decisions based on unreliable results.

## Acceptance Criteria

### MQL Converter Page
- [ ] New "MQL Converter" menu item in the sidebar navigation
- [ ] Large code input area (syntax-highlighted, monospace font) with placeholder: "Paste your MQL4 or MQL5 Expert Adviser code here..."
- [ ] MQL version selector (MQL4 / MQL5 / Auto-detect) — auto-detect inspects for `#property strict` or MQL5-specific syntax
- [ ] Asset and date range selector (same as backtest configuration) for the automatic backtest
- [ ] "Convert & Backtest" button triggers the full workflow

### Conversion Workflow
- [ ] MQL code is sent to Claude API with a system prompt framed as an expert MQL-to-Python conversion specialist
- [ ] Agent returns: (1) Python strategy class code, (2) function mapping report, (3) list of unsupported/approximated functions with explanations
- [ ] If unsupported functions are detected: conversion proceeds (best-effort) and a yellow warning banner lists each affected function with its approximation or omission reason
- [ ] If more than 50% of order management functions are unsupported: a red warning is shown stating "This conversion may produce significantly different results from the original EA"
- [ ] Generated Python code runs in the same sandbox as PROJ-21 (restricted imports, 60-second timeout)
- [ ] If sandbox execution fails: error message shown with the Claude-identified reason; user can retry after editing the code manually

### Backtest Integration
- [ ] Converted strategy is automatically backtested on the selected asset and date range immediately after successful conversion
- [ ] Backtest progress shown with streaming progress bar (same as PROJ-10)
- [ ] Full results displayed: metrics, trade list, equity curve

### Code Review Panel
- [ ] Generated Python code shown in a collapsible code block below the results
- [ ] Function mapping report shown as a table: MQL function → Python equivalent / approximation / unsupported
- [ ] User can manually edit the Python code in the browser and re-run the backtest without re-converting

### Strategy Persistence
- [ ] "Save Conversion" button appears after successful backtest
- [ ] User must provide a name (max 100 characters)
- [ ] Saved conversions store: name, original MQL code, MQL version, generated Python code, mapping report, backtest result, and creation date
- [ ] Saved in Supabase with RLS (user-scoped)
- [ ] "My Conversions" list shows all saved items with name, date, and last backtest metrics summary
- [ ] Saved conversions can be re-run on a different asset or date range
- [ ] Saved conversions can be deleted

## Edge Cases
- **Empty or non-MQL code pasted:** Before calling Claude API, a basic check detects if the input contains MQL keywords (`void OnTick`, `OrderSend`, `#property`). If not found, user sees: "This does not appear to be MQL code. Please paste a valid EA."
- **EA uses custom includes (#include):** Included files are not provided. Agent is informed and either inlines assumed logic or flags the included functions as unsupported.
- **EA uses global variables or static variables across ticks:** Translated to Python instance variables; agent documents this in the mapping report.
- **OnTick logic depends on sub-minute events:** Downgraded to 1-minute bar resolution with a warning that results may differ from live trading.
- **Extremely long EA (> 500 lines):** Claude API has context limits. If the code exceeds ~400 lines, the user is warned that very large EAs may result in incomplete conversions and is asked to split the EA if possible.
- **Conversion produces 0 trades:** Shown in results; user can manually edit the Python code and re-run.
- **Claude API error or timeout:** User sees a friendly error and a "Retry" button; no automatic retry.
- **User edits generated Python code and introduces syntax errors:** Sandbox catches the error and shows the traceback; backtest does not run.

## Technical Requirements
- Security: Authentication required; generated code executed in sandbox only (same infrastructure as PROJ-21, never in main Python process)
- Claude API key stored server-side only
- Rate limit: max 10 conversion requests per user per hour
- MQL code submitted by the user must be sanitized before being included in the Claude API prompt (strip null bytes, limit to 50,000 characters max)
- The manual code edit + re-run feature must not call Claude API again — only re-runs the sandbox + backtest

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)

### Dependency Note
PROJ-21 (AI Strategy Generator) is listed as a dependency because both features share a **Python sandbox** and **Claude API integration**. Since PROJ-21 is still Planned, PROJ-22 will build the sandbox infrastructure first — PROJ-21 will reuse it.

---

### Page Structure (Visual Tree)

```
/mql-converter  (new page, login required)
+-- Tabs: "Converter" | "My Conversions"
|
+-- [Tab: Converter]
|   +-- Input Panel
|   |   +-- MQL Code Textarea (large, monospace font)
|   |   +-- MQL Version Selector (Auto / MQL4 / MQL5)
|   |   +-- Asset & Date Range Selector (reused from backtest)
|   |   +-- "Convert & Backtest" Button
|   |
|   +-- Warning Banners (appear after conversion)
|   |   +-- Yellow: list of approximated functions
|   |   +-- Red: > 50% order management unsupported
|   |   +-- Blue: info about special EA patterns (#include, etc.)
|   |
|   +-- Progress Bar (while backtest runs)
|   |
|   +-- Results Panel (reused from backtest)
|   |   +-- Metrics Summary
|   |   +-- Equity Curve
|   |   +-- Trade List
|   |
|   +-- Code Review Panel (collapsible, appears after conversion)
|   |   +-- Generated Python Code (editable, syntax-highlighted)
|   |   +-- "Re-run Backtest" Button (no Claude API call)
|   |   +-- Function Mapping Table (MQL → Python / Approximation / Unsupported)
|   |
|   +-- "Save Conversion" Button + Name Input
|
+-- [Tab: My Conversions]
    +-- Conversions List
        +-- Conversion Card (name, date, asset, key metrics)
        +-- "Re-run" Button (loads code into Converter tab)
        +-- "Delete" Button
```

---

### Data Model (Plain Language)

**Table: `mql_conversions`**

Each saved conversion stores:
- Unique ID
- Owning user (user-scoped via RLS)
- Name (max 100 characters)
- Original MQL code (max 50,000 characters)
- MQL version (mql4 / mql5 / auto)
- Generated Python code
- Mapping report (JSON: list of MQL functions with status and Python equivalent)
- Last backtest result (JSON: metrics + trade count)
- Created timestamp

**Rate-limit tracking:** Server-side counter (max 10 conversions per user per hour). No separate DB table needed — tracked via a timestamp-windowed query on the conversions table.

---

### API Routes

| Route | Purpose |
|---|---|
| `POST /api/mql-converter/convert` | Send MQL code to Claude API → return Python code + mapping report |
| `POST /api/mql-converter/run` | Execute Python code in sandbox + run backtest |
| `GET /api/mql-converter/saves` | Load all saved conversions for the current user |
| `POST /api/mql-converter/saves` | Save a conversion with a name |
| `DELETE /api/mql-converter/saves/[id]` | Delete a saved conversion |

---

### Python Sandbox (New Infrastructure)

The sandbox is the critical new building block — an isolated Python execution environment:

- **Isolation:** Generated code runs in a separate Python subprocess, never in the main process
- **Import whitelist:** Only allowed imports (pandas, pandas_ta, numpy) — all others blocked
- **Timeout:** 60-second maximum execution time
- **No network access** from the sandbox process

This infrastructure is built as part of PROJ-22 and will be reused by PROJ-21.

---

### Conversion Workflow (Steps)

```
User clicks "Convert & Backtest"
        │
        ▼
[1] Frontend: MQL keyword check (local validation)
        │ invalid → error message, no API call
        ▼
[2] API /convert: check rate limit (max 10/hour)
        │ exceeded → 429 error
        ▼
[3] Sanitize MQL code (strip null bytes, cap at 50,000 chars)
        │
        ▼
[4] Call Claude API (server-side only, API key never in browser)
        │ → Returns: Python code + mapping report + warning list
        ▼
[5] Evaluate warnings and display banners
        │
        ▼
[6] API /run: execute Python code in sandbox + run backtest
        │ error → show traceback, "Retry" button
        ▼
[7] Display results (metrics, equity curve, trade list)
```

---

### Tech Decisions

| Decision | Why |
|---|---|
| Claude API called server-side only | API key must never reach the browser — security requirement |
| Reuse existing backtest components | `configuration-panel`, `results-panel`, `trade-list-table` already exist — no duplication |
| MQL keyword check in frontend | Prevents unnecessary Claude API calls for obviously invalid input |
| Mapping report stored as JSON in DB | Flexible for querying; can be used for analytics later |
| Re-run skips Claude API | Saves API costs; user edits Python only, not MQL |

---

### New Dependencies

| Package | Purpose |
|---|---|
| `@anthropic-ai/sdk` | Claude API (server-side) |
| `@monaco-editor/react` or `react-syntax-highlighter` | Syntax highlighting for MQL and Python code |

---

### Reused Components

- `src/components/backtest/configuration-panel.tsx` — Asset + date range selector
- `src/components/backtest/results-panel.tsx` — Metrics, charts, trade list
- `src/components/backtest/metrics-summary-card.tsx`
- `src/components/backtest/equity-curve-chart.tsx`
- `src/components/backtest/trade-list-table.tsx`
- `src/components/auth/app-sidebar.tsx` — new navigation entry

## QA Test Results (Re-Test)

**Tested:** 2026-04-02 (Re-test after bug fixes)
**App URL:** http://localhost:3000
**Tester:** QA Engineer (AI)
**Build Status:** PASS (alle API-Routen und Page korrekt kompiliert)
**Lint Status:** 3 Errors (1 in convert/route.ts, 2 in MQL-Komponenten)

---

### Acceptance Criteria Status

#### AC-1: MQL Converter Page
- [x] "MQL Converter" Menu-Eintrag in der Sidebar vorhanden (`app-sidebar.tsx` Zeile 51)
- [x] Grosses Code-Eingabefeld mit Monospace-Font und Placeholder "Paste your MQL4 or MQL5 Expert Adviser code here..."
- [x] MQL Version Selector (Auto-detect / MQL4 / MQL5) vorhanden und funktional
- [x] Auto-detect erkennt MQL5-spezifische Keywords (CTrade, PositionSelect, etc.)
- [x] Asset und Date Range Selector vorhanden (wiederverwendet AssetCombobox)
- [x] "Convert & Backtest" Button vorhanden und korrekt deaktiviert waehrend Ausfuehrung

#### AC-2: Conversion Workflow
- [x] MQL-Code wird an Claude API gesendet mit System-Prompt als MQL-zu-Python-Spezialist
- [x] Agent liefert: Python-Code, Mapping-Report, Warnings
- [x] Gelber Warning-Banner bei approximierten Funktionen
- [x] Roter Warning-Banner bei >50% unsupported Order-Management-Funktionen
- [x] Python-Code laeuft in isoliertem Subprocess (Sandbox via `_SANDBOX_RUN_SCRIPT`)
- [x] Fehler bei Sandbox-Ausfuehrung zeigt Traceback und Retry-Button

#### AC-3: Backtest Integration
- [x] Konvertierte Strategie wird automatisch auf gewaehltem Asset/Zeitraum backtested
- [ ] **TEILWEISE:** Streaming-Progressbar ist ein deterministischer 3-Step-Fortschritt (25%/55%/80%) statt echtem Streaming wie in PROJ-10 spezifiziert — akzeptabel laut vorherigem QA-Entscheid (BUG-5 entfernt)
- [x] Volle Ergebnisse: Metriken, Trade-Liste, Equity-Curve via wiederverwendetem ResultsPanel

#### AC-4: Code Review Panel
- [x] Python-Code in einklappbarem Bereich unterhalb der Ergebnisse
- [x] Mapping-Report als Tabelle: MQL-Funktion -> Python Equivalent / Status / Note
- [x] Code ist manuell editierbar und Re-run Button ueberspringt Claude API

#### AC-5: Strategy Persistence
- [x] "Save Conversion" Button erscheint nach erfolgreichem Backtest
- [x] Name-Eingabe mit max 100 Zeichen Limit (DB-Constraint + Frontend-Limit)
- [x] Gespeichert werden: Name, MQL-Code, MQL-Version, Python-Code, Mapping-Report, Backtest-Result, created_at
- [x] RLS auf `mql_conversions`-Tabelle: SELECT, INSERT, UPDATE, DELETE nur fuer eigenen user_id
- [x] "My Conversions" Liste zeigt Name, Datum, MQL-Version-Badge und Backtest-Metriken
- [x] Gespeicherte Conversions koennen geladen und auf anderem Asset/Zeitraum neu ausgefuehrt werden
- [x] Loeschen mit AlertDialog-Bestaetigung

---

### Edge Cases Status

#### EC-1: Leerer oder nicht-MQL Code
- [x] Frontend-Validierung prueft auf MQL-Keywords (OnTick, OrderSend, #property)
- [x] Server-seitige Validierung wiederholt die Pruefung (`looksLikeMqlCode`)
- [x] Fehlermeldung: "This does not appear to be MQL code."

#### EC-2: EA mit #include
- [x] System-Prompt informiert Claude ueber fehlende Includes; Agent markiert betroffene Funktionen

#### EC-3: Globale/statische Variablen
- [x] System-Prompt weist Claude an, diese in Instance-Variablen zu konvertieren

#### EC-4: Sub-Minute OnTick-Logik
- [x] System-Prompt: "OnTick() -> converted to bar-by-bar iteration"
- [x] Warning bei Approximation wird in Mapping-Report dokumentiert

#### EC-5: Sehr langer EA (>500 Zeilen)
- [x] Bei >400 Zeilen wird ein Warning in die Response eingefuegt
- [x] Harte Grenze bei 50.000 Zeichen (Zod-Validierung + DB-Constraint)

#### EC-6: Conversion erzeugt 0 Trades
- [x] Ergebnis wird angezeigt (leere Trade-Liste, Metriken zeigen 0 Trades)

#### EC-7: Claude API Fehler/Timeout
- [x] Fehler-Meldung wird angezeigt mit Retry-Button
- [x] Claude 429-Fehler wird als "AI service overloaded" angezeigt
- [x] Claude 401-Fehler wird als "AI service authentication failed" angezeigt

#### EC-8: Syntax-Fehler nach manuellem Edit
- [x] Sandbox erkennt SyntaxError und zeigt Traceback; Backtest laeuft nicht

---

### Security Audit Results

#### Authentifizierung & Autorisierung
- [x] Alle API-Routen pruefen Authentication via `supabase.auth.getUser()`
- [x] /convert, /run, /saves (GET/POST), /saves/[id] (DELETE) — alle auth-geschuetzt
- [x] FastAPI `/sandbox/run` Endpoint prueft JWT via `verify_jwt` Dependency
- [x] RLS auf `mql_conversions`-Tabelle mit Policies fuer alle 4 CRUD-Operationen
- [x] Cache-Zugriff in Sandbox prueft `created_by = user_id` (Zeile 2376)
- [x] DELETE Route prueft sowohl UUID-Format als auch `user_id` Match

#### API-Schluessel Sicherheit
- [x] `ANTHROPIC_API_KEY` nur in `process.env` (server-seitig), kein `NEXT_PUBLIC_` Prefix
- [x] API-Key korrekt in `.env.local.example` dokumentiert mit Hinweis "Server-side only"

#### Input Validation & Sanitization
- [x] Zod-Schema fuer Convert: `mql_code` max 50.000 Zeichen
- [x] Zod-Schema fuer Run: Python-Code, UUID cache_id, Backtest-Config validiert
- [x] Zod-Schema fuer Save: Name max 100 Zeichen, MQL-Code max 50.000
- [x] Null-Byte Stripping: `mqlCode.replace(/\x00/g, "")` in convert/route.ts
- [x] UUID-Format Validierung in DELETE Route

#### Sandbox Sicherheit
- [x] AST Import-Whitelist: nur pandas, pandas_ta, numpy erlaubt
- [x] Blocked Names: `__import__`, `exec`, `eval`, `compile`, `__builtins__`, `open`
- [x] Code laeuft in separatem Subprocess (nicht im FastAPI-Hauptprozess)
- [x] 30-Sekunden Timeout fuer Validierung, 60-Sekunden Timeout fuer Ausfuehrung
- [x] Temporaere Dateien werden im `finally`-Block bereinigt
- [ ] **BUG-11 (Medium):** Sandbox-Subprocess hat Netzwerkzugriff — Spec fordert "No network access" (Zeile 205), aber der Subprocess erbt die Netzwerk-Capabilities des Elternprozesses. Es gibt keine OS-Level Netzwerkisolierung (keine `seccomp`, kein `unshare`, kein Docker).
- [ ] **BUG-12 (Medium):** Sandbox-Subprocess kann ueber `os`-Modul (via numpy/pandas Imports) auf das Dateisystem zugreifen. `os` ist nicht in `_SANDBOX_BLOCKED_NAMES`, und da numpy importiert wird, kann Code wie `numpy.os.system("...")` oder `pandas.io.common.os.listdir("/")` Dateisystem-Operationen ausfuehren. Die AST-Pruefung faengt nur direkte `import os` ab, nicht den Zugriff ueber bereits importierte Module.
- [ ] **BUG-13 (Low):** `_SANDBOX_RUN_SCRIPT` fuegt `sys.path.insert(0, project_root)` hinzu — der User-Code kann damit auch andere Python-Module im Projektverzeichnis importieren (z.B. `from services import *`). Die AST-Pruefung blockiert nur Top-Level Imports ausserhalb der Whitelist, aber `from strategies.base import BaseStrategy` ist absichtlich erlaubt. Allerdings koennte User-Code `from services.cache_service import ...` aufrufen, was Zugriff auf interne Service-Logik ermoeglichen wuerde.

#### Rate Limiting
- [x] Convert API: max 10 Conversions pro User pro Stunde via `check_rate_limit` RPC
- [x] Sandbox API: max 30 Requests pro Minute via `_check_backtest_rate_limit`
- [x] Rate-Limit Fehler gibt 429 mit Retry-After Header zurueck
- [ ] **BUG-14 (Low):** Wenn `check_rate_limit` RPC fehlschlaegt (Zeile 100-103 in convert/route.ts), wird der Fehler nur geloggt und die Anfrage trotzdem durchgelassen. Sicherer waere es, bei RPC-Fehlern die Anfrage zu blockieren.

#### Datenlecks
- [x] Keine sensiblen Daten in API-Responses
- [x] Traceback bei Sandbox-Fehlern zeigt nur User-Code-bezogene Fehler
- [x] Claude API Raw-Response wird bei Parsing-Fehlern auf 500 Zeichen begrenzt

---

### Lint-Probleme (Neu gefunden im Re-Test)

#### BUG-15 (Low): Lint Error in convert/route.ts
- **Datei:** `src/app/api/mql-converter/convert/route.ts` Zeile 133
- **Problem:** `let mqlCode` wird nie reassigned, sollte `const` sein
- **Auswirkung:** Kein funktionales Problem, nur Code-Qualitaet

#### BUG-16 (Low): Lint Errors in MQL-Komponenten (setState in useEffect)
- **Dateien:** `src/components/mql-converter/code-review-panel.tsx` (Zeile 72), `src/components/mql-converter/save-conversion-section.tsx` (Zeile 25)
- **Problem:** `setState` direkt in `useEffect` Body kann kaskadierende Re-Renders verursachen
- **Auswirkung:** Potenzielle Performance-Probleme, kein funktionaler Bug

---

### Bugs Zusammenfassung (Neu gefunden im Re-Test)

#### BUG-11: Sandbox hat Netzwerkzugriff — **FIXED 2026-04-02**
- `socket.socket`, `socket.create_connection`, `socket.getaddrinfo` im Sandbox-Script auf Exception-Raiser überschrieben.

#### BUG-12: Sandbox Dateisystem-Zugriff über Module-Attribute — **FIXED 2026-04-02**
- `os` und `subprocess` Attribute werden nach dem Import von `numpy`/`pandas` via `delattr` entfernt.

#### BUG-13: Sandbox kann interne Projekt-Module importieren — **FIXED 2026-04-02**
- `sys.path.remove(project_root)` direkt nach `from strategies.base import BaseStrategy` in `_SANDBOX_RUN_SCRIPT` und `_SANDBOX_VALIDATE_SCRIPT`.

#### BUG-14: Rate-Limit Fehlerbehandlung zu nachgiebig — **FIXED 2026-04-02**
- RPC-Fehler gibt jetzt `503` zurück statt die Anfrage durchzulassen.

#### BUG-15: Lint Error — prefer-const — **FIXED 2026-04-02**
- `let mqlCode` → `const mqlCode` in `convert/route.ts`.

#### BUG-16: Lint Errors — setState in useEffect — **FIXED 2026-04-02**
- `useEffect + setState` durch React "adjusting state during render" Pattern ersetzt in `code-review-panel.tsx` und `save-conversion-section.tsx`.

#### BUG-17: `pandas_ta` nicht installiert — **FIXED 2026-04-07**
- **Problem:** System-Prompt instruierte Claude, `import pandas_ta as ta` immer einzufügen, auch wenn keine Indikatoren verwendet werden. `pandas_ta` fehlte in `python/requirements.txt`. → `ModuleNotFoundError` bei jeder Sandbox-Validierung.
- **Fix:** `pandas_ta==0.3.14b0` zu `requirements.txt` hinzugefügt. System-Prompt aktualisiert: `import pandas_ta as ta` nur wenn die Strategie tatsächlich Indikatorfunktionen verwendet.

#### BUG-18: `params=None` führt zu `AttributeError` — **FIXED 2026-04-07**
- **Problem:** `_SANDBOX_RUN_SCRIPT` rief `strategy.generate_signals(df, None)` auf. Generierter Code verwendet `params.get(...)` → `AttributeError: 'NoneType' object has no attribute 'get'`.
- **Fix:** `generate_signals(df, None)` → `generate_signals(df, {})` in `_SANDBOX_RUN_SCRIPT` (`python/main.py`). System-Prompt schreibt zusätzlich `params = params or {}` als erste Zeile in `generate_signals` vor.

#### BUG-19: Trailing Stop & Partial Close als "Unsupported" markiert — **FIXED 2026-04-07**
- **Problem:** System-Prompt erklärte Trailing Stop und Partial Close für nicht replizierbar. PROJ-30 hat diese Features aber bereits in der Engine via per-Signal-Spalten (`trail_type`, `trail_distance_pips`, `trail_dont_cross_entry`, `partial_close_pct`, `partial_at_r`) implementiert.
- **Fix:** System-Prompt vollständig überarbeitet: Claude mappt Trailing Stop auf `trail_type='continuous'` + Engine-Spalten, Partial Close auf `partial_close_pct` + `partial_at_r`/`partial_at_pips`. Status beider Mappings: "mapped" statt "unsupported".

#### BUG-20: Unnötige Lot-Sizing-Warnungen — **FIXED 2026-04-07**
- **Problem:** System-Prompt instruierte Claude, Lot-Sizing-Logik aus `AccountBalance`, `SymbolInfoDouble(SYMBOL_TRADE_TICK_VALUE)`, `SYMBOL_VOLUME_MIN/MAX/STEP` zu replizieren. Die Engine ignoriert jedoch alle berechneten Lot-Größen (kein `lot_size`-Feld in signals_df) und verwendet ausschließlich `sizing_mode`/`risk_percent`/`fixed_lot` aus BacktestConfig. Ergebnis: falscher Code + irreführende Approximations-Warnungen.
- **Fix:** System-Prompt: "DO NOT calculate lot sizes. Engine handles sizing." Entsprechende Mapping-Einträge und Warnungen werden nicht mehr generiert.

---

### Verifizierung der frueheren Bugs (BUG-1 bis BUG-10)

| Bug | Status | Verifizierung |
|-----|--------|---------------|
| BUG-1 (Rate Limit) | VERIFIED FIXED | `check_rate_limit` RPC in Supabase, korrekt in convert/route.ts integriert |
| BUG-2 (Import Bypass) | VERIFIED FIXED | `_SANDBOX_BLOCKED_NAMES` blockiert `__import__`, `exec`, `eval`, `compile`, `__builtins__`, `open` |
| BUG-3 (Sandbox Isolation) | VERIFIED FIXED | Code laeuft in `subprocess.run()` mit tempfiles, nicht in-process |
| BUG-4 (Auto-Detect) | VERIFIED FIXED | `detectMqlVersion()` mit MQL5-Keywords, Badge zeigt erkannte Version |
| BUG-5 (Streaming) | VERIFIED ENTFERNT | Deterministischer Progress (25/55/80%) statt Streaming — akzeptiert |
| BUG-6 (Metriken in Liste) | VERIFIED FIXED | `backtest_result` wird selektiert und Metriken angezeigt |
| BUG-7 (Load skip Claude) | VERIFIED FIXED | `preloadedPythonCode` ueberspringt Claude API Call |
| BUG-8 (Retry Button) | VERIFIED FIXED | Retry-Button in Error-Alert, ruft `handleSubmit(lastInputValues)` auf |
| BUG-9 (Loeschbestaetigung) | VERIFIED FIXED | `AlertDialog` mit Confirm/Cancel |
| BUG-10 (Default Name Reset) | VERIFIED FIXED | `useEffect` auf `defaultName` setzt Name und saved-State zurueck |

---

### Cross-Browser & Responsive (Code-Review basiert)

| Aspekt | Status | Anmerkung |
|--------|--------|-----------|
| Chrome | Erwartung: PASS | Standard shadcn/ui Komponenten, keine browser-spezifischen APIs |
| Firefox | Erwartung: PASS | Kein `date` Input Polyfill noetig (native Support seit Firefox 57) |
| Safari | Erwartung: PASS | shadcn/ui Komponenten sind Safari-kompatibel |
| Mobile 375px | [x] PASS | `grid-cols-1` Layout auf kleinen Screens, Input-Panel stacked |
| Tablet 768px | [x] PASS | Gleicher Grid wie mobile bis `xl` Breakpoint |
| Desktop 1440px | [x] PASS | `xl:grid-cols-[400px_1fr]` Two-Column Layout, sticky Input-Panel |

---

### Summary

- **Acceptance Criteria:** 25/26 bestanden (1 teilweise: Streaming-Progressbar durch deterministischen Fortschritt ersetzt)
- **Bugs BUG-1 bis BUG-16:** Alle behoben (9 aus erstem QA-Lauf, 6 aus Re-Test, 1 bewusst entfernt)
- **Security:** Alle Medium-Findings behoben (Sandbox Netzwerk + Dateisystem + interne Module blockiert)
- **Lint:** Keine Errors
- **Production Ready:** JA

### Relevante Dateien

- Sandbox: `python/main.py` (ab Zeile 2198)
- Rate-Limit-Migration: `supabase/migrations/20260402_rate_limit.sql`
- Conversions-Migration: `supabase/migrations/20260401_mql_conversions.sql`
- Convert API: `src/app/api/mql-converter/convert/route.ts`
- Run API: `src/app/api/mql-converter/run/route.ts`
- Saves API: `src/app/api/mql-converter/saves/route.ts`
- Delete API: `src/app/api/mql-converter/saves/[id]/route.ts`
- Hook: `src/hooks/use-mql-converter.ts`
- Page: `src/app/(dashboard)/mql-converter/page.tsx`
- Komponenten: `src/components/mql-converter/`

## Deployment

**Deployed:** 2026-04-02 (initial) / **Updated:** 2026-04-07 (BUG-17–20)
**Git Tag:** `v1.22.0-PROJ-22`
**Commit:** `1468f93` (initial)
**Supabase Migrations Applied:**
- `20260401_mql_conversions` — `mql_conversions` table with RLS
- `20260402_rate_limit` — `rate_limit_log` table + `check_rate_limit()` RPC

**Environment Variables Required (Vercel):**
- `ANTHROPIC_API_KEY` — Claude API key (server-side only)
