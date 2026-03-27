"use client";

import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

interface ProgressSectionProps {
  progress: number;
  total: number;
  onCancel: () => void;
}

export function ProgressSection({ progress, total, onCancel }: ProgressSectionProps) {
  const percentage = total > 0 ? Math.round((progress / total) * 100) : 0;

  return (
    <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-blue-400" />
          <div>
            <p className="text-sm font-medium text-white">
              Optimization running...
            </p>
            <p className="text-xs text-gray-400">
              {progress} / {total} backtests completed ({percentage}%)
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onCancel}
          className="border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20 hover:text-red-200"
          aria-label="Cancel optimization"
        >
          <X className="mr-1 h-3.5 w-3.5" />
          Cancel
        </Button>
      </div>

      <Progress
        value={percentage}
        className="h-2 bg-white/10 [&>div]:bg-blue-500"
      />
    </div>
  );
}
