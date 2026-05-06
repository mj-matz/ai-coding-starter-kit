-- PROJ-40: MT5 EA Auto-Deploy
--
-- Stores one row per "Deploy to MT5" attempt (from MQL Converter or, later,
-- the MT5 Genetic Optimizer in PROJ-38). Mirrors the per-user RLS pattern
-- already used by mt5_tester_runs / mql_conversions: users see only their own
-- deploys.
--
-- Status transitions:
--   pending → compiled
--   pending → compile_error
--   pending → timeout       (MetaEditor did not finish within the bridge's compile timeout)
--   pending → failed        (bridge offline, write error, unexpected exception, …)

CREATE TABLE IF NOT EXISTS mt5_ea_deployments (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  ea_name               TEXT        NOT NULL
                                    CHECK (char_length(ea_name) BETWEEN 1 AND 64)
                                    CHECK (ea_name ~ '^[A-Za-z0-9_\-]+$'),

  -- Source enum kept in sync with the Pydantic / Zod literals.
  -- mt5_optimizer is added now (PROJ-38 still planned) so the column shape is
  -- stable when the optimizer ships.
  source                TEXT        NOT NULL
                                    CHECK (source IN ('mql_converter', 'mt5_optimizer')),

  -- Optional links — nullable because either side may be absent.
  mql_conversion_id     UUID        REFERENCES mql_conversions(id) ON DELETE SET NULL,

  -- PROJ-38 not yet built — store the id without an FK constraint for now.
  -- A follow-up migration in PROJ-38 will add:
  --   ALTER TABLE mt5_ea_deployments
  --     ADD CONSTRAINT mt5_ea_deployments_optimizer_run_fk
  --     FOREIGN KEY (optimizer_run_id) REFERENCES mt5_optimizer_runs(id)
  --     ON DELETE SET NULL;
  optimizer_run_id      UUID,
  optimizer_result_rank INT,

  status                TEXT        NOT NULL DEFAULT 'pending'
                                    CHECK (status IN ('pending', 'compiled', 'compile_error', 'timeout', 'failed')),

  error_message         TEXT,
  -- `warnings` holds compile-warning strings (only set when status = 'compiled').
  -- `errors`   holds compile-error strings   (only set when status = 'compile_error').
  -- Splitting the two columns avoids the "warnings column actually carrying
  -- errors" footgun the previous shape had.
  warnings              JSONB,
  errors                JSONB,
  log_excerpt           TEXT,

  deployed_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE mt5_ea_deployments ENABLE ROW LEVEL SECURITY;

-- ── RLS policies (owner-only; admins can read via app_metadata.role) ────────

CREATE POLICY "Users can view own ea deployments"
  ON mt5_ea_deployments FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

CREATE POLICY "Users can insert own ea deployments"
  ON mt5_ea_deployments FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own ea deployments"
  ON mt5_ea_deployments FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own ea deployments"
  ON mt5_ea_deployments FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ── Indexes ─────────────────────────────────────────────────────────────────
-- Primary access pattern is the per-user history feed (Settings page → "EA
-- Deployments"), ordered by deployed_at DESC.
CREATE INDEX idx_mt5_ea_deployments_user_deployed_at
  ON mt5_ea_deployments(user_id, deployed_at DESC);

-- Secondary index for cleanup / admin queries by status.
CREATE INDEX idx_mt5_ea_deployments_status
  ON mt5_ea_deployments(status)
  WHERE status IN ('pending', 'failed');

COMMENT ON TABLE mt5_ea_deployments IS
  'PROJ-40: per-user history of MT5 EA deploy attempts (.mq5 written + compiled on the bridge).';
COMMENT ON COLUMN mt5_ea_deployments.optimizer_run_id IS
  'PROJ-38 placeholder — FK constraint added in the PROJ-38 migration.';
COMMENT ON COLUMN mt5_ea_deployments.warnings IS
  'JSONB array of compile-warning strings, null when status != compiled.';
COMMENT ON COLUMN mt5_ea_deployments.errors IS
  'JSONB array of compile-error strings, null when status != compile_error.';
COMMENT ON COLUMN mt5_ea_deployments.log_excerpt IS
  'Trimmed compile log (last ~50 lines) for quick inspection in the history UI.';
