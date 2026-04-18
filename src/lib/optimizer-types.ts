import { z } from "zod";

// ── Parameter Groups ────────────────────────────────────────────────────────

export const PARAMETER_GROUPS = [
  "crv",
  "time_exit",
  "trigger_deadline",
  "range_window",
  "trailing_stop",
] as const;

export type ParameterGroup = (typeof PARAMETER_GROUPS)[number];

export const PARAMETER_GROUP_LABELS: Record<ParameterGroup, string> = {
  crv: "CRV (SL/TP)",
  time_exit: "Time Exit",
  trigger_deadline: "Trigger Deadline",
  range_window: "Range Window",
  trailing_stop: "Trailing Stop",
};

// ── Target Metrics ──────────────────────────────────────────────────────────

export const TARGET_METRICS = [
  "profit_factor",
  "sharpe_ratio",
  "win_rate",
  "net_profit",
  "max_drawdown_pct",
  "recovery_factor",
] as const;

export type TargetMetric = (typeof TARGET_METRICS)[number];

export const TARGET_METRIC_LABELS: Record<TargetMetric, string> = {
  profit_factor: "Profit Factor",
  sharpe_ratio: "Sharpe Ratio",
  win_rate: "Win Rate",
  net_profit: "Net Profit",
  max_drawdown_pct: "Max Drawdown %",
  recovery_factor: "Recovery Factor",
};

/**
 * Defines the optimization direction for each metric.
 * "maximize" = higher is better; "minimize" = lower is better.
 */
export const TARGET_METRIC_DIRECTION: Record<TargetMetric, "maximize" | "minimize"> = {
  profit_factor: "maximize",
  sharpe_ratio: "maximize",
  win_rate: "maximize",
  net_profit: "maximize",
  max_drawdown_pct: "minimize",
  recovery_factor: "maximize",
};

// ── Hard Constraint ────────────────────────────────────────────────────────

export type ConstraintMetric = TargetMetric;

export interface HardConstraint {
  metric: ConstraintMetric;
  threshold: number;
  direction: ">=" | "<=";
}

/**
 * Returns true if the given result row violates the hard constraint.
 * Used by results table, best-result banner, and history view.
 */
export function isConstraintViolated(
  row: OptimizerResultRow,
  constraint: HardConstraint | null
): boolean {
  if (!constraint) return false;
  const value = row[constraint.metric];
  if (value == null) {
    // recovery_factor null means no drawdown occurred → theoretically infinite → best case (passes any constraint)
    // all other null metrics are treated as worst case → excluded
    return constraint.metric !== "recovery_factor";
  }
  if (constraint.direction === ">=") return value < constraint.threshold;
  return value > constraint.threshold;
}

// ── Parameter Range ─────────────────────────────────────────────────────────

export interface ParameterRange {
  min: number;
  max: number;
  step: number;
}

// ── Optimizer Result Row ────────────────────────────────────────────────────

export interface OptimizerResultRow {
  params: Record<string, number>;
  params_hash: string;
  profit_factor: number | null;
  sharpe_ratio: number | null;
  win_rate: number | null;
  total_trades: number;
  net_profit: number | null;
  max_drawdown_pct?: number | null;
  recovery_factor?: number | null;
  error: string | null;
}

// ── API Response Types ──────────────────────────────────────────────────────

export interface OptimizerStartResponse {
  job_id: string;
  total_combinations: number;
}

export interface OptimizerStatusResponse {
  job_id: string;
  status: "running" | "completed" | "cancelled" | "failed";
  total: number;
  completed: number;
  results: OptimizerResultRow[];
  error_message: string | null;
}

export interface OptimizerCancelResponse {
  job_id: string;
  status: string;
  message: string;
}

// ── Optimizer Run (Supabase record) ─────────────────────────────────────────

export interface OptimizationRun {
  id: string;
  user_id: string;
  asset: string;
  date_from: string;
  date_to: string;
  strategy: string;
  parameter_group: ParameterGroup;
  target_metric: TargetMetric;
  config: Record<string, unknown>;
  parameter_ranges: Record<string, ParameterRange>;
  total_combinations: number;
  completed_combinations: number;
  status: "running" | "completed" | "cancelled" | "failed";
  error_message: string | null;
  best_result: OptimizerResultRow | null;
  created_at: string;
  finished_at: string | null;
}

// ── Combination Counter ─────────────────────────────────────────────────────

export const OPTIMIZER_MAX_COMBINATIONS = 2000;
export const OPTIMIZER_WARN_COMBINATIONS = 500;

/**
 * Calculate the number of combinations from parameter ranges.
 */
export function calculateCombinations(
  ranges: Record<string, ParameterRange>
): number {
  const keys = Object.keys(ranges);
  if (keys.length === 0) return 0;

  let total = 1;
  for (const key of keys) {
    const { min, max, step } = ranges[key];
    if (step <= 0 || min > max) return 0;
    const count = Math.floor((max - min) / step) + 1;
    total *= count;
  }

  return total;
}

// ── Zod Schemas for forms ───────────────────────────────────────────────────

export const parameterRangeSchema = z.object({
  min: z.coerce.number(),
  max: z.coerce.number(),
  step: z.coerce.number().positive("Step must be > 0"),
}).refine(
  (d) => d.max >= d.min,
  { message: "Max must be >= Min", path: ["max"] }
).refine(
  (d) => d.step <= (d.max - d.min) || d.min === d.max,
  { message: "Step is larger than the range", path: ["step"] }
);
