"use client";

import { useState } from "react";
import { Loader2, BookPlus, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";

import type { StrategyParameter } from "@/components/mql-converter/parameters-panel";
import { useUserStrategies } from "@/hooks/use-user-strategies";
import { USER_STRATEGY_LIMIT } from "@/lib/strategy-types";

// ── Parameter schema builder ────────────────────────────────────────────────

function buildParameterSchema(parameters: StrategyParameter[]) {
  const properties: Record<string, object> = {};
  for (const p of parameters) {
    properties[p.name] = {
      name: p.name,
      label: p.label,
      type: p.type,
      default: p.default,
    };
  }
  return { properties };
}

// ── Props ───────────────────────────────────────────────────────────────────

interface AddToLibraryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pythonCode: string;
  parameters: StrategyParameter[];
  sourceConversionId?: string;
  defaultName?: string;
  /** When true, shows a warning that the code was manually edited. */
  isCodeEdited?: boolean;
  /** Called with the new strategy id after successful save */
  onSuccess: (strategyId: string) => void;
}

export function AddToLibraryDialog({
  open,
  onOpenChange,
  pythonCode,
  parameters,
  sourceConversionId,
  defaultName = "",
  isCodeEdited = false,
  onSuccess,
}: AddToLibraryDialogProps) {
  const { create, createOrReplace, strategies } = useUserStrategies();

  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAtLimit = strategies.length >= USER_STRATEGY_LIMIT;

  // Reset on open
  function handleOpenChange(next: boolean) {
    if (next) {
      setName(defaultName);
      setDescription("");
      setConflict(false);
      setError(null);
    }
    onOpenChange(next);
  }

  async function handleSave(overwrite = false) {
    const trimmed = name.trim();
    if (!trimmed) return;

    setIsSaving(true);
    setError(null);
    setConflict(false);

    try {
      const params = {
        name: trimmed,
        description: description.trim() || undefined,
        python_code: pythonCode,
        parameter_schema: buildParameterSchema(parameters),
        source_conversion_id: sourceConversionId,
      };

      const result = overwrite
        ? await createOrReplace(params)
        : await create(params);

      if (!result) throw new Error("Failed to save strategy");

      if ("conflict" in result) {
        setConflict(true);
        return;
      }

      onSuccess(result.strategy.id);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save strategy");
    } finally {
      setIsSaving(false);
    }
  }

  const paramCount = parameters.length;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="border-white/10 bg-[#0d0f14] text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookPlus className="h-5 w-5 text-blue-400" />
            Add to Strategy Library
          </DialogTitle>
          <DialogDescription className="text-gray-400">
            Save this converted strategy so it appears in the backtest selector alongside built-in strategies.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {isAtLimit && (
            <Alert className="border-amber-800/50 bg-amber-950/30">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              <AlertDescription className="text-amber-200/80 text-sm">
                You have reached the limit of {USER_STRATEGY_LIMIT} user strategies. Delete one before adding more.
              </AlertDescription>
            </Alert>
          )}

          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="strategy-name" className="text-gray-300 text-sm">
              Strategy Name <span className="text-red-400">*</span>
            </Label>
            <Input
              id="strategy-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value.slice(0, 80));
                setConflict(false);
              }}
              placeholder="e.g. My Breakout EA"
              maxLength={80}
              disabled={isSaving || isAtLimit}
              className="border-white/10 bg-black/20 text-gray-100 rounded-lg"
              aria-label="Strategy name"
            />
            <p className="text-xs text-gray-500">{name.length}/80 characters</p>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="strategy-desc" className="text-gray-300 text-sm">
              Description <span className="text-gray-500">(optional)</span>
            </Label>
            <Textarea
              id="strategy-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, 300))}
              placeholder="Briefly describe what this strategy does..."
              maxLength={300}
              rows={3}
              disabled={isSaving || isAtLimit}
              className="border-white/10 bg-black/20 text-gray-100 rounded-lg resize-none text-sm"
              aria-label="Strategy description"
            />
            <p className="text-xs text-gray-500">{description.length}/300 characters</p>
          </div>

          {/* Edited-code warning */}
          {isCodeEdited && (
            <Alert className="border-yellow-800/50 bg-yellow-950/30">
              <AlertTriangle className="h-4 w-4 text-yellow-400" />
              <AlertDescription className="text-yellow-200/80 text-sm">
                You are saving manually edited code. Ensure the parameters match the schema below.
              </AlertDescription>
            </Alert>
          )}

          {/* Parameter schema preview */}
          {paramCount > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-gray-400">
                {paramCount} parameter{paramCount !== 1 ? "s" : ""} detected
              </p>
              <div className="rounded-lg border border-white/10 bg-black/20 divide-y divide-white/5">
                {parameters.map((p) => (
                  <div key={p.name} className="flex items-center justify-between px-3 py-1.5 gap-2">
                    <span className="font-mono text-xs text-gray-200 truncate">{p.name}</span>
                    <span className="shrink-0 text-xs text-gray-500">
                      {p.type} · default: {String(p.default)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {paramCount === 0 && (
            <p className="text-xs text-gray-500">
              No configurable parameters detected. This strategy will run with its built-in defaults.
            </p>
          )}

          {/* Conflict warning */}
          {conflict && (
            <Alert className="border-amber-800/50 bg-amber-950/30">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              <AlertDescription className="text-amber-200/80 text-sm">
                A strategy named &quot;{name.trim()}&quot; already exists.{" "}
                <button
                  onClick={() => handleSave(true)}
                  disabled={isSaving}
                  className="text-amber-300 underline underline-offset-2 hover:text-amber-200 disabled:opacity-50"
                >
                  Overwrite it?
                </button>
              </AlertDescription>
            </Alert>
          )}

          {/* Generic error */}
          {error && (
            <Alert className="border-red-900/50 bg-red-950/30">
              <AlertDescription className="text-red-300 text-sm">{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
            className="border-white/20 bg-white/10 text-gray-300 hover:bg-white/20"
          >
            Cancel
          </Button>
          <Button
            onClick={() => handleSave(false)}
            disabled={!name.trim() || isSaving || isAtLimit}
            className="bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <BookPlus className="mr-2 h-4 w-4" />
                Save to Library
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
