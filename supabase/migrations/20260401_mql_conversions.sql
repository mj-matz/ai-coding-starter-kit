-- PROJ-22: MQL Converter — mql_conversions table
-- Stores saved MQL-to-Python conversions per user.

CREATE TABLE IF NOT EXISTS mql_conversions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (char_length(name) <= 100),
  mql_code        text NOT NULL CHECK (char_length(mql_code) <= 50000),
  mql_version     text NOT NULL CHECK (mql_version IN ('mql4', 'mql5', 'auto')),
  python_code     text NOT NULL,
  mapping_report  jsonb NOT NULL DEFAULT '[]'::jsonb,
  backtest_result jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Index for listing user's conversions sorted by date
CREATE INDEX idx_mql_conversions_user_created
  ON mql_conversions (user_id, created_at DESC);

-- Enable Row Level Security
ALTER TABLE mql_conversions ENABLE ROW LEVEL SECURITY;

-- RLS Policies: owner-only access
CREATE POLICY "mql_conversions_select_own"
  ON mql_conversions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "mql_conversions_insert_own"
  ON mql_conversions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "mql_conversions_update_own"
  ON mql_conversions FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "mql_conversions_delete_own"
  ON mql_conversions FOR DELETE
  USING (auth.uid() = user_id);
