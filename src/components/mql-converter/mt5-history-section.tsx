"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Clock,
  History,
  Loader2,
  RefreshCw,
  Server,
  Trash2,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
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
import type { Mt5RunStatus, Mt5TesterRun } from "@/lib/mt5-bridge-types";

// PROJ-37: MT5 Tester history list — analogous to PROJ-9 Backtest History.
// Shows the user's MT5 Strategy Tester runs with key metrics, status, and a
// delete action. Self-loading (fetches on mount); a manual Refresh button is
// provided so the user can pull new runs without leaving the tab.

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatProfit(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return value < 0 ? `-$${abs}` : `$${abs}`;
}

function formatPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.abs(value).toFixed(2)}%`;
}

function formatInt(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return Math.round(value).toLocaleString();
}

function StatusBadge({ status }: { status: Mt5RunStatus }) {
  if (status === "done") {
    return (
      <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/10">
        <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden />
        Completed
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge className="border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/10">
        <XCircle className="mr-1 h-3 w-3" aria-hidden />
        Failed
      </Badge>
    );
  }
  if (status === "cancelled") {
    return (
      <Badge className="border-slate-500/30 bg-slate-500/10 text-slate-300 hover:bg-slate-500/10">
        Cancelled
      </Badge>
    );
  }
  if (status === "running") {
    return (
      <Badge className="border-blue-500/30 bg-blue-500/10 text-blue-300 hover:bg-blue-500/10">
        <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden />
        Running
      </Badge>
    );
  }
  if (status === "queued") {
    return (
      <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/10">
        <Clock className="mr-1 h-3 w-3" aria-hidden />
        Queued
      </Badge>
    );
  }
  return (
    <Badge className="border-slate-500/30 bg-slate-500/10 text-slate-400 hover:bg-slate-500/10">
      {status}
    </Badge>
  );
}

interface Mt5HistorySectionProps {
  /** Bumped by the parent after a new run finishes so the table refetches. */
  refreshKey?: number;
}

export function Mt5HistorySection({ refreshKey = 0 }: Mt5HistorySectionProps) {
  const { toast } = useToast();
  const [runs, setRuns] = useState<Mt5TesterRun[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
          Convert an MQL Expert Adviser and click <span className="text-slate-300">Test in MT5</span>{" "}
          to run it on the connected Bridge Worker. Completed runs show up here.
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
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-slate-300">
          <History className="h-4 w-4 text-slate-400" aria-hidden />
          <span>{runs.length} run{runs.length === 1 ? "" : "s"}</span>
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
              const m = Array.isArray(run.metrics) && run.metrics.length > 0 ? run.metrics[0] : null;
              return (
                <TableRow key={run.id} className="border-white/10 hover:bg-white/5">
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
                    <StatusBadge status={run.status} />
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
                        >
                          {deletingId === run.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="border-white/10 bg-[#0d0f14] text-white">
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete MT5 Tester run</AlertDialogTitle>
                          <AlertDialogDescription className="text-gray-400">
                            Remove the run for <span className="text-slate-200">{run.expert_name}</span> on{" "}
                            <span className="text-slate-200">{run.symbol}</span>? This cannot be undone.
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
  );
}
