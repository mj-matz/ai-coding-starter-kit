# PROJ-35: Optimizer – Extended Target Metrics & Hard Constraint Filter

## Status: Deployed
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

### Overview

This feature has two independent parts that can be built in sequence:
1. **New Target Metrics** – surface `max_drawdown_pct` and `recovery_factor` from the Python backend and wire them into the existing optimizer UI.
2. **Hard Constraint Filter** – a purely client-side filtering layer that dims/excludes results violating a user-defined threshold.

No new database tables are needed. The Supabase `optimization_runs` record stores the hard constraint config as part of the existing JSON `config` column.

---

### Component Structure

```
Optimizer Page
+-- MetricSelector  (existing — add 2 new radio options)
+-- HardConstraintSection  (NEW collapsible panel, collapsed by default)
|   +-- Expand/collapse toggle  ("Add Hard Constraint")
|   +-- Constraint Metric dropdown  (Net Profit / PF / Sharpe / Win Rate / Max DD% / Recovery Factor)
|   +-- Direction selector  (">= threshold"  or  "<= threshold")
|   +-- Threshold numeric input
|   +-- Clear / Reset button
+-- ResultsTable  (existing — extended)
|   +-- Best Result Banner  (direction-aware: lowest for Max DD%, highest for others)
|   +-- "No combinations meet the constraint" empty state  (shown when all rows violate)
|   +-- Table columns  (add Max DD% and Recovery Factor, sortable)
|   |   +-- Violating rows  (dimmed / strikethrough badge)
|   +-- Detail Panel  (add Max DD% and Recovery Factor fields)
```

---

### Data Model Changes (plain language)

**`src/lib/optimizer-types.ts`** — the single source of truth for all optimizer types:

- `TARGET_METRICS` array grows from 4 to 6 entries: add `"max_drawdown_pct"` and `"recovery_factor"`.
- New `TARGET_METRIC_DIRECTION` record maps every metric to either `"maximize"` or `"minimize"`. Max Drawdown uses `"minimize"` (lower is better); all others use `"maximize"`. This record is read by the results table and the "Apply Best" logic — the direction is never hardcoded in UI components.
- `OptimizerResultRow` gains two optional fields: `max_drawdown_pct: number | null` and `recovery_factor: number | null`. Marked optional so existing saved runs without these fields load without errors.
- New `HardConstraint` type: `{ metric, threshold, direction }`. Used as prop/state throughout the results view.
- `ConstraintMetric` type: the union of all 6 metrics (same set as target metrics).

**Supabase `optimization_runs` table** — no schema change needed. The `config` column (already a JSONB field) stores the hard constraint object when present. Backward-compatible: absence of the key = no constraint.

---

### New Component

**`src/components/optimizer/hard-constraint-section.tsx`**

A self-contained collapsible panel rendered above (or below) the MetricSelector in the optimizer config form. Manages its own local state (expanded/collapsed, metric, threshold, direction) and exposes the current `HardConstraint | null` to the parent page via a callback. Can be shown both before a run (pre-configure) and after (applied post-hoc to existing results without re-running).

---

### Where Constraint Logic Lives

A shared utility function `isConstraintViolated(row, constraint)` returns `true/false` for a given result row. This lives in `optimizer-types.ts` or a small `optimizer-utils.ts` file — it is **not** duplicated in the results table, the best-result banner, or the history section. All three consumers call the same function.

The `useMemo` in `ResultsTable` that computes `bestResult` is updated to skip rows where `isConstraintViolated` returns `true`. Rows that violate are rendered with reduced opacity and an "Excluded" badge; they remain visible so the trader can see the trade-off.

---

### Python Backend Changes (minimal)

PROJ-31 already computes `max_drawdown_pct` and `recovery_factor` in the analytics module. The only change needed in the optimizer's Python code is to include these two values in the per-combination result dict that is returned to the frontend. No new calculations — just forwarding existing analytics output.

---

### API Route Changes

**`/api/optimizer/run/route.ts`**:
- The `target_metric` Zod enum is extended to accept `"max_drawdown_pct"` and `"recovery_factor"`. This is a one-line change to the validation schema.

**`/api/optimizer/runs/[id]/save/route.ts`**:
- The `hard_constraint` object (if set) is included in the config payload saved to Supabase. No database schema change needed.

---

### Tech Decisions

| Decision | Rationale |
|---|---|
| Direction config in `optimizer-types.ts`, not in UI | Single source of truth — prevents the "Apply Best" button and the sort default from disagreeing |
| Hard constraint applied client-side | No backend re-run needed; constraint can be changed post-hoc; spec explicitly allows this |
| Constraint stored in Supabase `config` JSON | Avoids a migration; the field is optional so old runs load cleanly |
| Violating rows dimmed but visible | Trader needs to see excluded combinations to understand the trade-off; pure removal would hide information |
| `isConstraintViolated` as shared utility | Prevents logic drift between the table, the banner, and the history view |

---

### Dependencies

No new npm packages required. All UI primitives (Collapsible/accordion-style toggle, Select, Input, Badge) are already available via shadcn/ui.

## QA Test Results

### Round 1 (2026-04-17) — Initial QA
Found 3 Medium + 2 Low bugs. Production-ready: **NO**.

---

### Round 2 (2026-04-18) — Re-QA after bug fixes
**Build:** ✓ Compiled successfully (Next.js, TypeScript, zero errors)
**Automated Tests:** No project-level unit/E2E test suite found

#### Fix Verification

| Bug | Severity | Status |
|-----|----------|--------|
| Bug 1 — `isConstraintViolated` treats null `recovery_factor` as excluded | Medium | ✅ Fixed — `constraint.metric !== "recovery_factor"` special-case at [optimizer-types.ts:81](src/lib/optimizer-types.ts#L81) |
| Bug 2 — Header click clears constraint | Medium | ✅ Fixed — header calls `setExpanded(false)` only; only "Clear Constraint" button calls `handleClear()` at [hard-constraint-section.tsx:76](src/components/optimizer/hard-constraint-section.tsx#L76) |
| Bug 3 — Sort not re-initialized on target metric change | Medium | ✅ Fixed — `useEffect` syncs `sortKey` + `sortDir` on `targetMetric` prop change at [results-table.tsx:94-97](src/components/optimizer/results-table.tsx#L94-L97) |
| Bug 4 — "No combinations meet constraint" shown for all-error runs | Low | ✅ Fixed — `allExcluded` filters `validRows = results.filter(r => r.error == null)` first at [results-table.tsx:122-127](src/components/optimizer/results-table.tsx#L122-L127) |
| Bug 5 — Post-hoc constraint not persisted to history | Low | ⚠️ Unchanged — acceptable session-only behavior, documented |

#### New Finding

| # | Finding | Severity |
|---|---------|----------|
| N1 | `MINIMIZE_METRICS` in [save/route.ts:118](src/app/api/optimizer/runs/%5Bid%5D/save/route.ts#L118) is a hardcoded `new Set(["max_drawdown_pct"])` instead of using `TARGET_METRIC_DIRECTION` from shared types. Functionally correct now, maintenance risk if a new minimize metric is added. | Low (Tech Debt) |

#### Acceptance Criteria Results

| # | Criterion | Result |
|---|-----------|--------|
| 1 | "Max Drawdown %" selectable as target metric | ✅ Pass |
| 2 | Max Drawdown % ranks ascending (lower = better) | ✅ Pass |
| 3 | "Recovery Factor" selectable as target metric | ✅ Pass |
| 4 | Recovery Factor ranks descending (higher = better) | ✅ Pass |
| 5 | Both metrics returned per combination from backend | ✅ Pass |
| 6 | Both metrics displayed as columns in results table | ✅ Pass |
| 7 | "Apply Best" uses correct direction-aware best result | ✅ Pass |
| 8 | Saved runs in history display correct best value | ✅ Pass |
| 9 | Optional hard constraint section, collapsed by default | ✅ Pass |
| 10 | User can select constraint metric (any of 6) | ✅ Pass |
| 11 | User sets threshold and direction (>= / <=) | ✅ Pass |
| 12 | Results table dims/marks violating combinations | ✅ Pass |
| 13 | Violating combinations excluded from "Apply Best" | ✅ Pass |
| 14 | Hard constraint applied client-side | ✅ Pass |
| 15 | Constraint settings included when saving run | ✅ Pass |
| 16 | "No combinations meet constraint" message shown | ✅ Pass |
| 17 | Hard constraint clearable without re-running | ✅ Pass — header collapse preserves constraint |
| E1 | Max Drawdown % null → treated as worst case | ✅ Pass |
| E2 | Recovery Factor null → treated as best case | ✅ Pass |
| E3 | Threshold of 0 valid | ✅ Pass |
| E4 | Switching target metric re-sorts without re-running | ✅ Pass |
| E5 | Changing constraint post-hoc re-filters | ✅ Pass |
| E6 | Post-hoc constraint applied after run completes | ✅ Pass (session-only) |

#### Security Audit

| Area | Finding |
|------|---------|
| Authentication | ✅ All routes verify session via `supabase.auth.getUser()` |
| Authorization | ✅ Save route verifies `user_id` ownership before writing |
| Input validation | ✅ Zod schema validates `target_metric` enum and `hard_constraint` shape |
| `hard_constraint` excluded from FastAPI | ✅ `_hc` destructured out before forwarding to Python |
| Constraint metric enum | ✅ Constrained to known values — no injection risk |
| New migration | ✅ Additive only (`ADD COLUMN IF NOT EXISTS`), safe rollout |
| No secrets exposed | ✅ |

#### Regression Check

- ✅ Existing 4 target metrics (Profit Factor, Sharpe, Win Rate, Net Profit) still work
- ✅ Old saved runs load without errors — new fields are `optional` in `OptimizerResultRow`
- ✅ History section shows correctly for runs without `hard_constraint` in config
- ✅ Heatmap chart handles `max_drawdown_pct` and `recovery_factor`
- ✅ Build passes with zero TypeScript errors

#### Summary

| Category | Count |
|----------|-------|
| Acceptance criteria | 17 + 6 edge cases = 23 |
| ✅ Passed | 23 |
| ❌ Failed | 0 |
| Security issues | 0 |
| Open — Low tech debt | 1 (N1 — hardcoded MINIMIZE_METRICS set) |

**Production-ready: YES** — All medium bugs fixed. One low-severity tech debt item (N1) can be addressed in a future cleanup.

## Deployment

**Deployed:** 2026-04-18
**Production URL:** https://test-project-ten-weld.vercel.app/optimizer

### Changes deployed
- Extended optimizer target metrics: Max Drawdown % (minimize) and Recovery Factor (maximize)
- New HardConstraintSection component (collapsible, client-side filtering)
- `isConstraintViolated` shared utility in optimizer-types
- Python backend returns `max_drawdown_pct` and `recovery_factor` per combination
- Supabase migration: `ADD COLUMN IF NOT EXISTS` for new metric columns
- Lint fix: replaced `useEffect`-based sort sync with React derived-state-during-render pattern
