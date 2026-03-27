"use client";

import { useState, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { BacktestFormValues, BacktestResult } from "@/lib/backtest-types";
import { getCurrenciesForInstrument } from "@/lib/instrument-currencies";

export type BacktestStatus = "idle" | "loading" | "success" | "error";

interface UseBacktestReturn {
  status: BacktestStatus;
  result: BacktestResult | null;
  error: string | null;
  isTimedOut: boolean;
  warnings: string[];
  newsDates: string[];
  clearWarnings: () => void;
  runBacktest: (config: BacktestFormValues) => Promise<void>;
  cancel: () => void;
}

const TIMEOUT_WARNING_MS = 60_000;

export function useBacktest(): UseBacktestReturn {
  const [status, setStatus] = useState<BacktestStatus>("idle");
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isTimedOut, setIsTimedOut] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [newsDates, setNewsDates] = useState<string[]>([]);

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
    setNewsDates([]);
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
      setNewsDates([]);

      // Set timeout warning
      timeoutTimerRef.current = setTimeout(() => {
        setIsTimedOut(true);
      }, TIMEOUT_WARNING_MS);

      try {
        // Fetch news dates from economic_calendar for badge display and optional filtering
        const supabase = createClient();
        const currencies = getCurrenciesForInstrument(config.symbol);
        const { data: newsData } = await supabase
          .from("economic_calendar")
          .select("date")
          .in("currency", currencies)
          .gte("date", config.startDate)
          .lte("date", config.endDate);

        const fetchedNewsDates = [
          ...new Set((newsData ?? []).map((r) => r.date as string)),
        ];
        setNewsDates(fetchedNewsDates);

        const requestBody = {
          ...config,
          ...(!config.tradeNewsDays && fetchedNewsDates.length > 0
            ? { newsDates: fetchedNewsDates }
            : {}),
        };

        const response = await fetch("/api/backtest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
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

  return {
    status,
    result,
    error,
    isTimedOut,
    warnings,
    newsDates,
    clearWarnings,
    runBacktest,
    cancel,
  };
}
