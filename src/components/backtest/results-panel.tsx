"use client";

import {
  AlertCircle,
  BarChart3,
  Loader2,
  Clock,
  BookmarkPlus,
  FileDown,
  FileSpreadsheet,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

import { MetricsSummaryCard } from "@/components/backtest/metrics-summary-card";
import { EquityCurveChart } from "@/components/backtest/equity-curve-chart";
import { DrawdownChart } from "@/components/backtest/drawdown-chart";
import { TradeListTable } from "@/components/backtest/trade-list-table";

import { Progress } from "@/components/ui/progress";

import type { BacktestResult } from "@/lib/backtest-types";
import type { BacktestStatus, BacktestProgress } from "@/hooks/use-backtest";
import { useExportBacktest } from "@/hooks/use-export-backtest";

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
  progress?: BacktestProgress | null;
  isStreaming?: boolean;
  newsDates?: string[];
  startDate?: string;
  endDate?: string;
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
  progress?: BacktestProgress | null;
  isStreaming?: boolean;
}

function LoadingState({ isTimedOut, onCancel, progress, isStreaming }: LoadingStateProps) {
  const progressPercent = progress && progress.totalDays > 0
    ? Math.round((progress.daysDone / progress.totalDays) * 100)
    : 0;

  return (
    <div className="bg-white/5 backdrop-blur-xl rounded-3xl border border-white/5 flex flex-col items-center justify-center py-20">
      {isStreaming ? (
        <>
          <h3 className="text-lg font-semibold text-slate-200 mb-6">
            Running backtest...
          </h3>
          <div className="w-full max-w-md px-6">
            <div className="relative">
              <Progress
                value={progressPercent}
                className="h-6 bg-white/10"
              />
              {progress && progress.totalDays > 0 && (
                <span className="absolute inset-0 flex items-center justify-center text-xs font-medium text-white drop-shadow-sm">
                  {progress.daysDone} / {progress.totalDays} Tage
                </span>
              )}
            </div>
            {progress?.currentDate && (
              <p className="mt-2 text-center text-xs text-slate-500">
                {progress.currentDate}
              </p>
            )}
          </div>
        </>
      ) : (
        <>
          <Loader2 className="mb-4 h-10 w-10 animate-spin text-blue-400" />
          <h3 className="text-lg font-semibold text-slate-200">
            Running backtest...
          </h3>
          <p className="mt-2 text-sm text-slate-500">
            Processing your configuration. This may take a moment.
          </p>
        </>
      )}
      <div className="mt-6 text-center">
        {isTimedOut && (
          <div className="mb-3 flex items-center justify-center gap-2">
            <Clock className="h-4 w-4 text-amber-400" />
            <span className="text-sm text-amber-400">
              This is taking longer than expected...
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
  progress,
  isStreaming,
  newsDates,
  startDate = "",
  endDate = "",
}: ResultsPanelProps) {
  const { exportExcel, exportCsv, isExporting } = useExportBacktest();
  if (status === "loading") {
    return <LoadingState isTimedOut={isTimedOut} onCancel={onCancel} progress={progress} isStreaming={isStreaming} />;
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

  return (
    <div className="space-y-6">
      {/* Export buttons */}
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => exportExcel(result, startDate, endDate)}
          disabled={isExporting}
          className="border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
        >
          <FileSpreadsheet className="mr-2 h-4 w-4" />
          Export Excel
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => exportCsv(result, startDate, endDate)}
          disabled={isExporting}
          className="border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
        >
          <FileDown className="mr-2 h-4 w-4" />
          Export CSV
        </Button>
      </div>

      {/* Metrics Summary (always visible) */}
      <MetricsSummaryCard metrics={result.metrics} initialCapital={initialCapital} monthlyR={result.monthly_r} />

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
            timeframe={result.timeframe}
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            triggerDeadline={triggerDeadline}
            newsDates={newsDates}
          />
        </TabsContent>
      </Tabs>

      {/* Save Run placeholder (PROJ-9) */}
      <div className="flex justify-end">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                disabled
                className="border-white/10 bg-white/5 text-slate-500 hover:bg-white/10"
                aria-label="Save run - coming soon"
              >
                <BookmarkPlus className="mr-2 h-4 w-4" />
                Save Run
                <Badge
                  variant="secondary"
                  className="ml-2 bg-gray-800 text-gray-500"
                >
                  Coming Soon
                </Badge>
              </Button>
            </TooltipTrigger>
            <TooltipContent className="border-white/10 bg-[#0d0f14] text-slate-300">
              <p>Backtest history will be available in a future update.</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}
