"use client";

import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Save, Check, Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { DeployToMt5Button } from "@/components/mql-converter/deploy-to-mt5-button";
import type { StrategyParameter, ParamValue } from "@/components/mql-converter/parameters-panel";
import type { EaDeployRequest } from "@/lib/mt5-bridge-types";

interface SaveConversionSectionProps {
  onSave: (name: string) => Promise<boolean>;
  defaultName?: string;
  /** Original MQL code for MT5 EA export (required for export to be enabled) */
  originalMqlCode?: string;
  /** Current strategy parameters with mql_input_name mapping */
  parameters?: StrategyParameter[];
  /** Current parameter values */
  parameterValues?: Record<string, ParamValue>;
  /** Symbol used in the backtest */
  symbol?: string;
  /** Start date of the backtest */
  dateFrom?: string;
  /** End date of the backtest */
  dateTo?: string;
  /** PROJ-40: Bridge online state — gates the Deploy button. */
  bridgeOnline?: boolean;
  /** PROJ-40: Loader flag for the bridge health check. */
  bridgeChecking?: boolean;
  /** PROJ-40: Called when a deploy completes; receives the deployed ea_name. */
  onDeployed?: (eaName: string) => void;
}

export function SaveConversionSection({
  onSave,
  defaultName = "",
  originalMqlCode,
  parameters,
  parameterValues,
  symbol,
  dateFrom,
  dateTo,
  bridgeOnline = false,
  bridgeChecking = false,
  onDeployed,
}: SaveConversionSectionProps) {
  const { toast } = useToast();
  const [prevDefaultName, setPrevDefaultName] = useState(defaultName);
  const [name, setName] = useState(defaultName);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [saved, setSaved] = useState(false);

  // Reset when a new backtest result arrives (adjusting state during render)
  if (defaultName !== prevDefaultName) {
    setPrevDefaultName(defaultName);
    setName(defaultName);
    setSaved(false);
  }

  const canExport = !!originalMqlCode;
  const canDeploy = !!originalMqlCode;

  // PROJ-40: Sanitize the conversion name to a valid EA filename so the
  // confirm dialog opens with a sensible default. Whitespace → underscore,
  // strip everything outside [A-Za-z0-9_-], and fall back to a generic name
  // when the user hasn't typed anything yet.
  function deriveDefaultEaName(): string {
    const base = (name.trim() || symbol || "Strategy").replace(/\s+/g, "_");
    const sanitized = base.replace(/[^A-Za-z0-9_\-]/g, "").slice(0, 64);
    return sanitized || "Strategy";
  }

  async function handleSave() {
    if (!name.trim() || isSaving) return;
    setIsSaving(true);

    const success = await onSave(name.trim());

    setIsSaving(false);
    if (success) {
      setSaved(true);
    }
  }

  // PROJ-33: Render the .mq5 content with current parameters baked in.
  // Returns the full code string and the suggested filename.
  async function renderMt5EaContent(): Promise<{ code: string; filename: string }> {
    // Build parameter entries for the API
    const paramEntries =
      parameters && parameterValues
        ? parameters
            .filter((p) => p.mql_input_name)
            .map((p) => ({
              mql_input_name: p.mql_input_name as string,
              current_value: parameterValues[p.name] ?? p.default,
              type: p.type,
            }))
        : [];

    const response = await fetch("/api/mql-converter/export-mt5", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        original_mql_code: originalMqlCode,
        parameters: paramEntries,
        symbol: symbol || "Unknown",
        date_from: dateFrom || "",
        date_to: dateTo || "",
        conversion_name: name.trim() || undefined,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => null);
      throw new Error(err?.error || `Export failed (${response.status})`);
    }

    const disposition = response.headers.get("Content-Disposition") || "";
    const filenameMatch = disposition.match(/filename="?([^"]+)"?/);
    const filename = filenameMatch?.[1] || "export.mq5";
    const code = await response.text();
    return { code, filename };
  }

  async function handleExport() {
    if (!canExport || isExporting) return;
    setIsExporting(true);

    try {
      const { code, filename } = await renderMt5EaContent();
      const blob = new Blob([code], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("MT5 EA export failed:", err);
      toast({
        title: "Export failed",
        description: err instanceof Error ? err.message : "Could not export the MT5 EA. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  }

  // PROJ-40: Build the deploy payload by re-using the export endpoint to
  // render the .mq5 content with the current parameter values, then forward
  // to /api/mt5/ea/deploy via the DeployToMt5Button.
  async function buildDeployRequest(eaName: string): Promise<EaDeployRequest> {
    const { code } = await renderMt5EaContent();
    return {
      ea_name: eaName,
      source: "mql_converter",
      mq5_content: code,
      symbol: symbol,
      date_from: dateFrom,
      date_to: dateTo,
      conversion_name: name.trim() || undefined,
    };
  }

  if (saved) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-green-900/50 bg-green-950/20 px-5 py-3">
        <div className="flex items-center gap-2">
          <Check className="h-4 w-4 text-green-400" />
          <span className="text-sm text-green-300">
            Conversion saved successfully.
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canExport && (
            <ExportButton
              onClick={handleExport}
              isExporting={isExporting}
              disabled={false}
            />
          )}
          {canDeploy && (
            <DeployToMt5Button
              defaultEaName={deriveDefaultEaName()}
              bridgeOnline={bridgeOnline}
              bridgeChecking={bridgeChecking}
              buildRequest={buildDeployRequest}
              onDeployed={onDeployed}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-5 py-4">
      <h4 className="text-sm font-medium text-gray-300 mb-3">
        Save & Export
      </h4>
      <div className="flex flex-wrap gap-3">
        <div className="flex-1 min-w-[200px]">
          <Label htmlFor="save-name" className="sr-only">
            Conversion name
          </Label>
          <Input
            id="save-name"
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 100))}
            placeholder="Enter a name for this conversion..."
            maxLength={100}
            className="border-white/10 bg-black/20 text-gray-100 rounded-lg"
            aria-label="Conversion name"
            disabled={isSaving || isExporting}
          />
          <p className="mt-1 text-xs text-gray-500">
            {name.length}/100 characters
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button
            onClick={handleSave}
            disabled={!name.trim() || isSaving}
            className="bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            aria-label="Save conversion"
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Save
              </>
            )}
          </Button>
          <ExportButton
            onClick={handleExport}
            isExporting={isExporting}
            disabled={!canExport}
            disabledReason={
              !canExport
                ? "Reload the conversion to enable export."
                : undefined
            }
          />
          {canDeploy && (
            <DeployToMt5Button
              defaultEaName={deriveDefaultEaName()}
              bridgeOnline={bridgeOnline}
              bridgeChecking={bridgeChecking}
              disabled={isSaving || isExporting}
              buildRequest={buildDeployRequest}
              onDeployed={onDeployed}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Export Button (with optional tooltip for disabled state) ─────────────────

function ExportButton({
  onClick,
  isExporting,
  disabled,
  disabledReason,
}: {
  onClick: () => void;
  isExporting: boolean;
  disabled: boolean;
  disabledReason?: string;
}) {
  const button = (
    <Button
      onClick={onClick}
      disabled={disabled || isExporting}
      className="bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
      aria-label="Export as MT5 EA"
    >
      {isExporting ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Exporting...
        </>
      ) : (
        <>
          <Download className="mr-2 h-4 w-4" />
          Export MT5 EA
        </>
      )}
    </Button>
  );

  if (disabled && disabledReason) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0}>{button}</span>
          </TooltipTrigger>
          <TooltipContent>
            <p>{disabledReason}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return button;
}
