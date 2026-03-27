-- Migration: Create optimization_runs + optimization_results tables for PROJ-19 (Strategy Optimizer)
-- Stores optimizer job metadata and per-combination result rows

-- ── Table: optimization_runs ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS optimization_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset TEXT NOT NULL,
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  strategy TEXT NOT NULL,
  parameter_group TEXT NOT NULL CHECK (parameter_group IN ('crv', 'time_exit', 'trigger_deadline', 'range_window', 'trailing_stop')),
  target_metric TEXT NOT NULL CHECK (target_metric IN ('profit_factor', 'sharpe_ratio', 'win_rate', 'net_profit')),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,        -- full backtest config snapshot
  parameter_ranges JSONB NOT NULL DEFAULT '{}'::jsonb, -- { "sl": { "min": 10, "max": 50, "step": 5 }, ... }
  total_combinations INT NOT NULL DEFAULT 0,
  completed_combinations INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'cancelled', 'failed')),
  error_message TEXT,
  best_result JSONB,                                 -- cached best-result row for quick display in history
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

-- Enable Row Level Security
ALTER TABLE optimization_runs ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- SELECT: Users see own runs; admins see all runs
CREATE POLICY "Users can view own optimization runs"
  ON optimization_runs FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    OR (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
  );

-- INSERT: Users can insert own runs only
CREATE POLICY "Users can insert own optimization runs"
  ON optimization_runs FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- UPDATE: Users can update own runs only (status changes, progress)
CREATE POLICY "Users can update own optimization runs"
  ON optimization_runs FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- DELETE: Users can delete own runs only
CREATE POLICY "Users can delete own optimization runs"
  ON optimization_runs FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_optimization_runs_user_id ON optimization_runs(user_id);
CREATE INDEX idx_optimization_runs_created_at ON optimization_runs(created_at DESC);
CREATE INDEX idx_optimization_runs_user_created ON optimization_runs(user_id, created_at DESC);
CREATE INDEX idx_optimization_runs_status ON optimization_runs(status);

COMMENT ON TABLE optimization_runs IS 'Stores optimizer job metadata: asset, date range, parameter group, target metric, status (PROJ-19)';


-- ── Table: optimization_results ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS optimization_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES optimization_runs(id) ON DELETE CASCADE,
  params JSONB NOT NULL,                             -- e.g. { "sl": 30, "tp": 90 }
  params_hash TEXT NOT NULL,                         -- deterministic hash for duplicate detection
  profit_factor FLOAT,
  sharpe_ratio FLOAT,
  win_rate FLOAT,
  total_trades INT NOT NULL DEFAULT 0,
  net_profit FLOAT,
  error TEXT                                          -- null if successful, error message otherwise
);

-- Enable Row Level Security
ALTER TABLE optimization_results ENABLE ROW LEVEL SECURITY;

-- RLS Policies (access is controlled via the parent run's ownership)

-- SELECT: Users can view results for runs they can see
CREATE POLICY "Users can view optimization results via run ownership"
  ON optimization_results FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM optimization_runs
      WHERE optimization_runs.id = optimization_results.run_id
      AND (
        optimization_runs.user_id = auth.uid()
        OR (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
      )
    )
  );

-- INSERT: Users can insert results for their own runs
CREATE POLICY "Users can insert optimization results for own runs"
  ON optimization_results FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM optimization_runs
      WHERE optimization_runs.id = optimization_results.run_id
      AND optimization_runs.user_id = auth.uid()
    )
  );

-- DELETE: Cascade from optimization_runs handles this, but explicit policy for direct deletes
CREATE POLICY "Users can delete optimization results for own runs"
  ON optimization_results FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM optimization_runs
      WHERE optimization_runs.id = optimization_results.run_id
      AND optimization_runs.user_id = auth.uid()
    )
  );

-- Indexes
CREATE INDEX idx_optimization_results_run_id ON optimization_results(run_id);
CREATE INDEX idx_optimization_results_params_hash ON optimization_results(run_id, params_hash);

COMMENT ON TABLE optimization_results IS 'Per-combination result rows for optimizer runs — only aggregates, no trade lists (PROJ-19)';
