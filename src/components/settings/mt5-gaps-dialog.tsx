"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

import { type Mt5Dataset } from "@/lib/mt5-data-types";
import { type Mt5GapsResponse } from "@/app/api/mt5-data/datasets/[id]/gaps/route";

// ── Types ────────────────────────────────────────────────────────────────────

interface Mt5GapsDialogProps {
  dataset: Mt5Dataset | null;
  onClose: () => void;
}

interface MonthGroup {
  label: string;   // "January 2025"
  dates: string[]; // ISO date strings
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function dayName(iso: string): string {
  return DAY_NAMES[new Date(iso + "T00:00:00Z").getUTCDay()];
}

function groupByMonth(dates: string[]): MonthGroup[] {
  const map = new Map<string, string[]>();
  for (const d of dates) {
    const key = d.slice(0, 7); // "2025-01"
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(d);
  }
  return Array.from(map.entries()).map(([key, ds]) => {
    const [year, month] = key.split("-");
    const label = new Date(`${year}-${month}-01T00:00:00Z`).toLocaleDateString(
      undefined,
      { month: "long", year: "numeric", timeZone: "UTC" }
    );
    return { label, dates: ds };
  });
}

// ── Component ────────────────────────────────────────────────────────────────

export function Mt5GapsDialog({ dataset, onClose }: Mt5GapsDialogProps) {
  const [data, setData] = useState<Mt5GapsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dataset) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setData(null);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    setData(null);

    fetch(`/api/mt5-data/datasets/${dataset.id}/gaps`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? "Failed to load gap analysis");
        }
        return res.json() as Promise<Mt5GapsResponse>;
      })
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Unknown error"))
      .finally(() => setIsLoading(false));
  }, [dataset]);

  const groups = data ? groupByMonth(data.missing_dates) : [];
  const missingCount = data?.missing_dates.length ?? 0;
  const coveragePercent =
    data && data.expected_days > 0
      ? Math.round((data.days_with_data / data.expected_days) * 100)
      : null;

  return (
    <Dialog open={!!dataset} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[80vh] overflow-hidden flex flex-col border-white/10 bg-[#0d0f14] text-white sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Coverage Analysis
            {dataset && (
              <span className="text-slate-400 font-normal text-sm">
                — {dataset.asset}{" "}
                <Badge
                  variant="secondary"
                  className="border-white/10 bg-white/10 text-slate-300 ml-1"
                >
                  {dataset.timeframe.toUpperCase()}
                </Badge>
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* Body */}
        <div className="flex-1 overflow-y-auto min-h-0 pr-1">
          {isLoading && (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Analyzing candle coverage…
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-300">
              {error}
            </div>
          )}

          {data && (
            <div className="space-y-4">
              {/* Summary stats */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-center">
                  <div className="text-xl font-semibold tabular-nums text-slate-100">
                    {data.expected_days}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">Expected days</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-center">
                  <div className="text-xl font-semibold tabular-nums text-slate-100">
                    {data.days_with_data}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">Days with data</div>
                </div>
                <div
                  className={`rounded-lg border p-3 text-center ${
                    missingCount === 0
                      ? "border-emerald-500/30 bg-emerald-500/5"
                      : "border-amber-500/30 bg-amber-500/5"
                  }`}
                >
                  <div
                    className={`text-xl font-semibold tabular-nums ${
                      missingCount === 0 ? "text-emerald-400" : "text-amber-400"
                    }`}
                  >
                    {missingCount}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">Missing days</div>
                </div>
              </div>

              {/* Coverage bar */}
              {coveragePercent !== null && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>Coverage</span>
                    <span>{coveragePercent}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        coveragePercent === 100
                          ? "bg-emerald-500"
                          : coveragePercent >= 95
                          ? "bg-amber-500"
                          : "bg-red-500"
                      }`}
                      style={{ width: `${coveragePercent}%` }}
                    />
                  </div>
                </div>
              )}

              {/* No gaps */}
              {missingCount === 0 && (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm text-emerald-300">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  Complete coverage — no missing trading days found.
                </div>
              )}

              {/* Missing dates grouped by month */}
              {missingCount > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs text-amber-400">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Missing weekdays (weekend gaps are excluded)
                  </div>
                  {groups.map((group) => (
                    <div key={group.label}>
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-xs font-medium text-slate-300">
                          {group.label}
                        </span>
                        <Badge
                          variant="secondary"
                          className="border-amber-500/30 bg-amber-500/10 text-amber-400 text-[10px]"
                        >
                          {group.dates.length} missing
                        </Badge>
                      </div>
                      <div className="space-y-1">
                        {group.dates.map((d) => (
                          <div
                            key={d}
                            className="flex items-center justify-between rounded-md bg-white/[0.03] px-3 py-1.5 text-sm"
                          >
                            <span className="text-slate-200">{formatDate(d)}</span>
                            <span className="text-xs text-slate-500">{dayName(d)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
