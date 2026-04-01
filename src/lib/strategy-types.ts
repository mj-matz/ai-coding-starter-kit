// Types for the /api/strategies response (mirrors Python registry output)

export interface StrategyParamFieldDef {
  type?: string;
  anyOf?: Array<{
    type: string;
    exclusiveMinimum?: number;
    minimum?: number;
    maximum?: number;
  }>;
  enum?: string[];
  default?: unknown;
  label?: string;
  ui_type?: string;
  exclusiveMinimum?: number;
  minimum?: number;
  maximum?: number;
  title?: string;
  pattern?: string;
}

export interface StrategyParametersSchema {
  type?: string;
  title?: string;
  properties: Record<string, StrategyParamFieldDef>;
  required?: string[];
}

export interface Strategy {
  id: string;
  name: string;
  description: string;
  parameters_schema: StrategyParametersSchema;
}
