/**
 * Component tests for PROJ-37: MT5 Result Panel discrepancy guard.
 *
 * These tests run in JSDOM and exercise the actual React render so we can
 * verify the guard logic the way a browser would see it:
 *   - the side-by-side comparison is suppressed when only one side has data;
 *   - the > 5 % discrepancy warning fires only when both Python and MT5
 *     reference the same mql_conversion_id;
 *   - friendly hints surface when comparison or warning are skipped.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { Mt5ResultPanel } from "./mt5-result-panel";
import type { BacktestResult } from "@/lib/backtest-types";
import type { Mt5TesterMetrics } from "@/lib/mt5-bridge-types";

// ── Helpers ─────────────────────────────────────────────────────────────────

function pythonResult(netProfit: number): BacktestResult {
  // Cast through unknown — the panel only reads metrics.{net_profit, sharpe_ratio,
  // max_drawdown_pct, total_trades}, so we don't need a full BacktestResult fixture.
  return {
    metrics: {
      net_profit: netProfit,
      sharpe_ratio: 1.4,
      max_drawdown_pct: 8.2,
      total_trades: 50,
    },
  } as unknown as BacktestResult;
}

function mt5Metrics(netProfit: number): Mt5TesterMetrics {
  return {
    total_net_profit: netProfit,
    sharpe_ratio: 1.4,
    profit_factor: 1.6,
    max_drawdown_abs: 820,
    max_drawdown_pct: 8.2,
    total_trades: 50,
    won_trades: 28,
    lost_trades: 22,
    average_trade: 18.0,
  };
}

// The "Metric" column header is unique to the comparison table — using it
// avoids collisions with "Python" / "MT5" strings that appear elsewhere
// (heading, status badges, hints).
const COMPARISON_METRIC_HEADER = "Metric";

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Mt5ResultPanel — discrepancy guard", () => {
  it("hides the comparison table when only the Python side has data", () => {
    render(
      <Mt5ResultPanel
        pythonResult={pythonResult(1000)}
        mt5Status={null}
        mt5Phase="idle"
        mt5Metrics={null}
        mt5ErrorMessage={null}
        mt5QueuePosition={null}
        mt5RunningElapsedSec={null}
        pythonConversionId={null}
        mt5ConversionId={null}
      />
    );

    // Column header row should not render — table is gated on both-sides-present.
    expect(screen.queryByText("Net Profit")).not.toBeInTheDocument();
    // The single-side hint should appear.
    expect(
      screen.getByText(/Run the strategy in MT5 to compare/i)
    ).toBeInTheDocument();
  });

  it("hides the comparison table when only the MT5 side has data", () => {
    render(
      <Mt5ResultPanel
        pythonResult={null}
        mt5Status="done"
        mt5Phase="done"
        mt5Metrics={mt5Metrics(1000)}
        mt5ErrorMessage={null}
        mt5QueuePosition={null}
        mt5RunningElapsedSec={null}
        pythonConversionId={null}
        mt5ConversionId="conv-1"
      />
    );

    expect(screen.queryByText("Net Profit")).not.toBeInTheDocument();
    expect(
      screen.getByText(/Run a Python backtest to compare/i)
    ).toBeInTheDocument();
  });

  it("renders the table when both sides have data", () => {
    render(
      <Mt5ResultPanel
        pythonResult={pythonResult(1000)}
        mt5Status="done"
        mt5Phase="done"
        mt5Metrics={mt5Metrics(1010)}
        mt5ErrorMessage={null}
        mt5QueuePosition={null}
        mt5RunningElapsedSec={null}
        pythonConversionId={null}
        mt5ConversionId={null}
      />
    );

    // Comparison table header + rows are present.
    expect(screen.getByText(COMPARISON_METRIC_HEADER)).toBeInTheDocument();
    expect(screen.getByText("Net Profit")).toBeInTheDocument();
    expect(screen.getByText("Sharpe Ratio")).toBeInTheDocument();
    expect(screen.getByText("Max Drawdown")).toBeInTheDocument();
    expect(screen.getByText("Total Trades")).toBeInTheDocument();
  });

  it("suppresses the > 5 % warning when both sides have data but conversion IDs differ", () => {
    render(
      <Mt5ResultPanel
        pythonResult={pythonResult(1000)}
        mt5Status="done"
        mt5Phase="done"
        mt5Metrics={mt5Metrics(1500)} // 50 % discrepancy — would trigger the warning
        mt5ErrorMessage={null}
        mt5QueuePosition={null}
        mt5RunningElapsedSec={null}
        pythonConversionId="conv-A"
        mt5ConversionId="conv-B"
      />
    );

    // Warning copy must NOT appear.
    expect(screen.queryByText(/Discrepancy Python vs MT5/i)).not.toBeInTheDocument();
    // The "skipped because mismatched" hint should appear instead.
    expect(
      screen.getByText(/Discrepancy check skipped/i)
    ).toBeInTheDocument();
  });

  it("suppresses the > 5 % warning when both conversion IDs are null (cannot prove same strategy)", () => {
    render(
      <Mt5ResultPanel
        pythonResult={pythonResult(1000)}
        mt5Status="done"
        mt5Phase="done"
        mt5Metrics={mt5Metrics(1500)}
        mt5ErrorMessage={null}
        mt5QueuePosition={null}
        mt5RunningElapsedSec={null}
        pythonConversionId={null}
        mt5ConversionId={null}
      />
    );

    expect(screen.queryByText(/Discrepancy Python vs MT5/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(/Discrepancy check skipped/i)
    ).toBeInTheDocument();
  });

  it("shows the > 5 % warning only when both sides have data AND conversion IDs match", () => {
    render(
      <Mt5ResultPanel
        pythonResult={pythonResult(1000)}
        mt5Status="done"
        mt5Phase="done"
        mt5Metrics={mt5Metrics(1500)} // 50 % discrepancy
        mt5ErrorMessage={null}
        mt5QueuePosition={null}
        mt5RunningElapsedSec={null}
        pythonConversionId="conv-shared"
        mt5ConversionId="conv-shared"
      />
    );

    expect(screen.getByText(/Discrepancy Python vs MT5/i)).toBeInTheDocument();
    expect(screen.queryByText(/Discrepancy check skipped/i)).not.toBeInTheDocument();
  });

  it("does not show the warning when matching IDs but discrepancy is below 5 %", () => {
    render(
      <Mt5ResultPanel
        pythonResult={pythonResult(1000)}
        mt5Status="done"
        mt5Phase="done"
        mt5Metrics={mt5Metrics(1010)} // 1 % discrepancy
        mt5ErrorMessage={null}
        mt5QueuePosition={null}
        mt5RunningElapsedSec={null}
        pythonConversionId="conv-shared"
        mt5ConversionId="conv-shared"
      />
    );

    expect(screen.queryByText(/Discrepancy Python vs MT5/i)).not.toBeInTheDocument();
    // No mismatched-conversion hint either — this is the happy "matches + within tolerance" path.
    expect(screen.queryByText(/Discrepancy check skipped/i)).not.toBeInTheDocument();
  });

  it("renders the failed-run alert with the bridge error message", () => {
    render(
      <Mt5ResultPanel
        pythonResult={pythonResult(1000)}
        mt5Status="failed"
        mt5Phase="failed"
        mt5Metrics={null}
        mt5ErrorMessage="Bridge token mismatch"
        mt5QueuePosition={null}
        mt5RunningElapsedSec={null}
        pythonConversionId={null}
        mt5ConversionId={null}
      />
    );

    expect(screen.getByText(/MT5 Tester run failed/i)).toBeInTheDocument();
    expect(screen.getByText("Bridge token mismatch")).toBeInTheDocument();
    // Failure path must not render the comparison table.
    expect(screen.queryByText("Net Profit")).not.toBeInTheDocument();
  });

  it("shows the queued progress hint with position", () => {
    render(
      <Mt5ResultPanel
        pythonResult={pythonResult(1000)}
        mt5Status="queued"
        mt5Phase="polling"
        mt5Metrics={null}
        mt5ErrorMessage={null}
        mt5QueuePosition={2}
        mt5RunningElapsedSec={null}
        pythonConversionId={null}
        mt5ConversionId={null}
      />
    );

    expect(screen.getByText(/Run queued at position 2/i)).toBeInTheDocument();
    // Still no comparison table while the run is queued.
    expect(screen.queryByText("Net Profit")).not.toBeInTheDocument();
  });
});
