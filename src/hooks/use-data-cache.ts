"use client";

import { useCallback, useEffect, useState } from "react";

// ── Types ───────────────────────────────────────────────────────────────────

export interface CacheChunk {
  id: string;
  year: number | null;
  month: number | null;
  is_complete: boolean;
  row_count: number;
  file_size_bytes: number;
  date_from: string | null;
  date_to: string | null;
}

export interface CacheGroup {
  symbol: string;
  source: string;
  timeframe: string;
  chunks: CacheChunk[];
  total_rows: number;
  total_size_bytes: number;
  earliest: string | null;
  latest: string | null;
}

interface UseDataCacheResult {
  groups: CacheGroup[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  deleteGroup: (group: CacheGroup) => Promise<boolean>;
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useDataCache(): UseDataCacheResult {
  const [groups, setGroups] = useState<CacheGroup[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/data/cache", { credentials: "include" });
      if (!res.ok) {
        throw new Error(`Failed to load cache (HTTP ${res.status})`);
      }
      const data = (await res.json()) as { groups: CacheGroup[] };
      setGroups(data.groups ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setGroups([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const deleteGroup = useCallback(
    async (group: CacheGroup): Promise<boolean> => {
      let allOk = true;
      for (const chunk of group.chunks) {
        try {
          const res = await fetch("/api/data/cache", {
            method: "DELETE",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: chunk.id }),
          });
          if (!res.ok) allOk = false;
        } catch {
          allOk = false;
        }
      }
      await refresh();
      return allOk;
    },
    [refresh]
  );

  return { groups, isLoading, error, refresh, deleteGroup };
}

// ── Formatting helpers ────────────────────────────────────────────────────

export function formatCacheDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
