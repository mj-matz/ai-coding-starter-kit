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
        <span>Keine Kombinationen konfiguriert</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Hash className="h-4 w-4 text-gray-400" />
        <span className="text-sm text-gray-300">
          Es werden{" "}
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
          Backtests ausgefuehrt
        </span>
      </div>

      {isExceeded && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          <p className="text-xs text-red-300">
            Zu viele Kombinationen (max. {OPTIMIZER_MAX_COMBINATIONS.toLocaleString()}).
            Bitte den Step-Wert erhoehen oder den Bereich verkleinern.
          </p>
        </div>
      )}

      {isWarning && !isExceeded && !hasWarningAcknowledged && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div>
            <p className="text-xs text-amber-300">
              Viele Kombinationen - das kann laenger dauern.
            </p>
            <button
              type="button"
              onClick={onAcknowledge}
              className="mt-1 text-xs font-medium text-amber-200 underline underline-offset-2 hover:text-amber-100"
            >
              Verstanden, trotzdem starten
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
