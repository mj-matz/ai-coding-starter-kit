-- PROJ-32: Add parameters column to mql_conversions for editable strategy parameters
-- Stores JSON with { definitions: StrategyParameter[], values: Record<string, number|string> }
-- Nullable for backward compatibility with existing conversions (Altdaten)

ALTER TABLE mql_conversions ADD COLUMN IF NOT EXISTS parameters JSONB;

COMMENT ON COLUMN mql_conversions.parameters IS 'Extracted MQL input parameters with definitions and user-edited values (PROJ-32)';
