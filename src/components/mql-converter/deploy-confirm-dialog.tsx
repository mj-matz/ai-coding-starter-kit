"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, Rocket } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// PROJ-40: Shared confirm dialog used by both deploy entry points.
//
// - MQL Converter flow: title "Deploy to MT5", no parameter summary.
// - MT5 Optimizer flow: title "Deploy as EA", shows the chosen parameter
//   values under a "Parameters" header.
//
// EA-name input is editable. Whitespace is auto-converted to underscores;
// other invalid characters trip a validation message.

const EA_NAME_REGEX = /^[A-Za-z0-9_\-]+$/;
const EA_NAME_MAX = 64;

function sanitizeEaName(input: string): string {
  // Replace whitespace runs with a single underscore, then strip any other
  // disallowed character so the user always sees a server-acceptable value.
  return input
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9_\-]/g, "")
    .slice(0, EA_NAME_MAX);
}

export interface DeployConfirmParameterSummary {
  label: string;
  value: string;
}

export interface DeployConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "Deploy to MT5" (converter) or "Deploy as EA" (optimizer). */
  title?: string;
  /** Pre-filled EA filename without the `.mq5` extension. */
  defaultEaName: string;
  /** When true the parameter summary block is rendered. */
  parameters?: DeployConfirmParameterSummary[] | null;
  /** Show the overwrite warning banner unconditionally. */
  showOverwriteWarning?: boolean;
  /** Submit handler — receives the sanitized EA name. */
  onConfirm: (eaName: string) => Promise<void> | void;
  /** External in-flight flag so the dialog can render Deploying… */
  isDeploying?: boolean;
}

export function DeployConfirmDialog({
  open,
  onOpenChange,
  title = "Deploy to MT5",
  defaultEaName,
  parameters = null,
  showOverwriteWarning = false,
  onConfirm,
  isDeploying = false,
}: DeployConfirmDialogProps) {
  const [eaName, setEaName] = useState<string>(sanitizeEaName(defaultEaName));
  const [touched, setTouched] = useState(false);
  // Track the open+defaultName pair we last initialised against. When the
  // parent reopens the dialog with a new default we re-seed the field
  // synchronously during render — this avoids the cascading-effect pattern
  // that React's lint rules warn against.
  const [seedKey, setSeedKey] = useState<string>(`${open}|${defaultEaName}`);
  const currentKey = `${open}|${defaultEaName}`;
  if (open && currentKey !== seedKey) {
    setSeedKey(currentKey);
    setEaName(sanitizeEaName(defaultEaName));
    setTouched(false);
  }

  const trimmed = eaName.trim();
  const isEmpty = trimmed.length === 0;
  const isInvalid = !isEmpty && !EA_NAME_REGEX.test(trimmed);
  const isTooLong = trimmed.length > EA_NAME_MAX;
  const hasError = isEmpty || isInvalid || isTooLong;

  const errorMessage = isEmpty
    ? "EA name is required."
    : isInvalid
      ? "EA name may contain only letters, digits, underscore and hyphen."
      : isTooLong
        ? `EA name must be ${EA_NAME_MAX} characters or fewer.`
        : null;

  async function handleConfirm() {
    setTouched(true);
    if (hasError || isDeploying) return;
    await onConfirm(trimmed);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-white/10 bg-[#0d0f14] text-white sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/30">
              <Rocket className="h-4 w-4" aria-hidden />
            </div>
            <DialogTitle className="text-base font-semibold">
              {title}
            </DialogTitle>
          </div>
          <DialogDescription className="pt-2 text-sm text-slate-400">
            The EA file will be written to the MT5{" "}
            <code className="rounded bg-white/5 px-1 py-0.5 text-xs text-slate-300">
              MQL5/Experts/
            </code>{" "}
            folder on the Bridge Worker and compiled.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* EA Name input */}
          <div className="space-y-1.5">
            <Label htmlFor="ea-name-input" className="text-xs text-slate-300">
              EA Name
            </Label>
            <Input
              id="ea-name-input"
              value={eaName}
              onChange={(e) => setEaName(sanitizeEaName(e.target.value))}
              onBlur={() => setTouched(true)}
              maxLength={EA_NAME_MAX}
              autoFocus
              spellCheck={false}
              disabled={isDeploying}
              aria-invalid={touched && hasError ? "true" : "false"}
              aria-describedby="ea-name-help"
              className="border-white/10 bg-black/20 font-mono text-sm text-slate-100"
            />
            <p id="ea-name-help" className="text-[11px] text-slate-500">
              Saved as{" "}
              <code className="text-slate-400">
                {trimmed || "<name>"}
                .mq5
              </code>
              . Letters, digits, underscore and hyphen only.
            </p>
            {touched && errorMessage && (
              <p className="text-[11px] text-rose-400">{errorMessage}</p>
            )}
          </div>

          {/* Optional parameter summary (optimizer flow) */}
          {parameters && parameters.length > 0 && (
            <div className="space-y-1.5">
              <h4 className="text-xs font-medium text-slate-300">Parameters</h4>
              <div className="overflow-hidden rounded-lg border border-white/10 bg-black/20">
                <ul className="divide-y divide-white/5 text-xs">
                  {parameters.map((p) => (
                    <li
                      key={p.label}
                      className="flex items-center justify-between gap-3 px-3 py-1.5"
                    >
                      <span className="font-mono text-slate-400">{p.label}</span>
                      <span className="font-mono font-medium text-slate-200">
                        {p.value}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Overwrite warning */}
          {showOverwriteWarning && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
              <AlertTriangle
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400"
                aria-hidden
              />
              <span>
                An EA with this name will be overwritten. If it is active on a
                chart, MT5 will reload it.
              </span>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isDeploying}
            className="border-white/20 bg-white/10 text-slate-200 hover:bg-white/20"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={hasError || isDeploying}
            className="bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50"
          >
            {isDeploying ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                Deploying…
              </>
            ) : (
              <>
                <Rocket className="mr-2 h-4 w-4" aria-hidden />
                Deploy
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
