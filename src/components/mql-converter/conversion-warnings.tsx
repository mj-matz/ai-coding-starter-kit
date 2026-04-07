"use client";

import { AlertCircle, AlertTriangle, Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { MappingEntry } from "@/hooks/use-mql-converter";

// ── Order management functions to check ─────────────────────────────────────

const ORDER_MANAGEMENT_FUNCTIONS = [
  "OrderSend",
  "OrderClose",
  "OrderModify",
  "OrdersTotal",
];

interface ConversionWarningsProps {
  mappingReport: MappingEntry[];
  warnings: string[];
}

export function ConversionWarnings({
  mappingReport,
  warnings,
}: ConversionWarningsProps) {
  // Calculate warning severity
  const approximatedEntries = mappingReport.filter(
    (e) => e.status === "approximated"
  );
  const unsupportedEntries = mappingReport.filter(
    (e) => e.status === "unsupported"
  );

  // Check if >50% of order management functions are unsupported
  const orderMgmtEntries = mappingReport.filter((e) =>
    ORDER_MANAGEMENT_FUNCTIONS.includes(e.mql_function)
  );
  const unsupportedOrderMgmt = orderMgmtEntries.filter(
    (e) => e.status === "unsupported"
  );
  const hasHighUnsupportedRatio =
    orderMgmtEntries.length > 0 &&
    unsupportedOrderMgmt.length / orderMgmtEntries.length > 0.5;

  const hasApproximations = approximatedEntries.length > 0;
  const hasInfoWarnings = warnings.length > 0;

  if (!hasHighUnsupportedRatio && !hasApproximations && !hasInfoWarnings) {
    return null;
  }

  return (
    <div className="space-y-3">
      {/* Red: High unsupported ratio */}
      {hasHighUnsupportedRatio && (
        <Alert className="border-red-900/50 bg-red-950/30 text-red-300">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Conversion Accuracy Warning</AlertTitle>
          <AlertDescription className="mt-1 text-red-300/80">
            This conversion may produce significantly different results from the
            original EA. More than 50% of order management functions (
            {unsupportedOrderMgmt.map((e) => e.mql_function).join(", ")}) are
            unsupported.
          </AlertDescription>
        </Alert>
      )}

      {/* Yellow: Approximated functions */}
      {hasApproximations && (
        <Alert className="border-yellow-900/50 bg-yellow-950/30 text-yellow-300">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Approximated Functions</AlertTitle>
          <AlertDescription className="mt-1 text-yellow-300/80">
            <ul className="mt-1 list-disc pl-4 space-y-0.5">
              {approximatedEntries.map((entry, i) => (
                <li key={i}>
                  <code className="text-xs">{entry.mql_function}</code>
                  {entry.note ? ` - ${entry.note}` : ""}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* Blue: Info warnings */}
      {hasInfoWarnings && (
        <Alert className="border-blue-900/50 bg-blue-950/30 text-blue-300">
          <Info className="h-4 w-4" />
          <AlertTitle>Conversion Notes</AlertTitle>
          <AlertDescription className="mt-1 text-blue-300/80">
            <ul className="mt-1 list-disc pl-4 space-y-0.5">
              {warnings.map((warning, i) => (
                <li key={i}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* Unsupported functions (if any, but not high ratio -- included in yellow) */}
      {!hasHighUnsupportedRatio && unsupportedEntries.length > 0 && (
        <Alert className="border-orange-900/50 bg-orange-950/30 text-orange-300">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Unsupported Functions</AlertTitle>
          <AlertDescription className="mt-1 text-orange-300/80">
            <ul className="mt-1 list-disc pl-4 space-y-0.5">
              {unsupportedEntries.map((entry, i) => (
                <li key={i}>
                  <code className="text-xs">{entry.mql_function}</code>
                  {entry.note ? ` - ${entry.note}` : " - not available in backtest engine"}
                </li>
              ))}
            </ul>
            {unsupportedEntries.some((e) =>
              e.mql_function.toLowerCase().includes("spread")
            ) && (
              <p className="mt-2 text-orange-200/90">
                <strong>Tipp:</strong> Da der Spread-Filter nicht simuliert werden
                kann, empfiehlt es sich, den durchschnittlichen Spread des
                Instruments als{" "}
                <code className="text-xs">slippage_pips</code> in der
                Backtest-Konfiguration einzutragen – so wird der Spread-Effekt
                näherungsweise berücksichtigt.
              </p>
            )}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
