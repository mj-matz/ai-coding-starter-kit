"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  History,
  Hourglass,
  Loader2,
  RefreshCw,
  Rocket,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";

import type {
  EaDeployment,
  EaDeploymentSource,
  EaDeploymentStatus,
  EaDeploymentsListResponse,
} from "@/lib/mt5-bridge-types";

// PROJ-40: EA Deployments history table.
//
// - Renders inside the Settings → MT5 Bridge section.
// - Paginated via offset/limit: 10 rows per page, with explicit Previous /
//   Next navigation once the table grows past the first page.
// - compile_error / failed / timeout rows are expandable inline to reveal
//   the structured error list and raw compile log.

const PAGE_SIZE = 10;

const SOURCE_LABEL: Record<EaDeploymentSource, string> = {
  mql_converter: "MQL Converter",
  mt5_optimizer: "MT5 Optimizer",
};

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusBadge({ status }: { status: EaDeploymentStatus }) {
  if (status === "compiled") {
    return (
      <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/10">
        <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden />
        Compiled
      </Badge>
    );
  }
  if (status === "compile_error") {
    return (
      <Badge className="border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/10">
        <XCircle className="mr-1 h-3 w-3" aria-hidden />
        Compile Error
      </Badge>
    );
  }
  if (status === "timeout") {
    return (
      <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/10">
        <Hourglass className="mr-1 h-3 w-3" aria-hidden />
        Timeout
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge className="border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/10">
        <AlertCircle className="mr-1 h-3 w-3" aria-hidden />
        Failed
      </Badge>
    );
  }
  // pending
  return (
    <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/10">
      <Clock className="mr-1 h-3 w-3" aria-hidden />
      Pending
    </Badge>
  );
}

interface EaDeploymentsSectionProps {
  /** Bumped by the parent after a deploy completes so the table refetches. */
  refreshKey?: number;
}

export function EaDeploymentsSection({
  refreshKey = 0,
}: EaDeploymentsSectionProps) {
  const [deployments, setDeployments] = useState<EaDeployment[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const offset = page * PAGE_SIZE;
  const totalPages = total > 0 ? Math.ceil(total / PAGE_SIZE) : 1;
  const hasPrev = page > 0;
  const hasNext = offset + deployments.length < total;

  const fetchDeployments = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/mt5/ea/deployments?limit=${PAGE_SIZE}&offset=${offset}`,
        { cache: "no-store" },
      );
      const data = (await res.json()) as
        | EaDeploymentsListResponse
        | { error?: string };
      if (!res.ok) {
        const errMsg =
          (data as { error?: string }).error ??
          `Failed to load deployments (${res.status})`;
        setError(errMsg);
        return;
      }
      const payload = data as EaDeploymentsListResponse;
      setDeployments(payload.deployments ?? []);
      setTotal(payload.total ?? payload.deployments.length ?? 0);
      // Collapse any open row when the page changes — the row id we tracked
      // belongs to the previous page's data set.
      setOpenRow(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load deployments");
    } finally {
      setIsLoading(false);
    }
  }, [offset]);

  useEffect(() => {
    void fetchDeployments();
  }, [fetchDeployments, refreshKey]);

  // Reset to page 0 whenever the parent bumps refreshKey (e.g. a fresh
  // deploy completed): the new entry is at the top of the history.
  useEffect(() => {
    setPage(0);
  }, [refreshKey]);

  // Header row — always visible
  const header = (
    <div className="flex items-center justify-between gap-3">
      <div>
        <h3 className="flex items-center gap-2 text-base font-semibold text-white">
          <Rocket className="h-4 w-4 text-violet-300" aria-hidden />
          EA Deployments
        </h3>
        <p className="mt-1 text-xs text-slate-400">
          History of EAs deployed to the MT5 terminal via the Bridge Worker.
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => void fetchDeployments()}
        disabled={isLoading}
        className="border-white/20 bg-white/10 text-slate-200 hover:bg-white/20"
        aria-label="Refresh EA deployments"
      >
        {isLoading ? (
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
        )}
        Refresh
      </Button>
    </div>
  );

  // Loading skeleton — only on first paint, otherwise we keep the existing rows
  if (isLoading && deployments.length === 0) {
    return (
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-md">
        {header}
        <div className="mt-6 flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-blue-400" aria-hidden />
          <span className="ml-2 text-sm text-slate-400">
            Loading deployments…
          </span>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-md">
        {header}
        <div className="mt-4 rounded-xl border border-rose-900/50 bg-rose-950/20 px-4 py-3 text-sm text-rose-300">
          <div className="font-medium">Could not load EA deployments.</div>
          <div className="mt-1 text-xs text-rose-300/80">{error}</div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchDeployments()}
            className="mt-3 border-rose-900/50 bg-rose-950/40 text-rose-300 hover:bg-rose-900/40 hover:text-rose-200"
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Retry
          </Button>
        </div>
      </div>
    );
  }

  // Empty state — only when we are on the first page and the server reports
  // a zero total. On later pages an empty response indicates we paged past
  // the end (rare race), in which case we show the table with the prev nav.
  if (deployments.length === 0 && page === 0) {
    return (
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-md">
        {header}
        <div className="mt-6 flex flex-col items-center justify-center py-12 text-center">
          <History className="mb-3 h-10 w-10 text-slate-600" aria-hidden />
          <h4 className="text-sm font-medium text-slate-300">
            No EA deployments yet
          </h4>
          <p className="mt-1 max-w-sm text-xs text-slate-500">
            Click <span className="text-slate-300">Deploy to MT5</span> in the
            MQL Converter to push your first EA to the terminal.
          </p>
        </div>
      </div>
    );
  }

  // Table
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-md">
      {header}

      <div className="mt-4 overflow-hidden rounded-xl border border-white/10 bg-black/20">
        <Table>
          <TableHeader>
            <TableRow className="border-white/10 hover:bg-transparent">
              <TableHead className="w-8" />
              <TableHead className="text-slate-400">Date</TableHead>
              <TableHead className="text-slate-400">EA Name</TableHead>
              <TableHead className="text-slate-400">Source</TableHead>
              <TableHead className="text-slate-400">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {deployments.map((d) => {
              const isOpen = openRow === d.id;
              const canExpand =
                d.status === "compile_error" ||
                d.status === "failed" ||
                d.status === "timeout";
              return (
                <DeploymentRow
                  key={d.id}
                  deployment={d}
                  isOpen={isOpen}
                  canExpand={canExpand}
                  onToggle={() =>
                    setOpenRow((prev) => (prev === d.id ? null : d.id))
                  }
                />
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Pagination footer — visible whenever there is more than one page. */}
      {total > PAGE_SIZE && (
        <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
          <span>
            Showing {offset + 1}–{offset + deployments.length} of {total}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={!hasPrev || isLoading}
              className="border-white/20 bg-white/10 text-slate-200 hover:bg-white/20"
              aria-label="Previous page"
            >
              <ChevronLeft className="mr-1 h-3.5 w-3.5" aria-hidden />
              Previous
            </Button>
            <span className="px-1 text-[11px] text-slate-500">
              Page {page + 1} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => p + 1)}
              disabled={!hasNext || isLoading}
              className="border-white/20 bg-white/10 text-slate-200 hover:bg-white/20"
              aria-label="Next page"
            >
              Next
              <ChevronRight className="ml-1 h-3.5 w-3.5" aria-hidden />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Row + expanded log ─────────────────────────────────────────────────────

interface DeploymentRowProps {
  deployment: EaDeployment;
  isOpen: boolean;
  canExpand: boolean;
  onToggle: () => void;
}

function DeploymentRow({
  deployment,
  isOpen,
  canExpand,
  onToggle,
}: DeploymentRowProps) {
  const sourceLabel = SOURCE_LABEL[deployment.source] ?? deployment.source;

  return (
    <>
      <TableRow
        className={`border-white/10 hover:bg-white/5 ${
          canExpand ? "cursor-pointer" : ""
        }`}
        onClick={canExpand ? onToggle : undefined}
        aria-expanded={canExpand ? isOpen : undefined}
      >
        <TableCell className="py-2.5">
          {canExpand ? (
            isOpen ? (
              <ChevronDown
                className="h-4 w-4 text-slate-400"
                aria-label="Collapse details"
              />
            ) : (
              <ChevronRight
                className="h-4 w-4 text-slate-500"
                aria-label="Expand details"
              />
            )
          ) : (
            <span className="inline-block h-4 w-4" aria-hidden />
          )}
        </TableCell>
        <TableCell className="py-2.5 text-xs text-slate-300">
          {formatDate(deployment.deployed_at)}
        </TableCell>
        <TableCell className="py-2.5 max-w-[260px] truncate text-sm text-slate-200">
          <code className="font-mono text-xs">{deployment.ea_name}.mq5</code>
        </TableCell>
        <TableCell className="py-2.5 text-xs text-slate-300">
          {sourceLabel}
          {deployment.optimizer_result_rank != null && (
            <span className="ml-1 text-slate-500">
              (rank {deployment.optimizer_result_rank + 1})
            </span>
          )}
        </TableCell>
        <TableCell className="py-2.5">
          <StatusBadge status={deployment.status} />
        </TableCell>
      </TableRow>

      {canExpand && isOpen && (
        <TableRow className="border-white/10 bg-black/30 hover:bg-black/30">
          <TableCell colSpan={5} className="py-3">
            <div className="space-y-3">
              <h4 className="text-xs font-medium text-slate-300">
                Compile Log
              </h4>
              {deployment.error_message && (
                <p className="rounded border border-rose-500/30 bg-rose-950/30 px-3 py-2 text-xs text-rose-200">
                  {deployment.error_message}
                </p>
              )}
              {deployment.errors && deployment.errors.length > 0 && (
                <div className="overflow-hidden rounded border border-rose-500/30 bg-rose-950/20">
                  <ul className="divide-y divide-rose-500/10 px-3 py-2 text-[11px]">
                    {deployment.errors.map((line, i) => (
                      <li
                        key={i}
                        className="py-1 font-mono text-rose-200"
                      >
                        {line}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {deployment.log_excerpt ? (
                <div className="overflow-hidden rounded border border-white/10 bg-black/40">
                  <ScrollArea className="max-h-60">
                    <pre className="whitespace-pre-wrap break-words px-3 py-2 font-mono text-[11px] leading-relaxed text-slate-300">
                      {deployment.log_excerpt}
                    </pre>
                  </ScrollArea>
                </div>
              ) : (
                !deployment.error_message &&
                  !(deployment.errors && deployment.errors.length > 0) && (
                  <p className="text-xs text-slate-500">
                    No compile log captured for this deployment.
                  </p>
                )
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
