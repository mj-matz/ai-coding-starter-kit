"use client";

import { useState } from "react";
import type { BacktestMetrics, MonthlyR } from "@/lib/backtest-types";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface MetricsSummaryCardProps {
  metrics: BacktestMetrics;
  initialCapital: number;
  monthlyR?: MonthlyR[];
  crv?: number | null;
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

function formatDollar(value: number): string {
  const abs = Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return value < 0 ? `-$${abs}` : `$${abs}`;
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes.toFixed(0)} min`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(1)} h`;
  const days = hours / 24;
  return `${days.toFixed(1)} d`;
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

// Highlighted CRV row (bold, white, visually distinct)
function CrvRow({ crv }: { crv: number }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "8px 0",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        marginBottom: "4px",
      }}
    >
      <span style={{ fontSize: "14px", fontWeight: 700, color: "rgba(255,255,255,0.7)" }}>
        CRV
      </span>
      <span style={{ fontSize: "15px", fontWeight: 700, color: "white", letterSpacing: "0.02em" }}>
        1 : {crv.toFixed(2)}
      </span>
    </div>
  );
}

// Row with a tooltip on the label
function TooltipRow({ label, value, tooltip }: { label: string; value: string; tooltip: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "6px 0",
      }}
    >
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              style={{
                fontSize: "13px",
                color: "rgba(255,255,255,0.5)",
                borderBottom: "1px dotted rgba(255,255,255,0.25)",
                cursor: "help",
              }}
            >
              {label}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p style={{ maxWidth: "260px", fontSize: "12px" }}>{tooltip}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <span style={{ fontSize: "13px", fontWeight: 600, color: "rgba(255,255,255,0.9)" }}>
        {value}
      </span>
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

export function MetricsSummaryCard({ metrics, monthlyR, crv }: MetricsSummaryCardProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const m = metrics;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px", fontFamily: FONT }}>

      {/* Row 1: Overview + Trade Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>

        {/* Overview */}
        <div style={glassCard}>
          <SectionTitle>Overview</SectionTitle>
          {crv != null && <CrvRow crv={crv} />}
          <BadgeRow
            label="Total Return"
            value={formatPct(m.total_return_pct)}
            positive={m.total_return_pct >= 0}
          />
          {m.net_profit != null && (
            <BadgeRow
              label="Net Profit"
              value={formatDollar(m.net_profit)}
              positive={m.net_profit >= 0}
            />
          )}
          {m.max_drawdown_abs != null && (
            <Row
              label="Recovery Factor"
              value={m.recovery_factor != null ? formatNum(m.recovery_factor) : "\u221e"}
            />
          )}
          {m.expected_payoff != null && (
            <BadgeRow
              label="Expected Payoff"
              value={formatDollar(m.expected_payoff)}
              positive={m.expected_payoff >= 0}
            />
          )}
          <BadgeRow
            label="CAGR"
            value={formatPct(m.cagr_pct)}
            positive={m.cagr_pct >= 0}
          />
          <Row label="Sharpe Ratio" value={formatNum(m.sharpe_ratio)} />
          <Row label="Sortino Ratio" value={formatNum(m.sortino_ratio)} />
          <Row
            label="Final Balance"
            value={formatDollar(m.final_balance)}
          />
        </div>

        {/* Trade Stats */}
        <div style={glassCard}>
          <SectionTitle>Trade Stats</SectionTitle>
          <div style={{ display: "flex", alignItems: "center", gap: "24px" }}>
            <WinRateCircle pct={m.win_rate_pct} />
            <div style={{ flex: 1 }}>
              <Row label="Total Trades" value={String(m.total_trades)} />
              <Row
                label="Winning / Losing"
                value={`${m.winning_trades} / ${m.losing_trades}`}
              />
              {m.buy_trades != null && (
                <Row
                  label="Buy Trades"
                  value={`${m.buy_trades} (${m.buy_win_rate_pct != null ? formatNum(m.buy_win_rate_pct, 1) + "%" : "\u2014%"})`}
                />
              )}
              {m.sell_trades != null && (
                <Row
                  label="Sell Trades"
                  value={`${m.sell_trades} (${m.sell_win_rate_pct != null ? formatNum(m.sell_win_rate_pct, 1) + "%" : "\u2014%"})`}
                />
              )}
              <Row
                label="Consecutive W / L"
                value={`${m.consecutive_wins} / ${m.consecutive_losses}`}
              />
              <Row
                label="Avg Duration"
                value={`${formatNum(m.avg_trade_duration_hours, 1)} h`}
              />
              {m.min_trade_duration_minutes != null && m.max_trade_duration_minutes != null && (
                <Row
                  label="Min / Max Duration"
                  value={`${formatDuration(m.min_trade_duration_minutes)} / ${formatDuration(m.max_trade_duration_minutes)}`}
                />
              )}
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
            value={`$${formatNum(m.gross_profit)} (${formatNum(m.gross_profit_pips, 1)} pips)`}
            positive={true}
          />
          <BadgeRow
            label="Gross Loss"
            value={`$${formatNum(m.gross_loss)} (${formatNum(m.gross_loss_pips, 1)} pips)`}
            positive={false}
          />
          <Row label="Profit Factor" value={formatNum(m.profit_factor)} />
          <BadgeRow
            label="Avg Win"
            value={`$${formatNum(m.avg_win)} (${formatNum(m.avg_win_pips, 1)} pips)`}
            positive={true}
          />
          <BadgeRow
            label="Avg Loss"
            value={`$${formatNum(m.avg_loss)} (${formatNum(m.avg_loss_pips, 1)} pips)`}
            positive={false}
          />
          <Row label="Avg Win / Avg Loss" value={formatNum(m.avg_win_loss_ratio)} />
          <BadgeRow
            label="Best Trade"
            value={`$${formatNum(m.best_trade)}`}
            positive={true}
          />
          <BadgeRow
            label="Worst Trade"
            value={`$${formatNum(m.worst_trade)}`}
            positive={false}
          />
          <BadgeRow
            label="Expectancy"
            value={`${formatNum(m.expectancy_pips)} pips`}
            positive={m.expectancy_pips >= 0}
          />

          {/* Consecutive streak metrics */}
          {m.max_consec_wins_count != null && (
            <BadgeRow
              label="Max Consec. Wins"
              value={`${m.max_consec_wins_count}x (${m.max_consec_wins_profit != null ? formatDollar(m.max_consec_wins_profit) : "\u2014"})`}
              positive={true}
            />
          )}
          {m.max_consec_losses_count != null && (
            <BadgeRow
              label="Max Consec. Losses"
              value={`${m.max_consec_losses_count}x (${m.max_consec_losses_loss != null ? formatDollar(m.max_consec_losses_loss) : "\u2014"})`}
              positive={false}
            />
          )}
          {m.avg_consec_wins != null && m.avg_consec_losses != null && (
            <Row
              label="Avg Consec. W / L"
              value={`${formatNum(m.avg_consec_wins, 1)} / ${formatNum(m.avg_consec_losses, 1)}`}
            />
          )}
        </div>

        {/* Right column: R-Multiple + Risk stacked */}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* R-Multiple */}
          <div style={glassCard}>
            <SectionTitle>R-Multiple</SectionTitle>
            <BadgeRow
              label="Avg R per Trade"
              value={`${formatNum(m.avg_r_multiple)}R`}
              positive={m.avg_r_multiple >= 0}
            />
            <BadgeRow
              label="Total R"
              value={`${formatNum(m.total_r)}R`}
              positive={m.total_r >= 0}
            />
            <BadgeRow
              label="Avg R per Month"
              value={`${formatNum(m.avg_r_per_month)}R`}
              positive={m.avg_r_per_month >= 0}
            />
          </div>

          {/* Risk */}
          <div style={glassCard}>
            <SectionTitle>Risk</SectionTitle>
            <BadgeRow
              label="Max Drawdown"
              value={formatPct(-Math.abs(m.max_drawdown_pct))}
              positive={false}
            />
            {m.max_drawdown_abs != null && (
              <BadgeRow
                label="Max Drawdown ($)"
                value={formatDollar(m.max_drawdown_abs)}
                positive={false}
              />
            )}
            {m.max_drawdown_abs != null && (
              <Row
                label="Recovery Factor"
                value={m.recovery_factor != null ? formatNum(m.recovery_factor) : "\u221e"}
              />
            )}
            <Row label="Calmar Ratio" value={formatNum(m.calmar_ratio)} />
            <Row
              label="Longest Drawdown"
              value={`${m.longest_drawdown_days.toFixed(0)} days`}
            />
          </div>
        </div>
      </div>

      {/* Advanced Card (collapsible, collapsed by default) */}
      {(m.ahpr != null || m.ghpr != null || m.lr_correlation != null || m.lr_std_error != null || m.z_score != null) && (
        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <div style={glassCard}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  width: "100%",
                  cursor: "pointer",
                  background: "none",
                  border: "none",
                  padding: 0,
                  fontFamily: FONT,
                }}
                aria-label={advancedOpen ? "Collapse advanced metrics" : "Expand advanced metrics"}
              >
                <SectionTitle>Advanced</SectionTitle>
                <span
                  style={{
                    fontSize: "18px",
                    color: "rgba(255,255,255,0.4)",
                    transition: "transform 0.2s",
                    transform: advancedOpen ? "rotate(180deg)" : "rotate(0deg)",
                  }}
                >
                  &#9662;
                </span>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div style={{ paddingTop: "8px" }}>
                {m.ahpr != null && (
                  <TooltipRow
                    label="AHPR"
                    value={formatNum(m.ahpr, 6)}
                    tooltip="Average Holding Period Return - arithmetischer Durchschnitt der Rendite pro Trade"
                  />
                )}
                {m.ghpr != null && (
                  <TooltipRow
                    label="GHPR"
                    value={formatNum(m.ghpr, 6)}
                    tooltip="Geometric Holding Period Return - geometrischer Durchschnitt der Balance-Multiplikatoren pro Trade"
                  />
                )}
                {m.lr_correlation != null && (
                  <TooltipRow
                    label="LR Correlation"
                    value={formatNum(m.lr_correlation, 4)}
                    tooltip="Pearson-Korrelation der Equity-Kurve vs. lineare Regression (0-1). Je naeher an 1, desto gleichmaessiger das Wachstum."
                  />
                )}
                {m.lr_std_error != null && (
                  <TooltipRow
                    label="LR Std. Error"
                    value={formatDollar(m.lr_std_error)}
                    tooltip="Standardfehler der linearen Regression der Equity-Kurve. Niedrigere Werte = gleichmaessigeres Wachstum."
                  />
                )}
                {m.z_score != null && (
                  <ZScoreRow
                    zScore={m.z_score}
                    confidencePct={m.z_score_confidence_pct}
                    totalTrades={m.total_trades}
                  />
                )}
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>
      )}

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
              gridTemplateColumns: "1fr 50px 65px 65px 80px",
              gap: "8px",
              padding: "0 0 6px 0",
              borderBottom: "1px solid rgba(255,255,255,0.08)",
              marginBottom: "4px",
            }}
          >
            <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)" }}>Monat</span>
            <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)", textAlign: "right" }}>Trades</span>
            <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)", textAlign: "right" }}>Winrate</span>
            <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)", textAlign: "right" }}>&Oslash; MAE</span>
            <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)", textAlign: "right" }}>R</span>
          </div>
          {monthlyR.map((row) => (
            <div
              key={row.month}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 50px 65px 65px 80px",
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
                {(row.win_rate_pct ?? 0).toFixed(2)}%
              </span>
              <span style={{ fontSize: "12px", textAlign: "right", color: "rgba(244,63,94,0.8)" }}>
                {row.avg_mae_pips != null ? `-${row.avg_mae_pips.toFixed(0)}p` : "\u2014"}
              </span>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                {row.r_earned != null ? (
                  <GlowBadge
                    value={`${row.r_earned.toFixed(2)}R`}
                    positive={row.r_earned >= 0}
                  />
                ) : (
                  <span style={{ color: "rgba(255,255,255,0.3)", fontSize: "13px" }}>{"\u2014"}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Z-Score row with tooltip warning for small samples
function ZScoreRow({
  zScore,
  confidencePct,
  totalTrades,
}: {
  zScore: number;
  confidencePct?: number;
  totalTrades: number;
}) {
  const valueStr = `${formatNum(zScore)} ${confidencePct != null ? `(${formatNum(confidencePct, 1)}%)` : ""}`;
  const isLowSample = totalTrades < 30;

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "6px 0",
      }}
    >
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              style={{
                fontSize: "13px",
                color: "rgba(255,255,255,0.5)",
                borderBottom: "1px dotted rgba(255,255,255,0.25)",
                cursor: "help",
              }}
            >
              Z-Score
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p style={{ maxWidth: "260px", fontSize: "12px" }}>
              Testet ob Gewinne und Verluste unabhaengig voneinander auftreten. Hoher Absolutwert = Trade-Ergebnisse sind seriell korreliert.
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <span style={{ fontSize: "13px", fontWeight: 600, color: "rgba(255,255,255,0.9)" }}>
          {valueStr}
        </span>
        {isLowSample && (
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  style={{
                    fontSize: "10px",
                    color: "#FBBF24",
                    background: "rgba(251, 191, 36, 0.15)",
                    borderRadius: "4px",
                    padding: "1px 5px",
                    fontWeight: 600,
                    cursor: "help",
                  }}
                >
                  low sample
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p style={{ maxWidth: "220px", fontSize: "12px" }}>
                  Weniger als 30 Trades. Der Z-Score ist statistisch nicht zuverlaessig.
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </span>
    </div>
  );
}
