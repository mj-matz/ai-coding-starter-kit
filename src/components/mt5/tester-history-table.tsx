"use client";

import { useCallback, useEffect, useState } from "react";
import {
  History,
  Loader2,
  RefreshCw,
  Server,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { useToast } from "@/hooks/use-toast";
import type { Mt5TesterRun } from "@/lib/mt5-bridge-types";
import { formatDate, formatInt, formatPct, formatProfit } from "@/lib/mt5-format";
import { Mt5StatusBadge } from "@/components/mt5/mt5-status-badge";
import { RunDetailDrawer } from "@/components/mt5/run-detail-drawer";

interface TesterHistoryTableProps {
  refreshKey?: number;
  onUseSettings?: (run: Mt5TesterRun) => void;
}

export function TesterHistoryTable({ refreshKey = 0, onUseSettings }: TesterHistoryTableProps) {
  const { toast } = useToast();
  const [runs, setRuns] = useState<Mt5TesterRun[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<Mt5TesterRun | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const fetchRuns = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/mt5/tester/runs?limit=50", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Failed to load runs (${res.status})`);
        return;
      }
      setRuns(Array.isArray(data.runs) ? (data.runs as Mt5TesterRun[]) : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load runs");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRuns();
  }, [fetchRuns, refreshKey]);

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/mt5/tester/runs/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast({
          title: "Delete failed",
          description: data?.error ?? "Could not delete run.",
          variant: "destructive",
        });
        return;
      }
      setRuns((prev) => prev.filter((r) => r.id !== id));
      toast({ title: "Run deleted", description: "The MT5 tester run was removed." });
    } finally {
      setDeletingId(null);
    }
  }

  function handleRowClick(run: Mt5TesterRun) {
    if (run.status !== "done") return;
    setSelectedRun(run);
    setDrawerOpen(true);
  }

  if (isLoading && runs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="mb-4 h-8 w-8 animate-spin text-blue-400" />
        <p className="text-sm text-gray-400">Loading MT5 Tester runs…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-rose-900/50 bg-rose-950/20 px-5 py-4 text-sm text-rose-300">
        <div className="font-medium">Could not load MT5 Tester history.</div>
        <div className="mt-1 text-xs text-rose-300/80">{error}</div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void fetchRuns()}
          className="mt-3 border-rose-900/50 bg-rose-950/40 text-rose-300 hover:bg-rose-900/40 hover:text-rose-200"
        >
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Retry
        </Button>
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Server className="mb-4 h-12 w-12 text-slate-600" />
        <h3 className="text-lg font-medium text-slate-300">No MT5 Tester runs yet</h3>
        <p className="mt-2 max-w-sm text-center text-sm text-slate-500">
          Use the Tester tab or the MQL Converter to run a strategy on the connected Bridge Worker.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void fetchRuns()}
          className="mt-4 border-white/20 bg-white/10 text-slate-200 hover:bg-white/20"
        >
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-slate-300">
            <History className="h-4 w-4 text-slate-400" aria-hidden />
            <span>
              {runs.length} run{runs.length === 1 ? "" : "s"}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchRuns()}
            disabled={isLoading}
            className="border-white/20 bg-white/10 text-slate-200 hover:bg-white/20"
          >
            {isLoading ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            Refresh
          </Button>
        </div>

        <p className="text-xs text-slate-500">
          Click a completed row to view trade details and reuse settings.
        </p>

        {/* Table */}
        <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5">
          <Table>
            <TableHeader>
              <TableRow className="border-white/10 hover:bg-transparent">
                <TableHead className="text-slate-400">Started</TableHead>
                <TableHead className="text-slate-400">Expert</TableHead>
                <TableHead className="text-slate-400">Symbol</TableHead>
                <TableHead className="text-slate-400">TF</TableHead>
                <TableHead className="text-right text-slate-400">Profit</TableHead>
                <TableHead className="text-right text-slate-400">Sharpe</TableHead>
                <TableHead className="text-right text-slate-400">DD%</TableHead>
                <TableHead className="text-right text-slate-400">Trades</TableHead>
                <TableHead className="text-slate-400">Status</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => {
                const m =
                  Array.isArray(run.metrics) && run.metrics.length > 0
                    ? run.metrics[0]
                    : null;
                const isClickable = run.status === "done";
                return (
                  <TableRow
                    key={run.id}
                    className={`border-white/10 hover:bg-white/5 ${isClickable ? "cursor-pointer" : ""}`}
                    onClick={() => handleRowClick(run)}
                  >
                    <TableCell className="text-xs text-slate-300">
                      {formatDate(run.started_at)}
                    </TableCell>
                    <TableCell className="max-w-[180px] truncate text-sm text-slate-200">
                      {run.expert_name}
                    </TableCell>
                    <TableCell className="text-sm text-slate-200">{run.symbol}</TableCell>
                    <TableCell className="text-xs uppercase text-slate-400">
                      {run.timeframe}
                    </TableCell>
                    <TableCell className="text-right font-medium text-slate-200">
                      {formatProfit(m?.total_net_profit)}
                    </TableCell>
                    <TableCell className="text-right text-slate-300">
                      {m?.sharpe_ratio != null && Number.isFinite(m.sharpe_ratio)
                        ? m.sharpe_ratio.toFixed(2)
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right text-slate-300">
                      {formatPct(m?.max_drawdown_pct)}
                    </TableCell>
                    <TableCell className="text-right text-slate-300">
                      {formatInt(m?.total_trades)}
                    </TableCell>
                    <TableCell>
                      <Mt5StatusBadge status={run.status} />
                    </TableCell>
                    <TableCell>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={deletingId === run.id}
                            className="border-red-900/50 bg-red-950/20 text-red-400 hover:bg-red-950/40 hover:text-red-300"
                            aria-label={`Delete MT5 run for ${run.expert_name}`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {deletingId === run.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent
                          className="border-white/10 bg-[#0d0f14] text-white"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete MT5 Tester run</AlertDialogTitle>
                            <AlertDialogDescription className="text-gray-400">
                              Remove the run for{" "}
                              <span className="text-slate-200">{run.expert_name}</span> on{" "}
                              <span className="text-slate-200">{run.symbol}</span>? This cannot be
                              undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel className="border-white/20 bg-white/10 text-gray-300 hover:bg-white/20">
                              Cancel
                            </AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => void handleDelete(run.id)}
                              className="bg-red-700 text-white hover:bg-red-600"
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      <RunDetailDrawer
        run={selectedRun}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onUseSettings={(fullRun) => {
          setDrawerOpen(false);
          onUseSettings?.(fullRun);
        }}
      />
    </>
  );
}
