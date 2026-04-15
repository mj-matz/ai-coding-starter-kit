"use client";

import { useCallback, useEffect, useState } from "react";

import type {
  Mt5Dataset,
  Mt5UploadRequest,
  Mt5UploadResponse,
  Mt5CheckResponse,
} from "@/lib/mt5-data-types";

// ── Types ───────────────────────────────────────────────────────────────────

interface UseMt5DataResult {
  datasets: Mt5Dataset[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  upload: (req: Mt5UploadRequest) => Promise<Mt5UploadResponse>;
  deleteDataset: (id: string) => Promise<boolean>;
  /** Client-side lookup (no network call) — use after datasets loaded. */
  findDataset: (asset: string, timeframe: string) => Mt5Dataset | undefined;
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useMt5Data(): UseMt5DataResult {
  const [datasets, setDatasets] = useState<Mt5Dataset[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/mt5-data/datasets", {
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error(`Failed to load datasets (HTTP ${res.status})`);
      }
      const data = (await res.json()) as { datasets: Mt5Dataset[] };
      setDatasets(data.datasets ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setDatasets([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const upload = useCallback(
    async (req: Mt5UploadRequest): Promise<Mt5UploadResponse> => {
      const res = await fetch("/api/mt5-data/upload", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });

      if (!res.ok) {
        let message = `Upload failed (HTTP ${res.status})`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body.error) message = body.error;
        } catch {
          // ignore
        }
        throw new Error(message);
      }

      const body = (await res.json()) as Mt5UploadResponse;
      await refresh();
      return body;
    },
    [refresh]
  );

  const deleteDataset = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/mt5-data/datasets/${id}`, {
          method: "DELETE",
          credentials: "include",
        });
        if (!res.ok) return false;
        await refresh();
        return true;
      } catch {
        return false;
      }
    },
    [refresh]
  );

  const findDataset = useCallback(
    (asset: string, timeframe: string): Mt5Dataset | undefined => {
      return datasets.find(
        (d) =>
          d.asset.toUpperCase() === asset.toUpperCase() &&
          d.timeframe === timeframe
      );
    },
    [datasets]
  );

  return {
    datasets,
    isLoading,
    error,
    refresh,
    upload,
    deleteDataset,
    findDataset,
  };
}

// ── Availability check (standalone, no hook state) ─────────────────────────

export async function checkMt5Coverage(
  asset: string,
  timeframe: string,
  startDate: string,
  endDate: string
): Promise<Mt5CheckResponse> {
  const params = new URLSearchParams({
    asset,
    timeframe,
    start_date: startDate,
    end_date: endDate,
  });
  try {
    const res = await fetch(`/api/mt5-data/check?${params.toString()}`, {
      credentials: "include",
    });
    if (!res.ok) return { available: false };
    return (await res.json()) as Mt5CheckResponse;
  } catch {
    return { available: false };
  }
}
