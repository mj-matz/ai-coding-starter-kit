"use client";

import { useState } from "react";
import { ConfigurationPanel } from "@/components/backtest/configuration-panel";
import { ResultsPanel } from "@/components/backtest/results-panel";
import { useBacktest } from "@/hooks/use-backtest";
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

export default function BacktestPage() {
  const { status, result, error, isTimedOut, progress, isStreaming, warnings, newsDates, clearWarnings, runBacktestStream, cancel } =
    useBacktest();
  const { exportExcel, exportCsv, isExporting } = useExportBacktest();
  const [initialCapital, setInitialCapital] = useState(10000);
  const [rangeStart, setRangeStart] = useState("02:00");
  const [rangeEnd, setRangeEnd] = useState("06:00");
  const [triggerDeadline, setTriggerDeadline] = useState("12:00");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  function handleRunBacktest(config: BacktestFormValues) {
    setInitialCapital(config.initialCapital);
    setRangeStart(config.rangeStart);
    setRangeEnd(config.rangeEnd);
    setTriggerDeadline(config.triggerDeadline);
    setStartDate(config.startDate);
    setEndDate(config.endDate);
    runBacktestStream(config);
  }

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
            progress={progress}
            isStreaming={isStreaming}
            newsDates={newsDates}
            startDate={startDate}
            endDate={endDate}
          />
        </div>
      </div>
    </div>
    </>
  );
}
