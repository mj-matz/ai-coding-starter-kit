"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

const TIMEFRAMES = ["M1", "M5", "M15", "M30", "H1", "H4", "D1"];

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

  // Initialise from mount-time values — no effect needed.
  const [expertName, setExpertName] = useState(initialValues?.expertName ?? "");
  const [symbol, setSymbol] = useState(initialValues?.symbol ?? "");
  const [timeframe, setTimeframe] = useState(initialValues?.timeframe ?? "M5");
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
            <Label htmlFor="expert-name" className="text-sm text-slate-300">
              Expert Name
            </Label>
            <Input
              id="expert-name"
              value={expertName}
              onChange={(e) => setExpertName(e.target.value)}
              placeholder="e.g. MyStrategy or Experts/MyStrategy.ex5"
              className="mt-1"
              disabled={isInProgress}
              required
            />
            <p className="mt-1 text-[11px] text-slate-500">
              The EA must already be compiled in your MT5 Experts folder.
            </p>
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
              disabled={isInProgress}
              required
            />
          </div>

          {/* Timeframe */}
          <div>
            <Label className="text-sm text-slate-300">Timeframe</Label>
            <Select value={timeframe} onValueChange={setTimeframe} disabled={isInProgress}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEFRAMES.map((tf) => (
                  <SelectItem key={tf} value={tf}>
                    {tf}
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
              disabled={isInProgress}
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
              disabled={isInProgress}
              required
            />
          </div>

          {/* Model */}
          <div className="sm:col-span-2">
            <Label className="text-sm text-slate-300">Testing Model</Label>
            <Select value={model} onValueChange={setModel} disabled={isInProgress}>
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
              disabled={isInProgress}
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
                  disabled={isInProgress}
                />
                <Input
                  value={param.value}
                  onChange={(e) => updateParameter(idx, "value", e.target.value)}
                  placeholder="Value"
                  className="flex-1 text-xs"
                  disabled={isInProgress}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => removeParameter(idx)}
                  disabled={isInProgress}
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
              isInProgress ||
              !expertName.trim() ||
              !symbol.trim() ||
              !fromDate ||
              !toDate
            }
            className="bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {isInProgress ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Running…
              </>
            ) : (
              "Run in MT5"
            )}
          </Button>
          {showResult && !isInProgress && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => mt5Run.reset()}
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
