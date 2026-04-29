// Types for the /api/strategies response (mirrors Python registry output)

export const USER_STRATEGY_LIMIT = 50;

export interface UserStrategyParameter {
  name: string;
  label: string;
  type: "number" | "integer" | "string" | "boolean";
  default: number | string | boolean;
}

export interface UserStrategy {
  id: string;
  user_id?: string;
  name: string;
  description: string | null;
  parameter_schema: {
    properties: Record<string, UserStrategyParameter>;
  };
  created_at: string;
}

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
  is_custom?: boolean;
}
