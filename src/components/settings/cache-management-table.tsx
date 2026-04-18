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
  formatCacheDate,
  formatBytes,
  type CacheGroup,
} from "@/hooks/use-data-cache";

// ── Props ───────────────────────────────────────────────────────────────────

interface CacheManagementTableProps {
  groups: CacheGroup[];
  isLoading: boolean;
  error: string | null;
  onDelete: (group: CacheGroup) => Promise<boolean>;
}

// ── Component ───────────────────────────────────────────────────────────────

export function CacheManagementTable({
  groups,
  isLoading,
  error,
  onDelete,
}: CacheManagementTableProps) {
  const [pendingDelete, setPendingDelete] = useState<CacheGroup | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleConfirmDelete() {
    if (!pendingDelete) return;
    setIsDeleting(true);
    await onDelete(pendingDelete);
    setIsDeleting(false);
    setPendingDelete(null);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 py-12 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading cache...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-6 text-sm text-red-300">
        Could not load cache: {error}
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 bg-white/5 py-12 text-center">
        <Database className="h-10 w-10 text-slate-600" />
        <p className="text-sm font-medium text-slate-300">No cached data yet</p>
        <p className="max-w-sm text-xs text-slate-500">
          Run a backtest or fetch to start caching Dukascopy data by monthly chunks.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5">
        <Table>
          <TableHeader>
            <TableRow className="border-white/10 hover:bg-transparent">
              <TableHead className="text-slate-400">Asset</TableHead>
              <TableHead className="text-slate-400">Source</TableHead>
              <TableHead className="text-slate-400">Timeframe</TableHead>
              <TableHead className="text-slate-400">Date Range</TableHead>
              <TableHead className="text-right text-slate-400">Months</TableHead>
              <TableHead className="text-right text-slate-400">Size</TableHead>
              <TableHead className="w-12 text-right text-slate-400">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((g) => (
              <TableRow
                key={`${g.symbol}-${g.source}-${g.timeframe}`}
                className="border-white/5 hover:bg-white/[0.03]"
              >
                <TableCell className="font-medium text-slate-100">{g.symbol}</TableCell>
                <TableCell className="text-slate-400">{g.source}</TableCell>
                <TableCell>
                  <Badge
                    variant="secondary"
                    className="border-white/10 bg-white/10 text-slate-300"
                  >
                    {g.timeframe.toUpperCase()}
                  </Badge>
                </TableCell>
                <TableCell className="text-slate-300">
                  {formatCacheDate(g.earliest)} – {formatCacheDate(g.latest)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-slate-300">
                  {g.chunks.length}
                </TableCell>
                <TableCell className="text-right tabular-nums text-slate-300">
                  {formatBytes(g.total_size_bytes)}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-slate-400 hover:bg-red-500/10 hover:text-red-300"
                    onClick={() => setPendingDelete(g)}
                    aria-label={`Delete cache for ${g.symbol} ${g.timeframe}`}
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
            <AlertDialogTitle>Delete cached data?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              {pendingDelete && (
                <>
                  This will permanently delete all{" "}
                  <span className="font-medium text-slate-200">
                    {pendingDelete.chunks.length} monthly chunk
                    {pendingDelete.chunks.length !== 1 ? "s" : ""}
                  </span>{" "}
                  (
                  <span className="font-medium text-slate-200">
                    {formatBytes(pendingDelete.total_size_bytes)}
                  </span>
                  ) for{" "}
                  <span className="font-medium text-slate-200">
                    {pendingDelete.symbol} {pendingDelete.timeframe.toUpperCase()}
                  </span>
                  . The next backtest will re-download the data from Dukascopy.
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
                "Delete all chunks"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
