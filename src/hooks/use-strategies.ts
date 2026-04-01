"use client";

import { useState, useEffect } from "react";
import type { Strategy } from "@/lib/strategy-types";

export interface UseStrategiesReturn {
  strategies: Strategy[];
  isLoading: boolean;
  error: string | null;
}

export function useStrategies(): UseStrategiesReturn {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchStrategies() {
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
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load strategies");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchStrategies();
    return () => {
      cancelled = true;
    };
  }, []);

  return { strategies, isLoading, error };
}
