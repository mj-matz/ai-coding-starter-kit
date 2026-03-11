-- Migration: Create data_cache table for PROJ-1 (Data Fetcher)
-- Stores metadata about cached OHLCV Parquet files

CREATE TABLE IF NOT EXISTS data_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('dukascopy', 'yfinance')),
  timeframe TEXT NOT NULL,
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  file_path TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL DEFAULT 0,
  row_count BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Enable Row Level Security
ALTER TABLE data_cache ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- SELECT: All authenticated users can read all cache entries
CREATE POLICY "Authenticated users can view all cache entries"
  ON data_cache FOR SELECT
  TO authenticated
  USING (true);

-- INSERT: All authenticated users can insert cache entries
CREATE POLICY "Authenticated users can insert cache entries"
  ON data_cache FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = created_by);

-- UPDATE: Users can only update rows they created
CREATE POLICY "Users can update their own cache entries"
  ON data_cache FOR UPDATE
  TO authenticated
  USING (auth.uid() = created_by)
  WITH CHECK (auth.uid() = created_by);

-- DELETE: Admin-only (users with is_admin = true in user_metadata)
CREATE POLICY "Only admins can delete cache entries"
  ON data_cache FOR DELETE
  TO authenticated
  USING ((auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean = true);

-- Indexes for frequently queried columns
CREATE INDEX idx_data_cache_symbol ON data_cache (symbol);
CREATE INDEX idx_data_cache_source ON data_cache (source);
CREATE INDEX idx_data_cache_timeframe ON data_cache (timeframe);
CREATE INDEX idx_data_cache_date_range ON data_cache (date_from, date_to);
CREATE INDEX idx_data_cache_created_by ON data_cache (created_by);

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_data_cache_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER data_cache_updated_at
  BEFORE UPDATE ON data_cache
  FOR EACH ROW
  EXECUTE FUNCTION update_data_cache_updated_at();
