"use client";

import { AlertCircle, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";

// PROJ-40: Compile-error dialog used by both deploy entry points.
//
// Compile output can run dozens of lines, so a toast would truncate it past
// the point of being useful. We render the parsed error array first (these
// are the "<line>: <message>" entries the bridge extracted) and the raw log
// excerpt below as a scrollable monospace block.

export interface CompileErrorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Echoed from the deploy response — used in the heading. */
  eaName?: string;
  /** Parsed error lines from the compile log. */
  errors: string[];
  /** Truncated raw compile log (last ~2 KB). */
  logExcerpt?: string;
}

export function CompileErrorDialog({
  open,
  onOpenChange,
  eaName,
  errors,
  logExcerpt,
}: CompileErrorDialogProps) {
  const { toast } = useToast();

  async function handleCopy() {
    const payload = [
      ...errors,
      ...(logExcerpt ? ["", "--- compile log ---", logExcerpt] : []),
    ].join("\n");
    try {
      await navigator.clipboard.writeText(payload);
      toast({
        title: "Copied",
        description: "Compile log copied to clipboard.",
      });
    } catch {
      toast({
        title: "Copy failed",
        description: "Your browser blocked clipboard access.",
        variant: "destructive",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] border-white/10 bg-[#0d0f14] text-white sm:max-w-5xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30">
              <AlertCircle className="h-4 w-4" aria-hidden />
            </div>
            <DialogTitle className="text-base font-semibold">
              Compile Error
            </DialogTitle>
          </div>
          <DialogDescription className="pt-2 text-sm text-slate-400">
            MetaEditor failed to compile{" "}
            {eaName ? (
              <code className="rounded bg-white/5 px-1 py-0.5 text-xs text-slate-300">
                {eaName}.mq5
              </code>
            ) : (
              "the EA"
            )}
            . The .mq5 file was written to the Experts folder; you can also fix
            and recompile it manually in MetaEditor.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Parsed error lines */}
          {errors.length > 0 ? (
            <div className="space-y-1.5">
              <h4 className="text-xs font-medium text-slate-300">
                Errors ({errors.length})
              </h4>
              <div className="overflow-hidden rounded-lg border border-rose-500/30 bg-rose-950/20">
                <ScrollArea className="max-h-48">
                  <ul className="divide-y divide-rose-500/10 px-3 py-2 text-xs">
                    {errors.map((line, i) => (
                      <li
                        key={i}
                        className="py-1.5 font-mono text-rose-200"
                      >
                        {line}
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-500">
              No structured errors were extracted — see the compile log below.
            </p>
          )}

          {/* Raw log excerpt */}
          {logExcerpt && (
            <div className="space-y-1.5">
              <h4 className="text-xs font-medium text-slate-300">
                Compile Log
              </h4>
              <div className="overflow-hidden rounded-lg border border-white/10 bg-black/40">
                <ScrollArea className="max-h-96">
                  <pre className="whitespace-pre-wrap break-words px-3 py-2 font-mono text-[11px] leading-relaxed text-slate-300">
                    {logExcerpt}
                  </pre>
                </ScrollArea>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleCopy}
            className="border-white/20 bg-white/10 text-slate-200 hover:bg-white/20"
            disabled={errors.length === 0 && !logExcerpt}
          >
            <Copy className="mr-2 h-4 w-4" aria-hidden />
            Copy
          </Button>
          <Button
            type="button"
            onClick={() => onOpenChange(false)}
            className="bg-blue-600 text-white hover:bg-blue-500"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
