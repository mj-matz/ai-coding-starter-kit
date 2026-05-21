-- Extend the source check constraint on mt5_ea_deployments to allow 'mt5_hub'.
-- 'mt5_hub' is used when the user pastes code or uploads a .mq5 file directly
-- in the MT5 Hub Tester form (PROJ-42).

ALTER TABLE mt5_ea_deployments
  DROP CONSTRAINT IF EXISTS mt5_ea_deployments_source_check;

ALTER TABLE mt5_ea_deployments
  ADD CONSTRAINT mt5_ea_deployments_source_check
  CHECK (source IN ('mql_converter', 'mt5_optimizer', 'mt5_hub'));
