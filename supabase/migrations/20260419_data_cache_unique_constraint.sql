-- PROJ-27 fix: replace partial unique index with a full unique constraint so
-- PostgREST's on_conflict upsert works without a WHERE predicate.
--
-- PostgreSQL treats NULLs as distinct in unique constraints, so legacy rows
-- with NULL year/month still coexist freely — behaviour is unchanged.

DROP INDEX IF EXISTS uniq_data_cache_chunk;

ALTER TABLE data_cache
  DROP CONSTRAINT IF EXISTS uniq_data_cache_chunk;

ALTER TABLE data_cache
  ADD CONSTRAINT uniq_data_cache_chunk
  UNIQUE (symbol, source, timeframe, year, month);
