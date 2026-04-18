"use client";

import { useState, useEffect, useCallback } from "react";
import type { Strategy } from "@/lib/strategy-types";

export interface UseStrategiesReturn {
  strategies: Strategy[];
  isLoading: boolean;
  error: string | null;
  retry: () => void;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

export function useStrategies(): UseStrategiesReturn {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setIsLoading(true);
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    async function fetchWithRetry(retriesLeft: number) {
      try {
        const response = await fetch("/api/strategies");
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || "Failed to load strategies");
        }
        const data: Strategy[] = await response.json();
        if (!cancelled) {
          setStrategies(data);
          setError(null);
          setIsLoading(false);
        }
      } catch (err) {
        if (cancelled) return;
        if (retriesLeft > 0) {
          timeoutId = setTimeout(() => {
            if (!cancelled) fetchWithRetry(retriesLeft - 1);
          }, RETRY_DELAY_MS);
        } else {
          setError(err instanceof Error ? err.message : "Failed to load strategies");
          setIsLoading(false);
        }
      }
    }

    fetchWithRetry(MAX_RETRIES);
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [attempt]);

  return { strategies, isLoading, error, retry };
}
