"use client";

import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  PARAMETER_GROUPS,
  PARAMETER_GROUP_LABELS,
  type ParameterGroup,
} from "@/lib/optimizer-types";

interface ParameterGroupSelectorProps {
  value: ParameterGroup | null;
  onChange: (group: ParameterGroup) => void;
  disabled?: boolean;
}

export function ParameterGroupSelector({
  value,
  onChange,
  disabled,
}: ParameterGroupSelectorProps) {
  return (
    <div>
      <h3 className="mb-3 text-sm font-medium text-gray-400">
        Parameter Group
      </h3>
      <RadioGroup
        value={value ?? ""}
        onValueChange={(v) => onChange(v as ParameterGroup)}
        className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3"
        disabled={disabled}
        aria-label="Parameter group selection"
      >
        {PARAMETER_GROUPS.map((group) => (
          <div
            key={group}
            className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 transition-colors hover:border-white/20 has-[button[data-state=checked]]:border-blue-500/50 has-[button[data-state=checked]]:bg-blue-600/10"
          >
            <RadioGroupItem
              value={group}
              id={`group-${group}`}
              className="border-gray-600 text-blue-500"
            />
            <Label
              htmlFor={`group-${group}`}
              className="cursor-pointer text-sm text-gray-300"
            >
              {PARAMETER_GROUP_LABELS[group]}
            </Label>
          </div>
        ))}
      </RadioGroup>
    </div>
  );
}
