"use client";

import { useEffect, useState } from "react";
import { ArrowRight, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import type { Mt5TesterRun, Mt5TesterTrade } from "@/lib/mt5-bridge-types";
import { formatDate, formatInt, formatPct, formatProfit } from "@/lib/mt5-format";
import { Mt5StatusBadge } from "@/components/mt5/mt5-status-badge";

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/5 py-2.5 last:border-b-0">
      <span className="text-sm text-slate-400">{label}</span>
      <span className="text-sm font-medium text-slate-200">{value}</span>
    </div>
  );
}

export interface RunDetailViewProps {
  run: Mt5TesterRun;
  onBack: () => void;
  onUseSettings: (fullRun: Mt5TesterRun) => void;
}

// PROJ-41 (UI iteration): inline detail view (replaces the previous Sheet drawer)
// so the trades table can use the full page width — matches the PROJ-9 history
// pattern. Renders in place of the history table; "Back" returns to the list.
export function RunDetailView({ run, onBack, onUseSettings }: RunDetailViewProps) {
  const [fetchedRunId, setFetchedRunId] = useState<string | null>(null);
  const [fullRun, setFullRun] = useState<Mt5TesterRun | null>(null);
  const [trades, setTrades] = useState<Mt5TesterTrade[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const isLoading = run != null && fetchedRunId !== run.id && !fetchError;

  useEffect(() => {
    if (!run) return;
    if (fetchedRunId === run.id) return;

    const runId = run.id;

    async function loadData() {
      setFetchError(null);
      const [runRes, tradesRes] = await Promise.all([
        fetch(`/api/mt5/tester/runs/${runId}`, { cache: "no-store" }),
        fetch(`/api/mt5/tester/runs/${runId}/trades`, { cache: "no-store" }),
      ]);
      if (!runRes.ok) {
        const err = (await runRes.json().catch(() => null)) as { error?: string } | null;
        throw new Error(err?.error ?? `Failed to load run (${runRes.status})`);
      }
      const runData = (await runRes.json()) as Mt5TesterRun;
      const tradesData = tradesRes.ok
        ? ((await tradesRes.json()) as { trades?: Mt5TesterTrade[] })
        : { trades: [] };
      setFullRun(runData);
      setTrades(Array.isArray(tradesData.trades) ? tradesData.trades : []);
      setFetchedRunId(runId);
    }

    void loadData().catch((err: unknown) => {
      setFetchError(err instanceof Error ? err.message : "Failed to load run details");
    });
  }, [run, fetchedRunId]);

  const displayRun = fetchedRunId === run?.id ? fullRun : run;
  const m =
    Array.isArray(displayRun?.metrics) && displayRun.metrics.length > 0
      ? displayRun.metrics[0]
      : null;
  const parameters = fullRun?.parameters ? Object.entries(fullRun.parameters) : [];

  const winRate =
    m?.total_trades && m.total_trades > 0 && m.won_trades != null
      ? `${((m.won_trades / m.total_trades) * 100).toFixed(1)}%`
      : "—";

  return (
    <div className="space-y-6">
      {/* Back button */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="text-slate-400 hover:text-white"
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          Back to history
        </Button>
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-2xl font-bold tracking-tight text-white">
          {displayRun?.expert_name ?? "Run Details"}
        </h2>
        {displayRun && <Mt5StatusBadge status={displayRun.status} />}
      </div>
      {displayRun && (
        <p className="-mt-3 text-sm text-slate-400">
          Started {formatDate(displayRun.started_at)}
          {displayRun.finished_at && ` · Finished ${formatDate(displayRun.finished_at)}`}
        </p>
      )}

      {/* Settings + Parameters side-by-side on wide screens */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Run Settings */}
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Run Settings
          </h3>
          <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-1">
            <MetricRow label="Symbol" value={displayRun?.symbol ?? "—"} />
            <MetricRow
              label="Timeframe"
              value={displayRun?.timeframe?.toUpperCase() ?? "—"}
            />
            <MetricRow label="From" value={displayRun?.from_date?.slice(0, 10) ?? "—"} />
            <MetricRow label="To" value={displayRun?.to_date?.slice(0, 10) ?? "—"} />
            <MetricRow
              label="Model"
              value={isLoading ? "Loading…" : (fullRun?.model ?? "—")}
            />
          </div>
        </section>

        {/* Parameters */}
        {(isLoading || parameters.length > 0) && (
          <section>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
              Parameters
            </h3>
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-9 w-full bg-white/5" />
                <Skeleton className="h-9 w-full bg-white/5" />
                <Skeleton className="h-9 w-3/4 bg-white/5" />
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-white/10">
                <Table>
                  <TableHeader>
                    <TableRow className="border-white/10 hover:bg-transparent">
                      <TableHead className="text-slate-400">Variable</TableHead>
                      <TableHead className="text-right text-slate-400">Value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parameters.map(([key, value]) => (
                      <TableRow key={key} className="border-white/10 hover:bg-white/5">
                        <TableCell className="font-mono text-sm text-slate-300">
                          {key}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm text-slate-200">
                          {String(value)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>
        )}
      </div>

      {/* Use these settings */}
      <Button
        variant="outline"
        className="w-full border-blue-500/30 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20 hover:text-blue-200 sm:w-auto"
        disabled={!displayRun}
        onClick={() => {
          if (displayRun) onUseSettings(fullRun ?? displayRun);
        }}
      >
        Use these settings
        <ArrowRight className="ml-2 h-4 w-4" />
      </Button>

      <Separator className="bg-white/10" />

      {/* Metrics */}
      {m && (
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Metrics
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-1">
              <MetricRow label="Net Profit" value={formatProfit(m.total_net_profit)} />
              <MetricRow
                label="Sharpe Ratio"
                value={
                  m.sharpe_ratio != null && Number.isFinite(m.sharpe_ratio)
                    ? m.sharpe_ratio.toFixed(2)
                    : "—"
                }
              />
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-1">
              <MetricRow label="Max Drawdown" value={formatPct(m.max_drawdown_pct)} />
              <MetricRow
                label="Profit Factor"
                value={
                  m.profit_factor != null && Number.isFinite(m.profit_factor)
                    ? m.profit_factor.toFixed(2)
                    : "—"
                }
              />
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-1">
              <MetricRow label="Win Rate" value={winRate} />
              <MetricRow label="Total Trades" value={formatInt(m.total_trades)} />
            </div>
          </div>
        </section>
      )}

      {/* Trades */}
      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Trades
        </h3>

        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full bg-white/5" />
            ))}
          </div>
        )}

        {!isLoading && fetchError && (
          <p className="text-sm text-rose-300">{fetchError}</p>
        )}

        {!isLoading && !fetchError && trades.length === 0 && (
          <p className="text-sm text-slate-500">No trades recorded.</p>
        )}

        {!isLoading && !fetchError && trades.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/10 hover:bg-transparent">
                    <TableHead className="text-sm text-slate-400">Open</TableHead>
                    <TableHead className="text-sm text-slate-400">Close</TableHead>
                    <TableHead className="text-sm text-slate-400">Direction</TableHead>
                    <TableHead className="text-right text-sm text-slate-400">Volume</TableHead>
                    <TableHead className="text-right text-sm text-slate-400">Entry</TableHead>
                    <TableHead className="text-right text-sm text-slate-400">Exit</TableHead>
                    <TableHead className="text-right text-sm text-slate-400">Profit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trades.map((t) => (
                    <TableRow key={t.id} className="border-white/10 hover:bg-white/5">
                      <TableCell className="whitespace-nowrap text-sm text-slate-300">
                        {t.open_time ? new Date(t.open_time).toLocaleString() : "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-slate-300">
                        {t.close_time ? new Date(t.close_time).toLocaleString() : "—"}
                      </TableCell>
                      <TableCell>
                        <span
                          className={
                            t.direction === "buy"
                              ? "text-sm font-medium text-emerald-400"
                              : t.direction === "sell"
                                ? "text-sm font-medium text-rose-400"
                                : "text-sm text-slate-400"
                          }
                        >
                          {t.direction?.toUpperCase() ?? "—"}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-sm text-slate-300">
                        {t.volume ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-slate-300">
                        {t.open_price ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-slate-300">
                        {t.close_price ?? "—"}
                      </TableCell>
                      <TableCell
                        className={`text-right text-sm font-medium ${
                          t.profit != null && t.profit >= 0
                            ? "text-emerald-400"
                            : "text-rose-400"
                        }`}
                      >
                        {formatProfit(t.profit)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
