"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { History, Trash2, Pencil, Check, X, ChevronLeft, BookmarkPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";

import { MetricsSummaryCard } from "@/components/backtest/metrics-summary-card";
import { EquityCurveChart } from "@/components/backtest/equity-curve-chart";
import { DrawdownChart } from "@/components/backtest/drawdown-chart";
import { TradeListTable } from "@/components/backtest/trade-list-table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  useBacktestRuns,
  type BacktestRunSummary,
  type BacktestRunFull,
} from "@/hooks/use-backtest-runs";
import type { BacktestMetrics, MonthlyR, TradeRecord } from "@/lib/backtest-types";
import { loadConfigFromStorage } from "@/lib/backtest-types";

// ── Types ─────────────────────────────────────────────────────────────────────

interface RunSummaryData {
  metrics: BacktestMetrics;
  monthly_r?: MonthlyR[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function safeMetric(summary: Record<string, unknown>, key: string, decimals = 2): string {
  const metrics = summary?.metrics as Record<string, unknown> | undefined;
  const val = metrics?.[key];
  if (typeof val === "number") return val.toFixed(decimals);
  return "—";
}

function safeSummaryField(summary: Record<string, unknown>, key: string): string {
  const val = summary?.[key];
  if (typeof val === "string") return val;
  return "—";
}

// ── Empty State ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-3xl border border-white/5 bg-white/5 py-24 backdrop-blur-xl">
      <BookmarkPlus className="mb-4 h-12 w-12 text-slate-600" />
      <h3 className="text-lg font-medium text-slate-300">Keine gespeicherten Runs</h3>
      <p className="mt-2 text-center text-sm text-slate-500">
        Führe einen Backtest durch und speichere ihn, um deine History zu starten.
      </p>
    </div>
  );
}

// ── Inline Rename ─────────────────────────────────────────────────────────────

interface InlineRenameProps {
  id: string;
  name: string;
  onRename: (id: string, name: string) => Promise<boolean>;
}

function InlineRename({ id, name, onRename }: InlineRenameProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    const trimmed = value.trim();
    if (!trimmed || trimmed === name) {
      setEditing(false);
      setValue(name);
      return;
    }
    setSaving(true);
    const ok = await onRename(id, trimmed);
    setSaving(false);
    if (ok) setEditing(false);
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2 group">
        <span className="text-slate-200 font-medium">{name}</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 opacity-0 group-hover:opacity-100 text-slate-500 hover:text-white transition-opacity"
          onClick={(e) => { e.stopPropagation(); setEditing(true); setValue(name); }}
          aria-label="Umbenennen"
        >
          <Pencil className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSave();
          if (e.key === "Escape") { setEditing(false); setValue(name); }
        }}
        className="h-7 border-white/10 bg-white/5 text-white text-sm"
        autoFocus
        disabled={saving}
      />
      <Button variant="ghost" size="icon" className="h-7 w-7 text-emerald-400 hover:text-emerald-300" onClick={handleSave} disabled={saving} aria-label="Speichern">
        <Check className="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-500 hover:text-white" onClick={() => { setEditing(false); setValue(name); }} disabled={saving} aria-label="Abbrechen">
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

const KNOWN_STRATEGIES = ["time_range_breakout"];

// ── Run Detail View ───────────────────────────────────────────────────────────

interface RunDetailViewProps {
  run: BacktestRunFull;
  onBack: () => void;
}

function RunDetailView({ run, onBack }: RunDetailViewProps) {
  const summary = run.summary as unknown as RunSummaryData;
  const trades = (run.trade_log ?? []) as unknown as TradeRecord[];
  const charts = run.charts ?? {};
  const equityCurve = (charts.equity_curve ?? []) as unknown as { date: string; balance: number }[];
  const drawdownCurve = (charts.drawdown_curve ?? []) as unknown as { date: string; drawdown_pct: number }[];
  const config = run.config as Record<string, unknown>;
  const rangeStart = (config?.rangeStart as string) ?? "02:00";
  const rangeEnd = (config?.rangeEnd as string) ?? "06:00";
  const triggerDeadline = (config?.triggerDeadline as string) ?? "12:00";
  const initialCapital = (config?.initialCapital as number) ?? 10000;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="text-slate-400 hover:text-white"
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          Zurück zur History
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">{run.name}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {run.asset} · {run.strategy} · gespeichert am {formatDate(run.created_at)}
        </p>
      </div>

      {!KNOWN_STRATEGIES.includes(run.strategy) && (
        <div className="rounded-xl border border-yellow-900/50 bg-yellow-950/30 px-4 py-3 text-sm text-yellow-300">
          Strategie &quot;{run.strategy}&quot; ist im System nicht mehr verfügbar — die gespeicherten Ergebnisse bleiben gültig, können aber nicht erneut ausgeführt werden.
        </div>
      )}

      {summary?.metrics ? (
        <MetricsSummaryCard
          metrics={summary.metrics}
          initialCapital={initialCapital}
          monthlyR={summary.monthly_r}
        />
      ) : (
        <p className="text-slate-500 text-sm">Keine Metriken verfügbar.</p>
      )}

      <Tabs defaultValue="charts" className="w-full">
        <TabsList className="bg-white/5 border border-white/10">
          <TabsTrigger value="charts" className="text-slate-400 data-[state=active]:bg-white/10 data-[state=active]:text-slate-100">
            Charts
          </TabsTrigger>
          <TabsTrigger value="trades" className="text-slate-400 data-[state=active]:bg-white/10 data-[state=active]:text-slate-100">
            Trades ({trades.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="charts" className="mt-4 space-y-6">
          <EquityCurveChart data={equityCurve} />
          <DrawdownChart data={drawdownCurve} />
        </TabsContent>

        <TabsContent value="trades" className="mt-4">
          <TradeListTable
            trades={trades}
            skippedDays={[]}
            timeframe={(config?.timeframe as string) ?? "1m"}
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            triggerDeadline={triggerDeadline}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function HistoryPage() {
  const { runs, isLoading, error, fetchRuns, deleteRun, renameRun, loadRun, isDeleting } =
    useBacktestRuns();
  const router = useRouter();

  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [detailRun, setDetailRun] = useState<BacktestRunFull | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [confirmLoadRun, setConfirmLoadRun] = useState<BacktestRunSummary | null>(null);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  const handleOpenRun = useCallback(
    async (run: BacktestRunSummary) => {
      setLoadingId(run.id);
      const full = await loadRun(run.id);
      setLoadingId(null);
      if (full) setDetailRun(full);
    },
    [loadRun]
  );

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTargetId) return;
    await deleteRun(deleteTargetId);
    setDeleteTargetId(null);
  }, [deleteTargetId, deleteRun]);

  const doLoadConfig = useCallback(
    async (run: BacktestRunSummary) => {
      const full = await loadRun(run.id);
      if (!full) return;
      const params = new URLSearchParams();
      params.set("config", JSON.stringify(full.config));
      router.push(`/backtest?${params.toString()}`);
    },
    [loadRun, router]
  );

  const handleLoadConfig = useCallback(
    (run: BacktestRunSummary, e: React.MouseEvent) => {
      e.stopPropagation();
      if (loadConfigFromStorage()) {
        setConfirmLoadRun(run);
      } else {
        doLoadConfig(run);
      }
    },
    [doLoadConfig]
  );

  if (detailRun) {
    return <RunDetailView run={detailRun} onBack={() => setDetailRun(null)} />;
  }

  return (
    <>
      <AlertDialog open={!!confirmLoadRun} onOpenChange={(open) => { if (!open) setConfirmLoadRun(null); }}>
        <AlertDialogContent className="border-white/10 bg-[#0d0f14] text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Config laden?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              Die aktuelle Backtest-Konfiguration wird überschrieben. Nicht gespeicherte Einstellungen gehen verloren.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white">
              Abbrechen
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (confirmLoadRun) doLoadConfig(confirmLoadRun); setConfirmLoadRun(null); }}
              className="bg-blue-600 text-white hover:bg-blue-700"
            >
              Laden
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteTargetId} onOpenChange={(open) => { if (!open) setDeleteTargetId(null); }}>
        <AlertDialogContent className="border-white/10 bg-[#0d0f14] text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Run löschen?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              Dieser Run wird permanent gelöscht und kann nicht wiederhergestellt werden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white">
              Abbrechen
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <History className="h-6 w-6" />
            Backtest History
          </h1>
          <p className="mt-1 text-gray-400">
            Alle gespeicherten Backtest-Runs auf einen Blick.
          </p>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-20 text-slate-500">
            Lade History...
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {!isLoading && !error && runs.length === 0 && <EmptyState />}

        {!isLoading && runs.length > 0 && (
          <div className="rounded-2xl border border-white/5 bg-white/5 backdrop-blur-xl overflow-hidden overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-white/5 hover:bg-transparent">
                  <TableHead className="text-slate-500">Name</TableHead>
                  <TableHead className="text-slate-500">Asset</TableHead>
                  <TableHead className="text-slate-500">Zeitraum</TableHead>
                  <TableHead className="text-slate-500">Strategie</TableHead>
                  <TableHead className="text-slate-500 text-right">Trades</TableHead>
                  <TableHead className="text-slate-500 text-right">Win Rate</TableHead>
                  <TableHead className="text-slate-500 text-right">Total R</TableHead>
                  <TableHead className="text-slate-500 text-right">Ø R/Monat</TableHead>
                  <TableHead className="text-slate-500">Gespeichert</TableHead>
                  <TableHead className="text-slate-500 text-right">Aktionen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow
                    key={run.id}
                    className="border-white/5 cursor-pointer hover:bg-white/5 transition-colors"
                    onClick={() => handleOpenRun(run)}
                  >
                    <TableCell>
                      <InlineRename id={run.id} name={run.name} onRename={renameRun} />
                      {loadingId === run.id && (
                        <span className="ml-2 text-xs text-slate-500">Lade...</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="border-white/10 text-slate-300">
                        {run.asset}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-slate-400 text-sm whitespace-nowrap">
                      {safeSummaryField(run.summary, "start_date")} – {safeSummaryField(run.summary, "end_date")}
                    </TableCell>
                    <TableCell className="text-slate-400 text-sm">{run.strategy}</TableCell>
                    <TableCell className="text-right text-slate-300">
                      {safeMetric(run.summary, "total_trades", 0)}
                    </TableCell>
                    <TableCell className="text-right text-slate-300">
                      {safeMetric(run.summary, "win_rate_pct")}%
                    </TableCell>
                    <TableCell className="text-right text-slate-300">
                      {safeMetric(run.summary, "total_r")}R
                    </TableCell>
                    <TableCell className="text-right text-slate-300">
                      {safeMetric(run.summary, "avg_r_per_month")}R
                    </TableCell>
                    <TableCell className="text-slate-500 text-sm">
                      {formatDate(run.created_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs text-slate-400 hover:text-white"
                          onClick={(e) => handleLoadConfig(run, e)}
                        >
                          Config laden
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-slate-500 hover:text-red-400"
                          onClick={(e) => { e.stopPropagation(); setDeleteTargetId(run.id); }}
                          disabled={isDeleting === run.id}
                          aria-label="Run löschen"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </>
  );
}
