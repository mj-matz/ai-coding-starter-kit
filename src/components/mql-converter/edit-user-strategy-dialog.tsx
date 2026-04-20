"use client";

import { useState } from "react";
import { Loader2, Pencil } from "lucide-react";

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

import type { UserStrategy } from "@/lib/strategy-types";
import { useUserStrategies } from "@/hooks/use-user-strategies";

interface EditUserStrategyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  strategy: UserStrategy;
  onSuccess: (updated: UserStrategy) => void;
}

export function EditUserStrategyDialog({
  open,
  onOpenChange,
  strategy,
  onSuccess,
}: EditUserStrategyDialogProps) {
  const { update } = useUserStrategies();

  const [name, setName] = useState(strategy.name);
  const [description, setDescription] = useState(strategy.description ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleOpenChange(next: boolean) {
    if (next) {
      setName(strategy.name);
      setDescription(strategy.description ?? "");
      setError(null);
    }
    onOpenChange(next);
  }

  async function handleSave() {
    const trimmedName = name.trim();
    if (!trimmedName) return;

    setIsSaving(true);
    setError(null);

    try {
      const ok = await update(strategy.id, {
        name: trimmedName,
        description: description.trim() || undefined,
      });

      if (!ok) throw new Error("Failed to update strategy");

      onSuccess({ ...strategy, name: trimmedName, description: description.trim() || null });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update strategy");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="border-white/10 bg-[#0d0f14] text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4 text-blue-400" />
            Edit Strategy
          </DialogTitle>
          <DialogDescription className="text-gray-400">
            Update the name or description of this user strategy.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="edit-name" className="text-gray-300 text-sm">
              Name <span className="text-red-400">*</span>
            </Label>
            <Input
              id="edit-name"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 80))}
              maxLength={80}
              disabled={isSaving}
              className="border-white/10 bg-black/20 text-gray-100 rounded-lg"
            />
            <p className="text-xs text-gray-500">{name.length}/80</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-desc" className="text-gray-300 text-sm">
              Description <span className="text-gray-500">(optional)</span>
            </Label>
            <Textarea
              id="edit-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, 300))}
              maxLength={300}
              rows={3}
              disabled={isSaving}
              className="border-white/10 bg-black/20 text-gray-100 rounded-lg resize-none text-sm"
            />
            <p className="text-xs text-gray-500">{description.length}/300</p>
          </div>

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
            onClick={handleSave}
            disabled={!name.trim() || isSaving}
            className="bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Save Changes"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
