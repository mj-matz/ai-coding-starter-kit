"use client";

import { useState, useCallback, useEffect } from "react";
import { Play, RotateCcw, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";

import { useOptimizer } from "@/hooks/use-optimizer";
import { ConfigInheritancePanel } from "@/components/optimizer/config-inheritance-panel";
import { ParameterGroupSelector } from "@/components/optimizer/parameter-group-selector";
import { ParameterRangeForm } from "@/components/optimizer/parameter-range-form";
import { MetricSelector } from "@/components/optimizer/metric-selector";
import { CombinationCounter } from "@/components/optimizer/combination-counter";
import { ProgressSection } from "@/components/optimizer/progress-section";
import { HeatmapChart } from "@/components/optimizer/heatmap-chart";
import { ResultsTable } from "@/components/optimizer/results-table";
import { HistorySection } from "@/components/optimizer/history-section";

import type { ParameterGroup, TargetMetric, ParameterRange, OptimizationRun } from "@/lib/optimizer-types";
import { calculateCombinations, OPTIMIZER_MAX_COMBINATIONS, OPTIMIZER_WARN_COMBINATIONS } from "@/lib/optimizer-types";

export default function OptimizerPage() {
  const { toast } = useToast();

  const {
    status,
    progress,
    total,
    results,
    error,
    backtestConfig,
    startOptimization,
    cancelOptimization,
    reset,
    loadBacktestConfig,
    runs,
    runsLoading,
    fetchRuns,
    deleteRun,
    loadRun,
  } = useOptimizer();

  // Config state
  const [parameterGroup, setParameterGroup] = useState<ParameterGroup | null>(null);
  const [targetMetric, setTargetMetric] = useState<TargetMetric | null>(null);
  const [parameterRanges, setParameterRanges] = useState<Record<string, ParameterRange>>({});
  const [warningAcknowledged, setWarningAcknowledged] = useState(false);
  const [duplicateRun, setDuplicateRun] = useState<OptimizationRun | null>(null);

  // Fetch history on mount so duplicate detection works without opening history tab
  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  const isRunning = status === "running";
  const isDone = status === "completed" || status === "cancelled";

  const combinationCount = calculateCombinations(parameterRanges);
  const exceedsMax = combinationCount > OPTIMIZER_MAX_COMBINATIONS;
  const needsWarning = combinationCount > OPTIMIZER_WARN_COMBINATIONS && !warningAcknowledged;

  const canStart =
    !!backtestConfig &&
    !!parameterGroup &&
    !!targetMetric &&
    combinationCount > 0 &&
    !exceedsMax &&
    !needsWarning;

  const parameterKeys = Object.keys(parameterRanges);

  function handleGroupChange(group: ParameterGroup) {
    setParameterGroup(group);
    setWarningAcknowledged(false);
    setParameterRanges({});
  }

  async function handleStart(forceStart = false) {
    if (!parameterGroup || !targetMetric || !backtestConfig) return;

    if (!forceStart) {
      const rangesKey = JSON.stringify(Object.fromEntries(Object.entries(parameterRanges).sort()));
      const duplicate = runs.find(
        (r) =>
          r.asset === backtestConfig.symbol &&
          r.date_from === backtestConfig.startDate &&
          r.date_to === backtestConfig.endDate &&
          r.strategy === backtestConfig.strategy &&
          r.parameter_group === parameterGroup &&
          r.target_metric === targetMetric &&
          JSON.stringify(Object.fromEntries(Object.entries(r.parameter_ranges).sort())) === rangesKey
      );
      if (duplicate) {
        setDuplicateRun(duplicate);
        return;
      }
    }

    setDuplicateRun(null);
    await startOptimization({ parameterGroup, targetMetric, parameterRanges });
  }

  function handleReset() {
    reset();
    setParameterGroup(null);
    setTargetMetric(null);
    setParameterRanges({});
    setWarningAcknowledged(false);
    setDuplicateRun(null);
  }

  const handleLoadRun = useCallback(
    async (id: string) => {
      const loaded = await loadRun(id);
      if (loaded) {
        const { results, run } = loaded;
        setParameterGroup(run.parameter_group);
        setTargetMetric(run.target_metric);
        setParameterRanges(run.parameter_ranges);
        toast({
          title: "Run geladen",
          description: `${results.length} Ergebnisse aus dem Verlauf geladen.`,
        });
      } else {
        toast({
          title: "Fehler",
          description: "Run konnte nicht geladen werden.",
          variant: "destructive",
        });
      }
    },
    [loadRun, toast]
  );

  const handleDeleteRun = useCallback(
    async (id: string) => {
      const ok = await deleteRun(id);
      if (!ok) {
        toast({
          title: "Fehler",
          description: "Run konnte nicht gelöscht werden.",
          variant: "destructive",
        });
      }
    },
    [deleteRun, toast]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Strategy Optimizer</h1>
          <p className="mt-1 text-gray-400">
            Optimiere Parameter-Gruppen deiner Strategie durch systematisches Backtesting.
          </p>
        </div>
        {(isDone || status === "failed") && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleReset}
            className="border-white/20 bg-white/10 text-slate-200 hover:bg-white/20 shrink-0"
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Neu starten
          </Button>
        )}
      </div>

      <Tabs defaultValue="optimizer">
        <TabsList className="bg-white/5 border border-white/10">
          <TabsTrigger value="optimizer" className="data-[state=active]:bg-white/10">
            Optimierung
          </TabsTrigger>
          <TabsTrigger value="history" className="data-[state=active]:bg-white/10">
            Verlauf
          </TabsTrigger>
        </TabsList>

        {/* ── Optimizer Tab ── */}
        <TabsContent value="optimizer" className="mt-6 space-y-6">
          {/* Config from Backtest */}
          <ConfigInheritancePanel config={backtestConfig} />

          {!backtestConfig && (
            <Button
              variant="outline"
              size="sm"
              onClick={loadBacktestConfig}
              className="border-white/20 bg-white/10 text-slate-200 hover:bg-white/20"
            >
              Konfiguration neu laden
            </Button>
          )}

          {/* Error state */}
          {status === "failed" && error && (
            <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/5 p-4">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
              <div>
                <p className="text-sm font-medium text-red-300">Fehler bei der Optimierung</p>
                <p className="mt-0.5 text-xs text-red-400/70">{error}</p>
              </div>
            </div>
          )}

          {/* Config form — only when not running/done */}
          {!isRunning && !isDone && (
            <div className="space-y-6">
              {/* Parameter Group */}
              <ParameterGroupSelector
                value={parameterGroup}
                onChange={handleGroupChange}
                disabled={!backtestConfig}
              />

              {/* Range Form */}
              {parameterGroup && (
                <ParameterRangeForm
                  group={parameterGroup}
                  onChange={setParameterRanges}
                  disabled={!backtestConfig}
                />
              )}

              {/* Metric Selector */}
              <MetricSelector
                value={targetMetric}
                onChange={setTargetMetric}
                disabled={!backtestConfig}
              />

              {/* Combination Counter */}
              {parameterGroup && combinationCount > 0 && (
                <CombinationCounter
                  ranges={parameterRanges}
                  hasWarningAcknowledged={warningAcknowledged}
                  onAcknowledge={() => setWarningAcknowledged(true)}
                />
              )}

              {/* Duplicate run warning */}
              {duplicateRun && (
                <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                  <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-amber-300">Diese Konfiguration wurde bereits optimiert</p>
                    <p className="mt-0.5 text-xs text-amber-400/70">
                      Run vom {new Date(duplicateRun.created_at).toLocaleDateString("de-DE")} mit{" "}
                      {duplicateRun.total_combinations} Kombinationen.
                    </p>
                    <div className="mt-3 flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
                        onClick={() => handleLoadRun(duplicateRun.id)}
                      >
                        Vorherigen Run laden
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-white/20 text-slate-300 hover:bg-white/10"
                        onClick={() => handleStart(true)}
                      >
                        Trotzdem neu starten
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Start Button */}
              <Button
                onClick={() => handleStart()}
                disabled={!canStart || isRunning}
                className="w-full bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40"
              >
                <Play className="mr-2 h-4 w-4" />
                {isRunning ? "Wird gestartet..." : `Optimierung starten (${combinationCount} Backtests)`}
              </Button>
            </div>
          )}

          {/* Progress */}
          {isRunning && (
            <ProgressSection
              progress={progress}
              total={total}
              onCancel={cancelOptimization}
            />
          )}

          {/* Results */}
          {(isDone || (isRunning && results.length > 0)) && targetMetric && (
            <div className="space-y-6">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-white">Ergebnisse</h2>
                {isRunning && (
                  <span className="text-xs text-gray-400">
                    (wird aktualisiert — {progress} / {total})
                  </span>
                )}
                {status === "cancelled" && (
                  <span className="text-xs text-amber-400">(Optimierung wurde abgebrochen)</span>
                )}
              </div>

              {/* Heatmap */}
              {parameterKeys.length > 0 && (
                <HeatmapChart
                  results={results}
                  targetMetric={targetMetric}
                  parameterKeys={parameterKeys}
                />
              )}

              {/* Results Table */}
              <ResultsTable
                results={results}
                targetMetric={targetMetric}
                parameterKeys={parameterKeys}
                backtestConfig={backtestConfig}
                onApplyParams={() =>
                  toast({
                    title: "Parameter übernommen",
                    description:
                      "Die besten Parameter wurden in deine Backtest-Konfiguration geladen. Wechsle zum Backtest-Tab um sie zu verwenden.",
                  })
                }
              />
            </div>
          )}
        </TabsContent>

        {/* ── History Tab ── */}
        <TabsContent value="history" className="mt-6">
          <HistorySection
            runs={runs}
            loading={runsLoading}
            onFetch={fetchRuns}
            onLoadRun={handleLoadRun}
            onDeleteRun={handleDeleteRun}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
