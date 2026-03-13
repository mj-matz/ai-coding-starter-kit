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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
      <p className="text-sm font-medium text-gray-100">
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
    <Card className="border-gray-800 bg-[#111118]">
      <CardHeader className="pb-2">
        <CardTitle className="text-base text-gray-100">Equity Curve</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[300px] w-full" role="img" aria-label="Equity curve chart showing account balance over time">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
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
                tickFormatter={formatCurrency}
                stroke="#6b7280"
                tick={{ fontSize: 11 }}
                domain={[minBalance - padding, maxBalance + padding]}
                width={70}
              />
              <Tooltip content={<CustomTooltip />} />
              <Line
                type="monotone"
                dataKey="balance"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: "#3b82f6" }}
              />
              <Brush
                dataKey="date"
                height={24}
                stroke="#374151"
                fill="#111118"
                tickFormatter={formatDateLabel}
                travellerWidth={8}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
