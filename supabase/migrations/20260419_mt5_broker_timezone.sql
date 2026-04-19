-- PROJ-34 fix: store broker server timezone alongside MT5 datasets so that
-- candle timestamps (which MT5 exports in broker-local time, not UTC) can be
-- converted correctly during upload.
--
-- Existing datasets default to 'UTC' (their stored timestamps were treated as
-- UTC at upload time).  Users must re-upload any data that was imported before
-- this migration to get timezone-correct results.

ALTER TABLE mt5_datasets
  ADD COLUMN IF NOT EXISTS broker_timezone text NOT NULL DEFAULT 'UTC';
