"use client";

import { useState } from "react";
import { ConfigurationPanel } from "@/components/backtest/configuration-panel";
import { ResultsPanel } from "@/components/backtest/results-panel";
import { useBacktest } from "@/hooks/use-backtest";
import type { BacktestFormValues } from "@/lib/backtest-types";

export default function BacktestPage() {
  const { status, result, error, isTimedOut, runBacktest, cancel } =
    useBacktest();
  const [initialCapital, setInitialCapital] = useState(10000);
  const [rangeStart, setRangeStart] = useState("02:00");
  const [rangeEnd, setRangeEnd] = useState("06:00");

  function handleRunBacktest(config: BacktestFormValues) {
    setInitialCapital(config.initialCapital);
    setRangeStart(config.rangeStart);
    setRangeEnd(config.rangeEnd);
    runBacktest(config);
  }

  return (
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
          />
        </div>
      </div>
    </div>
  );
}
