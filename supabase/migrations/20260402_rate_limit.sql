-- PROJ-22: Rate limiting infrastructure for MQL Converter (and future use)
-- Provides a generic check_rate_limit() RPC used by the /api/mql-converter/convert route.

CREATE TABLE IF NOT EXISTS rate_limit_log (
  key          text        NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rate_limit_log_key_time
  ON rate_limit_log (key, requested_at DESC);

-- No RLS needed: this table is only accessible via the SECURITY DEFINER function below,
-- never directly by client-side code.

-- check_rate_limit(p_key, p_max_requests, p_window_seconds)
-- Returns TRUE if the request is within the limit and logs it.
-- Returns FALSE if the limit is exceeded (request is NOT logged).
-- Uses SECURITY DEFINER so it can write to rate_limit_log regardless of caller privileges.
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_key            text,
  p_max_requests   integer,
  p_window_seconds integer
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_window_start timestamptz;
  v_count        integer;
BEGIN
  v_window_start := now() - (p_window_seconds || ' seconds')::interval;

  SELECT COUNT(*) INTO v_count
  FROM rate_limit_log
  WHERE key = p_key AND requested_at >= v_window_start;

  IF v_count >= p_max_requests THEN
    RETURN false;
  END IF;

  INSERT INTO rate_limit_log (key) VALUES (p_key);

  -- Opportunistic cleanup of expired entries for this key
  DELETE FROM rate_limit_log
  WHERE key = p_key AND requested_at < v_window_start;

  RETURN true;
END;
$$;
