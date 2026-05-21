"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  Mt5RunStartResponse,
  Mt5RunStatus,
  Mt5RunStatusResponse,
  Mt5TesterMetrics,
} from "@/lib/mt5-bridge-types";

// PROJ-37: Submit a Strategy Tester run and follow it to completion.
//
// - 2 s polling, mirrors the PROJ-19 Optimizer status pattern.
// - Tracks elapsed time so the UI can render "Running 0:12".
// - Stops polling automatically when status is one of the terminal states
//   (`done`, `failed`, `cancelled`).

const POLL_INTERVAL_MS = 2_000;

export interface Mt5TesterStartParams {
  expert_path: string;
  expert_name: string;
  symbol: string;
  timeframe: string;
  from_date: string;
  to_date: string;
  parameters?: Record<string, unknown>;
  model?: string;
  initial_capital?: number;
  mql_conversion_id?: string | null;
}

export type Mt5TesterRunPhase = "idle" | "submitting" | "polling" | "done" | "failed" | "cancelled";

export interface UseMt5TesterRunReturn {
  phase: Mt5TesterRunPhase;
  status: Mt5RunStatus | null;
  jobId: string | null;
  queuePosition: number | null;
  metrics: Mt5TesterMetrics | null;
  errorMessage: string | null;
  /** Seconds since the run reached the "running" status — null while queued/idle. */
  runningElapsedSec: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  /** mql_conversion_id passed at run start — used to guard the side-by-side
   * discrepancy warning (warn only when Python and MT5 reference the same
   * saved conversion). */
  mqlConversionId: string | null;

  startRun: (params: Mt5TesterStartParams) => Promise<Mt5RunStartResponse | null>;
  reset: () => void;
}

const TERMINAL_STATUSES: Mt5RunStatus[] = ["done", "failed", "cancelled"];

export function useMt5TesterRun(): UseMt5TesterRunReturn {
  const [phase, setPhase] = useState<Mt5TesterRunPhase>("idle");
  const [status, setStatus] = useState<Mt5RunStatus | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [metrics, setMetrics] = useState<Mt5TesterMetrics | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [finishedAt, setFinishedAt] = useState<string | null>(null);
  const [runningElapsedSec, setRunningElapsedSec] = useState<number | null>(null);
  const [mqlConversionId, setMqlConversionId] = useState<string | null>(null);

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runningSinceRef = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const stopElapsed = useCallback(() => {
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    stopPolling();
    stopElapsed();
    runningSinceRef.current = null;
    setPhase("idle");
    setStatus(null);
    setJobId(null);
    setQueuePosition(null);
    setMetrics(null);
    setErrorMessage(null);
    setStartedAt(null);
    setFinishedAt(null);
    setRunningElapsedSec(null);
    setMqlConversionId(null);
  }, [stopPolling, stopElapsed]);

  const applyStatus = useCallback(
    (data: Mt5RunStatusResponse) => {
      setStatus(data.status);
      setQueuePosition(data.queue_position ?? null);
      setErrorMessage(data.error_message ?? null);
      setMetrics(data.metrics ?? null);
      setStartedAt(data.started_at ?? null);
      setFinishedAt(data.finished_at ?? null);

      if (data.status === "running" && runningSinceRef.current == null) {
        // Use the server-provided started_at when available; fall back to now.
        const started = data.started_at ? Date.parse(data.started_at) : Date.now();
        runningSinceRef.current = Number.isFinite(started) ? started : Date.now();
      }

      if (TERMINAL_STATUSES.includes(data.status)) {
        stopPolling();
        stopElapsed();
        if (data.status === "done") setPhase("done");
        else if (data.status === "cancelled") setPhase("cancelled");
        else setPhase("failed");
      }
    },
    [stopPolling, stopElapsed]
  );

  const pollOnce = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/mt5/tester/status/${id}`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) {
          // Don't kill polling on a transient error — surface a message but keep trying.
          setErrorMessage(data.error ?? `Status check failed (${res.status})`);
          return;
        }
        applyStatus(data as Mt5RunStatusResponse);
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : "Status check failed");
      }
    },
    [applyStatus]
  );

  const startPolling = useCallback(
    (id: string) => {
      stopPolling();
      // Kick off an immediate poll; we don't want to wait 2 s for the first update.
      void pollOnce(id);
      pollTimerRef.current = setInterval(() => {
        void pollOnce(id);
      }, POLL_INTERVAL_MS);
    },
    [pollOnce, stopPolling]
  );

  const startElapsedTicker = useCallback(() => {
    if (elapsedTimerRef.current) return;
    elapsedTimerRef.current = setInterval(() => {
      const since = runningSinceRef.current;
      if (since == null) {
        setRunningElapsedSec(null);
        return;
      }
      setRunningElapsedSec(Math.max(0, Math.floor((Date.now() - since) / 1000)));
    }, 1_000);
  }, []);

  const startRun = useCallback(
    async (params: Mt5TesterStartParams): Promise<Mt5RunStartResponse | null> => {
      reset();
      setPhase("submitting");
      setMqlConversionId(params.mql_conversion_id ?? null);

      try {
        const res = await fetch("/api/mt5/tester/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expert_path: params.expert_path,
            expert_name: params.expert_name,
            symbol: params.symbol,
            timeframe: params.timeframe,
            from_date: params.from_date,
            to_date: params.to_date,
            parameters: params.parameters ?? {},
            model: params.model ?? "EveryTickRealistic",
            initial_capital: params.initial_capital ?? 100000,
            mql_conversion_id: params.mql_conversion_id ?? null,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          setPhase("failed");
          setStatus("failed");
          setErrorMessage(data.error ?? `Failed to submit run (${res.status})`);
          return null;
        }

        const start = data as Mt5RunStartResponse;
        setJobId(start.job_id);
        setStatus(start.status);
        setQueuePosition(start.queue_position ?? null);
        setPhase("polling");
        startElapsedTicker();
        startPolling(start.job_id);
        return start;
      } catch (err) {
        setPhase("failed");
        setStatus("failed");
        setErrorMessage(err instanceof Error ? err.message : "Failed to submit run");
        return null;
      }
    },
    [reset, startElapsedTicker, startPolling]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPolling();
      stopElapsed();
    };
  }, [stopPolling, stopElapsed]);

  return {
    phase,
    status,
    jobId,
    queuePosition,
    metrics,
    errorMessage,
    runningElapsedSec,
    startedAt,
    finishedAt,
    mqlConversionId,
    startRun,
    reset,
  };
}
