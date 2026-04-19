"use client";

import { useState, useMemo } from "react";
import { ChevronUp, ChevronDown, Trophy, ArrowUpRight, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { OptimizerResultRow, TargetMetric, HardConstraint } from "@/lib/optimizer-types";
import {
  TARGET_METRIC_LABELS,
  TARGET_METRIC_DIRECTION,
  isConstraintViolated,
} from "@/lib/optimizer-types";
import type { BacktestFormValues } from "@/lib/backtest-types";
import { saveConfigToStorage } from "@/lib/backtest-types";

type SortKey =
  | "profit_factor"
  | "sharpe_ratio"
  | "win_rate"
  | "net_profit"
  | "total_trades"
  | "max_drawdown_pct"
  | "recovery_factor";
type SortDir = "asc" | "desc";

// Parameter keys that are stored as minutes but should display as HH:MM
const TIME_PARAM_KEYS = new Set(["rangeStart", "rangeEnd", "timeExit"]);

// Defines display order for parameter keys; keys not listed keep their natural order
const PARAM_KEY_ORDER: Record<string, number> = {
  rangeStart: 0,
  rangeEnd: 1,
};

function sortedParamKeys(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const oa = PARAM_KEY_ORDER[a] ?? 99;
    const ob = PARAM_KEY_ORDER[b] ?? 99;
    return oa - ob;
  });
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60).toString().padStart(2, "0");
  const m = (minutes % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

function formatParamValue(key: string, value: number): string {
  return TIME_PARAM_KEYS.has(key) ? minutesToTime(value) : String(value);
}

/** All sortable metric columns in the table */
const TABLE_COLUMNS: { key: SortKey; label: string }[] = [
  { key: "profit_factor", label: "PF" },
  { key: "sharpe_ratio", label: "Sharpe" },
  { key: "win_rate", label: "Win%" },
  { key: "net_profit", label: "Net P&L" },
  { key: "max_drawdown_pct", label: "Max DD%" },
  { key: "recovery_factor", label: "Rec. F." },
  { key: "total_trades", label: "Trades" },
];

interface ResultsTableProps {
  results: OptimizerResultRow[];
  targetMetric: TargetMetric;
  parameterKeys: string[];
  backtestConfig: BacktestFormValues | null;
  onApplyParams?: () => void;
  hardConstraint?: HardConstraint | null;
}

function fmt(value: number | null | undefined, decimals = 2): string {
  if (value == null) return "\u2014";
  return value.toFixed(decimals);
}

export function ResultsTable({
  results,
  targetMetric,
  parameterKeys,
  backtestConfig,
  onApplyParams,
  hardConstraint = null,
}: ResultsTableProps) {
  const direction = TARGET_METRIC_DIRECTION[targetMetric];
  const defaultSortDir: SortDir = direction === "minimize" ? "asc" : "desc";

  const [sortKey, setSortKey] = useState<SortKey>(targetMetric as SortKey);
  const [sortDir, setSortDir] = useState<SortDir>(defaultSortDir);
  const [selectedRow, setSelectedRow] = useState<string | null>(null);
  const [prevTargetMetric, setPrevTargetMetric] = useState(targetMetric);

  // Re-sync sort when target metric changes (React derived-state-during-render pattern)
  if (prevTargetMetric !== targetMetric) {
    setPrevTargetMetric(targetMetric);
    setSortKey(targetMetric as SortKey);
    setSortDir(TARGET_METRIC_DIRECTION[targetMetric] === "minimize" ? "asc" : "desc");
  }

  const orderedParamKeys = sortedParamKeys(parameterKeys);

  // Find best result (direction-aware, constraint-aware)
  const bestResult = useMemo(() => {
    const valid = results.filter(
      (r) =>
        r.error == null &&
        r[targetMetric] != null &&
        !isConstraintViolated(r, hardConstraint)
    );
    if (valid.length === 0) return null;

    if (direction === "minimize") {
      return valid.reduce((best, curr) =>
        (curr[targetMetric] ?? Infinity) < (best[targetMetric] ?? Infinity) ? curr : best
      );
    }
    return valid.reduce((best, curr) =>
      (curr[targetMetric] ?? -Infinity) > (best[targetMetric] ?? -Infinity) ? curr : best
    );
  }, [results, targetMetric, direction, hardConstraint]);

  // True only when constraint is active AND at least one valid (non-error) row exists but all are excluded
  const allExcluded = useMemo(() => {
    if (!hardConstraint) return false;
    const validRows = results.filter((r) => r.error == null);
    if (validRows.length === 0) return false;
    return validRows.every((r) => isConstraintViolated(r, hardConstraint));
  }, [results, hardConstraint]);

  const sorted = useMemo(() => {
    const copy = [...results];
    copy.sort((a, b) => {
      const aVal = a[sortKey] ?? (sortDir === "desc" ? -Infinity : Infinity);
      const bVal = b[sortKey] ?? (sortDir === "desc" ? -Infinity : Infinity);
      return sortDir === "desc" ? (bVal as number) - (aVal as number) : (aVal as number) - (bVal as number);
    });
    return copy;
  }, [results, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      // Default sort direction based on metric direction
      const metricDir = TARGET_METRIC_DIRECTION[key as TargetMetric];
      setSortDir(metricDir === "minimize" ? "asc" : "desc");
    }
  }

  function SortIcon({ column }: { column: SortKey }) {
    if (sortKey !== column) return <ChevronUp className="h-3 w-3 text-gray-600" />;
    return sortDir === "desc" ? (
      <ChevronDown className="h-3 w-3 text-blue-400" />
    ) : (
      <ChevronUp className="h-3 w-3 text-blue-400" />
    );
  }

  function applyParamsToConfig(params: Record<string, number>) {
    if (!backtestConfig) return;
    const updatedStrategyParams: Record<string, unknown> = {
      ...((backtestConfig.strategyParams as Record<string, unknown>) ?? {}),
    };
    for (const [key, val] of Object.entries(params)) {
      updatedStrategyParams[key] = TIME_PARAM_KEYS.has(key) ? minutesToTime(val) : val;
    }
    saveConfigToStorage({ ...backtestConfig, strategyParams: updatedStrategyParams });
    onApplyParams?.();
  }

  function handleApplyBest() {
    if (!bestResult) return;
    applyParamsToConfig(bestResult.params);
  }

  function handleApplySelected() {
    if (!selectedResult) return;
    applyParamsToConfig(selectedResult.params);
  }

  const selectedResult = selectedRow
    ? results.find((r) => r.params_hash === selectedRow)
    : null;

  if (results.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-xl border border-white/10 bg-white/5">
        <p className="text-sm text-gray-500">No results available</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* All excluded by constraint warning */}
      {allExcluded && hardConstraint && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
          <p className="text-sm text-amber-300">
            No combinations meet the constraint ({TARGET_METRIC_LABELS[hardConstraint.metric]}{" "}
            {hardConstraint.direction} {hardConstraint.threshold})
          </p>
        </div>
      )}

      {/* Best result banner */}
      {bestResult && !allExcluded && (
        <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3">
          <div className="flex items-center gap-3">
            <Trophy className="h-4 w-4 text-emerald-400" />
            <div>
              <p className="text-sm font-medium text-emerald-300">
                Best Result:{" "}
                {orderedParamKeys.map((k) => `${k}=${formatParamValue(k, bestResult.params[k])}`).join(", ")}
              </p>
              <p className="text-xs text-emerald-400/70">
                {TARGET_METRIC_LABELS[targetMetric]}: {fmt(bestResult[targetMetric])}
                {hardConstraint && (
                  <span className="ml-2 text-emerald-400/50">
                    (constraint: {TARGET_METRIC_LABELS[hardConstraint.metric]} {hardConstraint.direction} {hardConstraint.threshold})
                  </span>
                )}
              </p>
            </div>
          </div>
          {backtestConfig && (
            <Button
              size="sm"
              onClick={handleApplyBest}
              className="bg-emerald-600 text-white hover:bg-emerald-500"
            >
              <ArrowUpRight className="mr-1 h-3.5 w-3.5" />
              Apply Best Params
            </Button>
          )}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 bg-white/5">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-400">
                Parameter
              </th>
              {TABLE_COLUMNS.map((col) => (
                <th key={col.key} className="px-3 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort(col.key)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-white"
                  >
                    {col.label}
                    <SortIcon column={col.key} />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const isBest = row.params_hash === bestResult?.params_hash;
              const isSelected = row.params_hash === selectedRow;
              const isViolated = isConstraintViolated(row, hardConstraint);

              return (
                <tr
                  key={row.params_hash}
                  onClick={() =>
                    setSelectedRow((prev) =>
                      prev === row.params_hash ? null : row.params_hash
                    )
                  }
                  className={[
                    "cursor-pointer border-b border-white/5 transition-colors",
                    isBest ? "bg-emerald-500/10 hover:bg-emerald-500/15" : "hover:bg-white/5",
                    isSelected ? "ring-1 ring-inset ring-blue-500/50" : "",
                    isViolated ? "opacity-40" : "",
                  ].join(" ")}
                >
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {orderedParamKeys.map((k) => (
                        <Badge
                          key={k}
                          variant="secondary"
                          className={
                            isBest
                              ? "bg-emerald-600/20 text-emerald-300 border-emerald-500/30 text-xs"
                              : "bg-white/10 text-gray-300 border-white/10 text-xs"
                          }
                        >
                          {k}={formatParamValue(k, row.params[k])}
                        </Badge>
                      ))}
                      {row.error && (
                        <Badge variant="secondary" className="bg-red-600/20 text-red-300 border-red-500/30 text-xs">
                          Error
                        </Badge>
                      )}
                      {isViolated && !row.error && (
                        <Badge variant="secondary" className="bg-amber-600/20 text-amber-300 border-amber-500/30 text-xs">
                          Excluded
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-300">
                    {fmt(row.profit_factor)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-300">
                    {fmt(row.sharpe_ratio)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-300">
                    {row.win_rate != null ? `${fmt(row.win_rate, 1)}%` : "\u2014"}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-300">
                    {fmt(row.net_profit)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-300">
                    {fmt(row.max_drawdown_pct, 2)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-300">
                    {fmt(row.recovery_factor, 2)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-300">
                    {row.total_trades}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Detail panel */}
      {selectedResult && (
        <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-4">
          <h4 className="mb-2 text-sm font-medium text-gray-300">
            Detail:{" "}
            {orderedParamKeys.map((k) => `${k}=${formatParamValue(k, selectedResult.params[k])}`).join(", ")}
            {isConstraintViolated(selectedResult, hardConstraint) && (
              <Badge variant="secondary" className="ml-2 bg-amber-600/20 text-amber-300 border-amber-500/30 text-xs">
                Excluded by constraint
              </Badge>
            )}
          </h4>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3 lg:grid-cols-8 items-end">
            <div>
              <p className="text-xs text-gray-500">Profit Factor</p>
              <p className="text-sm font-medium text-white">{fmt(selectedResult.profit_factor)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Sharpe Ratio</p>
              <p className="text-sm font-medium text-white">{fmt(selectedResult.sharpe_ratio)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Win Rate</p>
              <p className="text-sm font-medium text-white">
                {selectedResult.win_rate != null ? `${fmt(selectedResult.win_rate, 1)}%` : "\u2014"}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Net Profit</p>
              <p className="text-sm font-medium text-white">{fmt(selectedResult.net_profit)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Max Drawdown %</p>
              <p className="text-sm font-medium text-white">{fmt(selectedResult.max_drawdown_pct, 2)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Recovery Factor</p>
              <p className="text-sm font-medium text-white">{fmt(selectedResult.recovery_factor, 2)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Trades</p>
              <p className="text-sm font-medium text-white">{selectedResult.total_trades}</p>
            </div>
            {backtestConfig && (
              <div className="flex items-end justify-end">
                <Button
                  size="sm"
                  onClick={handleApplySelected}
                  className="shrink-0 bg-blue-600 text-white hover:bg-blue-500"
                >
                  <ArrowUpRight className="mr-1 h-3.5 w-3.5" />
                  Apply Params
                </Button>
              </div>
            )}
          </div>
          {selectedResult.error && (
            <p className="mt-2 text-xs text-red-400">{selectedResult.error}</p>
          )}
        </div>
      )}
    </div>
  );
}
