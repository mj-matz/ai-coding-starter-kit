"use client";

import { AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { BacktestFormValues } from "@/lib/backtest-types";

interface ConfigInheritancePanelProps {
  config: BacktestFormValues | null;
  historicalDate?: string;
}

export function ConfigInheritancePanel({ config, historicalDate }: ConfigInheritancePanelProps) {
  if (!config) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
        <AlertCircle className="h-5 w-5 shrink-0 text-amber-400" />
        <div>
          <p className="text-sm font-medium text-amber-300">
            No backtest configuration found
          </p>
          <p className="mt-0.5 text-xs text-amber-400/70">
            Please create and save a configuration in the Backtest tab first.
          </p>
        </div>
      </div>
    );
  }

  if (historicalDate) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
        <h3 className="mb-3 text-sm font-medium text-amber-400">
          Backtest Config (Historical run from {historicalDate})
        </h3>
        <ConfigBadges config={config} />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <h3 className="mb-3 text-sm font-medium text-gray-400">
        Active Backtest Configuration
      </h3>
      <ConfigBadges config={config} />
    </div>
  );
}

function ConfigBadges({ config }: { config: BacktestFormValues }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Badge variant="secondary" className="bg-blue-600/20 text-blue-300 border-blue-500/30">
        {config.symbol}
      </Badge>
      <Badge variant="secondary" className="bg-white/10 text-gray-300 border-white/10">
        {config.timeframe}
      </Badge>
      <Badge variant="secondary" className="bg-white/10 text-gray-300 border-white/10">
        {config.startDate} - {config.endDate}
      </Badge>
      <Badge variant="secondary" className="bg-white/10 text-gray-300 border-white/10">
        SL: {config.stopLoss} / TP: {config.takeProfit}
      </Badge>
      <Badge variant="secondary" className="bg-white/10 text-gray-300 border-white/10">
        Range: {config.rangeStart} - {config.rangeEnd}
      </Badge>
      <Badge variant="secondary" className="bg-white/10 text-gray-300 border-white/10">
        Deadline: {config.triggerDeadline}
      </Badge>
      <Badge variant="secondary" className="bg-white/10 text-gray-300 border-white/10">
        Exit: {config.timeExit}
      </Badge>
      {config.trailTriggerPips != null && (
        <Badge variant="secondary" className="bg-white/10 text-gray-300 border-white/10">
          Trail: {config.trailTriggerPips}/{config.trailLockPips}
        </Badge>
      )}
    </div>
  );
}
