"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Brush,
} from "recharts";
import { format, parseISO } from "date-fns";
import type { EquityCurvePoint } from "@/lib/backtest-types";

interface EquityCurveChartProps {
  data: EquityCurvePoint[];
}

function formatCurrency(value: number): string {
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function formatDateLabel(dateStr: string): string {
  try {
    return format(parseISO(dateStr), "MMM dd");
  } catch {
    return dateStr;
  }
}

interface TooltipPayloadItem {
  value: number;
  payload: EquityCurvePoint;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadItem[];
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  const point = payload[0];
  return (
    <div className="rounded-xl border border-white/10 bg-[#0d0f14] px-3 py-2 shadow-lg">
      <p className="text-xs text-slate-400">
        {(() => {
          try {
            return format(parseISO(point.payload.date), "MMM dd, yyyy HH:mm");
          } catch {
            return point.payload.date;
          }
        })()}
      </p>
      <p className="text-sm font-medium text-slate-100">
        {formatCurrency(point.value)}
      </p>
    </div>
  );
}

export function EquityCurveChart({ data }: EquityCurveChartProps) {
  // Downsample for performance if needed
  const chartData =
    data.length > 500
      ? data.filter((_, i) => i % Math.ceil(data.length / 500) === 0)
      : data;

  const balances = chartData.map((d) => d.balance);
  const minBalance = Math.min(...balances);
  const maxBalance = Math.max(...balances);
  const padding = (maxBalance - minBalance) * 0.05 || 100;

  return (
    <div className="bg-white/5 backdrop-blur-xl rounded-3xl border border-white/5 p-6">
      <h3 className="text-base font-semibold text-slate-200 mb-4">Equity Curve</h3>
      <div className="h-[300px] w-full" role="img" aria-label="Equity curve chart showing account balance over time">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartData}
            margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(255,255,255,0.05)"
              vertical={false}
            />
            <XAxis
              dataKey="date"
              tickFormatter={formatDateLabel}
              stroke="rgba(255,255,255,0.2)"
              tick={{ fontSize: 11, fill: "rgba(255,255,255,0.4)" }}
              minTickGap={40}
            />
            <YAxis
              tickFormatter={formatCurrency}
              stroke="rgba(255,255,255,0.2)"
              tick={{ fontSize: 11, fill: "rgba(255,255,255,0.4)" }}
              domain={[minBalance - padding, maxBalance + padding]}
              width={70}
            />
            <Tooltip content={<CustomTooltip />} />
            <Line
              type="monotone"
              dataKey="balance"
              stroke="#10B981"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: "#10B981" }}
            />
            <Brush
              dataKey="date"
              height={24}
              stroke="rgba(255,255,255,0.1)"
              fill="rgba(255,255,255,0.03)"
              tickFormatter={formatDateLabel}
              travellerWidth={8}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
