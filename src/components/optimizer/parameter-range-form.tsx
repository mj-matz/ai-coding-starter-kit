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

// ── Helpers for time input conversion ──────────────────────────────────────

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60).toString().padStart(2, "0");
  const m = (minutes % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m ?? 0);
}

// ── Parameter definitions per group ────────────────────────────────────────

interface ParamDef {
  key: string;
  label: string;
  unit: string;
  /** Min and Max are displayed as HH:MM time pickers; Step remains in minutes */
  isTimeInput?: boolean;
  defaults: { min: number; max: number; step: number };
}

const PARAMETER_DEFS: Record<ParameterGroup, ParamDef[]> = {
  crv: [
    { key: "stopLoss", label: "Stop Loss", unit: "pips", defaults: { min: 50, max: 200, step: 10 } },
    { key: "takeProfit", label: "Take Profit", unit: "pips", defaults: { min: 50, max: 300, step: 10 } },
  ],
  time_exit: [
    { key: "timeExit", label: "Time Exit", unit: "Minutes (from 00:00)", defaults: { min: 960, max: 1260, step: 30 } },
  ],
  trigger_deadline: [
    { key: "triggerDeadline", label: "Trigger Deadline", unit: "Minutes (from 00:00)", defaults: { min: 480, max: 840, step: 30 } },
  ],
  range_window: [
    { key: "rangeStart", label: "Range Start", unit: "Time (HH:MM)", isTimeInput: true, defaults: { min: 60, max: 240, step: 30 } },
    { key: "rangeEnd", label: "Range End", unit: "Time (HH:MM)", isTimeInput: true, defaults: { min: 240, max: 480, step: 30 } },
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
  const base = z.object(shape);

  if (group === "range_window") {
    return base.superRefine((data, ctx) => {
      const start = data as { rangeStart: { min: number }; rangeEnd: { min: number } };
      if (start.rangeEnd.min <= start.rangeStart.min) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Range End must be after Range Start",
          path: ["rangeEnd", "min"],
        });
      }
    });
  }

  return base;
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
        Parameter Ranges
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
                {/* Min */}
                <FormField
                  control={form.control}
                  name={`${def.key}.min`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-gray-500">Min</FormLabel>
                      <FormControl>
                        {def.isTimeInput ? (
                          <Input
                            type="time"
                            disabled={disabled}
                            value={minutesToTime(field.value as number)}
                            onChange={(e) => field.onChange(timeToMinutes(e.target.value))}
                            className="border-white/10 bg-black/30 text-gray-100 rounded-lg h-9 text-sm"
                            aria-label={`${def.label} minimum time`}
                          />
                        ) : (
                          <Input
                            {...field}
                            type="number"
                            step="any"
                            disabled={disabled}
                            className="border-white/10 bg-black/30 text-gray-100 rounded-lg h-9 text-sm"
                            aria-label={`${def.label} minimum`}
                          />
                        )}
                      </FormControl>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />
                {/* Max */}
                <FormField
                  control={form.control}
                  name={`${def.key}.max`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-gray-500">Max</FormLabel>
                      <FormControl>
                        {def.isTimeInput ? (
                          <Input
                            type="time"
                            disabled={disabled}
                            value={minutesToTime(field.value as number)}
                            onChange={(e) => field.onChange(timeToMinutes(e.target.value))}
                            className="border-white/10 bg-black/30 text-gray-100 rounded-lg h-9 text-sm"
                            aria-label={`${def.label} maximum time`}
                          />
                        ) : (
                          <Input
                            {...field}
                            type="number"
                            step="any"
                            disabled={disabled}
                            className="border-white/10 bg-black/30 text-gray-100 rounded-lg h-9 text-sm"
                            aria-label={`${def.label} maximum`}
                          />
                        )}
                      </FormControl>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />
                {/* Step — always a number (minutes) */}
                <FormField
                  control={form.control}
                  name={`${def.key}.step`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-gray-500">
                        Step{def.isTimeInput ? " (min)" : ""}
                      </FormLabel>
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
