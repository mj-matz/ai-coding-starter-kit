"use client";

import { useState, useCallback, useEffect } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

import { MqlInputPanel } from "@/components/mql-converter/mql-input-panel";
import type { MqlInputValues } from "@/components/mql-converter/mql-input-panel";
import { ConversionProgress } from "@/components/mql-converter/conversion-progress";
import { ConversionWarnings } from "@/components/mql-converter/conversion-warnings";
import { CodeReviewPanel } from "@/components/mql-converter/code-review-panel";
import {
  ParametersPanel,
  areParametersValid,
  buildParamsDict,
  initParameterValues,
} from "@/components/mql-converter/parameters-panel";
import type { StrategyParameter } from "@/components/mql-converter/parameters-panel";
import { SaveConversionSection } from "@/components/mql-converter/save-conversion-section";
import { SavedConversionsList } from "@/components/mql-converter/saved-conversions-list";
import { ResultsPanel } from "@/components/backtest/results-panel";

import { useMqlConverter } from "@/hooks/use-mql-converter";
import type { MqlVersion, MappingEntry } from "@/hooks/use-mql-converter";
import { useToast } from "@/hooks/use-toast";

export default function MqlConverterPage() {
  const {
    status,
    convertResult,
    backtestResult,
    error,
    cacheId,
    convertAndRun,
    rerunBacktest,
    loadConversionResult,
    cancel,
    savedConversions,
    loadingSaves,
    fetchSaves,
    saveConversion,
    deleteConversion,
  } = useMqlConverter();

  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState("converter");
  const [lastInputValues, setLastInputValues] = useState<MqlInputValues | null>(null);
  const [preloadMqlCode, setPreloadMqlCode] = useState("");
  const [preloadMqlVersion, setPreloadMqlVersion] = useState<MqlVersion>("auto");
  const [preloadedConversionResult, setPreloadedConversionResult] = useState<{
    pythonCode: string;
    mappingReport: MappingEntry[];
  } | null>(null);

  // Parameter state (extracted from conversion, editable by user)
  const [strategyParameters, setStrategyParameters] = useState<StrategyParameter[]>([]);
  const [parameterValues, setParameterValues] = useState<Record<string, number | string>>({});

  const isRunning =
    status === "converting" ||
    status === "fetching_data" ||
    status === "running";

  // Sync parameters when a new conversion result arrives
  useEffect(() => {
    if (convertResult?.parameters && convertResult.parameters.length > 0) {
      setStrategyParameters(convertResult.parameters);
      setParameterValues(initParameterValues(convertResult.parameters, convertResult.initialParameterValues));
    } else if (convertResult && !convertResult.parameters) {
      // Altdaten or no parameters extracted
      setStrategyParameters([]);
      setParameterValues({});
    }
  }, [convertResult]);

  const hasParameters = strategyParameters.length > 0;
  const parametersValid = !hasParameters || areParametersValid(strategyParameters, parameterValues);

  // ── Handle Convert & Backtest ─────────────────────────────────────────────

  function handleSubmit(values: MqlInputValues) {
    setLastInputValues(values);
    const preloaded = preloadedConversionResult;
    setPreloadedConversionResult(null);
    convertAndRun({
      mqlCode: values.mqlCode,
      mqlVersion: values.mqlVersion,
      symbol: values.symbol,
      timeframe: values.timeframe,
      startDate: values.startDate,
      endDate: values.endDate,
      initialCapital: values.initialCapital,
      sizingMode: values.sizingMode,
      riskPercent: values.riskPercent,
      fixedLot: values.fixedLot,
      commission: values.commission,
      slippage: values.slippage,
      preloadedPythonCode: preloaded?.pythonCode,
      preloadedMappingReport: preloaded?.mappingReport,
    });
  }

  // ── Handle Re-run (edited code, no conversion) ───────────────────────────

  function handleRerun(editedCode: string) {
    if (!cacheId || !lastInputValues) return;

    const paramsDict = hasParameters
      ? buildParamsDict(strategyParameters, parameterValues)
      : undefined;

    rerunBacktest({
      pythonCode: editedCode,
      cacheId,
      symbol: lastInputValues.symbol,
      initialCapital: lastInputValues.initialCapital,
      sizingMode: lastInputValues.sizingMode,
      riskPercent: lastInputValues.riskPercent,
      fixedLot: lastInputValues.fixedLot,
      commission: lastInputValues.commission,
      slippage: lastInputValues.slippage,
      params: paramsDict,
    });
  }

  // ── Handle Save ───────────────────────────────────────────────────────────

  const handleSave = useCallback(
    async (name: string): Promise<boolean> => {
      if (!convertResult || !lastInputValues) return false;

      const success = await saveConversion({
        name,
        mqlCode: lastInputValues.mqlCode,
        mqlVersion: lastInputValues.mqlVersion,
        pythonCode: convertResult.python_code,
        mappingReport: convertResult.mapping_report,
        backtestResult: backtestResult ?? undefined,
        parameters: hasParameters ? strategyParameters : undefined,
        parameterValues: hasParameters
          ? buildParamsDict(strategyParameters, parameterValues)
          : undefined,
      });

      if (success) {
        toast({
          title: "Conversion saved",
          description: `"${name}" has been saved to your conversions.`,
        });
      } else {
        toast({
          title: "Save failed",
          description: "Could not save the conversion. Please try again.",
          variant: "destructive",
        });
      }

      return success;
    },
    [convertResult, lastInputValues, backtestResult, saveConversion, toast, hasParameters, strategyParameters, parameterValues]
  );

  // ── Handle Load saved conversion ──────────────────────────────────────────

  const handleLoadConversion = useCallback(
    async (id: string) => {
      // For now, we need to fetch the full conversion data.
      // The GET /saves only returns summary. We need the full data from Supabase.
      // Since the API only returns summary, we'll use a direct Supabase query.
      try {
        const { createClient } = await import("@/lib/supabase/client");
        const supabase = createClient();
        const { data, error: fetchError } = await supabase
          .from("mql_conversions")
          .select("mql_code, mql_version, python_code, mapping_report, parameters")
          .eq("id", id)
          .single();

        if (fetchError || !data) {
          toast({
            title: "Load failed",
            description: "Could not load the conversion.",
            variant: "destructive",
          });
          return;
        }

        setPreloadMqlCode(data.mql_code);
        setPreloadMqlVersion(data.mql_version as MqlVersion);
        setPreloadedConversionResult({
          pythonCode: data.python_code,
          mappingReport: data.mapping_report ?? [],
        });
        // Restore parameters from saved data (if available).
        // Pass both definitions and saved values into loadConversionResult so the
        // useEffect can initialise parameterValues correctly without a second render
        // overwriting them with defaults.
        const savedParams = data.parameters as { definitions?: StrategyParameter[]; values?: Record<string, number | string> } | null;
        loadConversionResult(
          data.python_code,
          data.mapping_report ?? [],
          savedParams?.definitions,
          savedParams?.values,
        );

        setActiveTab("converter");

        toast({
          title: "Conversion loaded",
          description: "Configure your backtest settings and click Convert & Backtest — the saved Python code will be used directly without re-converting.",
        });
      } catch {
        toast({
          title: "Load failed",
          description: "Could not load the conversion.",
          variant: "destructive",
        });
      }
    },
    [toast, loadConversionResult]
  );

  // ── Handle Delete ─────────────────────────────────────────────────────────

  const handleDelete = useCallback(
    async (id: string) => {
      const success = await deleteConversion(id);
      if (success) {
        toast({
          title: "Conversion deleted",
          description: "The conversion has been removed.",
        });
      } else {
        toast({
          title: "Delete failed",
          description: "Could not delete the conversion.",
          variant: "destructive",
        });
      }
    },
    [deleteConversion, toast]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">
          MQL Converter
        </h1>
        <p className="mt-1 text-gray-400">
          Convert MQL4/MQL5 Expert Advisers to Python and backtest them on
          historical data.
        </p>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="bg-white/5 border border-white/10">
          <TabsTrigger
            value="converter"
            className="text-slate-400 data-[state=active]:bg-white/10 data-[state=active]:text-slate-100"
          >
            Converter
          </TabsTrigger>
          <TabsTrigger
            value="saves"
            className="text-slate-400 data-[state=active]:bg-white/10 data-[state=active]:text-slate-100"
          >
            My Conversions
          </TabsTrigger>
        </TabsList>

        {/* ── Tab: Converter ───────────────────────────────────────────────── */}
        <TabsContent value="converter" className="mt-6">
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[400px_1fr]">
            {/* Left Column: Input */}
            <div className="xl:sticky xl:top-6 xl:self-start">
              <MqlInputPanel
                onSubmit={handleSubmit}
                isRunning={isRunning}
                initialMqlCode={preloadMqlCode}
                initialMqlVersion={preloadMqlVersion}
              />
            </div>

            {/* Right Column: Results */}
            <div className="min-w-0 space-y-6">
              {/* Progress */}
              {isRunning && (
                <ConversionProgress status={status} onCancel={cancel} />
              )}

              {/* Error */}
              {status === "error" && error && (
                <Alert
                  variant="destructive"
                  className="border-red-900/50 bg-red-950/30 text-red-300"
                >
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Conversion Failed</AlertTitle>
                  <AlertDescription className="mt-2 whitespace-pre-wrap text-red-300/80 text-sm">
                    {error}
                  </AlertDescription>
                  {lastInputValues && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-3 border-red-800/60 bg-red-950/40 text-red-300 hover:bg-red-900/40 hover:text-red-200"
                      onClick={() => handleSubmit(lastInputValues)}
                    >
                      <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                      Retry
                    </Button>
                  )}
                </Alert>
              )}

              {/* Warnings */}
              {convertResult && !isRunning && (
                <ConversionWarnings
                  mappingReport={convertResult.mapping_report}
                  warnings={convertResult.warnings}
                />
              )}

              {/* Results Panel */}
              {(status === "success" || backtestResult) && !isRunning && (
                <ResultsPanel
                  status={backtestResult ? "success" : "idle"}
                  result={backtestResult}
                  error={null}
                  isTimedOut={false}
                  onCancel={() => {}}
                  initialCapital={lastInputValues?.initialCapital ?? 10000}
                  rangeStart=""
                  rangeEnd=""
                />
              )}

              {/* Parameters Panel */}
              {convertResult && !isRunning && hasParameters && (
                <ParametersPanel
                  parameters={strategyParameters}
                  values={parameterValues}
                  onChange={setParameterValues}
                  disabled={isRunning}
                />
              )}

              {/* Empty parameters hint */}
              {convertResult && !isRunning && convertResult.parameters && convertResult.parameters.length === 0 && (
                <ParametersPanel
                  parameters={[]}
                  values={{}}
                  onChange={() => {}}
                />
              )}

              {/* Code Review Panel */}
              {convertResult && !isRunning && (
                <CodeReviewPanel
                  pythonCode={convertResult.python_code}
                  mappingReport={convertResult.mapping_report}
                  isRunning={isRunning}
                  onRerun={handleRerun}
                  parametersValid={parametersValid}
                  canRerun={!!cacheId && !!lastInputValues}
                />
              )}

              {/* Save Section */}
              {backtestResult && convertResult && !isRunning && (
                <SaveConversionSection
                  onSave={handleSave}
                  defaultName={`${lastInputValues?.symbol ?? "Conversion"} ${new Date().toLocaleDateString()}`}
                />
              )}
            </div>
          </div>
        </TabsContent>

        {/* ── Tab: My Conversions ──────────────────────────────────────────── */}
        <TabsContent value="saves" className="mt-6">
          <div className="max-w-3xl">
            <SavedConversionsList
              conversions={savedConversions}
              loading={loadingSaves}
              onFetch={fetchSaves}
              onLoad={handleLoadConversion}
              onDelete={handleDelete}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
