"use client";

import { useState, useCallback } from "react";
import type { UserStrategy } from "@/lib/strategy-types";

export interface CreateUserStrategyParams {
  name: string;
  description?: string;
  python_code: string;
  parameter_schema: object;
  source_conversion_id?: string;
}

export interface UpdateUserStrategyParams {
  name?: string;
  description?: string;
}

export interface UseUserStrategiesReturn {
  strategies: UserStrategy[];
  isLoading: boolean;
  error: string | null;
  fetch: () => Promise<void>;
  create: (params: CreateUserStrategyParams) => Promise<{ strategy: UserStrategy } | { conflict: true }>;
  createOrReplace: (params: CreateUserStrategyParams) => Promise<{ strategy: UserStrategy } | null>;
  update: (id: string, params: UpdateUserStrategyParams) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
}

export function useUserStrategies(): UseUserStrategiesReturn {
  const [strategies, setStrategies] = useState<UserStrategy[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await window.fetch("/api/user-strategies");
      if (!res.ok) throw new Error("Failed to load user strategies");
      const data = await res.json();
      setStrategies(data.strategies ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load user strategies");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const create = useCallback(async (
    params: CreateUserStrategyParams
  ): Promise<{ strategy: UserStrategy } | { conflict: true }> => {
    const res = await window.fetch("/api/user-strategies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });

    if (res.status === 409) return { conflict: true };

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Failed to save strategy (${res.status})`);
    }

    const data = await res.json();
    setStrategies((prev) => [data.strategy, ...prev]);
    return { strategy: data.strategy };
  }, []);

  const createOrReplace = useCallback(async (
    params: CreateUserStrategyParams
  ): Promise<{ strategy: UserStrategy } | null> => {
    const res = await window.fetch("/api/user-strategies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...params, overwrite: true }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Failed to save strategy (${res.status})`);
    }

    const data = await res.json();
    setStrategies((prev) => {
      const idx = prev.findIndex((s) => s.name === params.name);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = data.strategy;
        return next;
      }
      return [data.strategy, ...prev];
    });
    return { strategy: data.strategy };
  }, []);

  const update = useCallback(async (id: string, params: UpdateUserStrategyParams): Promise<boolean> => {
    try {
      const res = await window.fetch(`/api/user-strategies/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      if (!res.ok) return false;
      const data = await res.json();
      setStrategies((prev) => prev.map((s) => s.id === id ? data.strategy : s));
      return true;
    } catch {
      return false;
    }
  }, []);

  const remove = useCallback(async (id: string): Promise<boolean> => {
    try {
      const res = await window.fetch(`/api/user-strategies/${id}`, { method: "DELETE" });
      if (!res.ok) return false;
      setStrategies((prev) => prev.filter((s) => s.id !== id));
      return true;
    } catch {
      return false;
    }
  }, []);

  return { strategies, isLoading, error, fetch, create, createOrReplace, update, remove };
}
