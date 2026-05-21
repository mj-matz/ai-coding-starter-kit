-- PROJ-42: Add gross_profit, gross_loss, recovery_factor columns to
-- mt5_tester_metrics. The EA OnTester() hook already writes these fields
-- to the JSON report; the bridge json_parser now extracts them.
ALTER TABLE mt5_tester_metrics
  ADD COLUMN IF NOT EXISTS gross_profit numeric,
  ADD COLUMN IF NOT EXISTS gross_loss numeric,
  ADD COLUMN IF NOT EXISTS recovery_factor numeric;
