"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  TARGET_METRICS,
  TARGET_METRIC_LABELS,
  type ConstraintMetric,
  type HardConstraint,
} from "@/lib/optimizer-types";

interface HardConstraintSectionProps {
  value: HardConstraint | null;
  onChange: (constraint: HardConstraint | null) => void;
  disabled?: boolean;
}

export function HardConstraintSection({
  value,
  onChange,
  disabled,
}: HardConstraintSectionProps) {
  const [expanded, setExpanded] = useState(value != null);

  function handleMetricChange(metric: string) {
    onChange({
      metric: metric as ConstraintMetric,
      threshold: value?.threshold ?? 0,
      direction: value?.direction ?? ">=",
    });
  }

  function handleDirectionChange(direction: string) {
    if (!value) return;
    onChange({ ...value, direction: direction as ">=" | "<=" });
  }

  function handleThresholdChange(raw: string) {
    if (!value) return;
    const num = parseFloat(raw);
    if (Number.isNaN(num)) return;
    onChange({ ...value, threshold: num });
  }

  function handleClear() {
    onChange(null);
    setExpanded(false);
  }

  function handleExpand() {
    setExpanded(true);
    if (!value) {
      // Set a sensible default when expanding
      onChange({
        metric: "max_drawdown_pct",
        threshold: 15,
        direction: "<=",
      });
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => (expanded ? setExpanded(false) : handleExpand())}
        disabled={disabled}
        className="flex items-center gap-2 text-sm font-medium text-gray-400 hover:text-white transition-colors disabled:opacity-50"
        aria-expanded={expanded}
        aria-label="Toggle hard constraint filter"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
        Hard Constraint Filter
        {value && (
          <span className="text-xs text-amber-400 font-normal">
            ({TARGET_METRIC_LABELS[value.metric]} {value.direction} {value.threshold})
          </span>
        )}
      </button>

      {expanded && (
        <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-4 space-y-4">
          <p className="text-xs text-gray-500">
            Exclude combinations that violate this constraint from the best result selection.
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {/* Constraint Metric */}
            <div className="space-y-1.5">
              <Label className="text-xs text-gray-400">Metric</Label>
              <Select
                value={value?.metric ?? ""}
                onValueChange={handleMetricChange}
                disabled={disabled}
              >
                <SelectTrigger
                  className="border-white/10 bg-black/20 text-sm text-gray-300"
                  aria-label="Constraint metric"
                >
                  <SelectValue placeholder="Select metric" />
                </SelectTrigger>
                <SelectContent>
                  {TARGET_METRICS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {TARGET_METRIC_LABELS[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Direction */}
            <div className="space-y-1.5">
              <Label className="text-xs text-gray-400">Direction</Label>
              <Select
                value={value?.direction ?? ">="}
                onValueChange={handleDirectionChange}
                disabled={disabled || !value}
              >
                <SelectTrigger
                  className="border-white/10 bg-black/20 text-sm text-gray-300"
                  aria-label="Constraint direction"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value=">=">{">="} threshold</SelectItem>
                  <SelectItem value="<=">{"<="} threshold</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Threshold */}
            <div className="space-y-1.5">
              <Label className="text-xs text-gray-400">Threshold</Label>
              <Input
                type="number"
                step="any"
                value={value?.threshold ?? ""}
                onChange={(e) => handleThresholdChange(e.target.value)}
                disabled={disabled || !value}
                className="border-white/10 bg-black/20 text-sm text-gray-300"
                aria-label="Constraint threshold"
              />
            </div>
          </div>

          {/* Clear button */}
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClear}
              disabled={disabled}
              className="h-7 text-xs text-gray-400 hover:text-white"
            >
              <X className="mr-1 h-3 w-3" />
              Clear Constraint
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
