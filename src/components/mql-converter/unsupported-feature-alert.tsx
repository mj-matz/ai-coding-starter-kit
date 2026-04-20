"use client";

import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

// ── Engine gap pattern detection ────────────────────────────────────────────

interface EngineGap {
  concept: string;
  detail: string;
}

const ENGINE_GAP_PATTERNS: Array<{
  pattern: RegExp;
  label: (match: RegExpMatchArray) => string;
}> = [
  {
    // AttributeError: 'EngineAPI' object has no attribute 'partial_close'
    pattern: /AttributeError.*?(?:EngineAPI|engine).*?has no attribute ['"]([\w_]+)['"]/i,
    label: (m) => `engine.${m[1]}()`,
  },
  {
    // NotImplementedError: partial_close is not yet supported
    pattern: /NotImplementedError.*?['"]([\w_]+)['"]/i,
    label: (m) => m[1],
  },
  {
    // AttributeError: 'NoneType' object has no attribute 'xxx' – too generic, skip
    // NameError: name 'smcEngine' is not defined
    pattern: /NameError.*?name ['"]([\w_]+)['"]/i,
    label: (m) => m[1],
  },
];

// Known engine concepts that map to human-friendly names
const CONCEPT_LABELS: Record<string, { name: string; description: string }> = {
  partial_close: {
    name: "Partial Close",
    description: "Closing part of a position while keeping the remainder open (PROJ-30).",
  },
  trailing_stop: {
    name: "Continuous Trailing Stop",
    description: "A tick-by-tick trailing stop that adjusts the SL as price moves in favour (PROJ-30).",
  },
  smc: {
    name: "SMC / Market Structure",
    description: "Smart Money Concepts: Break of Structure (BoS), Change of Character (ChoCH), Supply & Demand zones, Fair Value Gaps (PROJ-20).",
    },
  market_structure: {
    name: "Market Structure (SMC)",
    description: "Break of Structure detection and higher-high / lower-low analysis (PROJ-20).",
  },
  fair_value_gap: {
    name: "Fair Value Gap (FVG)",
    description: "Imbalance detection between three consecutive candles (PROJ-20).",
  },
  order_block: {
    name: "Order Block",
    description: "Last opposing candle before a strong impulsive move (PROJ-20).",
  },
};

function detectEngineGap(errorText: string): EngineGap | null {
  for (const { pattern, label } of ENGINE_GAP_PATTERNS) {
    const match = errorText.match(pattern);
    if (match) {
      const raw = label(match).toLowerCase().replace(/[().]/g, "").trim();
      const known = CONCEPT_LABELS[raw];
      return {
        concept: known?.name ?? label(match),
        detail: known?.description ?? `"${label(match)}" is not yet implemented in the backtesting engine.`,
      };
    }
  }
  return null;
}

// ── Component ───────────────────────────────────────────────────────────────

interface UnsupportedFeatureAlertProps {
  error: string;
}

export function UnsupportedFeatureAlert({ error }: UnsupportedFeatureAlertProps) {
  const [traceOpen, setTraceOpen] = useState(false);
  const gap = detectEngineGap(error);

  if (!gap) return null;

  const hasTraceback = error.includes("\n");

  return (
    <Alert className="border-amber-800/50 bg-amber-950/30 text-amber-200">
      <AlertTriangle className="h-4 w-4 text-amber-400" />
      <AlertTitle className="flex items-center gap-2 text-amber-300">
        Unsupported Engine Feature
        <Badge className="bg-amber-900/60 text-amber-300 border-amber-700/50 hover:bg-amber-900/60 text-xs">
          {gap.concept}
        </Badge>
      </AlertTitle>
      <AlertDescription className="mt-2 space-y-2 text-amber-200/80 text-sm">
        <p>{gap.detail}</p>
        <p className="text-amber-300/70 text-xs">
          To use this feature you need to implement it in the Python engine first, then re-run this strategy.
        </p>

        {hasTraceback && (
          <Collapsible open={traceOpen} onOpenChange={setTraceOpen}>
            <CollapsibleTrigger className="flex items-center gap-1 text-xs text-amber-400/70 hover:text-amber-400 transition-colors mt-1">
              {traceOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {traceOpen ? "Hide" : "Show"} full error
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="mt-2 max-h-48 overflow-auto rounded-md border border-amber-900/40 bg-black/30 p-3 text-xs text-amber-200/60 whitespace-pre-wrap leading-relaxed">
                {error}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        )}
      </AlertDescription>
    </Alert>
  );
}

export { detectEngineGap };
