# PROJ-35: Optimizer – Extended Target Metrics & Hard Constraint Filter

## Status: Planned
**Created:** 2026-04-17
**Last Updated:** 2026-04-17

## Dependencies
- Requires: PROJ-19 (Strategy Optimizer) – base optimizer infrastructure
- Requires: PROJ-31 (Extended Backtest Metrics) – Max Drawdown & Recovery Factor already computed in analytics

## User Stories
- As a trader, I want to optimize for **minimum Max Drawdown** so that I can find the parameter combination that protects my capital best.
- As a trader, I want to optimize for **Recovery Factor** so that I can find the combination with the best return-to-drawdown ratio.
- As a trader, I want to set a **Hard Constraint** (e.g. "Max Drawdown must be below 15%") alongside my primary target metric so that the optimizer ignores all combinations that exceed my risk tolerance.
- As a trader, I want the results table to **clearly highlight** which combinations are excluded by the hard constraint so that I understand the trade-off.
- As a trader, I want to save an optimizer run with a hard constraint to history so that I can review it later.

## Acceptance Criteria

### New Target Metrics
- [ ] "Max Drawdown %" is selectable as a target metric in the metric selector
- [ ] When "Max Drawdown %" is selected, the optimizer ranks results **ascending** (lower = better); the best result is the one with the lowest value
- [ ] "Recovery Factor" is selectable as a target metric in the metric selector
- [ ] When "Recovery Factor" is selected, the optimizer ranks results **descending** (higher = better)
- [ ] Both new metrics are returned per combination from the backend (Max Drawdown %, Recovery Factor)
- [ ] Both new metrics are displayed as columns in the results table
- [ ] The "Apply Best" button uses the correct best result for minimize/maximize direction depending on the selected metric
- [ ] Saved optimizer runs in history display the correct best value for the new metrics

### Hard Constraint Filter
- [ ] The optimizer config UI offers an **optional** hard constraint section (collapsed by default, expandable)
- [ ] The user can select a **constraint metric** (any of: Net Profit, Profit Factor, Sharpe Ratio, Win Rate, Max Drawdown %, Recovery Factor) independent of the primary target metric
- [ ] The user sets a **threshold value** (numeric input) and a **direction** (">= threshold" or "<= threshold")
- [ ] When a hard constraint is configured, the results table visually **dims or marks** combinations that violate the constraint
- [ ] Combinations violating the constraint are **excluded** from "best result" selection (Apply Best ignores them)
- [ ] The hard constraint is applied client-side (no backend changes required)
- [ ] The hard constraint settings (metric, threshold, direction) are included when saving a run to history
- [ ] If no combinations pass the hard constraint, a clear message is shown: "No combinations meet the constraint"
- [ ] The hard constraint can be cleared/reset without re-running the optimizer

## Edge Cases
- Max Drawdown % may be `null` if a combination produced 0 trades — treat as worst case (exclude from best selection, do not crash)
- Recovery Factor may be `null` if Max Drawdown is 0 (no drawdown occurred) — display as "—", treat as best case for recovery factor (it's theoretically infinite)
- Hard constraint threshold of 0 is valid (e.g. "Net Profit >= 0" to exclude losing strategies)
- Switching the primary target metric after a run completes re-sorts the table without re-running
- Changing the hard constraint after a run completes re-filters without re-running
- An optimizer run started without a hard constraint can have one applied post-hoc in the results view

## Technical Requirements
- All new metrics returned per combination from Python backend (max_drawdown_pct, recovery_factor added to result dict)
- Backend validation regex updated to accept new metric keys
- Minimize/maximize direction is defined in the TypeScript types (not hardcoded in UI components)
- Hard constraint logic lives in a shared utility / useMemo, not duplicated across components
- Backward compatibility: existing saved runs (without new metric fields) must load without errors (treat missing fields as null)

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)
_To be added by /architecture_

## QA Test Results
_To be added by /qa_

## Deployment
_To be added by /deploy_
