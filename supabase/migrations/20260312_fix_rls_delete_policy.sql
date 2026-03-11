-- Fix RLS DELETE policy: use app_metadata instead of user_metadata
-- user_metadata is client-writable; any user could self-escalate to admin
-- app_metadata can only be modified via the service role key

DROP POLICY IF EXISTS "Only admins can delete cache entries" ON data_cache;

CREATE POLICY "Only admins can delete cache entries"
  ON data_cache FOR DELETE
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);
