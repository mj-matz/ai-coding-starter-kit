"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { createChart, CandlestickSeries, BaselineSeries, LineSeries, createSeriesMarkers } from "lightweight-charts";
import type { IChartApi, UTCTimestamp } from "lightweight-charts";

import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Candle, TradeRecord } from "@/lib/backtest-types";

interface TradeChartDialogProps {
  trade: TradeRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cacheId: string | undefined;
  timeframe: string;
  rangeStart: string; // HH:MM (local time)
  rangeEnd: string;   // HH:MM (local time)
}

interface CandleCache {
  tradeId: number;
  candles: Candle[];
  error: string | null;
}

function formatDateTime(dateStr: string): string {
  try {
    return format(parseISO(dateStr), "MMM dd, yyyy HH:mm");
  } catch {
    return dateStr;
  }
}

// Shift a UTC unix timestamp to local time so lightweight-charts (which renders
// timestamps as-if UTC) displays the correct local time on the time axis.
function toChartTime(utcSeconds: number): UTCTimestamp {
  const tzOffsetSec = -new Date().getTimezoneOffset() * 60;
  return (utcSeconds + tzOffsetSec) as UTCTimestamp;
}

// Build the UTC unix timestamp for a given HH:MM local time on the same
// calendar day as `referenceDateStr` (an ISO date-time string).
function buildLocalTimestamp(referenceDateStr: string, timeHHMM: string): number {
  const refDate = new Date(referenceDateStr);
  // toLocaleDateString with en-CA gives "YYYY-MM-DD" in the browser's local timezone.
  const localDate = refDate.toLocaleDateString("en-CA");
  // No trailing 'Z' → Date constructor treats it as local time → getTime() is UTC ms.
  return new Date(`${localDate}T${timeHHMM}:00`).getTime() / 1000;
}

export function TradeChartDialog({
  trade,
  open,
  onOpenChange,
  cacheId,
  timeframe,
  rangeStart,
  rangeEnd,
}: TradeChartDialogProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const [candleCache, setCandleCache] = useState<CandleCache | null>(null);

  const cacheHit = open && trade != null && candleCache?.tradeId === trade.id;
  const isLoadingCandles = open && trade != null && cacheId != null && !cacheHit;
  const candles = useMemo(
    () => (cacheHit ? (candleCache?.candles ?? []) : []),
    [cacheHit, candleCache]
  );
  const candleError = cacheHit ? (candleCache?.error ?? null) : null;

  // Fetch candles on-demand
  useEffect(() => {
    if (!open || !trade || !cacheId) return;
    if (candleCache?.tradeId === trade.id) return;

    const controller = new AbortController();
    const tradeId = trade.id;

    const params = new URLSearchParams({
      cache_id: cacheId,
      entry_time: trade.entry_time,
      exit_time: trade.exit_time,
      timeframe,
    });
    if (rangeStart) {
      // Extend the candle window to include range-formation bars
      const rangeStartIso = new Date(
        buildLocalTimestamp(trade.entry_time, rangeStart) * 1000
      ).toISOString();
      params.set("range_start_time", rangeStartIso);
    }

    fetch(`/api/backtest/candles?${params}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Failed to load candles (${res.status})`);
        }
        return res.json() as Promise<Candle[]>;
      })
      .then((data) => setCandleCache({ tradeId, candles: data, error: null }))
      .catch((err: Error) => {
        if (!controller.signal.aborted) {
          setCandleCache({ tradeId, candles: [], error: err.message });
        }
      });

    return () => controller.abort();
  }, [open, trade, cacheId, timeframe, candleCache?.tradeId]);

  // Render chart once candles are available
  useEffect(() => {
    if (!open || !trade || !chartContainerRef.current || candles.length === 0) {
      return;
    }

    const container = chartContainerRef.current;
    const chartHeight = container.clientWidth < 400 ? 250 : 400;

    const chart = createChart(container, {
      width: container.clientWidth,
      height: chartHeight,
      layout: {
        background: { color: "#ffffff" },
        textColor: "#374151",
      },
      grid: {
        vertLines: { color: "#f3f4f6" },
        horzLines: { color: "#f3f4f6" },
      },
      crosshair: { mode: 0 },
      timeScale: {
        borderColor: "#d1d5db",
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: { borderColor: "#d1d5db" },
    });

    chartRef.current = chart;

    // ── Candlestick series ────────────────────────────────────────────────────
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });

    candleSeries.setData(
      candles.map((c) => ({
        time: toChartTime(c.time),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
    );

    const isLong = trade.direction === "long";
    const isWinLocal = trade.pnl_currency >= 0;
    const entryUtc = Math.floor(new Date(trade.entry_time).getTime() / 1000);
    const exitUtc  = Math.floor(new Date(trade.exit_time).getTime() / 1000);

    // Helper: creates a horizontal LineSeries at a fixed price spanning [t0, t1].
    // lastValueVisible gives a colored label on the right price axis.
    function addHLine(
      price: number,
      color: string,
      t0: UTCTimestamp,
      t1: UTCTimestamp,
      showLabel: boolean
    ) {
      const s = chart.addSeries(LineSeries, {
        color,
        lineWidth: 1,
        lastValueVisible: showLabel,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      });
      s.setData([
        { time: t0, value: price },
        { time: t1, value: price },
      ]);
    }

    // ── Range box (light blue) — fill + top & bottom borders + axis labels ────
    if (trade.range_high > 0 && trade.range_low > 0 && rangeStart && rangeEnd) {
      const rangeStartUtc = buildLocalTimestamp(trade.entry_time, rangeStart);
      const rangeEndUtc   = buildLocalTimestamp(trade.entry_time, rangeEnd);
      const rStart = toChartTime(rangeStartUtc);
      const rEnd   = toChartTime(rangeEndUtc);

      // Blue fill between range_low and range_high
      const rangeSeries = chart.addSeries(BaselineSeries, {
        baseValue: { type: "price", price: trade.range_low },
        topFillColor1: "rgba(96, 165, 250, 0.2)",
        topFillColor2: "rgba(96, 165, 250, 0.2)",
        bottomFillColor1: "rgba(0,0,0,0)",
        bottomFillColor2: "rgba(0,0,0,0)",
        topLineColor: "rgba(0,0,0,0)",
        bottomLineColor: "rgba(0,0,0,0)",
        lineWidth: 1,
        baseLineVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      });
      rangeSeries.setData([
        { time: rStart, value: trade.range_high },
        { time: rEnd,   value: trade.range_high },
      ]);

      // Top border + blue axis label for range_high
      addHLine(trade.range_high, "rgba(96, 165, 250, 0.9)", rStart, rEnd, true);
      // Bottom border + blue axis label for range_low
      addHLine(trade.range_low,  "rgba(96, 165, 250, 0.9)", rStart, rEnd, true);
    }

    // ── Trade zones (green TP / red SL) — from entry to exit ─────────────────
    const tEntry = toChartTime(entryUtc);
    const tExit  = toChartTime(exitUtc);

    if (trade.take_profit > 0 && trade.stop_loss > 0) {
      // Green zone: profit area between entry_price and take_profit
      // Long:  baseline=entry_price, value=take_profit  (tp > entry)
      // Short: baseline=take_profit, value=entry_price  (entry > tp)
      const greenBaseline = isLong ? trade.entry_price : trade.take_profit;
      const greenValue    = isLong ? trade.take_profit  : trade.entry_price;

      chart.addSeries(BaselineSeries, {
        baseValue: { type: "price", price: greenBaseline },
        topFillColor1: "rgba(34, 197, 94, 0.18)",
        topFillColor2: "rgba(34, 197, 94, 0.18)",
        bottomFillColor1: "rgba(0,0,0,0)",
        bottomFillColor2: "rgba(0,0,0,0)",
        topLineColor: "rgba(0,0,0,0)",
        bottomLineColor: "rgba(0,0,0,0)",
        lineWidth: 1,
        baseLineVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      }).setData([
        { time: tEntry, value: greenValue },
        { time: tExit,  value: greenValue },
      ]);

      // Red zone: loss area between stop_loss and entry_price
      // Long:  baseline=stop_loss,   value=entry_price  (entry > sl)
      // Short: baseline=entry_price, value=stop_loss    (sl > entry)
      const redBaseline = isLong ? trade.stop_loss   : trade.entry_price;
      const redValue    = isLong ? trade.entry_price : trade.stop_loss;

      chart.addSeries(BaselineSeries, {
        baseValue: { type: "price", price: redBaseline },
        topFillColor1: "rgba(239, 68, 68, 0.18)",
        topFillColor2: "rgba(239, 68, 68, 0.18)",
        bottomFillColor1: "rgba(0,0,0,0)",
        bottomFillColor2: "rgba(0,0,0,0)",
        topLineColor: "rgba(0,0,0,0)",
        bottomLineColor: "rgba(0,0,0,0)",
        lineWidth: 1,
        baseLineVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      }).setData([
        { time: tEntry, value: redValue },
        { time: tExit,  value: redValue },
      ]);
    }

    // ── Bounded price lines with axis labels ──────────────────────────────────
    // Black line at entry_price (divider between green/red) + black axis label
    addHLine(trade.entry_price, "#1a1a1a", tEntry, tExit, true);

    // Colored line at exit_price (shows where exit was taken) + colored axis label
    const exitColor = isWinLocal ? "#22c55e" : "#ef4444";
    addHLine(trade.exit_price, exitColor, tEntry, tExit, true);

    // ── Entry / Exit markers ──────────────────────────────────────────────────
    const closestEntryCandle = candles.reduce((prev, curr) =>
      Math.abs(curr.time - entryUtc) < Math.abs(prev.time - entryUtc) ? curr : prev
    );
    const closestExitCandle = candles.reduce((prev, curr) =>
      Math.abs(curr.time - exitUtc) < Math.abs(prev.time - exitUtc) ? curr : prev
    );

    const markers = [
      {
        time: toChartTime(closestEntryCandle.time),
        position: isLong ? "belowBar" : "aboveBar",
        color: isLong ? "#22c55e" : "#ef4444",
        shape: isLong ? "arrowUp" : "arrowDown",
        text: "Entry",
      },
      {
        time: toChartTime(closestExitCandle.time),
        position: isLong ? "aboveBar" : "belowBar",
        color: isWinLocal ? "#22c55e" : "#ef4444",
        shape: isLong ? "arrowDown" : "arrowUp",
        text: trade.exit_reason,
      },
    ] as const;

    createSeriesMarkers(
      candleSeries,
      [...markers].sort((a, b) => (a.time as number) - (b.time as number))
    );

    chart.timeScale().fitContent();

    const handleResize = () => {
      if (chartContainerRef.current) {
        const w = chartContainerRef.current.clientWidth;
        chart.applyOptions({ width: w, height: w < 400 ? 250 : 400 });
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartRef.current = null;
    };
  }, [open, trade, candles, rangeStart, rangeEnd]);

  if (!trade) return null;

  const isLong = trade.direction === "long";
  const isWin = trade.pnl_currency >= 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[900px] border-gray-800 bg-[#0a0a10] text-gray-100">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 text-gray-100">
            <span>
              Trade #{trade.id} &ndash;{" "}
              <span className={isLong ? "text-green-400" : "text-red-400"}>
                {trade.direction.toUpperCase()}
              </span>
            </span>
            <Badge
              className={
                isWin
                  ? "bg-green-900/50 text-green-300 hover:bg-green-900/50"
                  : "bg-red-900/50 text-red-300 hover:bg-red-900/50"
              }
            >
              {isWin ? "+" : ""}
              {trade.pnl_currency.toFixed(2)} ({isWin ? "+" : ""}
              {trade.pnl_pips.toFixed(1)} pips)
            </Badge>
          </DialogTitle>
          <DialogDescription className="text-gray-500">
            {trade.exit_reason} exit
          </DialogDescription>
        </DialogHeader>

        {/* Chart */}
        {isLoadingCandles ? (
          <div className="flex h-[250px] items-center justify-center rounded border border-gray-800 bg-[#111118] sm:h-[400px]">
            <p className="text-sm text-gray-500">Loading chart data...</p>
          </div>
        ) : candleError ? (
          <div className="flex h-[250px] items-center justify-center rounded border border-gray-800 bg-[#111118] sm:h-[400px]">
            <p className="text-sm text-red-400">{candleError}</p>
          </div>
        ) : candles.length > 0 ? (
          <div ref={chartContainerRef} className="w-full rounded border border-gray-200" />
        ) : (
          <div className="flex h-[250px] items-center justify-center rounded border border-gray-800 bg-[#111118] sm:h-[400px]">
            <p className="text-sm text-gray-500">No candle data available for this trade.</p>
          </div>
        )}

        {/* Info Grid */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 rounded border border-gray-800 bg-[#111118] p-4 text-sm sm:grid-cols-3">
          <div>
            <span className="text-gray-500">Entry Time</span>
            <p className="font-medium text-gray-200">{formatDateTime(trade.entry_time)}</p>
          </div>
          <div>
            <span className="text-gray-500">Exit Time</span>
            <p className="font-medium text-gray-200">{formatDateTime(trade.exit_time)}</p>
          </div>
          <div>
            <span className="text-gray-500">Direction</span>
            <p className={`font-medium ${isLong ? "text-green-400" : "text-red-400"}`}>
              {trade.direction.toUpperCase()}
            </p>
          </div>
          <div>
            <span className="text-gray-500">Entry Price</span>
            <p className="font-medium text-gray-200">{trade.entry_price.toFixed(2)}</p>
          </div>
          <div>
            <span className="text-gray-500">Exit Price</span>
            <p className="font-medium text-gray-200">{trade.exit_price.toFixed(2)}</p>
          </div>
          <div>
            <span className="text-gray-500">P&L</span>
            <p className={`font-medium ${isWin ? "text-green-400" : "text-red-400"}`}>
              {isWin ? "+" : ""}{trade.pnl_currency.toFixed(2)} / {isWin ? "+" : ""}{trade.pnl_pips.toFixed(1)}p / {isWin ? "+" : ""}{trade.r_multiple.toFixed(2)}R
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
