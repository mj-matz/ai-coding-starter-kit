"use client";

import { useCallback } from "react";
import { AlertTriangle } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

// ── Types ──────────────────────────────────────────────────────────────────

export type ParamValue = number | string | boolean;

export interface StrategyParameter {
  name: string;
  label: string;
  type: "number" | "integer" | "string" | "boolean";
  default: ParamValue;
  mql_input_name: string | null;
}

export interface ParametersPanelProps {
  parameters: StrategyParameter[];
  values: Record<string, ParamValue>;
  onChange: (values: Record<string, ParamValue>) => void;
  disabled?: boolean;
}

// ── Validation helpers ─────────────────────────────────────────────────────

function isValidValue(param: StrategyParameter, value: ParamValue): boolean {
  if (param.type === "boolean") return typeof value === "boolean";
  const raw = String(value ?? "");
  if (raw.trim() === "") return false;
  if (param.type === "integer") {
    return /^-?\d+$/.test(raw.trim());
  }
  if (param.type === "number") {
    return !isNaN(Number(raw.trim()));
  }
  return true; // string type accepts anything non-empty
}

function parseValue(param: StrategyParameter, raw: ParamValue): ParamValue {
  if (param.type === "boolean") {
    if (typeof raw === "boolean") return raw;
    const s = String(raw).trim().toLowerCase();
    return s === "true" || s === "1" || s === "yes";
  }
  const s = String(raw ?? "").trim();
  if (param.type === "integer") return parseInt(s, 10);
  if (param.type === "number") return parseFloat(s);
  return s;
}

// ── Component ──────────────────────────────────────────────────────────────

export function ParametersPanel({
  parameters,
  values,
  onChange,
  disabled = false,
}: ParametersPanelProps) {
  const handleFieldChange = useCallback(
    (paramName: string, value: ParamValue) => {
      onChange({ ...values, [paramName]: value });
    },
    [values, onChange]
  );

  // If no parameters found, show a hint
  if (parameters.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 px-5 py-4">
        <div className="flex items-center gap-2 text-gray-400 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            No configurable parameters found — edit the Python code directly.
          </span>
        </div>
      </div>
    );
  }

  const useWideGrid = parameters.length > 20;

  // Check validity for all fields (used to show per-field errors)
  function getFieldError(param: StrategyParameter): string | null {
    if (param.type === "boolean") return null;
    const raw = String(values[param.name] ?? "");
    if (raw.trim() === "") return "Value is required";
    if (param.type === "integer" && !/^-?\d+$/.test(raw.trim())) {
      return "Must be a whole number";
    }
    if (param.type === "number" && isNaN(Number(raw))) {
      return "Must be a valid number";
    }
    return null;
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-5 py-4">
      <h4 className="text-sm font-medium text-gray-300 mb-4">
        Strategy Parameters
      </h4>
      <div
        className={`grid gap-4 ${
          useWideGrid
            ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
            : "grid-cols-1 sm:grid-cols-2"
        }`}
      >
        {parameters.map((param) => {
          const error = getFieldError(param);
          const fieldId = `param-${param.name}`;

          if (param.type === "boolean") {
            const current = values[param.name];
            const checked =
              typeof current === "boolean"
                ? current
                : current === undefined
                ? Boolean(param.default)
                : String(current).toLowerCase() === "true";
            return (
              <div
                key={param.name}
                className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2"
              >
                <Label
                  htmlFor={fieldId}
                  className="text-xs font-medium text-gray-300"
                >
                  {param.label}
                </Label>
                <Switch
                  id={fieldId}
                  checked={checked}
                  onCheckedChange={(v) => handleFieldChange(param.name, v)}
                  disabled={disabled}
                  aria-label={param.label}
                />
              </div>
            );
          }

          const rawValue = String(values[param.name] ?? param.default ?? "");
          return (
            <div key={param.name} className="space-y-1.5">
              <Label
                htmlFor={fieldId}
                className="text-xs font-medium text-gray-400"
              >
                {param.label}
              </Label>
              <Input
                id={fieldId}
                type="text"
                inputMode={
                  param.type === "string"
                    ? "text"
                    : param.type === "integer"
                    ? "numeric"
                    : "decimal"
                }
                value={rawValue}
                onChange={(e) => handleFieldChange(param.name, e.target.value)}
                disabled={disabled}
                className={`border-white/10 bg-black/20 text-gray-100 rounded-lg text-sm ${
                  error ? "border-red-500/70 focus-visible:ring-red-500/50" : ""
                }`}
                aria-label={param.label}
                aria-invalid={!!error}
                aria-describedby={error ? `${fieldId}-error` : undefined}
              />
              {error && (
                <p
                  id={`${fieldId}-error`}
                  className="text-xs text-red-400"
                  role="alert"
                >
                  {error}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Utility exports ────────────────────────────────────────────────────────

/** Check if all parameter values are valid (used to disable Re-run button) */
export function areParametersValid(
  parameters: StrategyParameter[],
  values: Record<string, ParamValue>
): boolean {
  return parameters.every((param) => {
    const v = values[param.name];
    if (param.type === "boolean") return typeof v === "boolean" || v === undefined;
    return isValidValue(param, v ?? "");
  });
}

/** Convert raw values to typed params dict for the API */
export function buildParamsDict(
  parameters: StrategyParameter[],
  values: Record<string, ParamValue>
): Record<string, ParamValue> {
  const result: Record<string, ParamValue> = {};
  for (const param of parameters) {
    const raw = values[param.name] ?? param.default ?? "";
    result[param.name] = parseValue(param, raw);
  }
  return result;
}

/** Initialize values from parameters defaults or saved values */
export function initParameterValues(
  parameters: StrategyParameter[],
  savedValues?: Record<string, ParamValue> | null
): Record<string, ParamValue> {
  const result: Record<string, ParamValue> = {};
  for (const param of parameters) {
    result[param.name] =
      savedValues?.[param.name] !== undefined
        ? savedValues[param.name]
        : param.default;
  }
  return result;
}
