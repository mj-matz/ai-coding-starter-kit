"use client";

import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  Server,
  XCircle,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import type { BacktestResult } from "@/lib/backtest-types";
import type {
  Mt5RunStatus,
  Mt5TesterMetrics,
} from "@/lib/mt5-bridge-types";
import type { Mt5TesterRunPhase } from "@/hooks/use-mt5-tester-run";

// PROJ-37: Side-by-side comparison panel — Python backtest vs MT5 Strategy Tester.
//
// - Renders the four "Parität" metrics: Profit, Sharpe, Drawdown, Trades.
// - Highlights a discrepancy when |python.profit − mt5.profit| / |python.profit| > 5 %.
// - Shows the run lifecycle (queued, running, done, failed) inside the MT5 column.

interface Mt5ResultPanelProps {
  pythonResult: BacktestResult | null;
  mt5Status: Mt5RunStatus | null;
  mt5Phase: Mt5TesterRunPhase;
  mt5Metrics: Mt5TesterMetrics | null;
  mt5ErrorMessage: string | null;
  mt5QueuePosition: number | null;
  mt5RunningElapsedSec: number | null;
  /** Saved-conversion id the Python result is tied to (page-level state).
   * Null until the user saves the conversion. */
  pythonConversionId: string | null;
  /** Saved-conversion id the MT5 run was started with — captured by
   * useMt5TesterRun at run start. Null when the user hadn't saved yet. */
  mt5ConversionId: string | null;
}

const DISCREPANCY_THRESHOLD = 0.05;

function formatNumber(value: number | null | undefined, decimals = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
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
  return `${value >= 0 ? "" : "-"}${Math.abs(value).toFixed(2)}%`;
}

function formatInt(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return Math.round(value).toLocaleString();
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface Row {
  label: string;
  python: string;
  mt5: string;
  pythonValue: number | null;
  mt5Value: number | null;
  /** When true, treat as a "discrepancy candidate" (currently profit only). */
  isProfit?: boolean;
}

function computeRows(
  pythonResult: BacktestResult | null,
  mt5: Mt5TesterMetrics | null
): Row[] {
  const pythonProfit = pythonResult?.metrics?.net_profit ?? null;
  const pythonSharpe = pythonResult?.metrics?.sharpe_ratio ?? null;
  const pythonDdPct = pythonResult?.metrics?.max_drawdown_pct ?? null;
  const pythonTrades = pythonResult?.metrics?.total_trades ?? null;

  return [
    {
      label: "Net Profit",
      python: formatProfit(pythonProfit),
      mt5: formatProfit(mt5?.total_net_profit),
      pythonValue: pythonProfit,
      mt5Value: mt5?.total_net_profit ?? null,
      isProfit: true,
    },
    {
      label: "Sharpe Ratio",
      python: formatNumber(pythonSharpe),
      mt5: formatNumber(mt5?.sharpe_ratio),
      pythonValue: pythonSharpe,
      mt5Value: mt5?.sharpe_ratio ?? null,
    },
    {
      label: "Max Drawdown",
      python: formatPct(pythonDdPct),
      mt5: formatPct(mt5?.max_drawdown_pct),
      pythonValue: pythonDdPct,
      mt5Value: mt5?.max_drawdown_pct ?? null,
    },
    {
      label: "Total Trades",
      python: formatInt(pythonTrades),
      mt5: formatInt(mt5?.total_trades),
      pythonValue: pythonTrades,
      mt5Value: mt5?.total_trades ?? null,
    },
  ];
}

function computeDiscrepancy(rows: Row[]): { hasDiscrepancy: boolean; pct: number | null } {
  const profitRow = rows.find((r) => r.isProfit);
  if (!profitRow) return { hasDiscrepancy: false, pct: null };
  const a = profitRow.pythonValue;
  const b = profitRow.mt5Value;
  if (a == null || b == null) return { hasDiscrepancy: false, pct: null };
  const denom = Math.abs(a);
  if (denom < 1e-9) {
    // Avoid divide-by-zero; consider "differ" when one side is non-zero.
    return { hasDiscrepancy: Math.abs(b) > 1e-9, pct: null };
  }
  const pct = Math.abs(a - b) / denom;
  return { hasDiscrepancy: pct > DISCREPANCY_THRESHOLD, pct };
}

interface RunStatusBadgeProps {
  status: Mt5RunStatus | null;
  phase: Mt5TesterRunPhase;
  queuePosition: number | null;
  runningElapsedSec: number | null;
}

function RunStatusBadge({ status, phase, queuePosition, runningElapsedSec }: RunStatusBadgeProps) {
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
        {typeof runningElapsedSec === "number" && (
          <span className="ml-1 font-mono text-[10px]">{formatElapsed(runningElapsedSec)}</span>
        )}
      </Badge>
    );
  }

  if (status === "queued") {
    return (
      <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/10">
        <Clock className="mr-1 h-3 w-3" aria-hidden />
        Queued
        {typeof queuePosition === "number" && queuePosition > 0 && (
          <span className="ml-1 text-[10px]">(pos {queuePosition})</span>
        )}
      </Badge>
    );
  }

  if (phase === "submitting" || status === "pending") {
    return (
      <Badge className="border-blue-500/30 bg-blue-500/10 text-blue-300 hover:bg-blue-500/10">
        <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden />
        Starting…
      </Badge>
    );
  }

  return null;
}

export function Mt5ResultPanel(props: Mt5ResultPanelProps) {
  const {
    pythonResult,
    mt5Status,
    mt5Phase,
    mt5Metrics,
    mt5ErrorMessage,
    mt5QueuePosition,
    mt5RunningElapsedSec,
    pythonConversionId,
    mt5ConversionId,
  } = props;

  const rows = computeRows(pythonResult, mt5Metrics);
  const { hasDiscrepancy, pct } = computeDiscrepancy(rows);
  const isFailed = mt5Status === "failed";
  const isInFlight = mt5Status === "queued" || mt5Status === "running" || mt5Status === "pending";
  const isDone = mt5Status === "done";

  // Render the side-by-side comparison only when BOTH sides have results.
  // Rendering with one side missing produces a misleading row of "—" values.
  const hasBothResults = !!pythonResult && !!mt5Metrics;

  // Discrepancy warning is gated even tighter: both metrics + matching
  // mql_conversion_id (Python and MT5 must reference the same saved
  // conversion). When either id is null, we cannot prove they describe the
  // same strategy, so we suppress the warning rather than risk a false alarm.
  const conversionMatches =
    pythonConversionId != null &&
    mt5ConversionId != null &&
    pythonConversionId === mt5ConversionId;
  const showDiscrepancyWarning = isDone && hasBothResults && hasDiscrepancy && conversionMatches;

  const noTrades =
    isDone && mt5Metrics && mt5Metrics.total_trades != null && mt5Metrics.total_trades === 0;

  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-md">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/30">
            <Server className="h-4 w-4" aria-hidden />
          </div>
          <div>
            <h3 className="text-base font-semibold text-white">Comparison: Python vs MT5</h3>
            <p className="text-xs text-slate-400">
              Strategy Tester run on the connected Bridge Worker (real-tick mode).
            </p>
          </div>
        </div>
        <RunStatusBadge
          status={mt5Status}
          phase={mt5Phase}
          queuePosition={mt5QueuePosition}
          runningElapsedSec={mt5RunningElapsedSec}
        />
      </div>

      {/* Discrepancy hint — only when both sides have data AND mql_conversion_id matches */}
      {showDiscrepancyWarning && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <AlertTriangle
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-help text-amber-400"
                  aria-hidden
                />
              </TooltipTrigger>
              <TooltipContent side="top">
                <p className="max-w-[260px] text-xs">
                  Python and MT5 differ by more than 5 % on Net Profit. Common causes: spread/swap
                  modeling, broker symbol differences, or commission per lot.
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <span>
            Discrepancy Python vs MT5{pct != null ? `: ${(pct * 100).toFixed(1)} %` : ""}
          </span>
        </div>
      )}

      {/* Failure */}
      {isFailed && mt5ErrorMessage && (
        <Alert
          variant="destructive"
          className="mb-4 border-rose-900/50 bg-rose-950/30 text-rose-200"
        >
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>MT5 Tester run failed</AlertTitle>
          <AlertDescription className="mt-1 whitespace-pre-wrap text-xs text-rose-200/80">
            {mt5ErrorMessage}
          </AlertDescription>
        </Alert>
      )}

      {/* Empty state — done but no trades */}
      {noTrades && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden />
          <span>Strategy generated no trades — check parameters and date range.</span>
        </div>
      )}

      {/* In-flight progress */}
      {isInFlight && !isFailed && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/5 px-3 py-2 text-xs text-blue-200">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-blue-400" aria-hidden />
          {mt5Status === "queued" ? (
            <span>
              Run queued
              {typeof mt5QueuePosition === "number" && mt5QueuePosition > 0
                ? ` at position ${mt5QueuePosition}`
                : ""}
              . The MT5 Strategy Tester runs jobs one at a time.
            </span>
          ) : (
            <span>
              Running on the Bridge Worker
              {typeof mt5RunningElapsedSec === "number"
                ? ` for ${formatElapsed(mt5RunningElapsedSec)}`
                : ""}
              …
            </span>
          )}
        </div>
      )}

      {/* Comparison table — gated on both sides having results to avoid
          rendering a misleading row of "—" placeholders. */}
      {hasBothResults && (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-black/20">
          <div className="grid grid-cols-3 gap-0 border-b border-white/10 px-4 py-2 text-[11px] uppercase tracking-wider text-slate-500">
            <div>Metric</div>
            <div className="text-right">Python</div>
            <div className="text-right">MT5</div>
          </div>
          {rows.map((row) => (
            <div
              key={row.label}
              className="grid grid-cols-3 items-center gap-0 border-b border-white/5 px-4 py-2 text-sm last:border-b-0"
            >
              <div className="text-slate-400">{row.label}</div>
              <div className="text-right font-medium text-slate-200">{row.python}</div>
              <div className="text-right font-medium text-slate-200">{row.mt5}</div>
            </div>
          ))}
        </div>
      )}

      {/* Single-side hints — explicitly tell the user why no comparison is shown. */}
      {!hasBothResults && !isInFlight && !isFailed && (
        <p className="mt-1 text-xs text-slate-500">
          {pythonResult && !mt5Metrics
            ? "Run the strategy in MT5 to compare the results side-by-side."
            : !pythonResult && mt5Metrics
              ? "Run a Python backtest to compare the results side-by-side."
              : "Run a Python backtest and click Test in MT5 to compare results side-by-side."}
        </p>
      )}

      {/* Conversion-id mismatch hint — both sides have results but they
          describe different saved conversions, so a discrepancy comparison
          would be misleading. */}
      {hasBothResults && isDone && !conversionMatches && (
        <p className="mt-3 text-[11px] text-slate-500">
          Discrepancy check skipped — Python and MT5 results refer to different
          saved conversions. Save the current conversion and re-run both sides
          to enable the &gt; 5 % parity warning.
        </p>
      )}
    </div>
  );
}
