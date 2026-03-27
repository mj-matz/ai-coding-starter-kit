"use client";

import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

import type { ParameterGroup, ParameterRange } from "@/lib/optimizer-types";
import { parameterRangeSchema } from "@/lib/optimizer-types";

// ── Parameter definitions per group ────────────────────────────────────────

interface ParamDef {
  key: string;
  label: string;
  unit: string;
  defaults: { min: number; max: number; step: number };
}

const PARAMETER_DEFS: Record<ParameterGroup, ParamDef[]> = {
  crv: [
    { key: "stopLoss", label: "Stop Loss", unit: "pips", defaults: { min: 50, max: 200, step: 10 } },
    { key: "takeProfit", label: "Take Profit", unit: "pips", defaults: { min: 50, max: 300, step: 10 } },
  ],
  time_exit: [
    { key: "timeExit", label: "Time Exit", unit: "Minuten (ab 00:00)", defaults: { min: 960, max: 1260, step: 30 } },
  ],
  trigger_deadline: [
    { key: "triggerDeadline", label: "Trigger Deadline", unit: "Minuten (ab 00:00)", defaults: { min: 480, max: 840, step: 30 } },
  ],
  range_window: [
    { key: "rangeStart", label: "Range Start", unit: "Minuten (ab 00:00)", defaults: { min: 60, max: 240, step: 30 } },
    { key: "rangeEnd", label: "Range End", unit: "Minuten (ab 00:00)", defaults: { min: 240, max: 480, step: 30 } },
  ],
  trailing_stop: [
    { key: "trailTriggerPips", label: "Trail Trigger", unit: "pips", defaults: { min: 50, max: 200, step: 10 } },
    { key: "trailLockPips", label: "Trail Lock", unit: "pips", defaults: { min: 20, max: 100, step: 10 } },
  ],
};

// ── Dynamic form schema ────────────────────────────────────────────────────

function buildSchema(group: ParameterGroup) {
  const defs = PARAMETER_DEFS[group];
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const def of defs) {
    shape[def.key] = parameterRangeSchema;
  }
  return z.object(shape);
}

type FormValues = Record<string, { min: number; max: number; step: number }>;

function getDefaults(group: ParameterGroup): FormValues {
  const defs = PARAMETER_DEFS[group];
  const result: FormValues = {};
  for (const def of defs) {
    result[def.key] = { ...def.defaults };
  }
  return result;
}

// ── Component ──────────────────────────────────────────────────────────────

interface ParameterRangeFormProps {
  group: ParameterGroup;
  onChange: (ranges: Record<string, ParameterRange>) => void;
  disabled?: boolean;
}

export function ParameterRangeForm({ group, onChange, disabled }: ParameterRangeFormProps) {
  const defs = PARAMETER_DEFS[group];
  const schema = useMemo(() => buildSchema(group), [group]);
  const defaults = useMemo(() => getDefaults(group), [group]);

  const form = useForm<FormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema) as any,
    defaultValues: defaults,
    mode: "onChange",
  });

  // Reset form when group changes
  useEffect(() => {
    form.reset(defaults);
  }, [group, defaults, form]);

  // Emit valid ranges on every change
  useEffect(() => {
    const subscription = form.watch((values) => {
      // Validate all ranges
      const result = schema.safeParse(values);
      if (result.success) {
        onChange(result.data as Record<string, ParameterRange>);
      }
    });
    return () => subscription.unsubscribe();
  }, [form, schema, onChange]);

  // Emit initial defaults
  useEffect(() => {
    onChange(defaults);
    // Only on mount/group change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group]);

  return (
    <div>
      <h3 className="mb-3 text-sm font-medium text-gray-400">
        Parameter-Bereiche
      </h3>
      <Form {...form}>
        <div className="space-y-4">
          {defs.map((def) => (
            <div key={def.key} className="rounded-lg border border-white/10 bg-black/20 p-4">
              <p className="mb-2 text-sm font-medium text-gray-300">
                {def.label}{" "}
                <span className="text-xs text-gray-500">({def.unit})</span>
              </p>
              <div className="grid grid-cols-3 gap-3">
                <FormField
                  control={form.control}
                  name={`${def.key}.min`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-gray-500">Min</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          step="any"
                          disabled={disabled}
                          className="border-white/10 bg-black/30 text-gray-100 rounded-lg h-9 text-sm"
                          aria-label={`${def.label} minimum`}
                        />
                      </FormControl>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name={`${def.key}.max`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-gray-500">Max</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          step="any"
                          disabled={disabled}
                          className="border-white/10 bg-black/30 text-gray-100 rounded-lg h-9 text-sm"
                          aria-label={`${def.label} maximum`}
                        />
                      </FormControl>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name={`${def.key}.step`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-gray-500">Step</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          step="any"
                          disabled={disabled}
                          className="border-white/10 bg-black/30 text-gray-100 rounded-lg h-9 text-sm"
                          aria-label={`${def.label} step size`}
                        />
                      </FormControl>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />
              </div>
            </div>
          ))}
        </div>
      </Form>
    </div>
  );
}
