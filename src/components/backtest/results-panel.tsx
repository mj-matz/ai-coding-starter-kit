"use client";

import {
  AlertCircle,
  BarChart3,
  Loader2,
  Clock,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { MetricsSummaryCard } from "@/components/backtest/metrics-summary-card";
import { EquityCurveChart } from "@/components/backtest/equity-curve-chart";
import { DrawdownChart } from "@/components/backtest/drawdown-chart";
import { TradeListTable } from "@/components/backtest/trade-list-table";


import { SaveRunDialog } from "@/components/backtest/save-run-dialog";

import type { BacktestResult } from "@/lib/backtest-types";
import type { BacktestStatus } from "@/hooks/use-backtest";


interface ResultsPanelProps {
  status: BacktestStatus;
  result: BacktestResult | null;
  error: string | null;
  isTimedOut: boolean;
  onCancel: () => void;
  initialCapital: number;
  rangeStart: string;
  rangeEnd: string;
  triggerDeadline?: string;
  newsDates?: string[];
  startDate?: string;
  endDate?: string;
  onSaveRun?: (name: string) => Promise<void>;
  isSaving?: boolean;
  defaultRunName?: string;
  strategyParams?: Record<string, unknown>;
  /** When true, the trade-chart modal queries mt5_candles instead of the Dukascopy cache. */
  mt5Mode?: boolean;
  /** Falls back to result.symbol when omitted (kept for callers that pass it explicitly). */
  symbol?: string;
  /** IANA timezone for the trade-chart fetch window + range-box rendering. */
  instrumentTimezone?: string;
}

function EmptyState() {
  return (
    <div className="bg-white/5 backdrop-blur-xl rounded-3xl border border-white/5 flex flex-col items-center justify-center py-20">
      <BarChart3 className="mb-4 h-12 w-12 text-slate-600" />
      <h3 className="text-lg font-medium text-slate-300">No Results Yet</h3>
      <p className="mt-2 text-center text-sm text-slate-500">
        Configure your backtest parameters and click &quot;Run Backtest&quot;
        to see results here.
      </p>
    </div>
  );
}

interface LoadingStateProps {
  isTimedOut: boolean;
  onCancel: () => void;
}

function LoadingState({ isTimedOut, onCancel }: LoadingStateProps) {
  return (
    <div className="bg-white/5 backdrop-blur-xl rounded-3xl border border-white/5 flex flex-col items-center justify-center py-20">
      <Loader2 className="mb-4 h-10 w-10 animate-spin text-blue-400" />
      <h3 className="text-lg font-semibold text-slate-200">
        Running backtest...
      </h3>
      <p className="mt-2 text-sm text-slate-500">
        Processing your configuration. This may take a moment.
      </p>
      <div className="mt-6 text-center">
        {isTimedOut && (
          <div className="mb-3 flex items-center justify-center gap-2">
            <Clock className="h-4 w-4 text-amber-400" />
            <span className="text-sm text-amber-400">
              This can take up to 5 minutes. With these minutes you save a lot of time in manual backtesting.
            </span>
          </div>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={onCancel}
          className="border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
          aria-label="Cancel backtest"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

interface ErrorStateProps {
  error: string;
}

function ErrorState({ error }: ErrorStateProps) {
  return (
    <Alert
      variant="destructive"
      className="border-red-900/50 bg-red-950/30 text-red-300"
    >
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Backtest Failed</AlertTitle>
      <AlertDescription className="mt-2 text-red-300/80">
        {error}
      </AlertDescription>
    </Alert>
  );
}

function NoTradesState() {
  return (
    <div className="bg-white/5 backdrop-blur-xl rounded-3xl border border-white/5 flex flex-col items-center justify-center py-16">
      <BarChart3 className="mb-4 h-10 w-10 text-slate-600" />
      <h3 className="text-lg font-medium text-slate-300">No Trades Found</h3>
      <p className="mt-2 text-center text-sm text-slate-500">
        No trades were generated for this period and configuration. Try
        adjusting your parameters or date range.
      </p>
    </div>
  );
}

export function ResultsPanel({
  status,
  result,
  error,
  isTimedOut,
  onCancel,
  initialCapital,
  rangeStart,
  rangeEnd,
  triggerDeadline,
  newsDates,
  startDate = "",
  endDate = "",
  onSaveRun,
  isSaving = false,
  defaultRunName = "",
  strategyParams,
  mt5Mode,
  symbol,
  instrumentTimezone,
}: ResultsPanelProps) {
  if (status === "loading") {
    return <LoadingState isTimedOut={isTimedOut} onCancel={onCancel} />;
  }

  if (status === "error" && error) {
    return <ErrorState error={error} />;
  }

  if (!result) {
    return <EmptyState />;
  }

  if (result.trades.length === 0 && (result.skipped_days ?? []).length === 0) {
    return <NoTradesState />;
  }

  // Compute CRV from strategy config (takeProfit / stopLoss)
  const sp = strategyParams ?? {};
  const tp = typeof sp.takeProfit === "number" ? sp.takeProfit : null;
  const sl = typeof sp.stopLoss === "number" ? sp.stopLoss : null;
  const crv = tp != null && sl != null && sl > 0 ? tp / sl : null;

  return (
    <div className="space-y-6">
      {/* Metrics Summary (always visible) */}
      <MetricsSummaryCard metrics={result.metrics} initialCapital={initialCapital} monthlyR={result.monthly_r} crv={crv} />

      {/* Tabbed content: Charts and Trade List */}
      <Tabs defaultValue="charts" className="w-full">
        <TabsList className="bg-white/5 border border-white/10">
          <TabsTrigger
            value="charts"
            className="text-slate-400 data-[state=active]:bg-white/10 data-[state=active]:text-slate-100"
          >
            Charts
          </TabsTrigger>
          <TabsTrigger
            value="trades"
            className="text-slate-400 data-[state=active]:bg-white/10 data-[state=active]:text-slate-100"
          >
            Trades ({result.trades.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="charts" className="mt-4 space-y-6">
          <EquityCurveChart data={result.equity_curve} />
          <DrawdownChart data={result.drawdown_curve} />
        </TabsContent>

        <TabsContent value="trades" className="mt-4">
          <TradeListTable
            trades={result.trades}
            skippedDays={result.skipped_days ?? []}
            cacheId={result.cache_id}
            symbol={symbol ?? result.symbol}
            timeframe={result.timeframe}
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            triggerDeadline={triggerDeadline}
            newsDates={newsDates}
            mt5Mode={mt5Mode}
            instrumentTimezone={instrumentTimezone}
          />
        </TabsContent>
      </Tabs>

      {/* Save Run (PROJ-9) */}
      {onSaveRun && (
        <div className="flex justify-end">
          <SaveRunDialog
            defaultName={defaultRunName}
            isSaving={isSaving}
            onSave={onSaveRun}
          />
        </div>
      )}
    </div>
  );
}
