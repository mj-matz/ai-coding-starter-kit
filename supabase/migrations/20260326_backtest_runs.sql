-- Migration: Create backtest_runs table for PROJ-9 (Backtest History)
-- Stores saved backtest runs with config, results, and trade logs

CREATE TABLE IF NOT EXISTS backtest_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) <= 200),
  asset TEXT NOT NULL,
  strategy TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  trade_log JSONB NOT NULL DEFAULT '[]'::jsonb,
  charts JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE backtest_runs ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- SELECT: Users see own runs; admins see all runs
CREATE POLICY "Users can view own runs"
  ON backtest_runs FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

-- INSERT: Users can insert own runs only
CREATE POLICY "Users can insert own runs"
  ON backtest_runs FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- UPDATE: Users can update own runs only (for rename)
CREATE POLICY "Users can update own runs"
  ON backtest_runs FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- DELETE: Users can delete own runs only
CREATE POLICY "Users can delete own runs"
  ON backtest_runs FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Indexes for performance
CREATE INDEX idx_backtest_runs_user_id ON backtest_runs(user_id);
CREATE INDEX idx_backtest_runs_created_at ON backtest_runs(created_at DESC);
CREATE INDEX idx_backtest_runs_user_created ON backtest_runs(user_id, created_at DESC);

-- Comment
COMMENT ON TABLE backtest_runs IS 'Stores saved backtest runs with full config and results (PROJ-9)';
