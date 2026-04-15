"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { createChart, CandlestickSeries, BaselineSeries, LineSeries, createSeriesMarkers } from "lightweight-charts";
import type { IChartApi, UTCTimestamp } from "lightweight-charts";
import { Share2, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import type { Candle, TradeRecord, SkippedDay } from "@/lib/backtest-types";
import { useChartShare } from "@/hooks/use-chart-share";

interface TradeChartDialogProps {
  trade: TradeRecord | null;
  skippedDay?: SkippedDay | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cacheId: string | undefined;
  /** Symbol used when cacheId is unavailable (e.g. History view) */
  symbol?: string;
  timeframe: string;
  rangeStart: string;   // HH:MM (local time)
  rangeEnd: string;     // HH:MM (local time)
  triggerDeadline?: string; // HH:MM (local time) — for skipped days
}

// Cache key: number for trades, string date for skipped days
interface CandleCache {
  key: string;
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
  const tzOffsetSec = -new Date(utcSeconds * 1000).getTimezoneOffset() * 60;
  return (utcSeconds + tzOffsetSec) as UTCTimestamp;
}

// Convert timeframe string (e.g. "1m", "5m", "1h") to seconds
function timeframeToSeconds(tf: string): number {
  const m = tf.match(/^(\d+)([smhd])$/);
  if (!m) return 60;
  const n = parseInt(m[1]);
  switch (m[2]) {
    case "s": return n;
    case "m": return n * 60;
    case "h": return n * 3600;
    case "d": return n * 86400;
    default: return 60;
  }
}

// Build the UTC unix timestamp for a given HH:MM local time on the same
// calendar day as `referenceDateStr` (an ISO date-time or date string).
// Must use local time so that toChartTime() — which adds the local timezone
// offset — places the range box at the correct position on the chart axis.
function buildLocalTimestamp(referenceDateStr: string, timeHHMM: string): number {
  const refDate = new Date(referenceDateStr);
  const localDate = refDate.toLocaleDateString("en-CA");
  return new Date(`${localDate}T${timeHHMM}:00`).getTime() / 1000;
}

export function TradeChartDialog({
  trade,
  skippedDay,
  open,
  onOpenChange,
  cacheId,
  symbol,
  timeframe,
  rangeStart,
  rangeEnd,
  triggerDeadline,
}: TradeChartDialogProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const [candleCache, setCandleCache] = useState<CandleCache | null>(null);
  const [ohlcHover, setOhlcHover] = useState<Candle | null>(null);

  // For share: only available on trade charts
  const { isUploading, fallbackUrl, onShare, onCloseFallback } = useChartShare({
    tradeId: trade?.id ?? 0,
    tradeDate: trade?.entry_time ?? skippedDay?.date ?? "",
  });

  // Unique cache key for the current subject
  const cacheKey = trade != null
    ? String(trade.id)
    : skippedDay != null
      ? `skipped-${skippedDay.date}`
      : null;

  const canFetch = cacheId != null || symbol != null;
  const cacheHit = open && cacheKey != null && candleCache?.key === cacheKey;
  const isLoadingCandles = open && cacheKey != null && canFetch && !cacheHit;
  const candles = useMemo(
    () => (cacheHit ? (candleCache?.candles ?? []) : []),
    [cacheHit, candleCache]
  );
  const candleError = cacheHit ? (candleCache?.error ?? null) : null;

  // Fetch candles on-demand
  useEffect(() => {
    if (!open || cacheKey == null || !canFetch) return;
    if (candleCache?.key === cacheKey) return;

    const controller = new AbortController();
    const key = cacheKey;

    // Build shared time params
    const timeParams = new URLSearchParams({ timeframe });

    if (trade != null) {
      // Load from 14:00 so candles before rangeStart are available on zoom-out
      const dayStartIso = new Date(
        buildLocalTimestamp(trade.entry_time, "14:00") * 1000
      ).toISOString();
      const endOfDayIso = new Date(
        buildLocalTimestamp(trade.entry_time, "23:59") * 1000
      ).toISOString();
      timeParams.set("entry_time", dayStartIso);
      timeParams.set("exit_time", endOfDayIso);
      if (rangeStart) {
        const rangeStartIso = new Date(
          buildLocalTimestamp(trade.entry_time, rangeStart) * 1000
        ).toISOString();
        timeParams.set("range_start_time", rangeStartIso);
      }
    } else if (skippedDay != null) {
      const entryIso = new Date(
        buildLocalTimestamp(skippedDay.date, rangeStart) * 1000
      ).toISOString();
      const exitIso = new Date(
        buildLocalTimestamp(skippedDay.date, "23:59") * 1000
      ).toISOString();
      timeParams.set("entry_time", entryIso);
      timeParams.set("exit_time", exitIso);
      if (rangeStart) {
        timeParams.set("range_start_time", entryIso);
      }
    }

    // Choose endpoint: cache_id path (live backtest) or symbol path (history)
    let fetchUrl: string;
    if (cacheId != null) {
      timeParams.set("cache_id", cacheId);
      fetchUrl = `/api/backtest/candles?${timeParams}`;
    } else {
      timeParams.set("symbol", symbol!);
      fetchUrl = `/api/backtest/candles/by-symbol?${timeParams}`;
    }

    fetch(fetchUrl, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Failed to load candles (${res.status})`);
        }
        return res.json() as Promise<Candle[]>;
      })
      .then((data) => setCandleCache({ key, candles: data, error: null }))
      .catch((err: Error) => {
        if (!controller.signal.aborted) {
          setCandleCache({ key, candles: [], error: err.message });
        }
      });

    return () => controller.abort();
  }, [open, trade, skippedDay, cacheId, symbol, canFetch, timeframe, cacheKey, candleCache?.key, rangeStart]);

  // Render chart once candles are available
  useEffect(() => {
    const subject = trade ?? skippedDay;
    if (!open || !subject || !chartContainerRef.current || candles.length === 0) {
      return;
    }

    const container = chartContainerRef.current;
    const chartHeight = container.clientWidth < 400 ? 375 : 600;

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
      priceLineVisible: false,
      lastValueVisible: false,
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

    // Helper: creates a horizontal LineSeries at a fixed price spanning [t0, t1].
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

    const dateRef = trade != null ? trade.entry_time : `${skippedDay!.date}T12:00:00`;

    // ── Range box (light blue) — only if rangeStart and rangeEnd are set ─────
    if (rangeStart && rangeEnd) {
      const rangeStartUtc = buildLocalTimestamp(dateRef, rangeStart);
      const rangeEndUtc   = buildLocalTimestamp(dateRef, rangeEnd);
      const rStart = toChartTime(rangeStartUtc);
      const rEnd   = toChartTime(rangeEndUtc);

      // For trades: use known range_high / range_low; for skipped: derive from candles
      let rHigh = 0;
      let rLow = 0;
      if (trade != null && trade.range_high > 0 && trade.range_low > 0) {
        rHigh = trade.range_high;
        rLow  = trade.range_low;
      } else if (skippedDay != null) {
        // Derive range from candles within rangeStart..rangeEnd
        const rangeCandlesInWindow = candles.filter(
          (c) => c.time >= rangeStartUtc && c.time <= rangeEndUtc
        );
        if (rangeCandlesInWindow.length > 0) {
          rHigh = Math.max(...rangeCandlesInWindow.map((c) => c.high));
          rLow  = Math.min(...rangeCandlesInWindow.map((c) => c.low));
        }
      }

      if (rHigh > 0 && rLow > 0) {
        const rangeSeries = chart.addSeries(BaselineSeries, {
          baseValue: { type: "price", price: rLow },
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
          { time: rStart, value: rHigh },
          { time: rEnd,   value: rHigh },
        ]);
        addHLine(rHigh, "rgba(96, 165, 250, 0.9)", rStart, rEnd, true);
        addHLine(rLow,  "rgba(96, 165, 250, 0.9)", rStart, rEnd, true);
      }
    }

    if (trade != null) {
      // ── Trade chart: green/red zones + entry/exit markers ─────────────────
      const isLong = trade.direction === "long";
      const isWinLocal = trade.pnl_currency >= 0;
      const entryUtc = Math.floor(new Date(trade.entry_time).getTime() / 1000);
      const exitUtc  = Math.floor(new Date(trade.exit_time).getTime() / 1000);
      const tEntry = toChartTime(entryUtc);
      const tExit  = toChartTime(exitUtc);

      if (trade.take_profit > 0 && trade.stop_loss > 0) {
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

      addHLine(trade.entry_price, "#1a1a1a", tEntry, tExit, true);
      const exitColor = isWinLocal ? "#22c55e" : "#ef4444";
      addHLine(trade.exit_price, exitColor, tEntry, tExit, true);

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
          color: "#1a1a1a",
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
    } else if (skippedDay != null && triggerDeadline) {
      // ── Skipped day chart: arrow + thin vertical line at trigger deadline ─
      const deadlineUtc = buildLocalTimestamp(skippedDay.date, triggerDeadline);
      const deadlineChartTime = toChartTime(deadlineUtc);

      // Arrow marker at deadline candle
      const closestCandle = candles.reduce((prev, curr) =>
        Math.abs(curr.time - deadlineUtc) < Math.abs(prev.time - deadlineUtc) ? curr : prev
      );
      createSeriesMarkers(candleSeries, [
        {
          time: toChartTime(closestCandle.time),
          position: "aboveBar",
          color: "#f97316",
          shape: "arrowDown",
          text: `Trigger Deadline ${triggerDeadline}`,
        },
      ]);

      // Thin vertical orange line using a series primitive
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (candleSeries as any).attachPrimitive({
        updateAllViews() {},
        paneViews() {
          const x = chart.timeScale().timeToCoordinate(deadlineChartTime);
          if (x === null) return [];
          return [{
            renderer: () => ({
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              draw(target: any) {
                target.useBitmapCoordinateSpace(({ context: ctx, bitmapSize, horizontalPixelRatio }: { context: CanvasRenderingContext2D; bitmapSize: { height: number }; horizontalPixelRatio: number }) => {
                  const bx = Math.round(x * horizontalPixelRatio);
                  ctx.save();
                  ctx.strokeStyle = "#f97316";
                  ctx.lineWidth = Math.max(1, horizontalPixelRatio);
                  ctx.globalAlpha = 0.75;
                  ctx.beginPath();
                  ctx.moveTo(bx, 0);
                  ctx.lineTo(bx, bitmapSize.height);
                  ctx.stroke();
                  ctx.restore();
                });
              }
            })
          }];
        }
      });
    }

    // ── OHLC overlay on crosshair move ────────────────────────────────────────
    const candlesByTime = new Map<number, Candle>(
      candles.map((c) => [toChartTime(c.time) as number, c])
    );
    let lastHoveredTime: number | null = null;
    chart.subscribeCrosshairMove((param) => {
      const t = param.time != null ? (param.time as number) : null;
      if (t === lastHoveredTime) return;
      lastHoveredTime = t;
      setOhlcHover(t != null ? (candlesByTime.get(t) ?? null) : null);
    });

    // fitContent first so the axis auto-scales, then narrow the initial view
    chart.timeScale().fitContent();

    const barSec = timeframeToSeconds(timeframe);
    if (trade != null) {
      // Trade chart: show from rangeStart (range box visible) to exit+30 bars
      const rsUtc = rangeStart ? buildLocalTimestamp(trade.entry_time, rangeStart) : Math.floor(new Date(trade.entry_time).getTime() / 1000);
      const xUtc  = Math.floor(new Date(trade.exit_time).getTime() / 1000);
      chart.timeScale().setVisibleRange({
        from: toChartTime(rsUtc - 10 * barSec),
        to:   toChartTime(xUtc + 30 * barSec),
      });
    } else if (skippedDay != null && rangeStart && triggerDeadline) {
      // Skipped-day chart: rangeStart−10 bars → deadline+30 bars on open
      const rsUtc = buildLocalTimestamp(skippedDay.date, rangeStart);
      const dlUtc = buildLocalTimestamp(skippedDay.date, triggerDeadline);
      chart.timeScale().setVisibleRange({
        from: toChartTime(rsUtc - 10 * barSec),
        to:   toChartTime(dlUtc + 30 * barSec),
      });
    }

    const handleResize = () => {
      if (chartContainerRef.current) {
        const w = chartContainerRef.current.clientWidth;
        chart.applyOptions({ width: w, height: w < 400 ? 375 : 600 });
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartRef.current = null;
      setOhlcHover(null);
    };
  }, [open, trade, skippedDay, candles, rangeStart, rangeEnd, triggerDeadline, timeframe]);

  const isSkippedMode = trade == null && skippedDay != null;

  if (trade == null && skippedDay == null) return null;

  const isLong = trade?.direction === "long";
  const isWin = (trade?.pnl_currency ?? 0) >= 0;

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[1350px] border-gray-800 bg-[#0a0a10] text-gray-100">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 text-gray-100">
            {isSkippedMode ? (
              <span>
                Trigger Deadline —{" "}
                <span className="text-blue-400">{skippedDay!.date}</span>
              </span>
            ) : (
              <>
                <span>
                  Trade #{trade!.id} &ndash;{" "}
                  <span className={isLong ? "text-green-400" : "text-red-400"}>
                    {trade!.direction.toUpperCase()}
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
                  {trade!.pnl_currency.toFixed(2)} ({isWin ? "+" : ""}
                  {trade!.pnl_pips.toFixed(1)} pips)
                </Badge>
              </>
            )}
            <Button
              variant="outline"
              size="sm"
              className="ml-auto mr-8 border-gray-700 bg-transparent text-gray-300 hover:bg-gray-800 hover:text-gray-100"
              disabled={isUploading || candles.length === 0}
              onClick={() => chartRef.current && onShare(chartRef.current)}
            >
              {isUploading ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Share2 className="mr-1.5 h-3.5 w-3.5" />
              )}
              Share
            </Button>
          </DialogTitle>
          <DialogDescription className="text-gray-500">
            {isSkippedMode
              ? `Kein Trade — Trigger Deadline ${triggerDeadline ?? ""} erreicht ohne Ausbruch`
              : `${trade!.exit_reason} exit`}
          </DialogDescription>
        </DialogHeader>

        {/* Chart */}
        {isLoadingCandles ? (
          <div className="flex h-[375px] items-center justify-center rounded border border-gray-800 bg-[#111118] sm:h-[600px]">
            <p className="text-sm text-gray-500">Loading chart data...</p>
          </div>
        ) : candleError ? (
          <div className="flex h-[375px] items-center justify-center rounded border border-gray-800 bg-[#111118] sm:h-[600px]">
            <p className="text-sm text-red-400">{candleError}</p>
          </div>
        ) : candles.length > 0 ? (
          <div className="relative">
            <div ref={chartContainerRef} className="w-full rounded border border-gray-200" />
            {ohlcHover && (
              <div className="pointer-events-none absolute left-2 top-2 z-10 flex gap-3 rounded bg-white/80 px-2 py-1 font-mono text-xs backdrop-blur-sm">
                <span><span className="text-gray-500">O</span> <span className="text-gray-900">{ohlcHover.open.toFixed(2)}</span></span>
                <span><span className="text-gray-500">H</span> <span className="text-green-700">{ohlcHover.high.toFixed(2)}</span></span>
                <span><span className="text-gray-500">L</span> <span className="text-red-600">{ohlcHover.low.toFixed(2)}</span></span>
                <span><span className="text-gray-500">C</span> <span className={ohlcHover.close >= ohlcHover.open ? "text-green-700" : "text-red-600"}>{ohlcHover.close.toFixed(2)}</span></span>
              </div>
            )}
          </div>
        ) : (
          <div className="flex h-[375px] items-center justify-center rounded border border-gray-800 bg-[#111118] sm:h-[600px]">
            <p className="text-sm text-gray-500">No candle data available for this trade.</p>
          </div>
        )}

        {/* Info Grid */}
        {!isSkippedMode && trade != null && (
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
        )}
        {isSkippedMode && (
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 rounded border border-gray-800 bg-[#111118] p-4 text-sm sm:grid-cols-3">
            <div>
              <span className="text-gray-500">Datum</span>
              <p className="font-medium text-gray-200">{skippedDay!.date}</p>
            </div>
            <div>
              <span className="text-gray-500">Trigger Deadline</span>
              <p className="font-medium text-orange-400">{triggerDeadline ?? "—"}</p>
            </div>
            <div>
              <span className="text-gray-500">Grund</span>
              <p className="font-medium text-blue-400">Trigger Deadline/Range</p>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>

    <AlertDialog open={fallbackUrl !== null} onOpenChange={(open) => { if (!open) onCloseFallback(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Link zum Screenshot</AlertDialogTitle>
          <AlertDialogDescription>
            Die Zwischenablage ist in diesem Browser nicht verfügbar. Bitte kopiere den Link manuell:
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Input readOnly value={fallbackUrl ?? ""} className="font-mono text-xs" onClick={(e) => (e.target as HTMLInputElement).select()} />
        <AlertDialogFooter>
          <AlertDialogAction onClick={onCloseFallback}>Schließen</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
