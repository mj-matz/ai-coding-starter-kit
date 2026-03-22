# PROJ-16: Configurable Entry Offset (Pip Distance to Range)

## Status: Planned
**Created:** 2026-03-22
**Last Updated:** 2026-03-22

## Dependencies
- Requires: PROJ-3 (Time-Range Breakout Strategy) — entry_offset_pips lives in BreakoutParams
- Requires: PROJ-5 (Backtest UI) — configuration panel where the new input field will appear

## Problem Statement
The entry offset (how many pips above/below the range boundary the entry order is placed) is currently hardcoded and not configurable via the UI. Traders may want:
- **0 pips** — entry exactly at the range boundary (current default after PROJ-16 fix)
- **1–2 pips** — small buffer to reduce false breakouts
- **10+ pips** — wider buffer for volatile instruments

## User Stories
- As a trader, I want to configure how many pips above the range high (or below the range low) my entry order is placed, so that I can fine-tune breakout confirmation for different instruments and volatility regimes.

## Acceptance Criteria
- [ ] A numeric input "Entry Offset (Pips)" is added to the Backtest Configuration UI under the strategy parameters section.
- [ ] The field accepts values ≥ 0 with step 0.1; default is 0.
- [ ] The value is passed through the Next.js API route → FastAPI → `BreakoutParams.entry_offset_pips`.
- [ ] Setting offset to 0 places the entry order exactly at the range boundary (no buffer).
- [ ] Setting offset to 2 places the entry order 2 pips above range high / 2 pips below range low.
- [ ] Existing backtests that omit the field default to 0 (backward compatible).

## Scope
**In scope:**
- Frontend input field in `strategy-params.tsx`
- TypeScript type addition in `backtest-types.ts`
- Zod schema update in `src/app/api/backtest/route.ts`
- FastAPI request model update in `python/main.py` (`BacktestOrchestrationRequest`)
- Pass value to `BreakoutParams` construction in `python/main.py`

**Out of scope:**
- Per-direction offsets (same offset applies to long and short)
- Offset as percentage of range size

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)
_To be added by /architecture_

## QA Test Results
_To be added by /qa_

## Deployment
_To be added by /deploy_
