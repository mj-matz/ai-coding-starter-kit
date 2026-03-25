# PROJ-22: MQL Converter

## Status: Planned
**Created:** 2026-03-25
**Last Updated:** 2026-03-25

## Dependencies
- Requires: PROJ-2 (Backtesting Engine) — converted strategies run inside the engine
- Requires: PROJ-6 (Strategy Library / Plugin System) — converted strategies register as plugins
- Requires: PROJ-8 (Authentication) — page requires login
- Requires: PROJ-21 (AI Strategy Generator) — shares sandbox execution infrastructure and Claude API integration
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
| `OrderSend(BUY/SELL, lots, price, sl, tp)` | Engine `open_trade(direction, sl, tp)` |
| `OrderClose(ticket, lots, price)` | Engine `close_trade()` |
| `OrderModify(ticket, price, sl, tp)` | Engine `update_sl_tp(sl, tp)` |
| `OrdersTotal()` | Engine `has_open_position()` |

### Event Handlers
| MQL Handler | Mapping |
|---|---|
| `OnTick()` | Converted to bar-by-bar iteration |
| `OnInit()` | Strategy `__init__()` |
| `OnDeinit()` | Strategy cleanup (no-op if empty) |

### Broker-Specific (Best-Effort / Warning)
The following are approximated or flagged as unsupported:
- `AccountBalance()`, `AccountEquity()` — approximated from initial capital parameter
- `MarketInfo(SYMBOL_SPREAD)` — fixed spread assumption (documented in warning)
- `OrderProfit()`, `OrderSwap()` — not available; trade P&L calculated by engine at close
- Custom tick-based logic (`OnTick` with < 1-minute resolution) — downgraded to 1-minute bars; warning issued
- `SendMail()`, `Alert()`, `PlaySound()` — ignored with warning

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
_To be added by /architecture_

## QA Test Results
_To be added by /qa_

## Deployment
_To be added by /deploy_
