-- PROJ-37: MT5 Bridge Worker — Strategy Tester Run
--
-- Stores MT5 Strategy Tester run metadata + parsed XML metrics.
-- Mirrors the optimization_runs RLS pattern: users only see their own rows.
--
-- Tables:
--   • mt5_tester_runs    — one row per triggered tester run
--   • mt5_tester_metrics — 1:1 performance summary (parsed XML)
--   • mt5_tester_trades  — optional trade list (deferred persistence per PROJ-37 plan)
--   • user_settings      — per-user notification + Telegram preferences

-- ── Table: mt5_tester_runs ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mt5_tester_runs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mql_conversion_id  UUID REFERENCES mql_conversions(id) ON DELETE SET NULL,
  expert_name        TEXT NOT NULL,
  symbol             TEXT NOT NULL,
  timeframe          TEXT NOT NULL,
  from_date          DATE NOT NULL,
  to_date            DATE NOT NULL,
  parameters         JSONB NOT NULL DEFAULT '{}'::jsonb,
  model              TEXT NOT NULL DEFAULT 'EveryTickRealistic',
  status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'queued', 'running', 'done', 'failed', 'cancelled')),
  error_message      TEXT,
  bridge_job_id      TEXT,
  queue_position     INT,
  started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at        TIMESTAMPTZ,
  last_status_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE mt5_tester_runs ENABLE ROW LEVEL SECURITY;

-- SELECT — own rows or admin
CREATE POLICY "Users can view own mt5 tester runs"
  ON mt5_tester_runs FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

-- INSERT — own rows only
CREATE POLICY "Users can insert own mt5 tester runs"
  ON mt5_tester_runs FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- UPDATE — own rows only
CREATE POLICY "Users can update own mt5 tester runs"
  ON mt5_tester_runs FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- DELETE — own rows only
CREATE POLICY "Users can delete own mt5 tester runs"
  ON mt5_tester_runs FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Trigger: bump last_status_at whenever the status column changes.
-- Per the PROJ-37 plan adjustment, this fires only on status transitions —
-- not on every row update — so the stale-run sweeper has an accurate signal.
CREATE OR REPLACE FUNCTION set_mt5_tester_runs_last_status_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.last_status_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_mt5_tester_runs_last_status_at
  BEFORE UPDATE OF status ON mt5_tester_runs
  FOR EACH ROW
  EXECUTE FUNCTION set_mt5_tester_runs_last_status_at();

-- Indexes
CREATE INDEX idx_mt5_tester_runs_user_started
  ON mt5_tester_runs(user_id, started_at DESC);
CREATE INDEX idx_mt5_tester_runs_status_last_status
  ON mt5_tester_runs(status, last_status_at);
CREATE INDEX idx_mt5_tester_runs_bridge_job
  ON mt5_tester_runs(bridge_job_id)
  WHERE bridge_job_id IS NOT NULL;

COMMENT ON TABLE mt5_tester_runs IS
  'MT5 Strategy Tester run metadata (PROJ-37). Status transitions: pending → queued → running → done/failed/cancelled.';


-- ── Table: mt5_tester_metrics ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mt5_tester_metrics (
  run_id             UUID PRIMARY KEY REFERENCES mt5_tester_runs(id) ON DELETE CASCADE,
  total_net_profit   DOUBLE PRECISION,
  sharpe_ratio       DOUBLE PRECISION,
  profit_factor      DOUBLE PRECISION,
  max_drawdown_abs   DOUBLE PRECISION,
  max_drawdown_pct   DOUBLE PRECISION,
  total_trades       INT,
  won_trades         INT,
  lost_trades        INT,
  average_trade      DOUBLE PRECISION,
  raw_xml            TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE mt5_tester_metrics ENABLE ROW LEVEL SECURITY;

-- All CRUD scoped via parent run ownership.

CREATE POLICY "Users can view metrics via run ownership"
  ON mt5_tester_metrics FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM mt5_tester_runs r
      WHERE r.id = mt5_tester_metrics.run_id
        AND (
          r.user_id = auth.uid()
          OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
        )
    )
  );

CREATE POLICY "Users can insert metrics for own runs"
  ON mt5_tester_metrics FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM mt5_tester_runs r
      WHERE r.id = mt5_tester_metrics.run_id
        AND r.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update metrics for own runs"
  ON mt5_tester_metrics FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM mt5_tester_runs r
      WHERE r.id = mt5_tester_metrics.run_id
        AND r.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM mt5_tester_runs r
      WHERE r.id = mt5_tester_metrics.run_id
        AND r.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete metrics for own runs"
  ON mt5_tester_metrics FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM mt5_tester_runs r
      WHERE r.id = mt5_tester_metrics.run_id
        AND r.user_id = auth.uid()
    )
  );

COMMENT ON TABLE mt5_tester_metrics IS
  'Parsed XML report summary, 1:1 with mt5_tester_runs (PROJ-37).';


-- ── Table: mt5_tester_trades ────────────────────────────────────────────────
-- Created for schema completeness. XML → row persistence is deferred per the
-- approved PROJ-37 plan; the table is empty until that follow-up lands.

CREATE TABLE IF NOT EXISTS mt5_tester_trades (
  id           BIGSERIAL PRIMARY KEY,
  run_id       UUID NOT NULL REFERENCES mt5_tester_runs(id) ON DELETE CASCADE,
  open_time    TIMESTAMPTZ NOT NULL,
  close_time   TIMESTAMPTZ,
  direction    TEXT CHECK (direction IN ('buy', 'sell')),
  volume       DOUBLE PRECISION,
  open_price   DOUBLE PRECISION,
  close_price  DOUBLE PRECISION,
  profit       DOUBLE PRECISION,
  comment      TEXT
);

ALTER TABLE mt5_tester_trades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view trades via run ownership"
  ON mt5_tester_trades FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM mt5_tester_runs r
      WHERE r.id = mt5_tester_trades.run_id
        AND (
          r.user_id = auth.uid()
          OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
        )
    )
  );

CREATE POLICY "Users can insert trades for own runs"
  ON mt5_tester_trades FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM mt5_tester_runs r
      WHERE r.id = mt5_tester_trades.run_id
        AND r.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete trades for own runs"
  ON mt5_tester_trades FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM mt5_tester_runs r
      WHERE r.id = mt5_tester_trades.run_id
        AND r.user_id = auth.uid()
    )
  );

CREATE INDEX idx_mt5_tester_trades_run_id ON mt5_tester_trades(run_id);

COMMENT ON TABLE mt5_tester_trades IS
  'Optional per-run trade list (PROJ-37). XML persistence deferred to follow-up.';


-- ── Table: user_settings ────────────────────────────────────────────────────
-- One row per user. Holds Telegram credentials and per-run-type opt-ins.
-- Telegram bot tokens are stored as TEXT — encryption at rest is provided by
-- Supabase Postgres-level encryption; column-level encryption (pgcrypto) is a
-- future hardening step tracked separately.

CREATE TABLE IF NOT EXISTS user_settings (
  user_id                       UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  telegram_enabled              BOOLEAN NOT NULL DEFAULT false,
  telegram_bot_token            TEXT,
  telegram_chat_id              TEXT,
  notify_on_single_run          BOOLEAN NOT NULL DEFAULT false,
  notify_on_optimisation        BOOLEAN NOT NULL DEFAULT true,
  notify_on_walk_forward        BOOLEAN NOT NULL DEFAULT true,
  last_notification_attempt_at  TIMESTAMPTZ,
  last_notification_error       TEXT,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own settings"
  ON user_settings FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own settings"
  ON user_settings FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own settings"
  ON user_settings FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own settings"
  ON user_settings FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_user_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_user_settings_updated_at
  BEFORE UPDATE ON user_settings
  FOR EACH ROW
  EXECUTE FUNCTION set_user_settings_updated_at();

COMMENT ON TABLE user_settings IS
  'Per-user notification preferences and Telegram credentials (PROJ-37).';
