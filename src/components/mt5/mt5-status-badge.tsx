"use client";

import { CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Mt5RunStatus } from "@/lib/mt5-bridge-types";

export function Mt5StatusBadge({ status }: { status: Mt5RunStatus }) {
  if (status === "done") {
    return (
      <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/10">
        <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden />
        Completed
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge className="border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/10">
        <XCircle className="mr-1 h-3 w-3" aria-hidden />
        Failed
      </Badge>
    );
  }
  if (status === "cancelled") {
    return (
      <Badge className="border-slate-500/30 bg-slate-500/10 text-slate-300 hover:bg-slate-500/10">
        Cancelled
      </Badge>
    );
  }
  if (status === "running") {
    return (
      <Badge className="border-blue-500/30 bg-blue-500/10 text-blue-300 hover:bg-blue-500/10">
        <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden />
        Running
      </Badge>
    );
  }
  if (status === "queued") {
    return (
      <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/10">
        <Clock className="mr-1 h-3 w-3" aria-hidden />
        Queued
      </Badge>
    );
  }
  return (
    <Badge className="border-slate-500/30 bg-slate-500/10 text-slate-400 hover:bg-slate-500/10">
      {status}
    </Badge>
  );
}
