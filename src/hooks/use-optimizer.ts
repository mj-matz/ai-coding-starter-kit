"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type {
  ParameterGroup,
  TargetMetric,
  ParameterRange,
  OptimizerResultRow,
  OptimizerStatusResponse,
  OptimizerStartResponse,
  OptimizationRun,
} from "@/lib/optimizer-types";
import { loadConfigFromStorage, type BacktestFormValues } from "@/lib/backtest-types";

// ── Types ──────────────────────────────────────────────────────────────────

export type OptimizerStatus = "idle" | "configuring" | "running" | "completed" | "cancelled" | "failed";

export interface UseOptimizerReturn {
  // State
  status: OptimizerStatus;
  jobId: string | null;
  progress: number;
  total: number;
  results: OptimizerResultRow[];
  error: string | null;
  backtestConfig: BacktestFormValues | null;

  // Actions
  startOptimization: (params: StartOptimizerParams) => Promise<void>;
  cancelOptimization: () => Promise<void>;
  reset: () => void;
  loadBacktestConfig: () => void;

  // History
  runs: OptimizationRun[];
  runsLoading: boolean;
  fetchRuns: () => Promise<void>;
  deleteRun: (id: string) => Promise<boolean>;
  loadRun: (id: string) => Promise<{ results: OptimizerResultRow[]; run: OptimizationRun } | null>;
}

export interface StartOptimizerParams {
  parameterGroup: ParameterGroup;
  targetMetric: TargetMetric;
  parameterRanges: Record<string, ParameterRange>;
}

const POLL_INTERVAL_MS = 2000;

// ── Hook ───────────────────────────────────────────────────────────────────

export function useOptimizer(): UseOptimizerReturn {
  const [status, setStatus] = useState<OptimizerStatus>("idle");
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [results, setResults] = useState<OptimizerResultRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [backtestConfig, setBacktestConfig] = useState<BacktestFormValues | null>(null);

  // History
  const [runs, setRuns] = useState<OptimizationRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);

  // ── Load config from localStorage ─────────────────────────────────────

  const loadBacktestConfig = useCallback(() => {
    const config = loadConfigFromStorage();
    setBacktestConfig(config);
  }, []);

  // Load on mount
  useEffect(() => {
    loadBacktestConfig();
  }, [loadBacktestConfig]);

  // ── Polling logic ─────────────────────────────────────────────────────

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const saveResults = useCallback(
    async (runId: string, rows: OptimizerResultRow[], finalStatus: "completed" | "cancelled") => {
      if (rows.length === 0) return;
      try {
        await fetch(`/api/optimizer/runs/${runId}/save`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ results: rows, status: finalStatus }),
        });
      } catch {
        // Silent fail — results are still shown in the UI
      }
    },
    []
  );

  const pollStatus = useCallback(
    async (activeJobId: string) => {
      try {
        const response = await fetch(`/api/optimizer/status/${activeJobId}`);
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error || `Status check failed: ${response.status}`);
        }

        const data: OptimizerStatusResponse = await response.json();

        setProgress(data.completed);
        setTotal(data.total);
        setResults(data.results);

        if (data.status === "completed") {
          stopPolling();
          await saveResults(activeJobId, data.results, "completed");
          setStatus("completed");
        } else if (data.status === "cancelled") {
          stopPolling();
          await saveResults(activeJobId, data.results, "cancelled");
          setStatus("cancelled");
        } else if (data.status === "failed") {
          stopPolling();
          setStatus("failed");
          setError(data.error_message || "Optimization failed");
        }
      } catch (err) {
        // Don't stop polling on transient errors, but after 3 failures in a row
        // we rely on the caller (interval) to keep trying
        console.error("Polling error:", err);
      }
    },
    [stopPolling, saveResults]
  );

  const startPolling = useCallback(
    (activeJobId: string) => {
      stopPolling();
      pollTimerRef.current = setInterval(() => {
        if (!cancelledRef.current) {
          pollStatus(activeJobId);
        }
      }, POLL_INTERVAL_MS);
    },
    [stopPolling, pollStatus]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  // ── Start optimization ────────────────────────────────────────────────

  const startOptimization = useCallback(
    async ({ parameterGroup, targetMetric, parameterRanges }: StartOptimizerParams) => {
      if (!backtestConfig) {
        setError("Keine Backtest-Konfiguration gefunden. Bitte zuerst im Backtest-Tab konfigurieren.");
        return;
      }

      cancelledRef.current = false;
      setStatus("running");
      setError(null);
      setProgress(0);
      setTotal(0);
      setResults([]);

      try {
        const body = {
          ...backtestConfig,
          parameter_group: parameterGroup,
          target_metric: targetMetric,
          parameter_ranges: parameterRanges,
        };

        const response = await fetch("/api/optimizer/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || `Failed to start optimization: ${response.status}`);
        }

        const data: OptimizerStartResponse = await response.json();
        setJobId(data.job_id);
        setTotal(data.total_combinations);

        // Start polling
        startPolling(data.job_id);
      } catch (err) {
        setStatus("failed");
        setError(err instanceof Error ? err.message : "An unexpected error occurred");
      }
    },
    [backtestConfig, startPolling]
  );

  // ── Cancel optimization ───────────────────────────────────────────────

  const cancelOptimization = useCallback(async () => {
    if (!jobId) return;

    cancelledRef.current = true;
    stopPolling();

    try {
      await fetch(`/api/optimizer/cancel/${jobId}`, { method: "POST" });
      setStatus("cancelled");
    } catch {
      // Even if cancel request fails, we stop locally
      setStatus("cancelled");
    }
  }, [jobId, stopPolling]);

  // ── Reset ─────────────────────────────────────────────────────────────

  const reset = useCallback(() => {
    stopPolling();
    cancelledRef.current = false;
    setStatus("idle");
    setJobId(null);
    setProgress(0);
    setTotal(0);
    setResults([]);
    setError(null);
    loadBacktestConfig();
  }, [stopPolling, loadBacktestConfig]);

  // ── History: fetch runs ───────────────────────────────────────────────

  const fetchRuns = useCallback(async () => {
    setRunsLoading(true);
    try {
      const response = await fetch("/api/optimizer/runs");
      if (!response.ok) throw new Error("Failed to fetch runs");
      const data = await response.json();
      setRuns(data.runs ?? []);
    } catch {
      // Silent fail — runs are optional
      setRuns([]);
    } finally {
      setRunsLoading(false);
    }
  }, []);

  // ── History: delete run ───────────────────────────────────────────────

  const deleteRun = useCallback(async (id: string): Promise<boolean> => {
    try {
      const response = await fetch(`/api/optimizer/runs/${id}`, { method: "DELETE" });
      if (!response.ok) return false;
      setRuns((prev) => prev.filter((r) => r.id !== id));
      return true;
    } catch {
      return false;
    }
  }, []);

  // ── History: load run results ─────────────────────────────────────────

  const loadRun = useCallback(async (id: string): Promise<{ results: OptimizerResultRow[]; run: OptimizationRun } | null> => {
    try {
      const response = await fetch(`/api/optimizer/runs/${id}`);
      if (!response.ok) return null;
      const data = await response.json();
      const results: OptimizerResultRow[] = data.results ?? [];
      const run: OptimizationRun = data.run;
      // Set results into state so they can be displayed
      setResults(results);
      setStatus("completed");
      setJobId(id);
      if (run) {
        setTotal(run.total_combinations);
        setProgress(run.completed_combinations ?? run.total_combinations);
      }
      return { results, run };
    } catch {
      return null;
    }
  }, []);

  return {
    status,
    jobId,
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
  };
}
