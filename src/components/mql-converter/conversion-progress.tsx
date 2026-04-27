"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { MqlConverterStatus } from "@/hooks/use-mql-converter";

interface ConversionProgressProps {
  status: MqlConverterStatus;
  onCancel: () => void;
}

const STEP_CONFIG: Record<
  string,
  { label: string; description: string; progress: number; step: number }
> = {
  converting: {
    label: "Converting MQL to Python",
    description: "AI is analyzing your Expert Adviser and generating a Python strategy...",
    progress: 33,
    step: 1,
  },
  fetching_data: {
    label: "Loading MT5 Data",
    description: "Loading uploaded MT5 broker data for the selected range...",
    progress: 66,
    step: 2,
  },
  running: {
    label: "Running Backtest",
    description: "Executing the converted strategy on MT5 broker data...",
    progress: 80,
    step: 2,
  },
};

export function ConversionProgress({
  status,
  onCancel,
}: ConversionProgressProps) {
  const config = STEP_CONFIG[status];
  if (!config) return null;

  return (
    <div className="bg-white/5 backdrop-blur-xl rounded-3xl border border-white/5 p-8">
      <div className="flex flex-col items-center text-center">
        <Loader2 className="mb-4 h-10 w-10 animate-spin text-blue-400" />
        <h3 className="text-lg font-semibold text-slate-200">
          {config.label}
        </h3>
        <p className="mt-2 text-sm text-slate-500 max-w-md">
          {config.description}
        </p>

        <div className="mt-6 w-full max-w-xs">
          <Progress
            value={config.progress}
            className="h-2 bg-white/10"
          />
          <p className="mt-2 text-xs text-gray-500">
            Step {config.step} of 2
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={onCancel}
          className="mt-6 border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
          aria-label="Cancel conversion"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
