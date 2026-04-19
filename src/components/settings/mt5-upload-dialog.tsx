"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  FileUp,
  Loader2,
  RotateCcw,
  Upload,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

import { AssetCombobox } from "@/components/backtest/asset-combobox";
import {
  BROKER_TIMEZONES,
  CsvParseError,
  MT5_MAX_FILE_SIZE_BYTES,
  MT5_TIMEFRAMES,
  formatMt5DateTime,
  parseMt5Csv,
  type BrokerTimezone,
  type CsvParseResult,
  type Mt5Timeframe,
} from "@/lib/mt5-data-types";
import type { Mt5UploadRequest, Mt5UploadResponse } from "@/lib/mt5-data-types";
import { cn } from "@/lib/utils";

// ── Props ───────────────────────────────────────────────────────────────────

interface Mt5UploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existsForAsset: (asset: string, timeframe: Mt5Timeframe) => boolean;
  onUpload: (req: Mt5UploadRequest) => Promise<Mt5UploadResponse>;
  /** Pre-fill asset + timeframe when opening dialog (e.g. from MQL Converter). */
  initialAsset?: string;
  initialTimeframe?: Mt5Timeframe;
  onUploadSuccess?: (result: Mt5UploadResponse) => void;
}

type Step = "file" | "configure" | "preview" | "conflict" | "uploading" | "done";

// ── Component ───────────────────────────────────────────────────────────────

export function Mt5UploadDialog({
  open,
  onOpenChange,
  existsForAsset,
  onUpload,
  initialAsset,
  initialTimeframe,
  onUploadSuccess,
}: Mt5UploadDialogProps) {
  const [step, setStep] = useState<Step>("file");
  const [file, setFile] = useState<File | null>(null);
  const [parseResult, setParseResult] = useState<CsvParseResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parseHint, setParseHint] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);

  const [asset, setAsset] = useState(initialAsset ?? "");
  const [timeframe, setTimeframe] = useState<Mt5Timeframe>(initialTimeframe ?? "1m");
  const [brokerTimezone, setBrokerTimezone] = useState<BrokerTimezone>("Europe/Athens");
  const [conflictResolution, setConflictResolution] = useState<"merge" | "replace">("merge");
  const [rawFileText, setRawFileText] = useState<string | null>(null);

  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadedDataset, setUploadedDataset] = useState<Mt5UploadResponse | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset when dialog closes
  useEffect(() => {
    if (!open) {
      // Delay reset so close animation doesn't flicker UI
      const timer = setTimeout(() => {
        setStep("file");
        setFile(null);
        setParseResult(null);
        setParseError(null);
        setParseHint(null);
        setIsParsing(false);
        setAsset(initialAsset ?? "");
        setTimeframe(initialTimeframe ?? "1m");
        setBrokerTimezone("Europe/Athens");
        setConflictResolution("merge");
        setRawFileText(null);
        setUploadError(null);
        setUploadedDataset(null);
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [open, initialAsset, initialTimeframe]);

  // ── File handling ─────────────────────────────────────────────────────────

  const handleFile = useCallback(async (selected: File) => {
    setFile(selected);
    setParseError(null);
    setParseHint(null);
    setParseResult(null);

    if (selected.size > MT5_MAX_FILE_SIZE_BYTES) {
      setParseError("File too large. Max 50 MB. Split into multiple files by year.");
      return;
    }
    const lower = selected.name.toLowerCase();
    if (!lower.endsWith(".csv") && !lower.endsWith(".txt")) {
      setParseError("Please select a CSV or TXT file exported from MT5 History Center.");
      return;
    }

    setIsParsing(true);
    try {
      const text = await selected.text();
      // Parse with UTC for initial validation and row-count display.
      // The actual timezone conversion is applied when the user clicks Continue.
      const parsed = parseMt5Csv(text, "UTC");
      setRawFileText(text);
      setParseResult(parsed);
      setStep("configure");
    } catch (err) {
      if (err instanceof CsvParseError) {
        setParseError(err.message);
        setParseHint(err.hint ?? null);
      } else {
        setParseError(err instanceof Error ? err.message : "Could not parse file.");
      }
    } finally {
      setIsParsing(false);
    }
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void handleFile(f);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void handleFile(f);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  // ── Navigation ────────────────────────────────────────────────────────────

  const handleGoToPreview = () => {
    if (!rawFileText || !asset) return;

    // Re-parse with the selected broker timezone to apply correct UTC conversion.
    const finalParsed = parseMt5Csv(rawFileText, brokerTimezone);
    setParseResult(finalParsed);

    if (existsForAsset(asset, timeframe)) {
      setStep("conflict");
    } else {
      setStep("preview");
    }
  };

  const handleResolveConflict = () => {
    setStep("preview");
  };

  const handleBack = () => {
    if (step === "configure") setStep("file");
    else if (step === "conflict") setStep("configure");
    else if (step === "preview") {
      if (existsForAsset(asset, timeframe)) setStep("conflict");
      else setStep("configure");
    }
  };

  // ── Upload ────────────────────────────────────────────────────────────────

  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);

  const handleUpload = async () => {
    if (!parseResult || !asset) return;

    setStep("uploading");
    setUploadError(null);
    setUploadProgress(null);

    const CHUNK_SIZE = 20_000;
    const candles = parseResult.candles;
    const totalChunks = Math.ceil(candles.length / CHUNK_SIZE);
    const hasExisting = existsForAsset(asset, timeframe);

    let lastResponse: Mt5UploadResponse | null = null;

    try {
      for (let i = 0; i < totalChunks; i++) {
        setUploadProgress({ current: i + 1, total: totalChunks });
        const chunk = candles.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);

        // First chunk: use user-selected conflict resolution (if dataset exists)
        // Subsequent chunks: always merge into the dataset created by the first chunk
        const conflict_resolution =
          i === 0
            ? hasExisting
              ? conflictResolution
              : undefined
            : "merge";

        lastResponse = await onUpload({
          asset,
          timeframe,
          candles: chunk,
          broker_timezone: brokerTimezone,
          conflict_resolution,
        });
      }

      setUploadedDataset(lastResponse!);
      setStep("done");
      onUploadSuccess?.(lastResponse!);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed.");
      setStep("preview");
    } finally {
      setUploadProgress(null);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const canProceedToPreview = !!parseResult && !!asset;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-white/10 bg-[#0d0f14] text-white sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white">Upload MT5 Market Data</DialogTitle>
          <DialogDescription className="text-slate-400">
            Import an OHLCV CSV exported from the MT5 History Center.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Step 1: File selection */}
          {step === "file" && (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                className={cn(
                  "flex w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors",
                  isDragging
                    ? "border-blue-500 bg-blue-500/10"
                    : "border-white/15 bg-white/5 hover:border-white/30 hover:bg-white/10"
                )}
                aria-label="Choose or drop MT5 CSV file"
              >
                {isParsing ? (
                  <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
                ) : (
                  <FileUp className="h-8 w-8 text-slate-400" />
                )}
                <div>
                  <p className="text-sm font-medium text-slate-200">
                    {isParsing
                      ? "Parsing file..."
                      : "Drop CSV here or click to browse"}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Max 50 MB. Supports semicolon- or comma-separated MT5 exports.
                  </p>
                </div>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.txt,text/csv"
                className="hidden"
                onChange={handleFileInput}
                aria-hidden
              />

              {parseError && (
                <Alert
                  variant="destructive"
                  className="border-red-900/50 bg-red-950/30 text-red-300"
                >
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Could not read file</AlertTitle>
                  <AlertDescription className="mt-1 text-red-300/80">
                    <p>{parseError}</p>
                    {parseHint && (
                      <p className="mt-1 text-xs text-red-300/70">{parseHint}</p>
                    )}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}

          {/* Step 2: Configure */}
          {step === "configure" && parseResult && file && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                <div className="min-w-0 flex-1 text-xs text-emerald-300/90">
                  <p className="truncate font-medium">{file.name}</p>
                  <p className="mt-0.5 text-emerald-400/70">
                    {parseResult.total_rows.toLocaleString()} candles detected
                    {" - "}
                    format: {parseResult.detected_date_format}
                    {", "}
                    delimiter: {parseResult.detected_delimiter === ";" ? "semicolon" : parseResult.detected_delimiter === "\t" ? "tab" : "comma"}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-slate-300">Asset</Label>
                <AssetCombobox value={asset} onChange={setAsset} />
                <p className="text-xs text-slate-500">
                  Choose the internal instrument the MT5 symbol maps to (broker suffixes are ignored).
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="mt5-timeframe" className="text-slate-300">
                  Timeframe
                </Label>
                <Select value={timeframe} onValueChange={(v) => setTimeframe(v as Mt5Timeframe)}>
                  <SelectTrigger
                    id="mt5-timeframe"
                    className="border-white/10 bg-black/20 text-gray-100"
                    aria-label="Select MT5 data timeframe"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-white/10 bg-[#0d0f14]">
                    {MT5_TIMEFRAMES.map((t) => (
                      <SelectItem
                        key={t.value}
                        value={t.value}
                        className="text-gray-100 focus:bg-white/10 focus:text-white"
                      >
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="mt5-broker-tz" className="text-slate-300">
                  Broker server timezone
                </Label>
                <Select value={brokerTimezone} onValueChange={(v) => setBrokerTimezone(v as BrokerTimezone)}>
                  <SelectTrigger
                    id="mt5-broker-tz"
                    className="border-white/10 bg-black/20 text-gray-100"
                    aria-label="Select broker server timezone"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-white/10 bg-[#0d0f14]">
                    {BROKER_TIMEZONES.map((tz) => (
                      <SelectItem
                        key={tz.value}
                        value={tz.value}
                        className="text-gray-100 focus:bg-white/10 focus:text-white"
                      >
                        {tz.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-slate-500">
                  MT5 exports candles in broker server time. Select your broker&apos;s clock timezone so timestamps are correctly converted to UTC.
                </p>
              </div>
            </div>
          )}

          {/* Step 3: Conflict resolution */}
          {step === "conflict" && parseResult && (
            <div className="space-y-4">
              <Alert className="border-amber-500/30 bg-amber-500/5 text-amber-200">
                <AlertCircle className="h-4 w-4 text-amber-400" />
                <AlertTitle className="text-amber-300">
                  Data for {asset} {timeframe} already exists
                </AlertTitle>
                <AlertDescription className="mt-1 text-amber-300/80">
                  Choose how to handle the overlap with the existing dataset.
                </AlertDescription>
              </Alert>

              <RadioGroup
                value={conflictResolution}
                onValueChange={(v) => setConflictResolution(v as "merge" | "replace")}
                className="space-y-2"
              >
                <label
                  htmlFor="mt5-merge"
                  className={cn(
                    "flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors",
                    conflictResolution === "merge"
                      ? "border-blue-500/50 bg-blue-500/10"
                      : "border-white/10 bg-white/5 hover:border-white/20"
                  )}
                >
                  <RadioGroupItem value="merge" id="mt5-merge" className="mt-0.5 border-gray-600 text-blue-500" />
                  <div>
                    <p className="text-sm font-medium text-slate-200">Merge</p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      Add new candles, keep existing ones. Duplicates are skipped.
                    </p>
                  </div>
                </label>
                <label
                  htmlFor="mt5-replace"
                  className={cn(
                    "flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors",
                    conflictResolution === "replace"
                      ? "border-red-500/50 bg-red-500/10"
                      : "border-white/10 bg-white/5 hover:border-white/20"
                  )}
                >
                  <RadioGroupItem value="replace" id="mt5-replace" className="mt-0.5 border-gray-600 text-red-500" />
                  <div>
                    <p className="text-sm font-medium text-slate-200">Replace</p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      Delete the existing dataset completely and upload the new one.
                    </p>
                  </div>
                </label>
              </RadioGroup>
            </div>
          )}

          {/* Step 4: Preview */}
          {step === "preview" && parseResult && (
            <div className="space-y-3">
              <div className="rounded-lg border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Preview</p>
                <dl className="mt-3 space-y-2 text-sm">
                  <Row label="Asset" value={asset} />
                  <Row label="Timeframe" value={timeframe.toUpperCase()} />
                  <Row label="Broker timezone" value={BROKER_TIMEZONES.find((t) => t.value === brokerTimezone)?.label ?? brokerTimezone} />
                  <Row
                    label="Candles"
                    value={parseResult.total_rows.toLocaleString()}
                  />
                  <Row
                    label="Range"
                    value={`${formatMt5DateTime(parseResult.first_timestamp)} - ${formatMt5DateTime(parseResult.last_timestamp)}`}
                  />
                  <Row
                    label="Extra columns"
                    value={[
                      parseResult.has_tick_volume ? "TickVol" : null,
                      parseResult.has_volume ? "Volume" : null,
                      parseResult.has_spread ? "Spread" : null,
                    ]
                      .filter(Boolean)
                      .join(", ") || "none"}
                  />
                  {existsForAsset(asset, timeframe) && (
                    <Row
                      label="Conflict"
                      value={
                        conflictResolution === "merge"
                          ? "Merge with existing dataset"
                          : "Replace existing dataset"
                      }
                    />
                  )}
                </dl>
              </div>

              {uploadError && (
                <Alert
                  variant="destructive"
                  className="border-red-900/50 bg-red-950/30 text-red-300"
                >
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Upload failed</AlertTitle>
                  <AlertDescription className="mt-1 text-red-300/80">
                    {uploadError}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}

          {/* Step 5: Uploading */}
          {step === "uploading" && (
            <div className="flex items-center justify-center gap-3 py-10 text-slate-300">
              <Loader2 className="h-5 w-5 animate-spin text-blue-400" />
              <span className="text-sm">
                {uploadProgress && uploadProgress.total > 1
                  ? `Uploading chunk ${uploadProgress.current} / ${uploadProgress.total}...`
                  : "Uploading candles to Supabase..."}
              </span>
            </div>
          )}

          {/* Step 6: Done */}
          {step === "done" && uploadedDataset && (
            <div className="space-y-3 py-2">
              <div className="flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
                <div className="text-sm text-emerald-200">
                  <p className="font-medium">Upload complete</p>
                  <p className="mt-1 text-emerald-300/80">
                    {uploadedDataset.dataset.candle_count.toLocaleString()} candles stored for{" "}
                    {uploadedDataset.dataset.asset} {uploadedDataset.dataset.timeframe.toUpperCase()}.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <div>
            {(step === "configure" || step === "conflict" || step === "preview") && (
              <Button
                type="button"
                variant="ghost"
                onClick={handleBack}
                className="text-slate-400 hover:text-white"
              >
                Back
              </Button>
            )}
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            {step === "file" && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="mr-1.5 h-4 w-4" />
                Cancel
              </Button>
            )}

            {step === "configure" && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setFile(null);
                    setParseResult(null);
                    setStep("file");
                  }}
                  className="border-white/20 bg-white/5 text-slate-300 hover:bg-white/10"
                >
                  <RotateCcw className="mr-1.5 h-4 w-4" />
                  Choose different file
                </Button>
                <Button
                  type="button"
                  disabled={!canProceedToPreview}
                  onClick={handleGoToPreview}
                  className="bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40"
                >
                  Continue
                </Button>
              </>
            )}

            {step === "conflict" && (
              <Button
                type="button"
                onClick={handleResolveConflict}
                className="bg-blue-600 text-white hover:bg-blue-500"
              >
                Continue
              </Button>
            )}

            {step === "preview" && (
              <Button
                type="button"
                onClick={handleUpload}
                className="bg-blue-600 text-white hover:bg-blue-500"
              >
                <Upload className="mr-1.5 h-4 w-4" />
                Upload {(parseResult?.total_rows ?? 0).toLocaleString()} candles
              </Button>
            )}

            {step === "done" && (
              <Button
                type="button"
                onClick={() => onOpenChange(false)}
                className="bg-blue-600 text-white hover:bg-blue-500"
              >
                Done
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Helper ──────────────────────────────────────────────────────────────────

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-200">{value}</dd>
    </div>
  );
}
