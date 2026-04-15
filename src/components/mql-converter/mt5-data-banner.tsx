"use client";

import { AlertTriangle, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";

// ── Props ───────────────────────────────────────────────────────────────────

interface Mt5DataBannerProps {
  asset: string;
  timeframe: string;
  onUploadClick: () => void;
}

// ── Component ───────────────────────────────────────────────────────────────

/**
 * Warning banner shown in the MQL Converter when no MT5 data is available
 * for the currently selected asset + timeframe.
 *
 * PROJ-34: MT5 broker data is the recommended data source for MQL conversions
 * because it maximises parity with the user's live broker.
 */
export function Mt5DataBanner({ asset, timeframe, onUploadClick }: Mt5DataBannerProps) {
  if (!asset) return null;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 sm:flex-row sm:items-start">
      <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400" />
      <div className="flex-1">
        <p className="text-sm font-medium text-amber-300">
          No MT5 data available for {asset} {timeframe.toUpperCase()}
        </p>
        <p className="mt-1 text-xs text-amber-300/80">
          Results may differ from your MT5 broker. Upload an MT5 History Center CSV export to run the backtest against your broker&apos;s exact prices.
        </p>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={onUploadClick}
        className="shrink-0 border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20 hover:text-amber-100"
      >
        <Upload className="mr-1.5 h-3.5 w-3.5" />
        Upload MT5 Data
      </Button>
    </div>
  );
}
