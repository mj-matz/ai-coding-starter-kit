-- Aggregate candle counts per trading date for a dataset.
-- Used by the gaps analysis API to find missing trading days without
-- fetching hundreds of thousands of individual candle rows.
CREATE OR REPLACE FUNCTION get_mt5_candle_dates(p_dataset_id uuid)
RETURNS TABLE(trade_date date, candle_count bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (ts AT TIME ZONE 'UTC')::date AS trade_date,
    COUNT(*)                       AS candle_count
  FROM mt5_candles
  WHERE dataset_id = p_dataset_id
  GROUP BY trade_date
  ORDER BY trade_date;
$$;
