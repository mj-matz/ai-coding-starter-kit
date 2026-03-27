"use client";

import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  TARGET_METRICS,
  TARGET_METRIC_LABELS,
  type TargetMetric,
} from "@/lib/optimizer-types";

interface MetricSelectorProps {
  value: TargetMetric | null;
  onChange: (metric: TargetMetric) => void;
  disabled?: boolean;
}

export function MetricSelector({ value, onChange, disabled }: MetricSelectorProps) {
  return (
    <div>
      <h3 className="mb-3 text-sm font-medium text-gray-400">
        Zielmetrik
      </h3>
      <RadioGroup
        value={value ?? ""}
        onValueChange={(v) => onChange(v as TargetMetric)}
        className="flex flex-wrap gap-2"
        disabled={disabled}
        aria-label="Target metric selection"
      >
        {TARGET_METRICS.map((metric) => (
          <div
            key={metric}
            className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2 transition-colors hover:border-white/20 has-[button[data-state=checked]]:border-emerald-500/50 has-[button[data-state=checked]]:bg-emerald-600/10"
          >
            <RadioGroupItem
              value={metric}
              id={`metric-${metric}`}
              className="border-gray-600 text-emerald-500"
            />
            <Label
              htmlFor={`metric-${metric}`}
              className="cursor-pointer text-sm text-gray-300"
            >
              {TARGET_METRIC_LABELS[metric]}
            </Label>
          </div>
        ))}
      </RadioGroup>
    </div>
  );
}
