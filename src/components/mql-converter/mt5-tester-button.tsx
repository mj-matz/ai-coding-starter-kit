"use client";

import Link from "next/link";
import { ExternalLink, Loader2, PlayCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import type { Mt5RunStatus } from "@/lib/mt5-bridge-types";
import type { Mt5TesterRunPhase } from "@/hooks/use-mt5-tester-run";

// PROJ-37: "Test in MT5" button that lives next to the existing
// Convert & Backtest action. The button is automatically disabled when the
// Bridge Worker is offline, with a tooltip pointing the user to Settings.

interface Mt5TesterButtonProps {
  bridgeOnline: boolean;
  bridgeChecking?: boolean;
  phase: Mt5TesterRunPhase;
  status: Mt5RunStatus | null;
  queuePosition: number | null;
  runningElapsedSec: number | null;
  /** Disable when the prerequisites (e.g. converted code) are missing. */
  disabled?: boolean;
  onClick: () => void;
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function statusLabel(props: Mt5TesterButtonProps): string {
  const { phase, status, queuePosition, runningElapsedSec } = props;

  if (phase === "submitting") return "Submitting…";

  if (status === "queued") {
    if (typeof queuePosition === "number" && queuePosition > 0) {
      return `Queued (position ${queuePosition})`;
    }
    return "Queued";
  }

  if (status === "running") {
    if (typeof runningElapsedSec === "number") {
      return `Running ${formatElapsed(runningElapsedSec)}`;
    }
    return "Running";
  }

  if (status === "pending") return "Starting…";

  if (status === "done") return "Completed";
  if (status === "cancelled") return "Cancelled";
  if (status === "failed") return "Failed";

  return "Test in MT5";
}

function isBusy(phase: Mt5TesterRunPhase): boolean {
  return phase === "submitting" || phase === "polling";
}

export function Mt5TesterButton(props: Mt5TesterButtonProps) {
  const {
    bridgeOnline,
    bridgeChecking,
    phase,
    disabled,
    onClick,
  } = props;

  const offlineDisabled = !bridgeOnline;
  const busy = isBusy(phase);
  const buttonDisabled = busy || offlineDisabled || !!disabled;

  const label = statusLabel(props);
  const showSpinner = busy || (offlineDisabled && bridgeChecking);

  const button = (
    <Button
      type="button"
      onClick={onClick}
      disabled={buttonDisabled}
      variant="outline"
      className="border-violet-500/40 bg-violet-600/15 text-violet-200 hover:bg-violet-600/25 disabled:opacity-50"
      aria-label="Run strategy in MT5 Strategy Tester"
    >
      {showSpinner ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <PlayCircle className="mr-2 h-4 w-4" aria-hidden />
      )}
      {label}
    </Button>
  );

  if (!offlineDisabled) {
    return button;
  }

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* span needed because disabled buttons don't fire pointer events */}
          <span tabIndex={0} className="inline-flex">
            {button}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <p className="text-xs">
            MT5 Bridge Worker is offline.{" "}
            <Link
              href="/settings"
              className="inline-flex items-center gap-0.5 text-blue-400 underline"
            >
              Open Settings
              <ExternalLink className="h-3 w-3" aria-hidden />
            </Link>{" "}
            to diagnose.
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
