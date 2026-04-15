-- Security fix: Replace insecure user_metadata admin checks with app_metadata.
-- user_metadata can be set by the client (JWT manipulation risk).
-- app_metadata can only be set server-side via Service Role — safe for RLS.

-- ── backtest_runs ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can view own runs" ON backtest_runs;

CREATE POLICY "Users can view own runs"
  ON backtest_runs FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

-- ── optimization_runs ────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can view own optimization runs" ON optimization_runs;

CREATE POLICY "Users can view own optimization runs"
  ON optimization_runs FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

-- ── optimization_results ─────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can view optimization results via run ownership" ON optimization_results;

CREATE POLICY "Users can view optimization results via run ownership"
  ON optimization_results FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM optimization_runs
      WHERE optimization_runs.id = optimization_results.run_id
      AND (
        optimization_runs.user_id = auth.uid()
        OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
      )
    )
  );
