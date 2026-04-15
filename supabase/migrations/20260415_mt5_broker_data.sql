-- PROJ-34: MT5 Broker Data Import
-- Admin can upload/modify datasets; all authenticated users can read.
-- Candles cascade-delete when a dataset is removed.

-- ── Tables ───────────────────────────────────────────────────────────────────

CREATE TABLE mt5_datasets (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  asset         text        NOT NULL,
  timeframe     text        NOT NULL,
  start_date    date        NOT NULL,
  end_date      date        NOT NULL,
  candle_count  integer     NOT NULL DEFAULT 0,
  uploaded_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mt5_datasets_asset_timeframe_uq UNIQUE (user_id, asset, timeframe)
);

CREATE TABLE mt5_candles (
  dataset_id  uuid        NOT NULL REFERENCES mt5_datasets ON DELETE CASCADE,
  ts          timestamptz NOT NULL,
  open        double precision NOT NULL,
  high        double precision NOT NULL,
  low         double precision NOT NULL,
  close       double precision NOT NULL,
  tick_volume double precision,
  volume      double precision,
  spread      double precision,
  PRIMARY KEY (dataset_id, ts)
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX idx_mt5_datasets_user_uploaded
  ON mt5_datasets (user_id, uploaded_at DESC);

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE mt5_datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE mt5_candles  ENABLE ROW LEVEL SECURITY;

-- mt5_datasets: all authenticated users can read; only admin can write.

CREATE POLICY "All users can read mt5 datasets"
  ON mt5_datasets FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admin can insert mt5 datasets"
  ON mt5_datasets FOR INSERT
  TO authenticated
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

CREATE POLICY "Admin can update mt5 datasets"
  ON mt5_datasets FOR UPDATE
  TO authenticated
  USING  ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

CREATE POLICY "Admin can delete mt5 datasets"
  ON mt5_datasets FOR DELETE
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- mt5_candles: readable by all authenticated users; writable by admin only.

CREATE POLICY "All users can read mt5 candles"
  ON mt5_candles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admin can insert mt5 candles"
  ON mt5_candles FOR INSERT
  TO authenticated
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

CREATE POLICY "Admin can update mt5 candles"
  ON mt5_candles FOR UPDATE
  TO authenticated
  USING  ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

CREATE POLICY "Admin can delete mt5 candles"
  ON mt5_candles FOR DELETE
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
