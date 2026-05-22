"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { Mt5TesterMetrics } from "@/lib/mt5-bridge-types";
import type { TesterTradeSummary } from "@/hooks/use-mt5-tester-run";
import { formatInt, formatPct, formatProfit } from "@/lib/mt5-format";

// PROJ-41: Side-panel results view (stats grid + running balance chart).

interface TesterResultsPanelProps {
  metrics: Mt5TesterMetrics;
  trades: TesterTradeSummary[];
  initialCapital: number;
}

interface BalancePoint {
  x: number;
  balance: number;
}

function formatRatio(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(2);
}

function formatCount(
  value: number | null | undefined,
  total: number | null | undefined,
): string {
  if (value == null || !Number.isFinite(value)) return formatInt(value);
  if (total == null || !Number.isFinite(total) || total === 0) {
    return formatInt(value);
  }
  return `${value} (${((value / total) * 100).toFixed(1)}%)`;
}

function formatYTick(v: number): string {
  if (v >= 1000 || v <= -1000) return `${(v / 1000).toFixed(0)}k`;
  return String(v);
}

interface BalanceTooltipPayload {
  value?: number;
  payload?: BalancePoint;
}

function BalanceTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: BalanceTooltipPayload[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0];
  const balance = typeof point.value === "number" ? point.value : point.payload?.balance;
  const tradeIdx = point.payload?.x;
  if (balance == null) return null;
  return (
    <div className="rounded-md border border-white/10 bg-[#1e293b] px-3 py-2 text-xs shadow-lg">
      <p className="text-slate-400">
        {tradeIdx === 0 ? "Initial" : `After Trade #${tradeIdx}`}
      </p>
      <p className="mt-0.5 font-semibold text-slate-100">
        {balance.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}
      </p>
    </div>
  );
}

export function TesterResultsPanel({
  metrics,
  trades,
  initialCapital,
}: TesterResultsPanelProps) {
  const balanceData = useMemo<BalancePoint[]>(() => {
    const points: BalancePoint[] = [{ x: 0, balance: initialCapital }];
    let running = initialCapital;
    trades.forEach((trade, idx) => {
      running += trade.profit ?? 0;
      points.push({ x: idx + 1, balance: running });
    });
    return points;
  }, [trades, initialCapital]);

  const totalTrades = metrics.total_trades;

  const stats: Array<{ label: string; value: string }> = [
    { label: "Net Profit", value: formatProfit(metrics.total_net_profit) },
    { label: "Gross Profit", value: formatProfit(metrics.gross_profit ?? null) },
    { label: "Gross Loss", value: formatProfit(metrics.gross_loss ?? null) },
    { label: "Profit Factor", value: formatRatio(metrics.profit_factor) },
    { label: "Recovery Factor", value: formatRatio(metrics.recovery_factor) },
    { label: "Sharpe Ratio", value: formatRatio(metrics.sharpe_ratio) },
    { label: "Max DD (abs)", value: formatProfit(metrics.max_drawdown_abs) },
    { label: "Max DD (%)", value: formatPct(metrics.max_drawdown_pct) },
    { label: "Avg Trade", value: formatProfit(metrics.average_trade) },
    { label: "Total Trades", value: formatInt(totalTrades) },
    { label: "Won Trades", value: formatCount(metrics.won_trades, totalTrades) },
    { label: "Lost Trades", value: formatCount(metrics.lost_trades, totalTrades) },
  ];

  return (
    <div className="space-y-4 rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-md">
      <h3 className="text-base font-semibold text-white">MT5 Results</h3>

      {/* Stats grid: 3 columns x 4 rows */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {stats.map(({ label, value }) => (
          <div
            key={label}
            className="rounded-xl border border-white/10 bg-black/20 px-4 py-3"
          >
            <p className="text-xs text-slate-400">{label}</p>
            <p className="mt-1 text-sm font-semibold text-slate-100">{value}</p>
          </div>
        ))}
      </div>

      {/* Account balance chart */}
      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
        <p className="mb-2 text-xs text-slate-400">Account Balance</p>
        {trades.length === 0 ? (
          <p className="py-8 text-center text-xs text-slate-500">
            No trades to plot.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart
              data={balanceData}
              margin={{ top: 8, right: 12, left: 0, bottom: 20 }}
            >
              <defs>
                <linearGradient id="testerBalanceGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.08)" />
              <XAxis
                dataKey="x"
                tick={{ fill: "#94a3b8", fontSize: 10 }}
                tickLine={false}
                stroke="rgba(255,255,255,0.08)"
                label={{
                  value: "Trade #",
                  position: "insideBottom",
                  offset: -10,
                  fill: "#94a3b8",
                  fontSize: 10,
                }}
              />
              <YAxis
                tick={{ fill: "#94a3b8", fontSize: 10 }}
                width={45}
                stroke="rgba(255,255,255,0.08)"
                tickFormatter={formatYTick}
                domain={["auto", "auto"]}
              />
              <Tooltip content={<BalanceTooltip />} />
              <Area
                type="monotone"
                dataKey="balance"
                stroke="#3b82f6"
                strokeWidth={2}
                fill="url(#testerBalanceGradient)"
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
