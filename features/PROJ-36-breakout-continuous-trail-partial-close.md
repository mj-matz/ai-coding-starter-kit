# PROJ-36: Breakout – Continuous Trailing Stop & Partial Close Config

## Status: Planned
**Created:** 2026-04-20
**Last Updated:** 2026-04-20

## Dependencies
- Requires: PROJ-3 (Time-Range Breakout Strategy)
- Requires: PROJ-30 (Engine – Continuous Trailing Stop & Partial Close) — engine already supports these features; this PROJ wires them into the strategy schema and UI

## Context
The Python engine (PROJ-30) supports continuous trailing stops (`trail_type="continuous"`, `trail_distance_pips`, `trail_dont_cross_entry`) and partial close (`partial_close_pct`, `partial_at_r`). However, `BreakoutParamsSchema` only exposes the older step-trail params (`trailTriggerPips`, `trailLockPips`). This feature exposes the full set of trail and partial-close options in the backtest configuration panel.

## User Stories
- As a trader, I want to select between a step trail and a continuous ratcheting trail so that I can match my MT5 EA's trailing behavior in the backtest.
- As a trader, I want to configure the continuous trail start as an R-multiple of my stop loss so that I don't have to manually calculate pip distances.
- As a trader, I want to set a "don't cross entry" guard on the trailing stop so that the SL can never move past the entry price.
- As a trader, I want to configure a partial close (e.g. 40% at 1.0R) so that I can simulate locking in profits on part of the position before the full TP is hit.
- As a trader, I want to disable trailing and partial close independently so that I can test each feature in isolation.

## Acceptance Criteria

### Trail Type Selector
- [ ] The backtest config UI shows a "Trail Type" selector for the `time_range_breakout` strategy with three options: **None**, **Step**, **Continuous**
- [ ] Selecting **None** hides all trail parameters and disables trailing in the backtest
- [ ] Selecting **Step** shows `trailTriggerPips` and `trailLockPips` (existing fields, behavior unchanged)
- [ ] Selecting **Continuous** hides step-trail fields and shows `trailStartR`, `trailDistancePips`, `trailDontCrossEntry`

### Continuous Trail Parameters
- [ ] `trailStartR` (float, > 0): R-multiple of the stop loss at which continuous trailing activates (e.g. 1.0 = trail starts once profit ≥ 1× SL)
- [ ] `trailDistancePips` (float, > 0): trailing distance in pips (SL follows price at this distance)
- [ ] `trailDontCrossEntry` (bool, default `true`): when checked, the SL is clamped to entry price and cannot move past it
- [ ] The strategy converts `trailStartR` to pips internally: `trail_trigger_pips = trailStartR × stopLoss` before writing to the signals DataFrame
- [ ] The signal row sets `trail_type = "continuous"` so the engine dispatches to `_apply_continuous_trail`

### Partial Close Parameters
- [ ] A "Partial Close" toggle is shown in the UI (off by default)
- [ ] When enabled, two fields appear: `partialClosePercent` (float, 1–99%) and `partialAtR` (float, > 0)
- [ ] `partialAtR` is an R-multiple: e.g. `1.0` triggers the partial close once the position is `1× SL` in profit
- [ ] The strategy writes `partial_close_pct` and `partial_at_r` into the signals DataFrame so the engine executes the partial close
- [ ] Partial close and trailing stop are independent — both can be active simultaneously

### Schema & Validation
- [ ] `BreakoutParamsSchema` in `breakout.py` is updated with all new fields (all optional, default `None`/`false`)
- [ ] `BreakoutParams` dataclass is updated accordingly
- [ ] Validation: if `trailType == "continuous"`, both `trailStartR` and `trailDistancePips` must be provided
- [ ] Validation: if partial close is enabled, both `partialClosePercent` (1–99) and `partialAtR` (> 0) must be provided
- [ ] `trailStartR` must be < `takeProfit / stopLoss` (otherwise trail never fires before TP)
- [ ] Existing `trailTriggerPips` / `trailLockPips` step-trail behavior is unchanged

### UI Persistence
- [ ] Trail type and partial close settings are persisted in `localStorage` via the existing `saveConfigToStorage` mechanism

## Edge Cases
- `trailStartR = 0` → validation error (must be > 0)
- `trailDistancePips ≥ stopLoss` → allowed (just means a very wide trail), no error
- `trailDontCrossEntry = true` and price immediately reverses below entry → SL is clamped to entry, trade closes at breakeven
- `partialClosePercent = 50` and lot size rounds to 0 (tiny account, min lot) → partial close skipped silently, position stays intact
- Trail type = "Continuous" but `trailStartR` not set → validation error shown in UI before submit
- Partial close enabled but `partialAtR > trailStartR` → allowed (partial fires first, then trailing starts later)
- Switching strategy away from `time_range_breakout` → new trail/partial params are ignored (schema-driven UI hides them)

## Technical Requirements
- Only `breakout.py` strategy schema changes — no engine changes required (PROJ-30 already handles all cases)
- `_write_signal` method writes `trail_type`, `trail_distance_pips`, `trail_dont_cross_entry`, `partial_close_pct`, `partial_at_r` into the signals DataFrame
- The conversion `trail_trigger_pips = trailStartR × stopLoss` happens in `_write_signal`, not in the engine
- Frontend param form is schema-driven via `DynamicParamForm` — UI changes are minimal (the selector for trail type may require a small conditional rendering addition)

---

## Tech Design (Solution Architect)

### Overview
Wires the engine capabilities from PROJ-30 into the Breakout strategy config UI. The engine already handles all trail/partial-close execution — the work is: (1) extend the Python strategy schema with new fields and signal-writing logic, and (2) teach the frontend's schema-driven form to conditionally show/hide fields based on another field's value.

### Component Structure
```
ConfigurationPanel
└── DynamicParamForm                ← extended with conditional field visibility
    ├── Trail Type selector          [trailType: none / step / continuous]
    │
    ├── Step trail section           [visible only when trailType == "step"]
    │   ├── Trail Trigger (pips)     [trailTriggerPips — existing]
    │   └── Trail Lock (pips)        [trailLockPips — existing]
    │
    ├── Continuous trail section     [visible only when trailType == "continuous"]
    │   ├── Trail Start (R-multiple) [trailStartR]
    │   ├── Trail Distance (pips)    [trailDistancePips]
    │   └── Don't Cross Entry        [trailDontCrossEntry — checkbox, default on]
    │
    └── Partial Close section
        ├── Partial Close toggle     [partialCloseEnabled — Switch]
        ├── Close Amount (%)         [partialClosePercent — visible when enabled]
        └── Trigger (R-multiple)     [partialAtR — visible when enabled]
```
No new components needed — all UI uses existing shadcn/ui primitives inside the extended `DynamicParamForm`.

### New Strategy Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `trailType` | enum: none/step/continuous | `"none"` | Replaces implicit "always step" behavior |
| `trailTriggerPips` | float (existing) | — | Step trail trigger; active only when trailType = step |
| `trailLockPips` | float (existing) | — | Step trail lock; active only when trailType = step |
| `trailStartR` | float > 0 | — | R-multiple at which continuous trail activates |
| `trailDistancePips` | float > 0 | — | SL follows price at this pip distance |
| `trailDontCrossEntry` | boolean | `true` | Clamps SL to entry price |
| `partialCloseEnabled` | boolean | `false` | Toggle for partial close |
| `partialClosePercent` | float 1–99 | — | Percentage of position to close early |
| `partialAtR` | float > 0 | — | R-multiple at which partial close fires |

Stored in: `localStorage` via existing `saveConfigToStorage` — no persistence changes needed.

### Key Design Decision: Schema-Driven Conditional Visibility
Extend field definitions with a `ui_depends_on` property (e.g. `{ field: "trailType", value: "continuous" }`). `DynamicParamForm` reads this metadata and hides fields when the condition is not met. Keeps the component reusable — optimizer and history views get conditional UI automatically.

### System Boundaries
```
Frontend
  DynamicParamForm       ← reads ui_depends_on → conditional render
  backtest-types.ts      ← StrategyParamFieldDef gets ui_depends_on field

Python Backend
  breakout.py
    BreakoutParamsSchema  ← new fields + JSON schema metadata (ui_depends_on)
    _write_signal()       ← writes trail/partial columns; R→pips conversion here
  engine (PROJ-30)        ← no changes required
```

### Validation Rules
| Rule | Enforced in |
|------|------------|
| `trailStartR > 0` and `trailDistancePips > 0` required for continuous mode | Python Pydantic validator |
| `trailStartR < takeProfit / stopLoss` | Python Pydantic validator |
| `partialClosePercent` 1–99, `partialAtR > 0` required when enabled | Python field constraints |
| Frontend blocks submit when dependent required fields are empty | `DynamicParamForm` conditional logic |

## QA Test Results
_To be added by /qa_

## Deployment
_To be added by /deploy_
