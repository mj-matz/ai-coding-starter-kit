"use client";

import { useState } from "react";
import { Loader2, Save, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface SaveConversionSectionProps {
  onSave: (name: string) => Promise<boolean>;
  defaultName?: string;
}

export function SaveConversionSection({
  onSave,
  defaultName = "",
}: SaveConversionSectionProps) {
  const [prevDefaultName, setPrevDefaultName] = useState(defaultName);
  const [name, setName] = useState(defaultName);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Reset when a new backtest result arrives (adjusting state during render)
  if (defaultName !== prevDefaultName) {
    setPrevDefaultName(defaultName);
    setName(defaultName);
    setSaved(false);
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

  if (saved) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-green-900/50 bg-green-950/20 px-5 py-3">
        <Check className="h-4 w-4 text-green-400" />
        <span className="text-sm text-green-300">
          Conversion saved successfully.
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-5 py-4">
      <h4 className="text-sm font-medium text-gray-300 mb-3">
        Save Conversion
      </h4>
      <div className="flex gap-3">
        <div className="flex-1">
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
            disabled={isSaving}
          />
          <p className="mt-1 text-xs text-gray-500">
            {name.length}/100 characters
          </p>
        </div>
        <Button
          onClick={handleSave}
          disabled={!name.trim() || isSaving}
          className="shrink-0 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
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
              Save Conversion
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
