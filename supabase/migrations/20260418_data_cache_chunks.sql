-- PROJ-27: Persistent Market Data Store (Monthly Chunks)
--
-- Adds year/month/is_complete columns to data_cache so each row represents
-- one monthly chunk for a (symbol, source, timeframe) combination.
--
-- Backwards compatible: existing rows keep their date_from / date_to values
-- and the new columns remain NULL — the Python lookup falls back to the
-- legacy date-range path for those entries.

ALTER TABLE data_cache
  ADD COLUMN IF NOT EXISTS year        INTEGER,
  ADD COLUMN IF NOT EXISTS month       INTEGER,
  ADD COLUMN IF NOT EXISTS is_complete BOOLEAN NOT NULL DEFAULT TRUE;

-- Sanity guards on the new columns
ALTER TABLE data_cache
  DROP CONSTRAINT IF EXISTS data_cache_month_check;
ALTER TABLE data_cache
  ADD CONSTRAINT data_cache_month_check
  CHECK (month IS NULL OR (month BETWEEN 1 AND 12));

ALTER TABLE data_cache
  DROP CONSTRAINT IF EXISTS data_cache_year_check;
ALTER TABLE data_cache
  ADD CONSTRAINT data_cache_year_check
  CHECK (year IS NULL OR (year BETWEEN 2000 AND 2100));

-- Composite index for the chunk lookup hot path:
--   "give me all chunks for symbol+source+timeframe in [year_from, year_to]"
CREATE INDEX IF NOT EXISTS idx_data_cache_chunk_lookup
  ON data_cache (symbol, source, timeframe, year, month);

-- Partial unique index: at most one chunk per (symbol, source, timeframe, year, month).
-- Old monolithic rows have NULL year/month and are excluded from the constraint.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_data_cache_chunk
  ON data_cache (symbol, source, timeframe, year, month)
  WHERE year IS NOT NULL AND month IS NOT NULL;
