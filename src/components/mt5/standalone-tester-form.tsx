"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Code2, FileCode, Loader2, Plus, RefreshCw, Trash2, Upload, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { useMt5TesterRun } from "@/hooks/use-mt5-tester-run";
import { Mt5ResultPanel } from "@/components/mql-converter/mt5-result-panel";
import { formatInt, formatPct, formatProfit } from "@/lib/mt5-format";

export interface TesterFormValues {
  expertName: string;
  symbol: string;
  timeframe: string;
  fromDate: string;
  toDate: string;
  model: string;
  parameters: Array<{ key: string; value: string }>;
}

const TIMEFRAMES = [
  { value: "1m", label: "M1" },
  { value: "5m", label: "M5" },
  { value: "15m", label: "M15" },
  { value: "30m", label: "M30" },
  { value: "1h", label: "H1" },
  { value: "4h", label: "H4" },
  { value: "1d", label: "D1" },
];

const MODELS = [
  { value: "EveryTickRealistic", label: "Every tick based on real ticks" },
  { value: "EveryTick", label: "Every tick" },
  { value: "ControlPoints", label: "Control points" },
  { value: "OpenPrices", label: "Open prices only" },
];

function normalizeExpertName(raw: string): string {
  let name = raw.trim();
  if (name.toLowerCase().startsWith("experts/")) name = name.slice(8);
  if (name.toLowerCase().endsWith(".ex5")) name = name.slice(0, -4);
  return name;
}

function sanitizeEaName(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_\-]/g, "_");
}

type EaSourceMode = "none" | "code" | "file";

interface StandaloneTesterFormProps {
  /** Applied once at mount. Parent uses `key` to force re-mount with new values. */
  initialValues?: TesterFormValues | null;
  onRunComplete?: () => void;
}

export function StandaloneTesterForm({
  initialValues,
  onRunComplete,
}: StandaloneTesterFormProps) {
  const mt5Run = useMt5TesterRun();

  // EA list (for Expert Name combobox)
  const [eaList, setEaList] = useState<string[]>([]);
  const [eaListLoading, setEaListLoading] = useState(false);
  const [eaPickerOpen, setEaPickerOpen] = useState(false);

  async function fetchEaList() {
    setEaListLoading(true);
    try {
      const res = await fetch("/api/mt5/ea/list");
      if (res.ok) {
        const data = await res.json() as { eas?: string[] };
        setEaList(data.eas ?? []);
      }
    } catch {
      // Bridge offline — silent fail, user can still type
    } finally {
      setEaListLoading(false);
    }
  }

  // Fetch on mount
  useEffect(() => { void fetchEaList(); }, []);

  // EA source state
  const [eaSourceMode, setEaSourceMode] = useState<EaSourceMode>("none");
  const [eaCode, setEaCode] = useState("");
  const [eaFile, setEaFile] = useState<File | null>(null);
  const [compileState, setCompileState] = useState<"idle" | "compiling" | "error">("idle");
  const [compileErrors, setCompileErrors] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialise from mount-time values — no effect needed.
  const [expertName, setExpertName] = useState(initialValues?.expertName ?? "");
  const [symbol, setSymbol] = useState(initialValues?.symbol ?? "");
  const [timeframe, setTimeframe] = useState(initialValues?.timeframe ?? "5m");
  const [fromDate, setFromDate] = useState(initialValues?.fromDate ?? "");
  const [toDate, setToDate] = useState(initialValues?.toDate ?? "");
  const [model, setModel] = useState(initialValues?.model ?? "EveryTickRealistic");
  const [parameters, setParameters] = useState<Array<{ key: string; value: string }>>(
    initialValues?.parameters ?? []
  );

  // Notify parent when run reaches a terminal state (callback, not setState).
  const onRunCompleteRef = useRef(onRunComplete);
  useEffect(() => {
    onRunCompleteRef.current = onRunComplete;
  });

  const prevPhaseRef = useRef(mt5Run.phase);
  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = mt5Run.phase;
    if (prev === mt5Run.phase) return;
    if (
      mt5Run.phase === "done" ||
      mt5Run.phase === "failed" ||
      mt5Run.phase === "cancelled"
    ) {
      onRunCompleteRef.current?.();
    }
  }, [mt5Run.phase]);

  const isInProgress = mt5Run.phase === "submitting" || mt5Run.phase === "polling";
  const isBusy = compileState === "compiling" || isInProgress;

  function handleSourceModeChange(mode: EaSourceMode) {
    setEaSourceMode(mode);
    setCompileErrors([]);
    setCompileState("idle");
    if (mode !== "file") {
      setEaFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
    if (mode !== "code") setEaCode("");
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setEaFile(file);
    if (file) {
      const baseName = file.name.replace(/\.mq5$/i, "");
      setExpertName(sanitizeEaName(baseName));
    }
    setCompileErrors([]);
    setCompileState("idle");
  }

  function addParameter() {
    setParameters((prev) => [...prev, { key: "", value: "" }]);
  }

  function removeParameter(idx: number) {
    setParameters((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateParameter(idx: number, field: "key" | "value", val: string) {
    setParameters((prev) =>
      prev.map((p, i) => (i === idx ? { ...p, [field]: val } : p))
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cleanName = normalizeExpertName(expertName);
    if (!cleanName || !symbol.trim() || !fromDate || !toDate) return;

    // Compile step — only when source code is provided
    if (eaSourceMode !== "none") {
      let mq5Content: string;
      if (eaSourceMode === "file") {
        if (!eaFile) return;
        mq5Content = await eaFile.text();
      } else {
        mq5Content = eaCode.trim();
        if (!mq5Content) return;
      }

      setCompileState("compiling");
      setCompileErrors([]);

      try {
        const deployRes = await fetch("/api/mt5/ea/deploy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ea_name: cleanName, mq5_content: mq5Content, source: "mt5_hub" }),
        });
        const deployData = await deployRes.json() as { status?: string; errors?: string[]; error?: string };

        if (!deployRes.ok) {
          setCompileState("error");
          setCompileErrors([deployData.error ?? "Deploy failed."]);
          return;
        }
        if (deployData.status === "compile_error") {
          setCompileState("error");
          setCompileErrors(deployData.errors?.length ? deployData.errors : ["Compilation failed — check your MQL5 code."]);
          return;
        }
        if (deployData.status === "timeout") {
          setCompileState("error");
          setCompileErrors(["Compilation timed out. Please try again."]);
          return;
        }
      } catch {
        setCompileState("error");
        setCompileErrors(["Connection error — could not reach the bridge."]);
        return;
      }

      setCompileState("idle");
    }

    const paramsObj = parameters.reduce<Record<string, string>>((acc, { key, value }) => {
      if (key.trim()) acc[key.trim()] = value;
      return acc;
    }, {});

    await mt5Run.startRun({
      expert_path: `${cleanName}.ex5`,
      expert_name: cleanName,
      symbol: symbol.trim(),
      timeframe,
      from_date: fromDate,
      to_date: toDate,
      parameters: paramsObj,
      model,
    });
  }

  const showResult = mt5Run.phase !== "idle";
  const hasDoneMetrics = mt5Run.phase === "done" && mt5Run.metrics;

  return (
    <div className="space-y-6">
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="space-y-5 rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-md"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Expert Name */}
          <div className="sm:col-span-2">
            <div className="mb-1 flex items-center justify-between">
              <Label htmlFor="expert-name" className="text-sm text-slate-300">
                Expert Name
              </Label>
              {eaSourceMode === "none" && (
                <button
                  type="button"
                  onClick={() => void fetchEaList()}
                  disabled={isBusy || eaListLoading}
                  className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300 disabled:opacity-40"
                  title="Refresh EA list"
                >
                  <RefreshCw className={`h-3 w-3 ${eaListLoading ? "animate-spin" : ""}`} />
                  Refresh
                </button>
              )}
            </div>
            {eaSourceMode === "none" && eaList.length > 0 ? (
              <Popover open={eaPickerOpen} onOpenChange={setEaPickerOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    disabled={isBusy}
                    className="flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm text-left shadow-sm hover:bg-accent disabled:opacity-50"
                  >
                    <span className={expertName ? "text-foreground" : "text-muted-foreground"}>
                      {expertName || "Select or type an EA name…"}
                    </span>
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandInput
                      placeholder="Search or type EA name…"
                      value={expertName}
                      onValueChange={setExpertName}
                    />
                    <CommandList>
                      <CommandEmpty>No matching EA — type to use a custom name.</CommandEmpty>
                      <CommandGroup>
                        {eaList.map((ea) => (
                          <CommandItem
                            key={ea}
                            value={ea}
                            onSelect={(val) => {
                              setExpertName(val);
                              setEaPickerOpen(false);
                            }}
                          >
                            <Check className={`mr-2 h-4 w-4 ${expertName === ea ? "opacity-100" : "opacity-0"}`} />
                            {ea}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            ) : (
              <Input
                id="expert-name"
                value={expertName}
                onChange={(e) => setExpertName(e.target.value)}
                placeholder={eaSourceMode === "none" ? "e.g. MyStrategy or Experts/MyStrategy.ex5" : "Name for the compiled EA file"}
                className="mt-1"
                disabled={isBusy}
                required
              />
            )}
            <p className="mt-1 text-[11px] text-slate-500">
              {eaSourceMode === "none"
                ? eaList.length > 0
                  ? "Select a compiled EA from your MT5 Experts folder, or type a name."
                  : "The EA must already be compiled in your MT5 Experts folder."
                : "Used as the EA filename when compiling."}
            </p>
          </div>

          {/* EA Source Section */}
          <div className="sm:col-span-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm text-slate-300">EA Source Code (optional)</Label>
              <div className="flex gap-1">
                {(["none", "code", "file"] as EaSourceMode[]).map((mode) => {
                  const icons = { none: null, code: <Code2 className="h-3.5 w-3.5" />, file: <Upload className="h-3.5 w-3.5" /> };
                  const labels = { none: "Existing", code: "Paste Code", file: "Upload .mq5" };
                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => handleSourceModeChange(mode)}
                      disabled={isBusy}
                      className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                        eaSourceMode === mode
                          ? "bg-blue-600 text-white"
                          : "border border-white/20 bg-white/5 text-slate-400 hover:bg-white/10"
                      }`}
                    >
                      {icons[mode]}
                      {labels[mode]}
                    </button>
                  );
                })}
              </div>
            </div>

            {eaSourceMode === "code" && (
              <div className="mt-2">
                <Textarea
                  value={eaCode}
                  onChange={(e) => setEaCode(e.target.value)}
                  placeholder="Paste your MQL5 EA code here..."
                  className="mt-1 h-48 font-mono text-xs"
                  disabled={isBusy}
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  The code will be compiled automatically before running. Expert Name above becomes the filename.
                </p>
              </div>
            )}

            {eaSourceMode === "file" && (
              <div className="mt-2">
                <label
                  className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 bg-white/5 p-6 text-center transition-colors hover:bg-white/10 ${isBusy ? "pointer-events-none opacity-50" : ""}`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".mq5"
                    onChange={handleFileChange}
                    className="sr-only"
                    disabled={isBusy}
                  />
                  {eaFile ? (
                    <div className="flex items-center gap-2 text-slate-300">
                      <FileCode className="h-5 w-5 text-blue-400" />
                      <span className="text-sm font-medium">{eaFile.name}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          setEaFile(null);
                          if (fileInputRef.current) fileInputRef.current.value = "";
                        }}
                        className="ml-1 text-slate-500 hover:text-slate-300"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <Upload className="h-6 w-6 text-slate-500" />
                      <p className="text-sm text-slate-400">Click to select a <span className="text-slate-300">.mq5</span> file</p>
                      <p className="text-[11px] text-slate-500">The Expert Name will be set from the filename automatically.</p>
                    </>
                  )}
                </label>
              </div>
            )}

            {compileState === "error" && compileErrors.length > 0 && (
              <div className="mt-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3">
                <p className="mb-1 text-xs font-semibold text-red-400">Compilation failed</p>
                {compileErrors.map((err, i) => (
                  <p key={i} className="text-xs text-red-300">{err}</p>
                ))}
              </div>
            )}
          </div>

          {/* Symbol */}
          <div>
            <Label htmlFor="symbol" className="text-sm text-slate-300">
              Symbol
            </Label>
            <Input
              id="symbol"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="e.g. XAUUSD+"
              className="mt-1"
              disabled={isBusy}
              required
            />
          </div>

          {/* Timeframe */}
          <div>
            <Label className="text-sm text-slate-300">Timeframe</Label>
            <Select value={timeframe} onValueChange={setTimeframe} disabled={isBusy}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEFRAMES.map((tf) => (
                  <SelectItem key={tf.value} value={tf.value}>
                    {tf.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* From Date */}
          <div>
            <Label htmlFor="from-date" className="text-sm text-slate-300">
              From Date
            </Label>
            <Input
              id="from-date"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="mt-1"
              disabled={isBusy}
              required
            />
          </div>

          {/* To Date */}
          <div>
            <Label htmlFor="to-date" className="text-sm text-slate-300">
              To Date
            </Label>
            <Input
              id="to-date"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="mt-1"
              disabled={isBusy}
              required
            />
          </div>

          {/* Model */}
          <div className="sm:col-span-2">
            <Label className="text-sm text-slate-300">Testing Model</Label>
            <Select value={model} onValueChange={setModel} disabled={isBusy}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODELS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Parameters */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <Label className="text-sm text-slate-300">Parameters (optional)</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addParameter}
              disabled={isBusy}
              className="border-white/20 bg-white/5 text-slate-300 hover:bg-white/10"
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add
            </Button>
          </div>
          {parameters.length === 0 && (
            <p className="text-xs text-slate-500">
              No parameters — the EA will use its default input values.
            </p>
          )}
          <div className="space-y-2">
            {parameters.map((param, idx) => (
              <div key={idx} className="flex gap-2">
                <Input
                  value={param.key}
                  onChange={(e) => updateParameter(idx, "key", e.target.value)}
                  placeholder="Parameter name"
                  className="flex-1 text-xs"
                  disabled={isBusy}
                />
                <Input
                  value={param.value}
                  onChange={(e) => updateParameter(idx, "value", e.target.value)}
                  placeholder="Value"
                  className="flex-1 text-xs"
                  disabled={isBusy}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => removeParameter(idx)}
                  disabled={isBusy}
                  className="shrink-0 border-white/20 bg-white/5 text-slate-400 hover:bg-white/10"
                  aria-label="Remove parameter"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>

        {/* Submit */}
        <div className="flex items-center gap-4 pt-1">
          <Button
            type="submit"
            disabled={
              isBusy ||
              !expertName.trim() ||
              !symbol.trim() ||
              !fromDate ||
              !toDate ||
              (eaSourceMode === "code" && !eaCode.trim()) ||
              (eaSourceMode === "file" && !eaFile)
            }
            className="bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {compileState === "compiling" ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Compiling…
              </>
            ) : isInProgress ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Running…
              </>
            ) : (
              "Run in MT5"
            )}
          </Button>
          {(showResult || compileState === "error") && !isBusy && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => { mt5Run.reset(); setCompileState("idle"); setCompileErrors([]); }}
              className="border-white/20 bg-white/5 text-slate-300 hover:bg-white/10"
            >
              Reset
            </Button>
          )}
        </div>
      </form>

      {/* Live status panel (shows progress, error, and queue state) */}
      {showResult && (
        <Mt5ResultPanel
          pythonResult={null}
          mt5Status={mt5Run.status}
          mt5Phase={mt5Run.phase}
          mt5Metrics={mt5Run.metrics}
          mt5ErrorMessage={mt5Run.errorMessage}
          mt5QueuePosition={mt5Run.queuePosition}
          mt5RunningElapsedSec={mt5Run.runningElapsedSec}
          pythonConversionId={null}
          mt5ConversionId={null}
        />
      )}

      {/* Final metrics card — standalone display without the Python comparison */}
      {hasDoneMetrics && (
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-md">
          <h3 className="mb-4 text-base font-semibold text-white">MT5 Results</h3>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {[
              {
                label: "Net Profit",
                value: formatProfit(mt5Run.metrics!.total_net_profit),
              },
              {
                label: "Sharpe Ratio",
                value:
                  mt5Run.metrics!.sharpe_ratio != null &&
                  Number.isFinite(mt5Run.metrics!.sharpe_ratio)
                    ? mt5Run.metrics!.sharpe_ratio.toFixed(2)
                    : "—",
              },
              {
                label: "Max Drawdown",
                value: formatPct(mt5Run.metrics!.max_drawdown_pct),
              },
              {
                label: "Profit Factor",
                value:
                  mt5Run.metrics!.profit_factor != null &&
                  Number.isFinite(mt5Run.metrics!.profit_factor)
                    ? mt5Run.metrics!.profit_factor.toFixed(2)
                    : "—",
              },
              {
                label: "Win Rate",
                value:
                  mt5Run.metrics!.total_trades &&
                  mt5Run.metrics!.total_trades > 0 &&
                  mt5Run.metrics!.won_trades != null
                    ? `${((mt5Run.metrics!.won_trades / mt5Run.metrics!.total_trades) * 100).toFixed(1)}%`
                    : "—",
              },
              {
                label: "Total Trades",
                value: formatInt(mt5Run.metrics!.total_trades),
              },
            ].map(({ label, value }) => (
              <div
                key={label}
                className="rounded-xl border border-white/10 bg-black/20 px-4 py-3"
              >
                <p className="text-xs text-slate-400">{label}</p>
                <p className="mt-1 text-base font-semibold text-slate-100">{value}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
