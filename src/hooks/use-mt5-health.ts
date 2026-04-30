"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Mt5HealthResponse } from "@/lib/mt5-bridge-types";

// PROJ-37: Bridge Worker health check polling.
//
// - Polls `/api/mt5/health` every 30 s while the tab is visible.
// - Pauses polling automatically when the tab is hidden (tooth-gentle).
// - Exposes a manual `refresh()` for the "Test Connection" button.

const POLL_INTERVAL_MS = 30_000;

export interface UseMt5HealthReturn {
  health: Mt5HealthResponse | null;
  online: boolean;
  isLoading: boolean;
  error: string | null;
  /** Last successful fetch timestamp (client-side, ISO). */
  lastCheckedAt: string | null;
  /** Manual refetch — always bypasses the route cache by adding a cachebuster. */
  refresh: () => Promise<Mt5HealthResponse | null>;
}

function isOnline(payload: Mt5HealthResponse | null): boolean {
  if (!payload) return false;
  if (typeof payload.online === "boolean") return payload.online;
  if (typeof payload.status === "string") return payload.status === "online";
  return false;
}

export function useMt5Health(options?: { autoStart?: boolean }): UseMt5HealthReturn {
  const autoStart = options?.autoStart ?? true;
  const [health, setHealth] = useState<Mt5HealthResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(autoStart);
  const [error, setError] = useState<string | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inFlightRef = useRef<boolean>(false);

  const fetchHealth = useCallback(
    async (bypassCache = false): Promise<Mt5HealthResponse | null> => {
      if (inFlightRef.current) return health;
      inFlightRef.current = true;
      try {
        const url = bypassCache ? `/api/mt5/health?t=${Date.now()}` : "/api/mt5/health";
        const res = await fetch(url, { cache: "no-store" });
        const data = (await res.json()) as Mt5HealthResponse;
        if (!res.ok) {
          setError(data.error ?? `Health check failed (${res.status})`);
        } else {
          setError(null);
        }
        setHealth(data);
        setLastCheckedAt(new Date().toISOString());
        return data;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Health check failed";
        setError(msg);
        setHealth({ online: false, error: msg });
        return null;
      } finally {
        inFlightRef.current = false;
        setIsLoading(false);
      }
    },
    // health is intentionally excluded — we only care about the latest
    // value at call time and reading it would re-instantiate the function
    // every render, breaking the polling timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const startPolling = useCallback(() => {
    if (timerRef.current) return;
    timerRef.current = setInterval(() => {
      void fetchHealth();
    }, POLL_INTERVAL_MS);
  }, [fetchHealth]);

  const stopPolling = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!autoStart) return;

    // Initial fetch on mount
    void fetchHealth();
    startPolling();

    function handleVisibility() {
      if (document.visibilityState === "hidden") {
        stopPolling();
      } else {
        // Refresh immediately when tab comes back, then resume polling.
        void fetchHealth();
        startPolling();
      }
    }

    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      stopPolling();
    };
  }, [autoStart, fetchHealth, startPolling, stopPolling]);

  return {
    health,
    online: isOnline(health),
    isLoading,
    error,
    lastCheckedAt,
    refresh: () => fetchHealth(true),
  };
}
