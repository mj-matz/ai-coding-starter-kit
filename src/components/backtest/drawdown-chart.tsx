"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Brush,
} from "recharts";
import { format, parseISO } from "date-fns";
import type { DrawdownCurvePoint } from "@/lib/backtest-types";

interface DrawdownChartProps {
  data: DrawdownCurvePoint[];
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
  payload: DrawdownCurvePoint;
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
      <p className="text-sm font-medium text-red-400">
        {point.value.toFixed(2)}%
      </p>
    </div>
  );
}

export function DrawdownChart({ data }: DrawdownChartProps) {
  const chartData =
    data.length > 500
      ? data.filter((_, i) => i % Math.ceil(data.length / 500) === 0)
      : data;

  const minDrawdown = Math.min(...chartData.map((d) => d.drawdown_pct));

  return (
    <div className="bg-white/5 backdrop-blur-xl rounded-3xl border border-white/5 p-6">
      <h3 className="text-base font-semibold text-slate-200 mb-4">Drawdown</h3>
      <div className="h-[200px] w-full" role="img" aria-label="Drawdown chart showing percentage drawdown over time">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
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
              tickFormatter={(v: number) => `${v.toFixed(1)}%`}
              stroke="rgba(255,255,255,0.2)"
              tick={{ fontSize: 11, fill: "rgba(255,255,255,0.4)" }}
              domain={[minDrawdown * 1.1, 0]}
              width={55}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="drawdown_pct"
              stroke="#F43F5E"
              fill="#F43F5E"
              fillOpacity={0.12}
              strokeWidth={1.5}
            />
            <Brush
              dataKey="date"
              height={24}
              stroke="rgba(255,255,255,0.1)"
              fill="rgba(255,255,255,0.03)"
              tickFormatter={formatDateLabel}
              travellerWidth={8}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
