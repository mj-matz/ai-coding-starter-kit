"use client";

import { useState, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { BacktestFormValues, BacktestResult } from "@/lib/backtest-types";
import { getCurrenciesForInstrument } from "@/lib/instrument-currencies";

export type BacktestStatus = "idle" | "loading" | "success" | "error";

export interface BacktestProgress {
  daysDone: number;
  totalDays: number;
  currentDate: string;
}

interface UseBacktestReturn {
  status: BacktestStatus;
  result: BacktestResult | null;
  error: string | null;
  isTimedOut: boolean;
  progress: BacktestProgress | null;
  isStreaming: boolean;
  warnings: string[];
  clearWarnings: () => void;
  runBacktest: (config: BacktestFormValues) => Promise<void>;
  runBacktestStream: (config: BacktestFormValues) => Promise<void>;
  cancel: () => void;
}

const TIMEOUT_WARNING_MS = 60_000;

export function useBacktest(): UseBacktestReturn {
  const [status, setStatus] = useState<BacktestStatus>("idle");
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isTimedOut, setIsTimedOut] = useState(false);
  const [progress, setProgress] = useState<BacktestProgress | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);

  const clearWarnings = useCallback(() => setWarnings([]), []);

  const abortControllerRef = useRef<AbortController | null>(null);
  const timeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = useCallback(() => {
    abortControllerRef.current?.abort();
    if (timeoutTimerRef.current) {
      clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    }
    setStatus("idle");
    setIsTimedOut(false);
    setProgress(null);
    setIsStreaming(false);
  }, []);

  const runBacktest = useCallback(
    async (config: BacktestFormValues) => {
      // Cancel any in-progress request
      abortControllerRef.current?.abort();
      if (timeoutTimerRef.current) {
        clearTimeout(timeoutTimerRef.current);
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      setStatus("loading");
      setError(null);
      setIsTimedOut(false);
      setProgress(null);
      setIsStreaming(false);

      // Set timeout warning
      timeoutTimerRef.current = setTimeout(() => {
        setIsTimedOut(true);
      }, TIMEOUT_WARNING_MS);

      try {
        const response = await fetch("/api/backtest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(config),
          signal: controller.signal,
        });

        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(
            body.error || `Backtest failed with status ${response.status}`
          );
        }

        const data: BacktestResult = await response.json();
        setResult(data);
        setStatus("success");
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          setStatus("idle");
          return;
        }
        setError(
          err instanceof Error ? err.message : "An unexpected error occurred"
        );
        setStatus("error");
      } finally {
        if (timeoutTimerRef.current) {
          clearTimeout(timeoutTimerRef.current);
          timeoutTimerRef.current = null;
        }
        setIsTimedOut(false);
      }
    },
    []
  );

  const runBacktestStream = useCallback(
    async (config: BacktestFormValues) => {
      // Cancel any in-progress request
      abortControllerRef.current?.abort();
      if (timeoutTimerRef.current) {
        clearTimeout(timeoutTimerRef.current);
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      setStatus("loading");
      setError(null);
      setIsTimedOut(false);
      setProgress(null);
      setIsStreaming(true);
      setWarnings([]);

      // Set timeout warning
      timeoutTimerRef.current = setTimeout(() => {
        setIsTimedOut(true);
      }, TIMEOUT_WARNING_MS);

      try {
        const supabase = createClient();

        // Resolve news dates from Supabase when the user wants to skip news days
        let newsDates: string[] | undefined;
        if (!config.tradeNewsDays) {
          const currencies = getCurrenciesForInstrument(config.symbol);
          const { data } = await supabase
            .from("economic_calendar")
            .select("date")
            .gte("date", config.startDate)
            .lte("date", config.endDate)
            .eq("impact", "High")
            .in("currency", currencies);
          newsDates = [...new Set((data ?? []).map((r: { date: string }) => r.date))];
        }

        const payload = newsDates ? { ...config, newsDates } : config;

        const response = await fetch("/api/backtest/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(
            body.error || `Backtest failed with status ${response.status}`
          );
        }

        if (!response.body) {
          throw new Error("No response body received from stream endpoint");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let gotResult = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Parse SSE events from the buffer
          const lines = buffer.split("\n");
          // Keep the last potentially incomplete line in the buffer
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data: ")) continue;

            const jsonStr = trimmed.slice(6); // remove "data: " prefix
            if (!jsonStr) continue;

            try {
              const event = JSON.parse(jsonStr);

              if (event.type === "init") {
                setProgress({ daysDone: 0, totalDays: event.total_days, currentDate: "" });
              } else if (event.type === "progress") {
                setProgress({
                  daysDone: event.daysDone,
                  totalDays: event.totalDays,
                  currentDate: event.currentDate,
                });
              } else if (event.type === "result") {
                gotResult = true;
                setResult(event.data as BacktestResult);
                setStatus("success");
                setProgress(null);
                setIsStreaming(false);
              } else if (event.type === "warning") {
                setWarnings((prev) => [...prev, event.message as string]);
              } else if (event.type === "error") {
                throw new Error(event.message || "Backtest stream error");
              }
            } catch (parseErr) {
              // If it's a re-thrown Error from above, propagate it
              if (parseErr instanceof Error && parseErr.message !== "Unexpected end of JSON input") {
                throw parseErr;
              }
              // Otherwise skip malformed SSE lines
            }
          }
        }

        // Stream ended without result/error event (e.g. server crash)
        if (!gotResult) {
          throw new Error("Stream ended unexpectedly — Verbindung unterbrochen");
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          setStatus("idle");
          setProgress(null);
          setIsStreaming(false);
          return;
        }
        setError(
          err instanceof Error ? err.message : "An unexpected error occurred"
        );
        setStatus("error");
        setProgress(null);
        setIsStreaming(false);
      } finally {
        if (timeoutTimerRef.current) {
          clearTimeout(timeoutTimerRef.current);
          timeoutTimerRef.current = null;
        }
        setIsTimedOut(false);
      }
    },
    []
  );

  return {
    status,
    result,
    error,
    isTimedOut,
    progress,
    isStreaming,
    warnings,
    clearWarnings,
    runBacktest,
    runBacktestStream,
    cancel,
  };
}
