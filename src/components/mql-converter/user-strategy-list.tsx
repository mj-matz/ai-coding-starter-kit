"use client";

import { useEffect, useState } from "react";
import { Loader2, Trash2, Pencil, Upload, BookOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import type { UserStrategy } from "@/lib/strategy-types";
import { USER_STRATEGY_LIMIT } from "@/lib/strategy-types";
import { useUserStrategies } from "@/hooks/use-user-strategies";
import { EditUserStrategyDialog } from "@/components/mql-converter/edit-user-strategy-dialog";
import { useToast } from "@/hooks/use-toast";

// ── Props ───────────────────────────────────────────────────────────────────

interface UserStrategyListProps {
  /** Called when user clicks "Open in Converter" */
  onOpenInConverter: (strategy: UserStrategy) => void;
}

export function UserStrategyList({ onOpenInConverter }: UserStrategyListProps) {
  const { strategies, isLoading, error, fetch, remove, update } = useUserStrategies();
  const { toast } = useToast();

  const [editTarget, setEditTarget] = useState<UserStrategy | null>(null);

  useEffect(() => {
    fetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDelete(id: string, name: string) {
    const ok = await remove(id);
    if (ok) {
      toast({ title: "Strategy deleted", description: `"${name}" has been removed from your library.` });
    } else {
      toast({ title: "Delete failed", description: "Could not remove the strategy.", variant: "destructive" });
    }
  }

  function handleEditSuccess(updated: UserStrategy) {
    update(updated.id, { name: updated.name, description: updated.description ?? undefined });
    setEditTarget(null);
    toast({ title: "Strategy updated", description: `"${updated.name}" has been saved.` });
  }

  const paramCount = (s: UserStrategy) =>
    Object.keys(s.parameter_schema?.properties ?? {}).length;

  const isAtLimit = strategies.length >= USER_STRATEGY_LIMIT;

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="mb-4 h-8 w-8 animate-spin text-blue-400" />
        <p className="text-sm text-gray-400">Loading your strategy library…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-sm text-red-400">{error}</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4 border-white/20 bg-white/10 text-gray-300 hover:bg-white/20"
          onClick={() => fetch()}
        >
          Retry
        </Button>
      </div>
    );
  }

  if (strategies.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <BookOpen className="mb-4 h-12 w-12 text-slate-600" />
        <h3 className="text-lg font-medium text-slate-300">No Custom Strategies</h3>
        <p className="mt-2 text-center text-sm text-slate-500">
          Convert an MQL Expert Adviser and click &quot;Add to Strategy Library&quot; to save it here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Limit indicator */}
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>{strategies.length} / {USER_STRATEGY_LIMIT} strategies</span>
        {isAtLimit && (
          <span className="text-amber-400">Limit reached — delete one to add more</span>
        )}
      </div>

      {strategies.map((s) => {
        const pc = paramCount(s);
        return (
          <div
            key={s.id}
            className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/5 px-5 py-4"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="text-sm font-medium text-white truncate">{s.name}</h4>
                <Badge className="bg-blue-900/50 text-blue-300 border-blue-800/50 hover:bg-blue-900/50 text-xs">
                  Custom
                </Badge>
                {pc > 0 && (
                  <span className="text-xs text-gray-500">{pc} param{pc !== 1 ? "s" : ""}</span>
                )}
              </div>
              {s.description && (
                <p className="mt-0.5 text-xs text-gray-400 line-clamp-2">{s.description}</p>
              )}
              <p className="mt-0.5 text-xs text-gray-600">
                {new Date(s.created_at).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </p>
            </div>

            <div className="flex shrink-0 gap-2">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onOpenInConverter(s)}
                      className="border-white/20 bg-white/10 text-slate-200 hover:bg-white/20"
                      aria-label={`Open ${s.name} in Converter`}
                    >
                      <Upload className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Open in Converter</TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditTarget(s)}
                      className="border-white/20 bg-white/10 text-slate-200 hover:bg-white/20"
                      aria-label={`Edit ${s.name}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Edit name / description</TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-red-900/50 bg-red-950/20 text-red-400 hover:bg-red-950/40 hover:text-red-300"
                    aria-label={`Delete ${s.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="border-white/10 bg-[#0d0f14] text-white">
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete Strategy</AlertDialogTitle>
                    <AlertDialogDescription className="text-gray-400">
                      Are you sure you want to delete &quot;{s.name}&quot; from your strategy library? This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="border-white/20 bg-white/10 text-gray-300 hover:bg-white/20">
                      Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => handleDelete(s.id, s.name)}
                      className="bg-red-700 text-white hover:bg-red-600"
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        );
      })}

      {editTarget && (
        <EditUserStrategyDialog
          open={!!editTarget}
          onOpenChange={(open) => { if (!open) setEditTarget(null); }}
          strategy={editTarget}
          onSuccess={handleEditSuccess}
        />
      )}
    </div>
  );
}
