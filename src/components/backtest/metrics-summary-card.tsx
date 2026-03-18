"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { BacktestMetrics, MonthlyR } from "@/lib/backtest-types";

interface MetricsSummaryCardProps {
  metrics: BacktestMetrics;
  initialCapital: number;
  monthlyR?: MonthlyR[];
}

interface MetricItemProps {
  label: string;
  value: string;
  valueColor?: string;
}

function MetricItem({ label, value, valueColor }: MetricItemProps) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-gray-400">{label}</span>
      <span className={`text-sm font-medium ${valueColor ?? "text-gray-100"}`}>
        {value}
      </span>
    </div>
  );
}

function formatPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatNum(value: number, decimals = 2): string {
  return value.toFixed(decimals);
}

function pctColor(value: number): string {
  if (value > 0) return "text-green-400";
  if (value < 0) return "text-red-400";
  return "text-gray-100";
}

export function MetricsSummaryCard({ metrics, initialCapital, monthlyR }: MetricsSummaryCardProps) {
  return (
    <Card className="border-gray-800 bg-[#111118]">
      <CardHeader className="pb-3">
        <CardTitle className="text-base text-gray-100">
          Performance Summary
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Overview */}
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
            Overview
          </h4>
          <MetricItem
            label="Total Return"
            value={formatPct(metrics.total_return_pct)}
            valueColor={pctColor(metrics.total_return_pct)}
          />
          <MetricItem
            label="CAGR"
            value={formatPct(metrics.cagr_pct)}
            valueColor={pctColor(metrics.cagr_pct)}
          />
          <MetricItem
            label="Sharpe Ratio"
            value={formatNum(metrics.sharpe_ratio)}
          />
          <MetricItem
            label="Sortino Ratio"
            value={formatNum(metrics.sortino_ratio)}
          />
          <MetricItem
            label="Final Balance"
            value={`$${metrics.final_balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            valueColor={pctColor(metrics.final_balance - initialCapital)}
          />
        </div>

        <Separator className="bg-gray-800" />

        {/* Trade Stats */}
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
            Trade Stats
          </h4>
          <MetricItem
            label="Total Trades"
            value={String(metrics.total_trades)}
          />
          <MetricItem
            label="Win Rate"
            value={formatPct(metrics.win_rate_pct)}
          />
          <MetricItem
            label="Winning / Losing"
            value={`${metrics.winning_trades} / ${metrics.losing_trades}`}
          />
          <MetricItem
            label="Consecutive Wins / Losses"
            value={`${metrics.consecutive_wins} / ${metrics.consecutive_losses}`}
          />
          <MetricItem
            label="Avg Duration"
            value={`${formatNum(metrics.avg_trade_duration_hours, 1)} h`}
          />
        </div>

        <Separator className="bg-gray-800" />

        {/* P&L */}
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
            P&amp;L
          </h4>
          <MetricItem
            label="Gross Profit"
            value={`$${formatNum(metrics.gross_profit)} (${formatNum(metrics.gross_profit_pips, 1)} pips)`}
            valueColor="text-green-400"
          />
          <MetricItem
            label="Gross Loss"
            value={`$${formatNum(metrics.gross_loss)} (${formatNum(metrics.gross_loss_pips, 1)} pips)`}
            valueColor="text-red-400"
          />
          <MetricItem
            label="Profit Factor"
            value={formatNum(metrics.profit_factor)}
          />
          <MetricItem
            label="Avg Win"
            value={`$${formatNum(metrics.avg_win)} (${formatNum(metrics.avg_win_pips, 1)} pips)`}
            valueColor="text-green-400"
          />
          <MetricItem
            label="Avg Loss"
            value={`$${formatNum(metrics.avg_loss)} (${formatNum(metrics.avg_loss_pips, 1)} pips)`}
            valueColor="text-red-400"
          />
          <MetricItem
            label="Avg Win / Avg Loss"
            value={formatNum(metrics.avg_win_loss_ratio)}
          />
          <MetricItem
            label="Best Trade"
            value={`$${formatNum(metrics.best_trade)}`}
            valueColor="text-green-400"
          />
          <MetricItem
            label="Worst Trade"
            value={`$${formatNum(metrics.worst_trade)}`}
            valueColor="text-red-400"
          />
          <MetricItem
            label="Expectancy"
            value={`${formatNum(metrics.expectancy_pips)} pips`}
            valueColor={pctColor(metrics.expectancy_pips)}
          />
        </div>

        <Separator className="bg-gray-800" />

        {/* R-Multiple */}
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
            R-Multiple
          </h4>
          <MetricItem
            label="Avg R per Trade"
            value={`${formatNum(metrics.avg_r_multiple)}R`}
            valueColor={pctColor(metrics.avg_r_multiple)}
          />
          <MetricItem
            label="Total R"
            value={`${formatNum(metrics.total_r)}R`}
            valueColor={pctColor(metrics.total_r)}
          />
          <MetricItem
            label="Avg R per Month"
            value={`${formatNum(metrics.avg_r_per_month)}R`}
            valueColor={pctColor(metrics.avg_r_per_month)}
          />
        </div>

        <Separator className="bg-gray-800" />

        {/* Risk */}
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
            Risk
          </h4>
          <MetricItem
            label="Max Drawdown"
            value={formatPct(-Math.abs(metrics.max_drawdown_pct))}
            valueColor="text-red-400"
          />
          <MetricItem
            label="Calmar Ratio"
            value={formatNum(metrics.calmar_ratio)}
          />
          <MetricItem
            label="Longest Drawdown"
            value={`${metrics.longest_drawdown_days.toFixed(0)} days`}
          />
        </div>

        {/* Monthly R Breakdown */}
        {monthlyR && monthlyR.length > 0 && (
          <>
            <Separator className="bg-gray-800" />
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                Monthly R
              </h4>
              {monthlyR.map((row) => (
                <MetricItem
                  key={row.month}
                  label={`${row.month} (${row.trade_count} trades)`}
                  value={row.r_earned != null ? `${row.r_earned.toFixed(2)}R` : "—"}
                  valueColor={row.r_earned != null ? pctColor(row.r_earned) : undefined}
                />
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
