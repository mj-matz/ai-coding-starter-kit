"use client";

import { useEffect } from "react";
import { History, Trash2, Eye, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { OptimizationRun, TargetMetric } from "@/lib/optimizer-types";
import { PARAMETER_GROUP_LABELS, TARGET_METRIC_LABELS } from "@/lib/optimizer-types";

interface HistorySectionProps {
  runs: OptimizationRun[];
  loading: boolean;
  onFetch: () => void;
  onLoadRun: (id: string) => void;
  onDeleteRun: (id: string) => void;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function bestResultLabel(run: OptimizationRun): string {
  if (!run.best_result) return "—";
  const metric = run.target_metric as TargetMetric;
  const val = run.best_result[metric];
  if (val == null) return "—";
  const label = TARGET_METRIC_LABELS[metric];
  const params = Object.entries(run.best_result.params)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  return `${label}: ${typeof val === "number" ? val.toFixed(2) : val} (${params})`;
}

function StatusBadge({ status }: { status: OptimizationRun["status"] }) {
  const map: Record<OptimizationRun["status"], { label: string; className: string }> = {
    running: { label: "Running", className: "bg-blue-600/20 text-blue-300 border-blue-500/30" },
    completed: { label: "Completed", className: "bg-emerald-600/20 text-emerald-300 border-emerald-500/30" },
    cancelled: { label: "Cancelled", className: "bg-amber-600/20 text-amber-300 border-amber-500/30" },
    failed: { label: "Failed", className: "bg-red-600/20 text-red-300 border-red-500/30" },
  };
  const { label, className } = map[status] ?? map.failed;
  return (
    <Badge variant="secondary" className={`text-xs ${className}`}>
      {label}
    </Badge>
  );
}

export function HistorySection({
  runs,
  loading,
  onFetch,
  onLoadRun,
  onDeleteRun,
}: HistorySectionProps) {
  // Fetch on mount
  useEffect(() => {
    onFetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-gray-400" />
          <h3 className="text-sm font-medium text-gray-300">Optimizer History</h3>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onFetch}
          disabled={loading}
          className="h-7 text-xs text-gray-400 hover:text-white"
        >
          <RefreshCw className={`mr-1 h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {loading && runs.length === 0 && (
        <div className="flex h-20 items-center justify-center rounded-xl border border-white/10 bg-white/5">
          <p className="text-sm text-gray-500">Loading history...</p>
        </div>
      )}

      {!loading && runs.length === 0 && (
        <div className="flex h-20 items-center justify-center rounded-xl border border-white/10 bg-white/5">
          <p className="text-sm text-gray-500">No optimizer runs yet</p>
        </div>
      )}

      {runs.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-400">Datum</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-400">Asset</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-400">Gruppe</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-400 hidden sm:table-cell">Fortschritt</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-400 hidden lg:table-cell">Best Result</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-400">Status</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr
                  key={run.id}
                  className="border-b border-white/5 hover:bg-white/5"
                >
                  <td className="px-4 py-2.5 text-xs text-gray-400 whitespace-nowrap">
                    {fmtDate(run.created_at)}
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge variant="secondary" className="bg-blue-600/20 text-blue-300 border-blue-500/30 text-xs">
                      {run.asset}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-300 whitespace-nowrap">
                    {PARAMETER_GROUP_LABELS[run.parameter_group]}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-400 hidden sm:table-cell whitespace-nowrap">
                    {run.completed_combinations ?? 0} / {run.total_combinations}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-400 hidden lg:table-cell max-w-xs truncate">
                    {bestResultLabel(run)}
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusBadge status={run.status} />
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1 justify-end">
                      {(run.status === "completed" || run.status === "cancelled") && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onLoadRun(run.id)}
                          className="h-7 w-7 p-0 text-gray-400 hover:text-white"
                          title="Load results"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onDeleteRun(run.id)}
                        className="h-7 w-7 p-0 text-gray-400 hover:text-red-400"
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
