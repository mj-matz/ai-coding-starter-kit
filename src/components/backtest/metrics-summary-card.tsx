"use client";

import type { BacktestMetrics, MonthlyR } from "@/lib/backtest-types";

interface MetricsSummaryCardProps {
  metrics: BacktestMetrics;
  initialCapital: number;
  monthlyR?: MonthlyR[];
}

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
const EMERALD = "#10B981";
const ROSE = "#F43F5E";

const glassCard: React.CSSProperties = {
  background: "rgba(255, 255, 255, 0.05)",
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
  border: "1px solid rgba(255, 255, 255, 0.1)",
  borderRadius: "24px",
  padding: "24px",
  fontFamily: FONT,
};

function formatPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatNum(value: number, decimals = 2): string {
  return value.toFixed(decimals);
}

// Colored badge with neon glow
function GlowBadge({ value, positive }: { value: string; positive: boolean }) {
  const color = positive ? EMERALD : ROSE;
  const bg = positive ? "rgba(16, 185, 129, 0.15)" : "rgba(244, 63, 94, 0.15)";
  return (
    <span
      style={{
        color,
        background: bg,
        borderRadius: "8px",
        padding: "2px 10px",
        fontSize: "13px",
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {value}
    </span>
  );
}

// Plain metric row (label + neutral value)
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "6px 0",
      }}
    >
      <span style={{ fontSize: "13px", color: "rgba(255,255,255,0.5)" }}>{label}</span>
      <span style={{ fontSize: "13px", fontWeight: 600, color: "rgba(255,255,255,0.9)" }}>
        {value}
      </span>
    </div>
  );
}

// Badge metric row
function BadgeRow({ label, value, positive }: { label: string; value: string; positive: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "6px 0",
      }}
    >
      <span style={{ fontSize: "13px", color: "rgba(255,255,255,0.5)" }}>{label}</span>
      <GlowBadge value={value} positive={positive} />
    </div>
  );
}

// Circular win rate donut (SVG)
function WinRateCircle({ pct }: { pct: number }) {
  const r = 50;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  return (
    <div style={{ position: "relative", width: 136, height: 136, flexShrink: 0 }}>
      <svg width="136" height="136" style={{ transform: "rotate(-90deg)" }}>
        <circle
          cx="68" cy="68" r={r}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="10"
        />
        <circle
          cx="68" cy="68" r={r}
          fill="none"
          stroke={EMERALD}
          strokeWidth="10"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ filter: "drop-shadow(0 0 6px rgba(16,185,129,0.6))" }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.45)", marginBottom: "2px" }}>
          Win Rate
        </div>
        <div style={{ fontSize: "21px", fontWeight: 700, color: "white" }}>
          {pct.toFixed(2)}%
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3
      style={{
        fontSize: "15px",
        fontWeight: 600,
        color: "white",
        marginBottom: "16px",
        fontFamily: FONT,
      }}
    >
      {children}
    </h3>
  );
}

export function MetricsSummaryCard({ metrics, monthlyR }: MetricsSummaryCardProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px", fontFamily: FONT }}>

      {/* Row 1: Overview + Trade Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>

        {/* Overview */}
        <div style={glassCard}>
          <SectionTitle>Overview</SectionTitle>
          <BadgeRow
            label="Total Return"
            value={formatPct(metrics.total_return_pct)}
            positive={metrics.total_return_pct >= 0}
          />
          <BadgeRow
            label="CAGR"
            value={formatPct(metrics.cagr_pct)}
            positive={metrics.cagr_pct >= 0}
          />
          <Row label="Sharpe Ratio" value={formatNum(metrics.sharpe_ratio)} />
          <Row label="Sortino Ratio" value={formatNum(metrics.sortino_ratio)} />
          <Row
            label="Final Balance"
            value={`$${metrics.final_balance.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}`}
          />
        </div>

        {/* Trade Stats */}
        <div style={glassCard}>
          <SectionTitle>Trade Stats</SectionTitle>
          <div style={{ display: "flex", alignItems: "center", gap: "24px" }}>
            <WinRateCircle pct={metrics.win_rate_pct} />
            <div style={{ flex: 1 }}>
              <Row label="Total Trades" value={String(metrics.total_trades)} />
              <Row
                label="Winning / Losing"
                value={`${metrics.winning_trades} / ${metrics.losing_trades}`}
              />
              <Row
                label="Consecutive W / L"
                value={`${metrics.consecutive_wins} / ${metrics.consecutive_losses}`}
              />
              <Row
                label="Avg Duration"
                value={`${formatNum(metrics.avg_trade_duration_hours, 1)} h`}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Row 2: P&L + R-Multiple/Risk column */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.15fr 1fr",
          gap: "16px",
          alignItems: "start",
        }}
      >
        {/* P&L */}
        <div style={glassCard}>
          <SectionTitle>P&amp;L</SectionTitle>
          <BadgeRow
            label="Gross Profit"
            value={`$${formatNum(metrics.gross_profit)} (${formatNum(metrics.gross_profit_pips, 1)} pips)`}
            positive={true}
          />
          <BadgeRow
            label="Gross Loss"
            value={`$${formatNum(metrics.gross_loss)} (${formatNum(metrics.gross_loss_pips, 1)} pips)`}
            positive={false}
          />
          <Row label="Profit Factor" value={formatNum(metrics.profit_factor)} />
          <BadgeRow
            label="Avg Win"
            value={`$${formatNum(metrics.avg_win)} (${formatNum(metrics.avg_win_pips, 1)} pips)`}
            positive={true}
          />
          <BadgeRow
            label="Avg Loss"
            value={`$${formatNum(metrics.avg_loss)} (${formatNum(metrics.avg_loss_pips, 1)} pips)`}
            positive={false}
          />
          <Row label="Avg Win / Avg Loss" value={formatNum(metrics.avg_win_loss_ratio)} />
          <BadgeRow
            label="Best Trade"
            value={`$${formatNum(metrics.best_trade)}`}
            positive={true}
          />
          <BadgeRow
            label="Worst Trade"
            value={`$${formatNum(metrics.worst_trade)}`}
            positive={false}
          />
          <BadgeRow
            label="Expectancy"
            value={`${formatNum(metrics.expectancy_pips)} pips`}
            positive={metrics.expectancy_pips >= 0}
          />
        </div>

        {/* Right column: R-Multiple + Risk stacked */}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* R-Multiple */}
          <div style={glassCard}>
            <SectionTitle>R-Multiple</SectionTitle>
            <BadgeRow
              label="Avg R per Trade"
              value={`${formatNum(metrics.avg_r_multiple)}R`}
              positive={metrics.avg_r_multiple >= 0}
            />
            <BadgeRow
              label="Total R"
              value={`${formatNum(metrics.total_r)}R`}
              positive={metrics.total_r >= 0}
            />
            <BadgeRow
              label="Avg R per Month"
              value={`${formatNum(metrics.avg_r_per_month)}R`}
              positive={metrics.avg_r_per_month >= 0}
            />
          </div>

          {/* Risk */}
          <div style={glassCard}>
            <SectionTitle>Risk</SectionTitle>
            <BadgeRow
              label="Max Drawdown"
              value={formatPct(-Math.abs(metrics.max_drawdown_pct))}
              positive={false}
            />
            <Row label="Calmar Ratio" value={formatNum(metrics.calmar_ratio)} />
            <Row
              label="Longest Drawdown"
              value={`${metrics.longest_drawdown_days.toFixed(0)} days`}
            />
          </div>
        </div>
      </div>

      {/* Monthly R */}
      {monthlyR && monthlyR.length > 0 && (
        <div style={glassCard}>
          <h3
            style={{
              fontSize: "11px",
              fontWeight: 600,
              color: "rgba(255,255,255,0.4)",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              marginBottom: "12px",
              fontFamily: FONT,
            }}
          >
            Monthly R
          </h3>
          {/* Header row */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 50px 70px 80px",
              gap: "8px",
              padding: "0 0 6px 0",
              borderBottom: "1px solid rgba(255,255,255,0.08)",
              marginBottom: "4px",
            }}
          >
            <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)" }}>Monat</span>
            <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)", textAlign: "right" }}>Trades</span>
            <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)", textAlign: "right" }}>Winrate</span>
            <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)", textAlign: "right" }}>R</span>
          </div>
          {monthlyR.map((row) => (
            <div
              key={row.month}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 50px 70px 80px",
                gap: "8px",
                alignItems: "center",
                padding: "5px 0",
              }}
            >
              <span style={{ fontSize: "13px", color: "rgba(255,255,255,0.5)" }}>
                {row.month}
              </span>
              <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.4)", textAlign: "right" }}>
                {row.trade_count}
              </span>
              <span
                style={{
                  fontSize: "12px",
                  fontWeight: 600,
                  textAlign: "right",
                  color: (row.win_rate_pct ?? 0) >= 50 ? EMERALD : ROSE,
                }}
              >
                {(row.win_rate_pct ?? 0).toFixed(0)}%
              </span>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                {row.r_earned != null ? (
                  <GlowBadge
                    value={`${row.r_earned.toFixed(2)}R`}
                    positive={row.r_earned >= 0}
                  />
                ) : (
                  <span style={{ color: "rgba(255,255,255,0.3)", fontSize: "13px" }}>—</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
