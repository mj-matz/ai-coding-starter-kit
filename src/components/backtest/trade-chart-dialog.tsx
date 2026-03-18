"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { createChart, CandlestickSeries, LineStyle, createSeriesMarkers } from "lightweight-charts";
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

export function TradeChartDialog({ trade, open, onOpenChange, cacheId, timeframe }: TradeChartDialogProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  // Cache candles per trade id — avoids re-fetching when dialog re-opens for same trade.
  // All setState calls are inside async fetch callbacks (no synchronous setState in effect body).
  const [candleCache, setCandleCache] = useState<CandleCache | null>(null);

  // Derived: we need candles for this trade but don't have them yet
  const cacheHit = open && trade != null && candleCache?.tradeId === trade.id;
  const isLoadingCandles = open && trade != null && cacheId != null && !cacheHit;
  const candles = useMemo(
    () => (cacheHit ? (candleCache?.candles ?? []) : []),
    [cacheHit, candleCache]
  );
  const candleError = cacheHit ? (candleCache?.error ?? null) : null;

  // Fetch candles on-demand — no synchronous setState in effect body
  useEffect(() => {
    if (!open || !trade || !cacheId) return;
    if (candleCache?.tradeId === trade.id) return; // already cached for this trade

    const controller = new AbortController();
    const tradeId = trade.id;

    const params = new URLSearchParams({
      cache_id: cacheId,
      entry_time: trade.entry_time,
      exit_time: trade.exit_time,
      timeframe,
    });

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
        background: { color: "#111118" },
        textColor: "#9ca3af",
      },
      grid: {
        vertLines: { color: "#1f2937" },
        horzLines: { color: "#1f2937" },
      },
      crosshair: { mode: 0 },
      timeScale: {
        borderColor: "#374151",
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: { borderColor: "#374151" },
    });

    chartRef.current = chart;

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
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
    );

    const isLong = trade.direction === "long";

    candleSeries.createPriceLine({
      price: trade.entry_price,
      color: isLong ? "#22c55e" : "#ef4444",
      lineWidth: 2,
      lineStyle: LineStyle.Solid,
      axisLabelVisible: true,
      title: `Entry ${trade.entry_price.toFixed(2)}`,
    });

    candleSeries.createPriceLine({
      price: trade.exit_price,
      color: isLong ? "#ef4444" : "#22c55e",
      lineWidth: 2,
      lineStyle: LineStyle.Solid,
      axisLabelVisible: true,
      title: `Exit ${trade.exit_price.toFixed(2)}`,
    });

    if (trade.stop_loss > 0) {
      candleSeries.createPriceLine({
        price: trade.stop_loss,
        color: "#ef4444",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "SL",
      });
    }

    if (trade.take_profit > 0) {
      candleSeries.createPriceLine({
        price: trade.take_profit,
        color: "#22c55e",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "TP",
      });
    }

    if (trade.range_high > 0) {
      candleSeries.createPriceLine({
        price: trade.range_high,
        color: "#f97316",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "Range High",
      });
    }

    if (trade.range_low > 0) {
      candleSeries.createPriceLine({
        price: trade.range_low,
        color: "#f97316",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "Range Low",
      });
    }

    const entryTimestamp = Math.floor(new Date(trade.entry_time).getTime() / 1000);
    const closestEntryCandle = candles.reduce((prev, curr) =>
      Math.abs(curr.time - entryTimestamp) < Math.abs(prev.time - entryTimestamp) ? curr : prev
    );

    const exitTimestamp = Math.floor(new Date(trade.exit_time).getTime() / 1000);
    const closestExitCandle = candles.reduce((prev, curr) =>
      Math.abs(curr.time - exitTimestamp) < Math.abs(prev.time - exitTimestamp) ? curr : prev
    );

    const isWinLocal = trade.pnl_currency >= 0;

    const markers = [
      {
        time: closestEntryCandle.time as UTCTimestamp,
        position: isLong ? "belowBar" : "aboveBar",
        color: isLong ? "#22c55e" : "#ef4444",
        shape: isLong ? "arrowUp" : "arrowDown",
        text: "Entry",
      },
      {
        time: closestExitCandle.time as UTCTimestamp,
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
  }, [open, trade, candles]);

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
          <div ref={chartContainerRef} className="w-full rounded border border-gray-800" />
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
