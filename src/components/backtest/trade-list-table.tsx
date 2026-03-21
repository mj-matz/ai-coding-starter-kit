"use client";

import { useState, useMemo } from "react";
import { format, parseISO } from "date-fns";
import { ArrowUpDown, ChevronLeft, ChevronRight, EyeOff, Eye } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TradeChartDialog } from "@/components/backtest/trade-chart-dialog";
import type { TradeRecord, SkippedDay } from "@/lib/backtest-types";

interface TradeListTableProps {
  trades: TradeRecord[];
  skippedDays?: SkippedDay[];
  cacheId?: string;
  timeframe: string;
}

type SortField = "entry_time" | "pnl_pips" | "duration_minutes";
type SortDir = "asc" | "desc";

type Row =
  | { kind: "trade"; data: TradeRecord }
  | { kind: "skipped"; data: SkippedDay };

const PAGE_SIZE = 50;

function formatDateTime(dateStr: string): string {
  try {
    return format(parseISO(dateStr), "MMM dd, yyyy HH:mm");
  } catch {
    return dateStr;
  }
}

function formatTimeOnly(dateStr: string): string {
  try {
    return format(parseISO(dateStr), "HH:mm");
  } catch {
    return dateStr;
  }
}

function formatDateShort(dateStr: string): string {
  try {
    return format(parseISO(dateStr), "MMM dd, yyyy");
  } catch {
    return dateStr;
  }
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) return `${hours}h ${mins}m`;
  const days = Math.floor(hours / 24);
  const remainHours = hours % 24;
  return `${days}d ${remainHours}h`;
}

const REASON_LABELS: Record<string, string> = {
  NO_BARS: "No bars",
  NO_RANGE_BARS: "No range bars",
  FLAT_RANGE: "Flat range",
  NO_SIGNAL_BAR: "No signal bar",
  DEADLINE_MISSED: "Deadline missed",
  TRIGGER_EXPIRED: "Trigger Deadline/Range",
};

export function TradeListTable({ trades, skippedDays = [], cacheId, timeframe }: TradeListTableProps) {
  const [sortField, setSortField] = useState<SortField>("entry_time");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(0);
  const [showNoTrade, setShowNoTrade] = useState(true);
  const [selectedTrade, setSelectedTrade] = useState<TradeRecord | null>(null);
  const [chartOpen, setChartOpen] = useState(false);

  const sortedTrades = useMemo(() => {
    return [...trades].sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];
      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDir === "asc"
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }
      const numA = Number(aVal);
      const numB = Number(bVal);
      return sortDir === "asc" ? numA - numB : numB - numA;
    });
  }, [trades, sortField, sortDir]);

  const mergedRows = useMemo<Row[]>(() => {
    if (sortField !== "entry_time" || !showNoTrade || skippedDays.length === 0) {
      return sortedTrades.map((t) => ({ kind: "trade", data: t }));
    }

    const tradeRows: Row[] = sortedTrades.map((t) => ({ kind: "trade", data: t }));
    const skippedRows: Row[] = skippedDays.map((s) => ({ kind: "skipped", data: s }));

    const all = [...tradeRows, ...skippedRows].sort((a, b) => {
      const dateA = a.kind === "trade" ? a.data.entry_time : a.data.date;
      const dateB = b.kind === "trade" ? b.data.entry_time : b.data.date;
      const cmp = dateA.localeCompare(dateB);
      return sortDir === "asc" ? cmp : -cmp;
    });

    return all;
  }, [sortedTrades, skippedDays, sortField, sortDir, showNoTrade]);

  const totalPages = Math.ceil(mergedRows.length / PAGE_SIZE);

  const paginatedRows = useMemo(() => {
    return mergedRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  }, [mergedRows, page]);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
    setPage(0);
  }

  return (
    <div className="bg-white/5 backdrop-blur-xl rounded-3xl border border-white/5 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-5 pb-4">
        <h3 className="text-base font-semibold text-slate-200">
          Trade List{" "}
          <span className="font-normal text-slate-400">
            ({trades.length} trades
            {skippedDays.length > 0 && (
              <span className="ml-1 text-slate-500">· {skippedDays.length} no-trade days</span>
            )}
            )
          </span>
        </h3>
        <div className="flex items-center gap-1">
          {skippedDays.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setShowNoTrade((v) => !v); setPage(0); }}
              className="h-7 px-2 text-xs text-slate-400 hover:text-slate-200 hover:bg-white/10"
              aria-label={showNoTrade ? "Hide no-trade days" : "Show no-trade days"}
            >
              {showNoTrade ? (
                <EyeOff className="mr-1 h-3 w-3" />
              ) : (
                <Eye className="mr-1 h-3 w-3" />
              )}
              {showNoTrade ? "Hide NT" : "Show NT"}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => toggleSort("entry_time")}
            className="h-7 px-2 text-xs text-slate-400 hover:text-slate-200 hover:bg-white/10"
            aria-label="Sort by date"
          >
            Date <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => toggleSort("pnl_pips")}
            className="h-7 px-2 text-xs text-slate-400 hover:text-slate-200 hover:bg-white/10"
            aria-label="Sort by PnL"
          >
            PnL <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => toggleSort("duration_minutes")}
            className="h-7 px-2 text-xs text-slate-400 hover:text-slate-200 hover:bg-white/10"
            aria-label="Sort by duration"
          >
            Duration <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-white/5 hover:bg-transparent">
              <TableHead className="text-xs font-medium text-slate-400">#</TableHead>
              <TableHead className="text-xs font-medium text-slate-400">Entry</TableHead>
              <TableHead className="text-xs font-medium text-slate-400">Exit</TableHead>
              <TableHead className="text-xs font-medium text-slate-400">Dir</TableHead>
              <TableHead className="text-right text-xs font-medium text-slate-400">Entry Px</TableHead>
              <TableHead className="text-right text-xs font-medium text-slate-400">Exit Px</TableHead>
              <TableHead className="text-right text-xs font-medium text-slate-400">Lot</TableHead>
              <TableHead className="text-right text-xs font-medium text-slate-400">PnL (pips)</TableHead>
              <TableHead className="text-right text-xs font-medium text-slate-400">PnL ($)</TableHead>
              <TableHead className="text-right text-xs font-medium text-slate-400">R</TableHead>
              <TableHead className="text-xs font-medium text-slate-400">Exit Reason</TableHead>
              <TableHead className="text-right text-xs font-medium text-slate-400">Duration</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedRows.map((row) => {
              if (row.kind === "skipped") {
                const s = row.data;
                return (
                  <TableRow
                    key={`skipped-${s.date}`}
                    className="border-white/5 opacity-50 hover:opacity-70 hover:bg-transparent"
                  >
                    <TableCell className="text-slate-500">—</TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-slate-500">
                      {formatDateShort(s.date)}
                    </TableCell>
                    <TableCell />
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          s.reason === "TRIGGER_EXPIRED"
                            ? "border-blue-500/40 text-blue-400 text-[10px] px-1"
                            : "border-white/10 text-slate-500 text-[10px] px-1"
                        }
                      >
                        NT
                      </Badge>
                    </TableCell>
                    <TableCell />
                    <TableCell />
                    <TableCell />
                    <TableCell />
                    <TableCell />
                    <TableCell />
                    <TableCell>
                      {s.reason === "TRIGGER_EXPIRED" ? (
                        <span className="text-xs text-blue-400 italic">
                          {REASON_LABELS[s.reason]}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-500 italic">
                          {REASON_LABELS[s.reason] ?? s.reason}
                        </span>
                      )}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                );
              }

              const trade = row.data;
              return (
                <TableRow
                  key={trade.id}
                  className="border-white/5 cursor-pointer hover:bg-white/5 transition-colors"
                  onClick={() => {
                    setSelectedTrade(trade);
                    setChartOpen(true);
                  }}
                >
                  <TableCell className="text-slate-500">{trade.id}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-slate-200">
                    {formatDateTime(trade.entry_time)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-slate-400">
                    {formatTimeOnly(trade.exit_time)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={trade.direction === "long" ? "default" : "secondary"}
                      className={
                        trade.direction === "long"
                          ? "bg-emerald-500/20 text-emerald-400 border-0 hover:bg-emerald-500/20"
                          : "bg-rose-500/20 text-rose-400 border-0 hover:bg-rose-500/20"
                      }
                    >
                      {trade.direction === "long" ? "L" : "S"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-sm text-slate-200">
                    <span className="inline-flex items-center gap-1 justify-end">
                      {trade.entry_gap_pips > 0 && (
                        <Badge className="bg-orange-500/20 text-orange-300 border-0 hover:bg-orange-500/20 text-[10px] px-1 py-0">
                          GAP +{trade.entry_gap_pips.toFixed(1)}p
                        </Badge>
                      )}
                      {trade.entry_price.toFixed(2)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right text-sm text-slate-200">
                    {trade.exit_price.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right text-sm text-slate-300">
                    {trade.lot_size.toFixed(2)}
                  </TableCell>
                  <TableCell
                    className={`text-right text-sm font-medium ${
                      trade.pnl_pips >= 0 ? "text-emerald-400" : "text-rose-400"
                    }`}
                  >
                    {trade.pnl_pips >= 0 ? "+" : ""}
                    {trade.pnl_pips.toFixed(1)}
                  </TableCell>
                  <TableCell
                    className={`text-right text-sm font-medium ${
                      trade.pnl_currency >= 0 ? "text-emerald-400" : "text-rose-400"
                    }`}
                  >
                    {trade.pnl_currency >= 0 ? "+" : ""}
                    {trade.pnl_currency.toFixed(2)}
                  </TableCell>
                  <TableCell
                    className={`text-right text-sm ${
                      trade.r_multiple >= 0 ? "text-emerald-400" : "text-rose-400"
                    }`}
                  >
                    {trade.r_multiple >= 0 ? "+" : ""}
                    {trade.r_multiple.toFixed(2)}R
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1">
                      <Badge
                        variant="outline"
                        className="border-white/10 text-slate-400 bg-white/5"
                      >
                        {trade.exit_reason}
                      </Badge>
                      {trade.exit_gap && (
                        <Badge className="bg-orange-500/20 text-orange-300 border-0 hover:bg-orange-500/20 text-[10px] px-1 py-0">
                          GAP EXIT
                        </Badge>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="text-right text-sm text-slate-400">
                    {formatDuration(trade.duration_minutes)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-6 py-4 border-t border-white/5">
          <p className="text-sm text-slate-500">
            Page {page + 1} of {totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-slate-200"
              aria-label="Previous page"
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-slate-200"
              aria-label="Next page"
            >
              Next
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <TradeChartDialog
        trade={selectedTrade}
        open={chartOpen}
        onOpenChange={setChartOpen}
        cacheId={cacheId}
        timeframe={timeframe}
      />
    </div>
  );
}
