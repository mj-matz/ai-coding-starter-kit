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

export default function BacktestPage() {
  const { status, result, error, isTimedOut, progress, isStreaming, warnings, newsDates, clearWarnings, runBacktestStream, cancel } =
    useBacktest();
  const [initialCapital, setInitialCapital] = useState(10000);
  const [rangeStart, setRangeStart] = useState("02:00");
  const [rangeEnd, setRangeEnd] = useState("06:00");
  const [triggerDeadline, setTriggerDeadline] = useState("12:00");

  function handleRunBacktest(config: BacktestFormValues) {
    setInitialCapital(config.initialCapital);
    setRangeStart(config.rangeStart);
    setRangeEnd(config.rangeEnd);
    setTriggerDeadline(config.triggerDeadline);
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
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">
          Backtest
        </h1>
        <p className="mt-1 text-gray-400">
          Configure and run backtests on historical market data.
        </p>
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
          />
        </div>
      </div>
    </div>
    </>
  );
}
