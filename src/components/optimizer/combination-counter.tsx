"use client";

import { AlertTriangle, Hash } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  calculateCombinations,
  OPTIMIZER_WARN_COMBINATIONS,
  OPTIMIZER_MAX_COMBINATIONS,
  type ParameterRange,
} from "@/lib/optimizer-types";

interface CombinationCounterProps {
  ranges: Record<string, ParameterRange>;
  hasWarningAcknowledged: boolean;
  onAcknowledge: () => void;
}

export function CombinationCounter({
  ranges,
  hasWarningAcknowledged,
  onAcknowledge,
}: CombinationCounterProps) {
  const count = calculateCombinations(ranges);
  const isWarning = count > OPTIMIZER_WARN_COMBINATIONS;
  const isExceeded = count > OPTIMIZER_MAX_COMBINATIONS;

  if (count === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Hash className="h-4 w-4" />
        <span>No combinations configured</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Hash className="h-4 w-4 text-gray-400" />
        <span className="text-sm text-gray-300">
          Running{" "}
          <Badge
            variant="secondary"
            className={
              isExceeded
                ? "bg-red-600/20 text-red-300 border-red-500/30"
                : isWarning
                  ? "bg-amber-600/20 text-amber-300 border-amber-500/30"
                  : "bg-blue-600/20 text-blue-300 border-blue-500/30"
            }
          >
            {count.toLocaleString()}
          </Badge>{" "}
          backtests
        </span>
      </div>

      {isExceeded && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          <p className="text-xs text-red-300">
            Too many combinations (max. {OPTIMIZER_MAX_COMBINATIONS.toLocaleString()}).
            Please increase the step value or reduce the range.
          </p>
        </div>
      )}

      {isWarning && !isExceeded && !hasWarningAcknowledged && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div>
            <p className="text-xs text-amber-300">
              Many combinations — this may take a while.
            </p>
            <button
              type="button"
              onClick={onAcknowledge}
              className="mt-1 text-xs font-medium text-amber-200 underline underline-offset-2 hover:text-amber-100"
            >
              Got it, start anyway
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
