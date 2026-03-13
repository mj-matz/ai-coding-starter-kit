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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    <div className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 shadow-lg">
      <p className="text-xs text-gray-400">
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
    <Card className="border-gray-800 bg-[#111118]">
      <CardHeader className="pb-2">
        <CardTitle className="text-base text-gray-100">Drawdown</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[200px] w-full" role="img" aria-label="Drawdown chart showing percentage drawdown over time">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={chartData}
              margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="#1f2937"
                vertical={false}
              />
              <XAxis
                dataKey="date"
                tickFormatter={formatDateLabel}
                stroke="#6b7280"
                tick={{ fontSize: 11 }}
                minTickGap={40}
              />
              <YAxis
                tickFormatter={(v: number) => `${v.toFixed(1)}%`}
                stroke="#6b7280"
                tick={{ fontSize: 11 }}
                domain={[minDrawdown * 1.1, 0]}
                width={55}
              />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone"
                dataKey="drawdown_pct"
                stroke="#ef4444"
                fill="#ef4444"
                fillOpacity={0.15}
                strokeWidth={1.5}
              />
              <Brush
                dataKey="date"
                height={24}
                stroke="#374151"
                fill="#111118"
                tickFormatter={formatDateLabel}
                travellerWidth={8}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
