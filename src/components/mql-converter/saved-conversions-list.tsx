"use client";

import { useEffect } from "react";
import { Loader2, Trash2, Upload, FileCode } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { SavedConversion, SavedConversionMetrics } from "@/hooks/use-mql-converter";

// ── Metrics summary ─────────────────────────────────────────────────────────

function MetricsSummary({ metrics }: { metrics: SavedConversionMetrics }) {
  const sign = metrics.total_return_pct >= 0 ? "+" : "";
  return (
    <div className="mt-1.5 flex gap-3 text-xs text-gray-500">
      <span>
        Return:{" "}
        <span className={metrics.total_return_pct >= 0 ? "text-green-400" : "text-red-400"}>
          {sign}{metrics.total_return_pct.toFixed(1)}%
        </span>
      </span>
      <span>Win Rate: {metrics.win_rate_pct.toFixed(1)}%</span>
      <span>Trades: {metrics.total_trades}</span>
    </div>
  );
}

// ── Version badge ───────────────────────────────────────────────────────────

function VersionBadge({ version }: { version: string }) {
  const label = version === "auto" ? "Auto" : version.toUpperCase();
  return (
    <Badge
      variant="outline"
      className="border-white/20 text-gray-400 text-xs"
    >
      {label}
    </Badge>
  );
}

// ── Props ───────────────────────────────────────────────────────────────────

interface SavedConversionsListProps {
  conversions: SavedConversion[];
  loading: boolean;
  onFetch: () => void;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
}

export function SavedConversionsList({
  conversions,
  loading,
  onFetch,
  onLoad,
  onDelete,
}: SavedConversionsListProps) {
  // Fetch on mount
  useEffect(() => {
    onFetch();
  }, [onFetch]);

  // Loading state
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="mb-4 h-8 w-8 animate-spin text-blue-400" />
        <p className="text-sm text-gray-400">Loading saved conversions...</p>
      </div>
    );
  }

  // Empty state
  if (conversions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <FileCode className="mb-4 h-12 w-12 text-slate-600" />
        <h3 className="text-lg font-medium text-slate-300">
          No Saved Conversions
        </h3>
        <p className="mt-2 text-center text-sm text-slate-500">
          Convert an MQL Expert Adviser and save it to see it here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {conversions.map((conversion) => (
        <div
          key={conversion.id}
          className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/5 px-5 py-4"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-medium text-white truncate">
                {conversion.name}
              </h4>
              <VersionBadge version={conversion.mql_version} />
            </div>
            <p className="mt-0.5 text-xs text-gray-500">
              {new Date(conversion.created_at).toLocaleDateString("en-US", {
                year: "numeric",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
            {conversion.backtest_result?.metrics && (
              <MetricsSummary metrics={conversion.backtest_result.metrics} />
            )}
          </div>

          <div className="flex shrink-0 gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onLoad(conversion.id)}
              className="border-white/20 bg-white/10 text-slate-200 hover:bg-white/20"
              aria-label={`Load conversion: ${conversion.name}`}
            >
              <Upload className="mr-1.5 h-3.5 w-3.5" />
              Load
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-red-900/50 bg-red-950/20 text-red-400 hover:bg-red-950/40 hover:text-red-300"
                  aria-label={`Delete conversion: ${conversion.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="border-white/10 bg-[#0d0f14] text-white">
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Conversion</AlertDialogTitle>
                  <AlertDialogDescription className="text-gray-400">
                    Are you sure you want to delete &quot;{conversion.name}&quot;? This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="border-white/20 bg-white/10 text-gray-300 hover:bg-white/20">
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => onDelete(conversion.id)}
                    className="bg-red-700 text-white hover:bg-red-600"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      ))}
    </div>
  );
}
