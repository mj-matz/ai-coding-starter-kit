"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import type { MappingEntry } from "@/hooks/use-mql-converter";

// ── Status badge styling ────────────────────────────────────────────────────

function StatusBadge({ status }: { status: MappingEntry["status"] }) {
  switch (status) {
    case "mapped":
      return (
        <Badge className="bg-green-900/50 text-green-300 border-green-800/50 hover:bg-green-900/50">
          Mapped
        </Badge>
      );
    case "approximated":
      return (
        <Badge className="bg-yellow-900/50 text-yellow-300 border-yellow-800/50 hover:bg-yellow-900/50">
          Approximated
        </Badge>
      );
    case "unsupported":
      return (
        <Badge className="bg-red-900/50 text-red-300 border-red-800/50 hover:bg-red-900/50">
          Unsupported
        </Badge>
      );
  }
}

// ── Props ───────────────────────────────────────────────────────────────────

interface CodeReviewPanelProps {
  pythonCode: string;
  mappingReport: MappingEntry[];
  isRunning: boolean;
  onRerun: (editedCode: string) => void;
}

export function CodeReviewPanel({
  pythonCode,
  mappingReport,
  isRunning,
  onRerun,
}: CodeReviewPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [prevPythonCode, setPrevPythonCode] = useState(pythonCode);
  const [editedCode, setEditedCode] = useState(pythonCode);

  // Sync edited code when a new conversion arrives (adjusting state during render)
  if (pythonCode !== prevPythonCode) {
    setPrevPythonCode(pythonCode);
    setEditedCode(pythonCode);
  }

  const hasEdited = editedCode !== pythonCode;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-3xl overflow-hidden">
        <CollapsibleTrigger className="flex w-full items-center justify-between px-6 py-4 text-left hover:bg-white/5 transition-colors">
          <div className="flex items-center gap-2">
            {isOpen ? (
              <ChevronDown className="h-4 w-4 text-gray-400" />
            ) : (
              <ChevronRight className="h-4 w-4 text-gray-400" />
            )}
            <h3 className="text-base font-semibold text-white">
              Code Review & Mapping
            </h3>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span>{mappingReport.length} functions mapped</span>
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-6 pb-6 space-y-6">
            {/* Python Code (editable) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium text-gray-400">
                  Generated Python Code
                  {hasEdited && (
                    <span className="ml-2 text-xs text-yellow-400">(edited)</span>
                  )}
                </h4>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onRerun(editedCode)}
                  disabled={isRunning}
                  className="border-white/20 bg-white/10 text-slate-200 hover:bg-white/20"
                  aria-label="Re-run backtest with edited code"
                >
                  {isRunning ? (
                    <>
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                      Running...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-2 h-3.5 w-3.5" />
                      Re-run Backtest
                    </>
                  )}
                </Button>
              </div>
              <Textarea
                value={editedCode}
                onChange={(e) => setEditedCode(e.target.value)}
                className="min-h-[300px] max-h-[600px] resize-y border-white/10 bg-black/30 font-mono text-xs text-gray-100 rounded-lg leading-relaxed"
                aria-label="Editable Python code"
                disabled={isRunning}
              />
            </div>

            {/* Function Mapping Table */}
            {mappingReport.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-gray-400">
                  Function Mapping Report
                </h4>
                <div className="rounded-lg border border-white/10 overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-white/10 hover:bg-transparent">
                        <TableHead className="text-gray-400 font-medium">
                          MQL Function
                        </TableHead>
                        <TableHead className="text-gray-400 font-medium">
                          Python Equivalent
                        </TableHead>
                        <TableHead className="text-gray-400 font-medium">
                          Status
                        </TableHead>
                        <TableHead className="text-gray-400 font-medium">
                          Note
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {mappingReport.map((entry, i) => (
                        <TableRow
                          key={i}
                          className="border-white/5 hover:bg-white/5"
                        >
                          <TableCell className="font-mono text-xs text-gray-200">
                            {entry.mql_function}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-gray-300">
                            {entry.python_equivalent}
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={entry.status} />
                          </TableCell>
                          <TableCell className="text-xs text-gray-400 max-w-[200px] truncate">
                            {entry.note}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
