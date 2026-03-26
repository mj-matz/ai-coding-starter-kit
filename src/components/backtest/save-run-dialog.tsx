"use client";

import { useState } from "react";
import { BookmarkPlus, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface SaveRunDialogProps {
  defaultName: string;
  isSaving: boolean;
  onSave: (name: string) => Promise<void>;
}

export function SaveRunDialog({
  defaultName,
  isSaving,
  onSave,
}: SaveRunDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaultName);

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setName(defaultName);
    }
    setOpen(nextOpen);
  }

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    await onSave(trimmed);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="border-white/20 bg-white/10 text-slate-200 hover:bg-white/20"
          aria-label="Save run"
        >
          <BookmarkPlus className="mr-2 h-4 w-4" />
          Save Run
        </Button>
      </DialogTrigger>
      <DialogContent className="border-white/10 bg-[#0d0f14] text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Run speichern</DialogTitle>
          <DialogDescription className="text-slate-400">
            Gib einen Namen ein, um diesen Backtest-Run in deiner History zu
            speichern.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-4">
          <Label htmlFor="run-name" className="text-slate-300">
            Name
          </Label>
          <Input
            id="run-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z.B. XAUUSD 3.5R TP"
            className="border-white/10 bg-white/5 text-white placeholder:text-slate-600"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
            }}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={isSaving}
            className="text-slate-400 hover:text-white"
          >
            Abbrechen
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving || !name.trim()}
            className="bg-blue-600 text-white hover:bg-blue-700"
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Speichern...
              </>
            ) : (
              "Speichern"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
