"use client";

import { useState, useCallback } from "react";

export interface BacktestRunSummary {
  id: string;
  user_id: string;
  name: string;
  asset: string;
  strategy: string;
  summary: Record<string, unknown>;
  created_at: string;
}

export interface BacktestRunFull extends BacktestRunSummary {
  config: Record<string, unknown>;
  trade_log: Record<string, unknown>[];
  charts: {
    equity_curve?: Record<string, unknown>[];
    drawdown_curve?: Record<string, unknown>[];
  };
}

interface UseBacktestRunsReturn {
  runs: BacktestRunSummary[];
  isLoading: boolean;
  error: string | null;
  fetchRuns: () => Promise<void>;
  saveRun: (payload: {
    name: string;
    asset: string;
    strategy: string;
    config: Record<string, unknown>;
    summary: Record<string, unknown>;
    trade_log: Record<string, unknown>[];
    charts: {
      equity_curve?: Record<string, unknown>[];
      drawdown_curve?: Record<string, unknown>[];
    };
  }) => Promise<{ id: string; name: string } | null>;
  deleteRun: (id: string) => Promise<boolean>;
  renameRun: (id: string, name: string) => Promise<boolean>;
  loadRun: (id: string) => Promise<BacktestRunFull | null>;
  isSaving: boolean;
  isDeleting: string | null;
}

export function useBacktestRuns(): UseBacktestRunsReturn {
  const [runs, setRuns] = useState<BacktestRunSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);

  const fetchRuns = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/backtest/runs");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to fetch runs (${res.status})`);
      }
      const data = await res.json();
      setRuns(data.runs ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch runs");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const saveRun = useCallback(
    async (payload: {
      name: string;
      asset: string;
      strategy: string;
      config: Record<string, unknown>;
      summary: Record<string, unknown>;
      trade_log: Record<string, unknown>[];
      charts: {
        equity_curve?: Record<string, unknown>[];
        drawdown_curve?: Record<string, unknown>[];
      };
    }): Promise<{ id: string; name: string } | null> => {
      setIsSaving(true);
      try {
        const res = await fetch("/api/backtest/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Failed to save run (${res.status})`);
        }
        const data = await res.json();
        return data.run as { id: string; name: string };
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save run");
        return null;
      } finally {
        setIsSaving(false);
      }
    },
    []
  );

  const deleteRun = useCallback(async (id: string): Promise<boolean> => {
    setIsDeleting(id);
    try {
      const res = await fetch(`/api/backtest/runs/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to delete run (${res.status})`);
      }
      setRuns((prev) => prev.filter((r) => r.id !== id));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete run");
      return false;
    } finally {
      setIsDeleting(null);
    }
  }, []);

  const renameRun = useCallback(
    async (id: string, name: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/backtest/runs/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            body.error || `Failed to rename run (${res.status})`
          );
        }
        setRuns((prev) =>
          prev.map((r) => (r.id === id ? { ...r, name } : r))
        );
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to rename run");
        return false;
      }
    },
    []
  );

  const loadRun = useCallback(
    async (id: string): Promise<BacktestRunFull | null> => {
      try {
        const res = await fetch(`/api/backtest/runs/${id}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Failed to load run (${res.status})`);
        }
        const data = await res.json();
        return data.run as BacktestRunFull;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load run");
        return null;
      }
    },
    []
  );

  return {
    runs,
    isLoading,
    error,
    fetchRuns,
    saveRun,
    deleteRun,
    renameRun,
    loadRun,
    isSaving,
    isDeleting,
  };
}
