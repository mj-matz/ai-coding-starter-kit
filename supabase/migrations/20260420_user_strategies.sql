-- PROJ-28: User-Defined Strategies — user_strategies table

CREATE TABLE IF NOT EXISTS user_strategies (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name                 text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  description          text        CHECK (char_length(description) <= 300),
  python_code          text        NOT NULL,
  parameter_schema     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  source_conversion_id uuid        REFERENCES mql_conversions(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE INDEX idx_user_strategies_user_created
  ON user_strategies (user_id, created_at DESC);

-- Auto-update updated_at on modification
CREATE OR REPLACE FUNCTION update_user_strategies_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_user_strategies_updated_at
  BEFORE UPDATE ON user_strategies
  FOR EACH ROW EXECUTE FUNCTION update_user_strategies_updated_at();

ALTER TABLE user_strategies ENABLE ROW LEVEL SECURITY;

-- SELECT: owner OR admin (read-only for admin)
CREATE POLICY "user_strategies_select"
  ON user_strategies FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

-- INSERT / UPDATE / DELETE: owner only
CREATE POLICY "user_strategies_insert_own"
  ON user_strategies FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_strategies_update_own"
  ON user_strategies FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_strategies_delete_own"
  ON user_strategies FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
