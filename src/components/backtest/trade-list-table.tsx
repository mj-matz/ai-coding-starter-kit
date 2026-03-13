"use client";

import { useState, useMemo } from "react";
import { format, parseISO } from "date-fns";
import { ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { TradeRecord } from "@/lib/backtest-types";

interface TradeListTableProps {
  trades: TradeRecord[];
}

type SortField = "entry_time" | "pnl_pips" | "duration_minutes";
type SortDir = "asc" | "desc";

const PAGE_SIZE = 50;

function formatDate(dateStr: string): string {
  try {
    return format(parseISO(dateStr), "MMM dd, yyyy HH:mm");
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

export function TradeListTable({ trades }: TradeListTableProps) {
  const [sortField, setSortField] = useState<SortField>("entry_time");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(0);

  const sortedTrades = useMemo(() => {
    const sorted = [...trades].sort((a, b) => {
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
    return sorted;
  }, [trades, sortField, sortDir]);

  const totalPages = Math.ceil(sortedTrades.length / PAGE_SIZE);
  const paginatedTrades = sortedTrades.slice(
    page * PAGE_SIZE,
    (page + 1) * PAGE_SIZE
  );

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
    <Card className="border-gray-800 bg-[#111118]">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base text-gray-100">
            Trade List ({trades.length} trades)
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => toggleSort("entry_time")}
              className="h-7 px-2 text-xs text-gray-400 hover:text-white"
              aria-label="Sort by date"
            >
              Date <ArrowUpDown className="ml-1 h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => toggleSort("pnl_pips")}
              className="h-7 px-2 text-xs text-gray-400 hover:text-white"
              aria-label="Sort by PnL"
            >
              PnL <ArrowUpDown className="ml-1 h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => toggleSort("duration_minutes")}
              className="h-7 px-2 text-xs text-gray-400 hover:text-white"
              aria-label="Sort by duration"
            >
              Duration <ArrowUpDown className="ml-1 h-3 w-3" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-gray-800 hover:bg-transparent">
                <TableHead className="text-gray-400">#</TableHead>
                <TableHead className="text-gray-400">Date</TableHead>
                <TableHead className="text-gray-400">Dir</TableHead>
                <TableHead className="text-right text-gray-400">
                  Entry
                </TableHead>
                <TableHead className="text-right text-gray-400">
                  Exit
                </TableHead>
                <TableHead className="text-right text-gray-400">Lot</TableHead>
                <TableHead className="text-right text-gray-400">
                  PnL (pips)
                </TableHead>
                <TableHead className="text-right text-gray-400">
                  PnL ($)
                </TableHead>
                <TableHead className="text-right text-gray-400">R</TableHead>
                <TableHead className="text-gray-400">Exit Reason</TableHead>
                <TableHead className="text-right text-gray-400">
                  Duration
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedTrades.map((trade) => (
                <TableRow
                  key={trade.id}
                  className="border-gray-800 hover:bg-gray-900/50"
                >
                  <TableCell className="text-gray-500">{trade.id}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-gray-300">
                    {formatDate(trade.entry_time)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        trade.direction === "long" ? "default" : "secondary"
                      }
                      className={
                        trade.direction === "long"
                          ? "bg-green-900/50 text-green-300 hover:bg-green-900/50"
                          : "bg-red-900/50 text-red-300 hover:bg-red-900/50"
                      }
                    >
                      {trade.direction === "long" ? "L" : "S"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-sm text-gray-300">
                    {trade.entry_price.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right text-sm text-gray-300">
                    {trade.exit_price.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right text-sm text-gray-300">
                    {trade.lot_size.toFixed(2)}
                  </TableCell>
                  <TableCell
                    className={`text-right text-sm font-medium ${
                      trade.pnl_pips >= 0 ? "text-green-400" : "text-red-400"
                    }`}
                  >
                    {trade.pnl_pips >= 0 ? "+" : ""}
                    {trade.pnl_pips.toFixed(1)}
                  </TableCell>
                  <TableCell
                    className={`text-right text-sm font-medium ${
                      trade.pnl_currency >= 0
                        ? "text-green-400"
                        : "text-red-400"
                    }`}
                  >
                    {trade.pnl_currency >= 0 ? "+" : ""}
                    {trade.pnl_currency.toFixed(2)}
                  </TableCell>
                  <TableCell
                    className={`text-right text-sm ${
                      trade.r_multiple >= 0 ? "text-green-400" : "text-red-400"
                    }`}
                  >
                    {trade.r_multiple >= 0 ? "+" : ""}
                    {trade.r_multiple.toFixed(2)}R
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className="border-gray-700 text-gray-400"
                    >
                      {trade.exit_reason}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-sm text-gray-400">
                    {formatDuration(trade.duration_minutes)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm text-gray-500">
              Page {page + 1} of {totalPages}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="border-gray-700 text-gray-300 hover:bg-gray-800"
                aria-label="Previous page"
              >
                <ChevronLeft className="mr-1 h-4 w-4" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setPage((p) => Math.min(totalPages - 1, p + 1))
                }
                disabled={page >= totalPages - 1}
                className="border-gray-700 text-gray-300 hover:bg-gray-800"
                aria-label="Next page"
              >
                Next
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
