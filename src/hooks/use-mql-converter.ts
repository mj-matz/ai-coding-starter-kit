"use client";

import { useState, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { BacktestResult } from "@/lib/backtest-types";

// ── Types ───────────────────────────────────────────────────────────────────

export type MqlVersion = "auto" | "mql4" | "mql5";

export interface MappingEntry {
  mql_function: string;
  python_equivalent: string;
  status: "mapped" | "approximated" | "unsupported";
  note: string;
}

export interface StrategyParameter {
  name: string;
  label: string;
  type: "number" | "integer" | "string";
  default: number | string;
  mql_input_name: string;
}

export interface ConvertResult {
  python_code: string;
  mapping_report: MappingEntry[];
  warnings: string[];
  parameters?: StrategyParameter[];
  /** Saved parameter values to restore when loading a conversion (not set on fresh conversions) */
  initialParameterValues?: Record<string, number | string>;
}

export interface SavedConversionMetrics {
  total_trades: number;
  win_rate_pct: number;
  total_return_pct: number;
}

export interface SavedConversion {
  id: string;
  name: string;
  mql_version: MqlVersion;
  created_at: string;
  backtest_result?: { metrics: SavedConversionMetrics } | null;
}

export type MqlConverterStatus =
  | "idle"
  | "converting"
  | "fetching_data"
  | "running"
  | "success"
  | "error";

interface UseMqlConverterReturn {
  status: MqlConverterStatus;
  convertResult: ConvertResult | null;
  backtestResult: BacktestResult | null;
  error: string | null;
  cacheId: string | null;

  convertAndRun: (params: ConvertAndRunParams) => Promise<void>;
  rerunBacktest: (params: RerunParams) => Promise<void>;
  loadConversionResult: (pythonCode: string, mappingReport: MappingEntry[], parameters?: StrategyParameter[], savedValues?: Record<string, number | string>) => void;
  cancel: () => void;
  reset: () => void;

  // Saves
  savedConversions: SavedConversion[];
  loadingSaves: boolean;
  fetchSaves: () => Promise<void>;
  saveConversion: (params: SaveParams) => Promise<boolean>;
  deleteConversion: (id: string) => Promise<boolean>;
}

export interface ConvertAndRunParams {
  mqlCode: string;
  mqlVersion: MqlVersion;
  symbol: string;
  timeframe: string;
  startDate: string;
  endDate: string;
  initialCapital: number;
  sizingMode: "risk_percent" | "fixed_lot";
  riskPercent?: number;
  fixedLot?: number;
  commission: number;
  slippage: number;
  /** When set, the Claude conversion step is skipped and this code is used directly. */
  preloadedPythonCode?: string;
  preloadedMappingReport?: MappingEntry[];
}

export interface RerunParams {
  pythonCode: string;
  cacheId: string;
  symbol: string;
  initialCapital: number;
  sizingMode: "risk_percent" | "fixed_lot";
  riskPercent?: number;
  fixedLot?: number;
  commission: number;
  slippage: number;
  params?: Record<string, number | string>;
}

interface SaveParams {
  name: string;
  mqlCode: string;
  mqlVersion: MqlVersion;
  pythonCode: string;
  mappingReport: MappingEntry[];
  backtestResult?: BacktestResult;
  parameters?: StrategyParameter[];
  parameterValues?: Record<string, number | string>;
}

// ── Instrument config lookup ────────────────────────────────────────────────

async function getInstrumentConfig(
  symbol: string
): Promise<{ pip_size: number; pip_value_per_lot: number; timezone: string }> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("instruments")
    .select("pip_size, pip_value_per_lot, timezone")
    .eq("symbol", symbol)
    .single();

  if (error || !data) {
    throw new Error(`Instrument config not found for ${symbol}`);
  }

  return data as { pip_size: number; pip_value_per_lot: number; timezone: string };
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useMqlConverter(): UseMqlConverterReturn {
  const [status, setStatus] = useState<MqlConverterStatus>("idle");
  const [convertResult, setConvertResult] = useState<ConvertResult | null>(null);
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cacheId, setCacheId] = useState<string | null>(null);

  const [savedConversions, setSavedConversions] = useState<SavedConversion[]>([]);
  const [loadingSaves, setLoadingSaves] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setStatus("idle");
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setStatus("idle");
    setConvertResult(null);
    setBacktestResult(null);
    setError(null);
    setCacheId(null);
  }, []);

  // ── Convert & Run ─────────────────────────────────────────────────────────

  const convertAndRun = useCallback(async (params: ConvertAndRunParams) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus("converting");
    setError(null);
    setConvertResult(null);
    setBacktestResult(null);
    setCacheId(null);

    try {
      // Step 1: Convert MQL to Python (or use preloaded code to skip Claude API)
      let convertData: ConvertResult;

      if (params.preloadedPythonCode) {
        convertData = {
          python_code: params.preloadedPythonCode,
          mapping_report: params.preloadedMappingReport ?? [],
          warnings: [],
        };
        setConvertResult(convertData);
      } else {
        const convertRes = await fetch("/api/mql-converter/convert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mql_code: params.mqlCode,
            mql_version: params.mqlVersion,
          }),
          signal: controller.signal,
        });

        if (!convertRes.ok) {
          const body = await convertRes.json().catch(() => ({}));
          throw new Error(body.error || `Conversion failed (${convertRes.status})`);
        }

        convertData = await convertRes.json();
        setConvertResult(convertData);
      }

      // Step 2: Fetch data to get cache_id
      setStatus("fetching_data");

      const fetchRes = await fetch("/api/data/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: params.symbol,
          source: "dukascopy",
          timeframe: params.timeframe,
          date_from: params.startDate,
          date_to: params.endDate,
        }),
        signal: controller.signal,
      });

      if (!fetchRes.ok) {
        const body = await fetchRes.json().catch(() => ({}));
        throw new Error(body.error || `Data fetch failed (${fetchRes.status})`);
      }

      const fetchData = await fetchRes.json();
      const newCacheId = fetchData.cache_id;

      if (!newCacheId) {
        throw new Error("Data fetch did not return a cache_id");
      }

      setCacheId(newCacheId);

      // Step 3: Get instrument config
      const instrument = await getInstrumentConfig(params.symbol);

      // Step 4: Run backtest with converted code
      setStatus("running");

      const runRes = await fetch("/api/mql-converter/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          python_code: convertData.python_code,
          cache_id: newCacheId,
          config: {
            initial_balance: params.initialCapital,
            sizing_mode: params.sizingMode,
            instrument: {
              pip_size: instrument.pip_size,
              pip_value_per_lot: instrument.pip_value_per_lot,
            },
            ...(params.sizingMode === "fixed_lot"
              ? { fixed_lot: params.fixedLot }
              : { risk_percent: params.riskPercent }),
            commission: params.commission,
            slippage_pips: params.slippage,
            timezone: instrument.timezone,
          },
        }),
        signal: controller.signal,
      });

      if (!runRes.ok) {
        const body = await runRes.json().catch(() => ({}));
        const detail = body.detail;
        if (typeof detail === "object" && detail?.error) {
          throw new Error(
            detail.traceback
              ? `${detail.error}\n\n${detail.traceback}`
              : detail.error
          );
        }
        throw new Error(body.error || `Backtest failed (${runRes.status})`);
      }

      const runData: BacktestResult = await runRes.json();
      setBacktestResult(runData);
      setStatus("success");
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setStatus("idle");
        return;
      }
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
      setStatus("error");
    }
  }, []);

  // ── Load a saved conversion result without re-converting ─────────────────

  const loadConversionResult = useCallback((
    pythonCode: string,
    mappingReport: MappingEntry[],
    parameters?: StrategyParameter[],
    savedValues?: Record<string, number | string>
  ) => {
    setConvertResult({
      python_code: pythonCode,
      mapping_report: mappingReport,
      warnings: [],
      parameters,
      initialParameterValues: savedValues,
    });
    setBacktestResult(null);
    setStatus("idle");
    setError(null);
    setCacheId(null);
  }, []);

  // ── Re-run backtest (edited code, no conversion) ─────────────────────────

  const rerunBacktest = useCallback(async (params: RerunParams) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus("running");
    setError(null);
    setBacktestResult(null);

    try {
      const instrument = await getInstrumentConfig(params.symbol);

      const runPayload: Record<string, unknown> = {
        python_code: params.pythonCode,
        cache_id: params.cacheId,
        config: {
          initial_balance: params.initialCapital,
          sizing_mode: params.sizingMode,
          instrument: {
            pip_size: instrument.pip_size,
            pip_value_per_lot: instrument.pip_value_per_lot,
          },
          ...(params.sizingMode === "fixed_lot"
            ? { fixed_lot: params.fixedLot }
            : { risk_percent: params.riskPercent }),
          commission: params.commission,
          slippage_pips: params.slippage,
          timezone: instrument.timezone,
        },
      };

      if (params.params && Object.keys(params.params).length > 0) {
        runPayload.params = params.params;
      }

      const runRes = await fetch("/api/mql-converter/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(runPayload),
        signal: controller.signal,
      });

      if (!runRes.ok) {
        const body = await runRes.json().catch(() => ({}));
        const detail = body.detail;
        if (typeof detail === "object" && detail?.error) {
          throw new Error(
            detail.traceback
              ? `${detail.error}\n\n${detail.traceback}`
              : detail.error
          );
        }
        throw new Error(body.error || `Backtest failed (${runRes.status})`);
      }

      const runData: BacktestResult = await runRes.json();
      setBacktestResult(runData);
      setStatus("success");
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setStatus("idle");
        return;
      }
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
      setStatus("error");
    }
  }, []);

  // ── Saved conversions CRUD ────────────────────────────────────────────────

  const fetchSaves = useCallback(async () => {
    setLoadingSaves(true);
    try {
      const res = await fetch("/api/mql-converter/saves");
      if (!res.ok) throw new Error("Failed to load saves");
      const data = await res.json();
      setSavedConversions(data.conversions ?? []);
    } catch {
      setSavedConversions([]);
    } finally {
      setLoadingSaves(false);
    }
  }, []);

  const saveConversion = useCallback(async (params: SaveParams): Promise<boolean> => {
    try {
      const res = await fetch("/api/mql-converter/saves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: params.name,
          mql_code: params.mqlCode,
          mql_version: params.mqlVersion,
          python_code: params.pythonCode,
          mapping_report: params.mappingReport,
          backtest_result: params.backtestResult
            ? { metrics: params.backtestResult.metrics }
            : undefined,
          parameters: params.parameters ?? undefined,
          parameter_values: params.parameterValues ?? undefined,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to save");
      }

      // Refresh list
      await fetchSaves();
      return true;
    } catch {
      return false;
    }
  }, [fetchSaves]);

  const deleteConversion = useCallback(async (id: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/mql-converter/saves/${id}`, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("Failed to delete");

      setSavedConversions((prev) => prev.filter((c) => c.id !== id));
      return true;
    } catch {
      return false;
    }
  }, []);

  return {
    status,
    convertResult,
    backtestResult,
    error,
    cacheId,
    convertAndRun,
    rerunBacktest,
    loadConversionResult,
    cancel,
    reset,
    savedConversions,
    loadingSaves,
    fetchSaves,
    saveConversion,
    deleteConversion,
  };
}
