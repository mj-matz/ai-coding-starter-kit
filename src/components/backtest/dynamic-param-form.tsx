"use client";

import { useState } from "react";
import { Clock, ChevronDown, ChevronRight } from "lucide-react";
import type { UseFormReturn } from "react-hook-form";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

import type { BacktestFormValues } from "@/lib/backtest-types";
import type { StrategyParamFieldDef, StrategyParametersSchema } from "@/lib/strategy-types";

interface DynamicParamFormProps {
  schema: StrategyParametersSchema;
  form: UseFormReturn<BacktestFormValues>;
}

function isOptionalField(field: StrategyParamFieldDef): boolean {
  return field.anyOf?.some((x) => x.type === "null") ?? false;
}

function getBaseType(field: StrategyParamFieldDef): string {
  if (field.type) return field.type;
  // anyOf: [{type: X}, {type: "null"}] — extract the non-null type
  const nonNull = field.anyOf?.find((x) => x.type !== "null");
  return nonNull?.type ?? "string";
}

function getNumericConstraints(field: StrategyParamFieldDef) {
  const nonNull = field.anyOf?.find((x) => x.type !== "null");
  return {
    min: field.minimum ?? nonNull?.minimum,
    exclusiveMin: field.exclusiveMinimum ?? nonNull?.exclusiveMinimum,
    max: field.maximum ?? nonNull?.maximum,
  };
}

// ── Single field renderer ────────────────────────────────────────────────────

interface FieldProps {
  name: string;
  field: StrategyParamFieldDef;
  value: unknown;
  onChange: (val: unknown) => void;
}

function ParamField({ name, field, value, onChange }: FieldProps) {
  const label = field.label ?? name;
  const optional = isOptionalField(field);
  const baseType = getBaseType(field);
  const { min, exclusiveMin, max } = getNumericConstraints(field);
  const inputMin = exclusiveMin != null ? exclusiveMin + 0.0001 : min;

  // Direction or other small enum → button group
  if (field.enum && field.enum.length <= 4) {
    return (
      <div>
        <Label className="text-gray-300 text-sm">{label}</Label>
        <div className="mt-1.5 flex gap-1.5">
          {field.enum.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => onChange(opt)}
              aria-pressed={value === opt}
              className={cn(
                "flex-1 rounded-md py-1.5 text-xs font-medium capitalize transition-colors",
                value === opt
                  ? "bg-white text-black"
                  : "border border-white/10 bg-black/20 text-gray-400 hover:text-gray-200"
              )}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Larger enum → Select
  if (field.enum) {
    return (
      <div>
        <Label className="text-gray-300 text-sm">{label}</Label>
        <Select
          value={value != null ? String(value) : ""}
          onValueChange={(v) => onChange(v)}
        >
          <SelectTrigger className="mt-1.5 border-white/10 bg-black/20 text-gray-100 rounded-lg">
            <SelectValue placeholder={`Select ${label}`} />
          </SelectTrigger>
          <SelectContent className="border-white/10 bg-[#0d0f14]">
            {field.enum.map((opt) => (
              <SelectItem
                key={opt}
                value={opt}
                className="text-gray-100 focus:bg-white/10 focus:text-white capitalize"
              >
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  // Time field
  if (field.ui_type === "time") {
    return (
      <div>
        <Label className="text-gray-300 text-sm">{label}</Label>
        <div className="relative mt-1.5">
          <Clock className="pointer-events-none absolute left-3 top-1/2 h-[1.1rem] w-[1.1rem] -translate-y-1/2 text-gray-500" />
          <Input
            type="time"
            value={value != null ? String(value) : ""}
            onChange={(e) => onChange(e.target.value)}
            className="border-white/10 bg-black/20 pl-9 text-gray-100 rounded-lg [&::-webkit-calendar-picker-indicator]:hidden"
          />
        </div>
      </div>
    );
  }

  // Number / Integer
  if (baseType === "number" || baseType === "integer") {
    const step = baseType === "integer" ? 1 : 0.1;
    return (
      <div>
        <Label className="text-gray-300 text-sm">
          {label}
          {optional && (
            <span className="ml-1.5 text-xs text-gray-500">(optional)</span>
          )}
        </Label>
        <Input
          type="number"
          step={step}
          min={inputMin}
          max={max}
          value={value != null && value !== "" ? String(value) : ""}
          placeholder={optional ? "—" : undefined}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") {
              onChange(optional ? null : undefined);
            } else {
              const n = baseType === "integer" ? parseInt(raw, 10) : parseFloat(raw);
              onChange(isNaN(n) ? undefined : n);
            }
          }}
          className="mt-1.5 border-white/10 bg-black/20 text-gray-100 rounded-lg"
        />
      </div>
    );
  }

  // String fallback
  return (
    <div>
      <Label className="text-gray-300 text-sm">{label}</Label>
      <Input
        type="text"
        value={value != null ? String(value) : ""}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 border-white/10 bg-black/20 text-gray-100 rounded-lg"
      />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function DynamicParamForm({ schema, form }: DynamicParamFormProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const strategyParams = (form.watch("strategyParams") ?? {}) as Record<string, unknown>;

  function setParam(key: string, value: unknown) {
    const current = (form.getValues("strategyParams") ?? {}) as Record<string, unknown>;
    form.setValue("strategyParams", { ...current, [key]: value }, { shouldDirty: true });
  }

  const entries = Object.entries(schema.properties);
  const mainFields = entries.filter(([, f]) => !isOptionalField(f));
  const advancedFields = entries.filter(([, f]) => isOptionalField(f));

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {mainFields.map(([name, fieldDef]) => (
          <ParamField
            key={name}
            name={name}
            field={fieldDef}
            value={strategyParams[name] ?? fieldDef.default}
            onChange={(val) => setParam(name, val)}
          />
        ))}
      </div>

      {advancedFields.length > 0 && (
        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleTrigger className="mt-4 flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors">
            {advancedOpen ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            Advanced Parameters
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {advancedFields.map(([name, fieldDef]) => (
                <ParamField
                  key={name}
                  name={name}
                  field={fieldDef}
                  value={strategyParams[name] ?? fieldDef.default}
                  onChange={(val) => setParam(name, val)}
                />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </>
  );
}

// ── Helper: build default strategyParams from a schema ───────────────────────

export function buildDefaultParams(schema: StrategyParametersSchema): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema.properties)) {
    if ("default" in field) {
      defaults[key] = field.default;
    }
  }
  return defaults;
}
