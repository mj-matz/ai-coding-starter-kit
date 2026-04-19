"use client";

import { AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { BacktestFormValues } from "@/lib/backtest-types";
import { Mt5DataStatusBadge } from "@/components/shared/mt5-data-status-badge";
import { useMt5Data } from "@/hooks/use-mt5-data";

interface ConfigInheritancePanelProps {
  config: BacktestFormValues | null;
  historicalDate?: string;
  /** PROJ-34: Effective MT5 mode from the optimizer's independent toggle. */
  mt5ModeOverride?: boolean;
}

export function ConfigInheritancePanel({ config, historicalDate, mt5ModeOverride }: ConfigInheritancePanelProps) {
  const { findDataset } = useMt5Data();

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

  // PROJ-34: Use the optimizer's independent toggle if provided, else fall back to inherited config
  const effectiveMt5Mode = mt5ModeOverride !== undefined ? mt5ModeOverride : (config.mt5Mode ?? false);
  const mt5Badge = effectiveMt5Mode ? (
    <div className="mt-3">
      <Mt5DataStatusBadge
        mt5ModeEnabled
        asset={config.symbol}
        timeframe={config.timeframe}
        startDate={config.startDate}
        endDate={config.endDate}
        dataset={findDataset(config.symbol, config.timeframe)}
      />
    </div>
  ) : null;

  if (historicalDate) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
        <h3 className="mb-3 text-sm font-medium text-amber-400">
          Backtest Config (Historical run from {historicalDate})
        </h3>
        <ConfigBadges config={config} mt5ModeOverride={mt5ModeOverride} />
        {mt5Badge}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <h3 className="mb-3 text-sm font-medium text-gray-400">
        Active Backtest Configuration
      </h3>
      <ConfigBadges config={config} />
      {mt5Badge}
    </div>
  );
}

function ConfigBadges({ config, mt5ModeOverride }: { config: BacktestFormValues; mt5ModeOverride?: boolean }) {
  const effectiveMt5Mode = mt5ModeOverride !== undefined ? mt5ModeOverride : (config.mt5Mode ?? false);
  const p = (config.strategyParams ?? {}) as Record<string, unknown>;
  return (
    <div className="flex flex-wrap gap-2">
      <Badge variant="secondary" className="bg-blue-600/20 text-blue-300 border-blue-500/30">
        {config.strategy}
      </Badge>
      <Badge variant="secondary" className="bg-blue-600/20 text-blue-300 border-blue-500/30">
        {config.symbol}
      </Badge>
      <Badge variant="secondary" className="bg-white/10 text-gray-300 border-white/10">
        {config.timeframe}
      </Badge>
      <Badge variant="secondary" className="bg-white/10 text-gray-300 border-white/10">
        {config.startDate} - {config.endDate}
      </Badge>
      {p.stopLoss != null && (
        <Badge variant="secondary" className="bg-white/10 text-gray-300 border-white/10">
          SL: {String(p.stopLoss)} / TP: {p.takeProfit != null ? String(p.takeProfit) : "—"}
        </Badge>
      )}
      {p.rangeStart != null && (
        <Badge variant="secondary" className="bg-white/10 text-gray-300 border-white/10">
          Range: {String(p.rangeStart)} - {String(p.rangeEnd)}
        </Badge>
      )}
      {p.triggerDeadline != null && (
        <Badge variant="secondary" className="bg-white/10 text-gray-300 border-white/10">
          Deadline: {String(p.triggerDeadline)}
        </Badge>
      )}
      {p.timeExit != null && (
        <Badge variant="secondary" className="bg-white/10 text-gray-300 border-white/10">
          Exit: {String(p.timeExit)}
        </Badge>
      )}
      {p.trailTriggerPips != null && (
        <Badge variant="secondary" className="bg-white/10 text-gray-300 border-white/10">
          Trail: {String(p.trailTriggerPips)}/{String(p.trailLockPips)}
        </Badge>
      )}
      {effectiveMt5Mode ? (
        <Badge variant="secondary" className="bg-emerald-600/20 text-emerald-300 border-emerald-500/30">
          MT5 Data
        </Badge>
      ) : (
        <Badge variant="secondary" className="bg-white/10 text-gray-300 border-white/10">
          BID Data
        </Badge>
      )}
    </div>
  );
}
