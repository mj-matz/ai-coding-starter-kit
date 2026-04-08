"use client";

import { useState, useCallback, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ConfigurationPanel } from "@/components/backtest/configuration-panel";
import { ResultsPanel } from "@/components/backtest/results-panel";
import { useBacktest } from "@/hooks/use-backtest";
import { useBacktestRuns } from "@/hooks/use-backtest-runs";
import type { BacktestFormValues } from "@/lib/backtest-types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { FileDown, FileSpreadsheet } from "lucide-react";
import { useExportBacktest } from "@/hooks/use-export-backtest";
import { useToast } from "@/hooks/use-toast";

function BacktestPageInner() {
  const searchParams = useSearchParams();
  const preloadConfig = useMemo(() => {
    const raw = searchParams.get("config");
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as BacktestFormValues;
    } catch {
      return undefined;
    }
  }, [searchParams]);

  const { status, result, error, isTimedOut, warnings, newsDates, clearWarnings, runBacktest, cancel } =
    useBacktest();
  const { exportExcel, exportCsv, isExporting } = useExportBacktest();
  const { saveRun, isSaving } = useBacktestRuns();
  const { toast } = useToast();
  const [initialCapital, setInitialCapital] = useState(10000);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [symbol, setSymbol] = useState("XAUUSD");
  const [strategy, setStrategy] = useState("time_range_breakout");
  const [lastConfig, setLastConfig] = useState<BacktestFormValues | null>(null);

  function handleRunBacktest(config: BacktestFormValues) {
    setInitialCapital(config.initialCapital);
    setStartDate(config.startDate);
    setEndDate(config.endDate);
    setSymbol(config.symbol);
    setStrategy(config.strategy);
    setLastConfig(config);
    runBacktest(config);
  }

  const handleSaveRun = useCallback(
    async (name: string) => {
      if (!result || !lastConfig) return;
      const saved = await saveRun({
        name,
        asset: symbol,
        strategy,
        config: lastConfig as unknown as Record<string, unknown>,
        summary: {
          metrics: result.metrics,
          monthly_r: result.monthly_r,
          skipped_days: result.skipped_days,
          start_date: lastConfig.startDate,
          end_date: lastConfig.endDate,
        },
        trade_log: result.trades as unknown as Record<string, unknown>[],
        charts: {
          equity_curve: result.equity_curve as unknown as Record<string, unknown>[],
          drawdown_curve: result.drawdown_curve as unknown as Record<string, unknown>[],
        },
      });
      if (saved) {
        toast({
          title: "Run gespeichert",
          description: `"${saved.name}" wurde in deiner History gespeichert.`,
        });
      }
    },
    [result, lastConfig, symbol, strategy, saveRun, toast]
  );

  const defaultRunName = `${symbol} ${strategy} ${startDate}`;

  // Extract strategy-specific chart params from strategyParams (may be absent for non-breakout strategies)
  const sp = (lastConfig?.strategyParams ?? {}) as Record<string, unknown>;
  const rangeStart = sp.rangeStart != null ? String(sp.rangeStart) : "";
  const rangeEnd = sp.rangeEnd != null ? String(sp.rangeEnd) : "";
  const triggerDeadline = sp.triggerDeadline != null ? String(sp.triggerDeadline) : undefined;

  return (
    <>
    <AlertDialog open={warnings.length > 0} onOpenChange={(open) => { if (!open) clearWarnings(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Hinweis zum Datendownload</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-1">
              {warnings.map((msg, i) => (
                <p key={i}>{msg}</p>
              ))}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={clearWarnings}>OK</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Backtest
          </h1>
          <p className="mt-1 text-gray-400">
            Configure and run backtests on historical market data.
          </p>
        </div>
        {result && (
          <div className="flex shrink-0 gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportExcel(result, startDate, endDate)}
              disabled={isExporting}
              className="border-white/20 bg-white/10 text-slate-200 hover:bg-white/20"
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Export Excel
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportCsv(result, startDate, endDate)}
              disabled={isExporting}
              className="border-white/20 bg-white/10 text-slate-200 hover:bg-white/20"
            >
              <FileDown className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[400px_1fr]">
        {/* Left Column: Configuration */}
        <div className="xl:sticky xl:top-6 xl:self-start">
          <ConfigurationPanel
            onSubmit={handleRunBacktest}
            isRunning={status === "loading"}
            preloadConfig={preloadConfig}
          />
        </div>

        {/* Right Column: Results */}
        <div className="min-w-0">
          <ResultsPanel
            status={status}
            result={result}
            error={error}
            isTimedOut={isTimedOut}
            onCancel={cancel}
            initialCapital={initialCapital}
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            triggerDeadline={triggerDeadline}
            newsDates={newsDates}
            startDate={startDate}
            endDate={endDate}
            onSaveRun={handleSaveRun}
            isSaving={isSaving}
            defaultRunName={defaultRunName}
            strategyParams={lastConfig?.strategyParams}
          />
        </div>
      </div>
    </div>
    </>
  );
}

export default function BacktestPage() {
  return (
    <Suspense>
      <BacktestPageInner />
    </Suspense>
  );
}
