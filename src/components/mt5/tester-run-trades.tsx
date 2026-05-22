"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { TesterTradeSummary } from "@/hooks/use-mt5-tester-run";
import { formatDate } from "@/lib/mt5-format";

// PROJ-41: Full-width trade list for a completed MT5 tester run.

interface TesterRunTradesProps {
  trades: TesterTradeSummary[];
}

function formatPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(2);
}

function formatVolume(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(2);
}

function formatProfitValue(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return value < 0 ? `-$${abs}` : `$${abs}`;
}

function DirectionBadge({ direction }: { direction: string | null }) {
  if (!direction) {
    return <span className="text-slate-500">—</span>;
  }
  const lower = direction.toLowerCase();
  const isBuy = lower === "buy" || lower === "long";
  const isSell = lower === "sell" || lower === "short";
  const color = isBuy
    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
    : isSell
    ? "bg-red-500/10 text-red-400 border-red-500/30"
    : "bg-white/5 text-slate-300 border-white/20";
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${color}`}
    >
      {direction}
    </span>
  );
}

export function TesterRunTrades({ trades }: TesterRunTradesProps) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-md">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-base font-semibold text-white">Trades</h3>
        <p className="text-xs text-slate-400">{trades.length} total</p>
      </div>

      {trades.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">
          No trades recorded.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-black/20">
          <Table>
            <TableHeader>
              <TableRow className="border-white/10 hover:bg-transparent">
                <TableHead className="text-slate-400">#</TableHead>
                <TableHead className="text-slate-400">Direction</TableHead>
                <TableHead className="text-slate-400">Open Time</TableHead>
                <TableHead className="text-slate-400">Close Time</TableHead>
                <TableHead className="text-right text-slate-400">Volume</TableHead>
                <TableHead className="text-right text-slate-400">Open Price</TableHead>
                <TableHead className="text-right text-slate-400">Close Price</TableHead>
                <TableHead className="text-right text-slate-400">Profit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trades.map((trade, idx) => {
                const profit = trade.profit;
                const profitClass =
                  profit == null || !Number.isFinite(profit)
                    ? "text-slate-300"
                    : profit < 0
                    ? "text-red-400"
                    : profit > 0
                    ? "text-emerald-400"
                    : "text-slate-300";
                return (
                  <TableRow
                    key={idx}
                    className="border-white/5 hover:bg-white/5"
                  >
                    <TableCell className="text-slate-400">{idx + 1}</TableCell>
                    <TableCell>
                      <DirectionBadge direction={trade.direction} />
                    </TableCell>
                    <TableCell className="text-slate-300">
                      {formatDate(trade.open_time)}
                    </TableCell>
                    <TableCell className="text-slate-300">
                      {formatDate(trade.close_time)}
                    </TableCell>
                    <TableCell className="text-right text-slate-300">
                      {formatVolume(trade.volume)}
                    </TableCell>
                    <TableCell className="text-right text-slate-300">
                      {formatPrice(trade.open_price)}
                    </TableCell>
                    <TableCell className="text-right text-slate-300">
                      {formatPrice(trade.close_price)}
                    </TableCell>
                    <TableCell className={`text-right font-semibold ${profitClass}`}>
                      {formatProfitValue(profit)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
