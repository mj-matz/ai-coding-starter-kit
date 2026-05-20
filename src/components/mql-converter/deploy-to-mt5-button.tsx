"use client";

import { useState } from "react";
import Link from "next/link";
import { ExternalLink, Loader2, Rocket } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { CompileErrorDialog } from "@/components/mql-converter/compile-error-dialog";
import {
  DeployConfirmDialog,
  type DeployConfirmParameterSummary,
} from "@/components/mql-converter/deploy-confirm-dialog";
import { useMt5EaDeploy } from "@/hooks/use-mt5-ea-deploy";
import { useToast } from "@/hooks/use-toast";
import type { EaDeployRequest } from "@/lib/mt5-bridge-types";

// PROJ-40: Self-contained "Deploy to MT5" trigger.
//
// Owns:
//   - The confirm dialog (EA name + optional parameter summary)
//   - The compile-error dialog (multi-line error output)
//   - Bridge-offline tooltip + disabled state
//   - Toast notifications for success / timeout / transport failure
//
// The parent provides a `buildRequest(eaName)` callback that synchronously
// constructs the deploy payload — this lets the converter flow generate the
// .mq5 inline (via /api/mql-converter/export-mt5) while the optimizer flow
// can omit the content and pass the conversion id instead.

export interface DeployToMt5ButtonProps {
  /** Pre-filled EA name in the confirm dialog (without `.mq5`). */
  defaultEaName: string;
  /** Bridge online-status from useMt5Health. */
  bridgeOnline: boolean;
  /** While the bridge health check is pending, render the spinner. */
  bridgeChecking?: boolean;
  /** Generic disabled — e.g. "no converted EA yet". */
  disabled?: boolean;
  /** Called once the user confirms; must produce the API request body. */
  buildRequest: (eaName: string) => Promise<EaDeployRequest> | EaDeployRequest;
  /** Optional parameter summary block (optimizer flow). */
  parameters?: DeployConfirmParameterSummary[] | null;
  /** Show the overwrite warning — defaults to true since the bridge silently overwrites. */
  showOverwriteWarning?: boolean;
  /** Called when a deploy completes; receives the ea_name that was deployed. */
  onDeployed?: (eaName: string) => void;
  /** Override the confirm-dialog title. Defaults to "Deploy to MT5". */
  dialogTitle?: string;
  /** Override the button label. Defaults to "Deploy to MT5". */
  buttonLabel?: string;
  /** Compact button variant for use inside table rows. */
  compact?: boolean;
}

export function DeployToMt5Button({
  defaultEaName,
  bridgeOnline,
  bridgeChecking = false,
  disabled = false,
  buildRequest,
  parameters = null,
  showOverwriteWarning = true,
  onDeployed,
  dialogTitle,
  buttonLabel = "Deploy to MT5",
  compact = false,
}: DeployToMt5ButtonProps) {
  const { toast } = useToast();
  const { phase, error, deploy, reset } = useMt5EaDeploy();

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [errorDialogOpen, setErrorDialogOpen] = useState(false);

  const isDeploying = phase === "deploying";
  const offlineDisabled = !bridgeOnline;
  const buttonDisabled =
    isDeploying || offlineDisabled || disabled || bridgeChecking;

  async function handleConfirm(eaName: string) {
    let request: EaDeployRequest;
    try {
      request = await buildRequest(eaName);
    } catch (err) {
      toast({
        title: "Deploy failed",
        description:
          err instanceof Error
            ? err.message
            : "Could not prepare the EA for deployment.",
        variant: "destructive",
      });
      return;
    }

    const result = await deploy(request);

    if (result?.status === "compiled") {
      toast({
        title: "EA compiled",
        description: `EA "${result.ea_name}" compiled and ready in MT5.`,
      });
      setConfirmOpen(false);
      onDeployed?.(eaName);
      return;
    }

    if (result?.status === "compile_error") {
      // Keep the confirm dialog state, surface the structured errors instead.
      setConfirmOpen(false);
      setErrorDialogOpen(true);
      onDeployed?.(eaName); // history table updates regardless of outcome
      return;
    }

    // Transport / timeout / unknown failure — useMt5EaDeploy populated `error`.
    setConfirmOpen(false);
    if (result?.status === "timeout") {
      toast({
        title: "Compile timed out",
        description:
          "MetaEditor did not respond — please compile manually in MT5.",
        variant: "destructive",
      });
    } else if (error?.kind === "compile") {
      setErrorDialogOpen(true);
    } else {
      toast({
        title: "Deploy failed",
        description: error?.message ?? "An unexpected error occurred.",
        variant: "destructive",
      });
    }
    onDeployed?.(eaName);
  }

  function handleErrorDialogChange(open: boolean) {
    setErrorDialogOpen(open);
    if (!open) {
      // Clear residual error state once the user dismisses the dialog so
      // the next click on the button starts from a clean phase.
      reset();
    }
  }

  const button = (
    <Button
      type="button"
      onClick={() => setConfirmOpen(true)}
      disabled={buttonDisabled}
      size={compact ? "sm" : undefined}
      className={
        compact
          ? "bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50"
          : "bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50"
      }
      aria-label={buttonLabel}
    >
      {isDeploying ? (
        <>
          <Loader2
            className={
              compact ? "mr-1 h-3.5 w-3.5 animate-spin" : "mr-2 h-4 w-4 animate-spin"
            }
            aria-hidden
          />
          Deploying…
        </>
      ) : (
        <>
          <Rocket
            className={compact ? "mr-1 h-3.5 w-3.5" : "mr-2 h-4 w-4"}
            aria-hidden
          />
          {buttonLabel}
        </>
      )}
    </Button>
  );

  const trigger = offlineDisabled ? (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* span needed because disabled buttons swallow pointer events */}
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
  ) : (
    button
  );

  return (
    <>
      {trigger}

      <DeployConfirmDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!isDeploying) setConfirmOpen(open);
        }}
        title={dialogTitle}
        defaultEaName={defaultEaName}
        parameters={parameters}
        showOverwriteWarning={showOverwriteWarning}
        isDeploying={isDeploying}
        onConfirm={handleConfirm}
      />

      <CompileErrorDialog
        open={errorDialogOpen}
        onOpenChange={handleErrorDialogChange}
        eaName={error?.eaName}
        errors={error?.errors ?? []}
        logExcerpt={error?.logExcerpt}
      />
    </>
  );
}
