-- Migration: PROJ-35 – Optimizer Extended Target Metrics
-- Adds max_drawdown_pct and recovery_factor to optimization_results
-- and relaxes the target_metric CHECK on optimization_runs to accept the two new values

-- ── optimization_results: new metric columns ─────────────────────────────────

ALTER TABLE optimization_results
  ADD COLUMN IF NOT EXISTS max_drawdown_pct FLOAT,
  ADD COLUMN IF NOT EXISTS recovery_factor  FLOAT;

-- ── optimization_runs: extend target_metric CHECK constraint ─────────────────

ALTER TABLE optimization_runs
  DROP CONSTRAINT IF EXISTS optimization_runs_target_metric_check;

ALTER TABLE optimization_runs
  ADD CONSTRAINT optimization_runs_target_metric_check
    CHECK (target_metric IN ('profit_factor', 'sharpe_ratio', 'win_rate', 'net_profit', 'max_drawdown_pct', 'recovery_factor'));
