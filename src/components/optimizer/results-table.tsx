"use client";

import { useState, useMemo } from "react";
import { ChevronUp, ChevronDown, Trophy, ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { OptimizerResultRow, TargetMetric } from "@/lib/optimizer-types";
import { TARGET_METRIC_LABELS } from "@/lib/optimizer-types";
import type { BacktestFormValues } from "@/lib/backtest-types";
import { saveConfigToStorage } from "@/lib/backtest-types";

type SortKey = "profit_factor" | "sharpe_ratio" | "win_rate" | "net_profit" | "total_trades";
type SortDir = "asc" | "desc";

interface ResultsTableProps {
  results: OptimizerResultRow[];
  targetMetric: TargetMetric;
  parameterKeys: string[];
  backtestConfig: BacktestFormValues | null;
  onApplyParams?: () => void;
}

function fmt(value: number | null, decimals = 2): string {
  if (value == null) return "N/A";
  return value.toFixed(decimals);
}

export function ResultsTable({
  results,
  targetMetric,
  parameterKeys,
  backtestConfig,
  onApplyParams,
}: ResultsTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>(targetMetric as SortKey);
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selectedRow, setSelectedRow] = useState<string | null>(null);

  // Find best result (highest value of target metric among valid rows)
  const bestResult = useMemo(() => {
    const valid = results.filter((r) => r.error == null && r[targetMetric] != null);
    if (valid.length === 0) return null;
    return valid.reduce((best, curr) =>
      (curr[targetMetric] ?? -Infinity) > (best[targetMetric] ?? -Infinity) ? curr : best
    );
  }, [results, targetMetric]);

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
      setSortDir("desc");
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

  function handleApplyBest() {
    if (!bestResult || !backtestConfig) return;
    const updated = { ...backtestConfig };
    for (const [key, val] of Object.entries(bestResult.params)) {
      if (key in updated) {
        (updated as Record<string, unknown>)[key] = val;
      }
    }
    saveConfigToStorage(updated);
    onApplyParams?.();
  }

  const selectedResult = selectedRow
    ? results.find((r) => r.params_hash === selectedRow)
    : null;

  if (results.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-xl border border-white/10 bg-white/5">
        <p className="text-sm text-gray-500">Keine Ergebnisse vorhanden</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Best result banner */}
      {bestResult && (
        <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3">
          <div className="flex items-center gap-3">
            <Trophy className="h-4 w-4 text-emerald-400" />
            <div>
              <p className="text-sm font-medium text-emerald-300">
                Bestes Ergebnis:{" "}
                {parameterKeys.map((k) => `${k}=${bestResult.params[k]}`).join(", ")}
              </p>
              <p className="text-xs text-emerald-400/70">
                {TARGET_METRIC_LABELS[targetMetric]}: {fmt(bestResult[targetMetric])}
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
              Beste Params anwenden
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
              {(["profit_factor", "sharpe_ratio", "win_rate", "net_profit", "total_trades"] as SortKey[]).map(
                (col) => (
                  <th key={col} className="px-3 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => toggleSort(col)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-white"
                    >
                      {col === "total_trades"
                        ? "Trades"
                        : col === "profit_factor"
                          ? "PF"
                          : col === "sharpe_ratio"
                            ? "Sharpe"
                            : col === "win_rate"
                              ? "Win%"
                              : "Net P&L"}
                      <SortIcon column={col} />
                    </button>
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const isBest = row.params_hash === bestResult?.params_hash;
              const isSelected = row.params_hash === selectedRow;

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
                  ].join(" ")}
                >
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {parameterKeys.map((k) => (
                        <Badge
                          key={k}
                          variant="secondary"
                          className={
                            isBest
                              ? "bg-emerald-600/20 text-emerald-300 border-emerald-500/30 text-xs"
                              : "bg-white/10 text-gray-300 border-white/10 text-xs"
                          }
                        >
                          {k}={row.params[k]}
                        </Badge>
                      ))}
                      {row.error && (
                        <Badge variant="secondary" className="bg-red-600/20 text-red-300 border-red-500/30 text-xs">
                          Fehler
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
                    {row.win_rate != null ? `${fmt(row.win_rate, 1)}%` : "N/A"}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-300">
                    {fmt(row.net_profit)}
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
            {parameterKeys.map((k) => `${k}=${selectedResult.params[k]}`).join(", ")}
          </h4>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3 lg:grid-cols-5">
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
                {selectedResult.win_rate != null ? `${fmt(selectedResult.win_rate, 1)}%` : "N/A"}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Net Profit</p>
              <p className="text-sm font-medium text-white">{fmt(selectedResult.net_profit)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Trades</p>
              <p className="text-sm font-medium text-white">{selectedResult.total_trades}</p>
            </div>
          </div>
          {selectedResult.error && (
            <p className="mt-2 text-xs text-red-400">{selectedResult.error}</p>
          )}
        </div>
      )}
    </div>
  );
}
