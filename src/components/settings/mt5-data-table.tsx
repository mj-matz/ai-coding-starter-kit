"use client";

import { useState } from "react";
import { Database, Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

import {
  formatMt5Date,
  formatMt5DateTime,
  type Mt5Dataset,
} from "@/lib/mt5-data-types";

// ── Props ───────────────────────────────────────────────────────────────────

interface Mt5DataTableProps {
  datasets: Mt5Dataset[];
  isLoading: boolean;
  error: string | null;
  onDelete: (id: string) => Promise<boolean>;
}

// ── Component ───────────────────────────────────────────────────────────────

export function Mt5DataTable({
  datasets,
  isLoading,
  error,
  onDelete,
}: Mt5DataTableProps) {
  const [pendingDelete, setPendingDelete] = useState<Mt5Dataset | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleConfirmDelete() {
    if (!pendingDelete) return;
    setIsDeleting(true);
    await onDelete(pendingDelete.id);
    setIsDeleting(false);
    setPendingDelete(null);
  }

  // ── Loading ──
  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 py-12 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading datasets...
      </div>
    );
  }

  // ── Error ──
  if (error) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-6 text-sm text-red-300">
        Could not load datasets: {error}
      </div>
    );
  }

  // ── Empty ──
  if (datasets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 bg-white/5 py-12 text-center">
        <Database className="h-10 w-10 text-slate-600" />
        <p className="text-sm font-medium text-slate-300">
          No MT5 data uploaded yet
        </p>
        <p className="max-w-sm text-xs text-slate-500">
          Upload an OHLCV CSV exported from the MT5 History Center to use broker-parity data in your backtests.
        </p>
      </div>
    );
  }

  // ── Table ──
  return (
    <>
      <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5">
        <Table>
          <TableHeader>
            <TableRow className="border-white/10 hover:bg-transparent">
              <TableHead className="text-slate-400">Asset</TableHead>
              <TableHead className="text-slate-400">Timeframe</TableHead>
              <TableHead className="text-slate-400">Date Range</TableHead>
              <TableHead className="text-right text-slate-400">Candles</TableHead>
              <TableHead className="text-slate-400">Uploaded</TableHead>
              <TableHead className="w-12 text-right text-slate-400">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {datasets.map((ds) => (
              <TableRow key={ds.id} className="border-white/5 hover:bg-white/[0.03]">
                <TableCell className="font-medium text-slate-100">{ds.asset}</TableCell>
                <TableCell>
                  <Badge
                    variant="secondary"
                    className="border-white/10 bg-white/10 text-slate-300"
                  >
                    {ds.timeframe.toUpperCase()}
                  </Badge>
                </TableCell>
                <TableCell className="text-slate-300">
                  {formatMt5Date(ds.start_date)} - {formatMt5Date(ds.end_date)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-slate-300">
                  {ds.candle_count.toLocaleString()}
                </TableCell>
                <TableCell className="text-slate-400">
                  {formatMt5DateTime(ds.uploaded_at)}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-slate-400 hover:bg-red-500/10 hover:text-red-300"
                    onClick={() => setPendingDelete(ds)}
                    aria-label={`Delete dataset for ${ds.asset} ${ds.timeframe}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && !isDeleting && setPendingDelete(null)}
      >
        <AlertDialogContent className="border-white/10 bg-[#0d0f14] text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete MT5 dataset?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              {pendingDelete && (
                <>
                  This will permanently delete all{" "}
                  <span className="font-medium text-slate-200">
                    {pendingDelete.candle_count.toLocaleString()} candles
                  </span>{" "}
                  for{" "}
                  <span className="font-medium text-slate-200">
                    {pendingDelete.asset} {pendingDelete.timeframe.toUpperCase()}
                  </span>
                  . Backtests with MT5 Mode enabled for this asset will fall back to Dukascopy.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={isDeleting}
              className="border-white/20 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              disabled={isDeleting}
              className="bg-red-600 text-white hover:bg-red-500"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete dataset"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
