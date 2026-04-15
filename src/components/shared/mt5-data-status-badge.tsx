"use client";

import { AlertCircle, CheckCircle2, Database } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  formatMt5Date,
  type Mt5Dataset,
  type Mt5Timeframe,
} from "@/lib/mt5-data-types";

// ── Props ───────────────────────────────────────────────────────────────────

interface Mt5DataStatusBadgeProps {
  /** The MT5 dataset that matches asset + timeframe, or undefined if none. */
  dataset: Mt5Dataset | undefined;
  /** Whether MT5 Mode toggle is on — only then does the badge matter. */
  mt5ModeEnabled: boolean;
  /** The currently requested backtest range, if set. */
  startDate?: string;
  endDate?: string;
  asset: string;
  timeframe: Mt5Timeframe | string;
}

// ── Component ───────────────────────────────────────────────────────────────

/**
 * Reusable indicator that tells the user which data source the backtest will use.
 *
 * Three states:
 *   1. MT5 data covers the requested range  → green "Using MT5 data"
 *   2. MT5 data missing                     → gray "Using Dukascopy (no MT5 data)"
 *   3. MT5 data present but range not fully covered → red alert
 */
export function Mt5DataStatusBadge({
  dataset,
  mt5ModeEnabled,
  startDate,
  endDate,
  asset,
  timeframe,
}: Mt5DataStatusBadgeProps) {
  if (!mt5ModeEnabled) return null;
  if (!asset) return null;

  // No MT5 data for this asset+timeframe
  if (!dataset) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-400">
        <Database className="h-3.5 w-3.5 shrink-0 text-slate-500" />
        <span>
          Using Dukascopy data (no MT5 data available for {asset} {String(timeframe).toUpperCase()})
        </span>
      </div>
    );
  }

  // MT5 data exists — check range coverage
  const coversRange = checkCoverage(dataset, startDate, endDate);

  if (coversRange === "uncovered") {
    return (
      <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-300">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
        <span>
          MT5 data for {asset} only covers {formatMt5Date(dataset.start_date)} -{" "}
          {formatMt5Date(dataset.end_date)}. Adjust the date range or upload additional data.
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-300">
      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
      <span>Using MT5 data</span>
      <Badge
        variant="secondary"
        className="ml-auto border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-200"
      >
        {dataset.candle_count.toLocaleString()} candles
      </Badge>
    </div>
  );
}

// ── Helper ──────────────────────────────────────────────────────────────────

type CoverageStatus = "covered" | "uncovered" | "unknown";

function checkCoverage(
  dataset: Mt5Dataset,
  startDate?: string,
  endDate?: string
): CoverageStatus {
  if (!startDate || !endDate) return "unknown";
  try {
    const requestStart = new Date(startDate).getTime();
    const requestEnd = new Date(endDate).getTime();
    const dataStart = new Date(dataset.start_date).getTime();
    const dataEnd = new Date(dataset.end_date).getTime();
    if (Number.isNaN(requestStart) || Number.isNaN(requestEnd)) return "unknown";
    if (dataStart > requestStart || dataEnd < requestEnd) return "uncovered";
    return "covered";
  } catch {
    return "unknown";
  }
}

/** Returns true if the requested range is fully covered by the dataset. */
export function mt5CoversRange(
  dataset: Mt5Dataset | undefined,
  startDate?: string,
  endDate?: string
): boolean {
  if (!dataset) return false;
  const status = checkCoverage(dataset, startDate, endDate);
  return status === "covered";
}
