"use client";

import { useMemo } from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  CartesianGrid,
  LineChart,
  Line,
} from "recharts";

import type { OptimizerResultRow, TargetMetric } from "@/lib/optimizer-types";
import { TARGET_METRIC_LABELS } from "@/lib/optimizer-types";

interface HeatmapChartProps {
  results: OptimizerResultRow[];
  targetMetric: TargetMetric;
  parameterKeys: string[];
}

// ── Color interpolation ────────────────────────────────────────────────────

function interpolateColor(value: number, min: number, max: number): string {
  if (max === min) return "hsl(210, 50%, 50%)";
  const ratio = Math.max(0, Math.min(1, (value - min) / (max - min)));
  // Red (0) -> Yellow (0.5) -> Green (1)
  const hue = ratio * 120; // 0 = red, 60 = yellow, 120 = green
  return `hsl(${hue}, 70%, ${35 + ratio * 20}%)`;
}

// ── Get metric value from result row ───────────────────────────────────────

function getMetricValue(row: OptimizerResultRow, metric: TargetMetric): number | null {
  switch (metric) {
    case "profit_factor":
      return row.profit_factor;
    case "sharpe_ratio":
      return row.sharpe_ratio;
    case "win_rate":
      return row.win_rate;
    case "net_profit":
      return row.net_profit;
    case "max_drawdown_pct":
      return row.max_drawdown_pct ?? null;
    case "recovery_factor":
      return row.recovery_factor ?? null;
  }
}

// ── Custom Tooltip ─────────────────────────────────────────────────────────

interface TooltipPayloadItem {
  payload?: Record<string, unknown>;
}

function HeatmapTooltip({
  active,
  payload,
  targetMetric,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  targetMetric: TargetMetric;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const data = payload[0]?.payload;
  if (!data) return null;

  return (
    <div className="rounded-lg border border-white/20 bg-[#0d0f14] p-3 shadow-xl">
      <p className="text-xs text-gray-400">
        {Object.entries(data)
          .filter(([key]) => !["metricValue", "color", "index"].includes(key))
          .map(([key, value]) => `${key}: ${value}`)
          .join(" | ")}
      </p>
      <p className="mt-1 text-sm font-medium text-white">
        {TARGET_METRIC_LABELS[targetMetric]}:{" "}
        {typeof data.metricValue === "number"
          ? data.metricValue.toFixed(2)
          : "N/A"}
      </p>
    </div>
  );
}

// ── Heatmap Component ──────────────────────────────────────────────────────

export function HeatmapChart({ results, targetMetric, parameterKeys }: HeatmapChartProps) {
  const validResults = useMemo(
    () => results.filter((r) => r.error == null && getMetricValue(r, targetMetric) != null),
    [results, targetMetric]
  );

  const is2D = parameterKeys.length >= 2;

  if (validResults.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-white/10 bg-white/5">
        <p className="text-sm text-gray-500">No valid results to display</p>
      </div>
    );
  }

  // 1D case: Line chart
  if (!is2D) {
    return <LineChartView results={validResults} targetMetric={targetMetric} parameterKey={parameterKeys[0]} />;
  }

  // 2D case: Scatter-based heatmap
  return <ScatterHeatmapView results={validResults} targetMetric={targetMetric} parameterKeys={parameterKeys} />;
}

// ── 1D Line Chart ──────────────────────────────────────────────────────────

function LineChartView({
  results,
  targetMetric,
  parameterKey,
}: {
  results: OptimizerResultRow[];
  targetMetric: TargetMetric;
  parameterKey: string;
}) {
  const data = useMemo(() => {
    return results
      .map((r) => ({
        x: r.params[parameterKey],
        value: getMetricValue(r, targetMetric),
      }))
      .filter((d) => d.value != null)
      .sort((a, b) => a.x - b.x);
  }, [results, targetMetric, parameterKey]);

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <h4 className="mb-3 text-sm font-medium text-gray-400">
        {TARGET_METRIC_LABELS[targetMetric]} by {parameterKey}
      </h4>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
          <XAxis
            dataKey="x"
            stroke="#64748b"
            tick={{ fill: "#94a3b8", fontSize: 12 }}
            label={{ value: parameterKey, position: "bottom", fill: "#94a3b8", fontSize: 12, offset: -5 }}
          />
          <YAxis
            stroke="#64748b"
            tick={{ fill: "#94a3b8", fontSize: 12 }}
            label={{
              value: TARGET_METRIC_LABELS[targetMetric],
              angle: -90,
              position: "insideLeft",
              fill: "#94a3b8",
              fontSize: 12,
            }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#0d0f14",
              border: "1px solid rgba(255,255,255,0.2)",
              borderRadius: "8px",
              color: "#e2e8f0",
            }}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={{ fill: "#3b82f6", r: 4 }}
            name={TARGET_METRIC_LABELS[targetMetric]}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── 2D Scatter Heatmap ─────────────────────────────────────────────────────

function ScatterHeatmapView({
  results,
  targetMetric,
  parameterKeys,
}: {
  results: OptimizerResultRow[];
  targetMetric: TargetMetric;
  parameterKeys: string[];
}) {
  const [xKey, yKey] = parameterKeys;

  const { data, minValue, maxValue } = useMemo(() => {
    const mapped = results.map((r, i) => ({
      [xKey]: r.params[xKey],
      [yKey]: r.params[yKey],
      metricValue: getMetricValue(r, targetMetric) ?? 0,
      index: i,
    }));

    const values = mapped.map((d) => d.metricValue);
    const min = Math.min(...values);
    const max = Math.max(...values);

    return { data: mapped, minValue: min, maxValue: max };
  }, [results, targetMetric, xKey, yKey]);

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-medium text-gray-400">
          {TARGET_METRIC_LABELS[targetMetric]} - Heatmap ({xKey} x {yKey})
        </h4>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <div className="h-3 w-12 rounded bg-gradient-to-r from-red-600 via-yellow-500 to-green-500" />
          <span>low - high</span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={Math.min(400, Math.max(250, data.length * 3))}>
        <ScatterChart margin={{ top: 10, right: 10, bottom: 30, left: 30 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
          <XAxis
            dataKey={xKey}
            type="number"
            stroke="#64748b"
            tick={{ fill: "#94a3b8", fontSize: 12 }}
            label={{ value: xKey, position: "bottom", fill: "#94a3b8", fontSize: 12, offset: -5 }}
            domain={["dataMin", "dataMax"]}
          />
          <YAxis
            dataKey={yKey}
            type="number"
            stroke="#64748b"
            tick={{ fill: "#94a3b8", fontSize: 12 }}
            label={{ value: yKey, angle: -90, position: "insideLeft", fill: "#94a3b8", fontSize: 12 }}
            domain={["dataMin", "dataMax"]}
          />
          <Tooltip content={<HeatmapTooltip targetMetric={targetMetric} />} />
          <Scatter data={data} shape="square">
            {data.map((entry) => (
              <Cell
                key={entry.index}
                fill={interpolateColor(entry.metricValue, minValue, maxValue)}
                stroke="rgba(255,255,255,0.1)"
                strokeWidth={0.5}
              />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
