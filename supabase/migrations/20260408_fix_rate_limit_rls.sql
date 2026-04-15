-- PROJ-22: Enable RLS on rate_limit_log to prevent direct public access.
-- The table is only accessed via check_rate_limit() (SECURITY DEFINER),
-- which bypasses RLS automatically — so no explicit policies are needed.
-- Without RLS, the anon key could query the table directly via the REST API.

ALTER TABLE rate_limit_log ENABLE ROW LEVEL SECURITY;

-- No policies are intentionally added here.
-- Direct access (SELECT/INSERT/DELETE) is blocked for all roles.
-- Only SECURITY DEFINER functions can access this table.
