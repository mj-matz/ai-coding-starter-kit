"use client";

import { useState, useEffect, useMemo } from "react";
import { Loader2, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

import { AssetCombobox } from "@/components/backtest/asset-combobox";
import type { MqlVersion } from "@/hooks/use-mql-converter";

// ── MQL version auto-detection ──────────────────────────────────────────────

const MQL5_INDICATORS = [
  "CTrade", "CPositionInfo", "COrderInfo", "CDealInfo",
  "PositionSelect", "PositionGetDouble", "PositionGetInteger", "PositionGetString",
  "OrderGetDouble", "OrderGetInteger", "OnTradeTransaction",
  "ENUM_POSITION_TYPE", "ENUM_ORDER_TYPE", "ENUM_DEAL_TYPE",
];

function detectMqlVersion(code: string): "mql4" | "mql5" {
  for (const indicator of MQL5_INDICATORS) {
    if (code.includes(indicator)) return "mql5";
  }
  return "mql4";
}

// ── MQL keyword validation ──────────────────────────────────────────────────

const MQL_KEYWORDS = ["OnTick", "OrderSend", "#property"];

function looksLikeMqlCode(code: string): boolean {
  return MQL_KEYWORDS.some((kw) => code.includes(kw));
}

// ── Timeframes ──────────────────────────────────────────────────────────────

const TIMEFRAMES = [
  { value: "1m", label: "1 minute" },
  { value: "5m", label: "5 minutes" },
  { value: "15m", label: "15 minutes" },
  { value: "30m", label: "30 minutes" },
  { value: "1h", label: "1 hour" },
  { value: "4h", label: "4 hours" },
  { value: "1d", label: "1 day" },
];

// ── Props ───────────────────────────────────────────────────────────────────

export interface MqlInputValues {
  mqlCode: string;
  mqlVersion: MqlVersion;
  symbol: string;
  timeframe: string;
  startDate: string;
  endDate: string;
  initialCapital: number;
  sizingMode: "risk_percent" | "fixed_lot";
  riskPercent: number;
  fixedLot: number;
  commission: number;
  slippage: number;
}

interface MqlInputPanelProps {
  onSubmit: (values: MqlInputValues) => void;
  isRunning: boolean;
  initialMqlCode?: string;
  initialMqlVersion?: MqlVersion;
}

export function MqlInputPanel({
  onSubmit,
  isRunning,
  initialMqlCode = "",
  initialMqlVersion = "auto",
}: MqlInputPanelProps) {
  const [mqlCode, setMqlCode] = useState(initialMqlCode);
  const [mqlVersion, setMqlVersion] = useState<MqlVersion>(initialMqlVersion);
  const [symbol, setSymbol] = useState("XAUUSD");
  const [timeframe, setTimeframe] = useState("1m");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [initialCapital, setInitialCapital] = useState(10000);
  const [sizingMode, setSizingMode] = useState<"risk_percent" | "fixed_lot">("risk_percent");
  const [riskPercent, setRiskPercent] = useState(1.0);
  const [fixedLot, setFixedLot] = useState(0.1);
  const [commission, setCommission] = useState(0);
  const [slippage, setSlippage] = useState(0);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Auto-detect MQL version when selector is on "auto"
  const detectedVersion = useMemo<"mql4" | "mql5">(() => {
    if (mqlVersion !== "auto" || !mqlCode.trim()) return "mql4";
    return detectMqlVersion(mqlCode);
  }, [mqlCode, mqlVersion]);

  // Sync state when preloaded values change (e.g., loading a saved conversion)
  useEffect(() => {
    if (initialMqlCode) setMqlCode(initialMqlCode);
  }, [initialMqlCode]);

  useEffect(() => {
    setMqlVersion(initialMqlVersion);
  }, [initialMqlVersion]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setValidationError(null);

    // Validate MQL code
    if (!mqlCode.trim()) {
      setValidationError("Please paste your MQL code.");
      return;
    }

    if (!looksLikeMqlCode(mqlCode)) {
      setValidationError(
        "This does not appear to be MQL code. The code should contain at least one of: OnTick, OrderSend, or #property."
      );
      return;
    }

    // Validate dates
    if (!startDate || !endDate) {
      setValidationError("Please select a start and end date.");
      return;
    }

    if (new Date(endDate) <= new Date(startDate)) {
      setValidationError("End date must be after start date.");
      return;
    }

    onSubmit({
      mqlCode,
      mqlVersion: mqlVersion === "auto" ? detectedVersion : mqlVersion,
      symbol,
      timeframe,
      startDate,
      endDate,
      initialCapital,
      sizingMode,
      riskPercent,
      fixedLot,
      commission,
      slippage,
    });
  }

  return (
    <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-3xl p-6">
      <h2 className="text-lg font-semibold text-white mb-6">MQL Code Input</h2>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* MQL Code Textarea */}
        <div className="space-y-2">
          <Label htmlFor="mql-code" className="text-gray-300">
            Expert Adviser Code
          </Label>
          <Textarea
            id="mql-code"
            value={mqlCode}
            onChange={(e) => setMqlCode(e.target.value)}
            placeholder="Paste your MQL4 or MQL5 Expert Adviser code here..."
            className="min-h-[240px] max-h-[480px] resize-y border-white/10 bg-black/20 font-mono text-sm text-gray-100 rounded-lg placeholder:text-gray-600"
            aria-label="MQL Expert Adviser code input"
            disabled={isRunning}
          />
          <p className="text-xs text-gray-500">
            Max 50,000 characters. Large EAs (&gt;400 lines) may produce less accurate conversions.
          </p>
        </div>

        {/* MQL Version */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="mql-version" className="text-gray-300">
              MQL Version
            </Label>
            {mqlVersion === "auto" && mqlCode.trim() && (
              <span className="rounded-full bg-blue-900/40 px-2 py-0.5 text-xs text-blue-300">
                Detected: {detectedVersion.toUpperCase()}
              </span>
            )}
          </div>
          <Select
            value={mqlVersion}
            onValueChange={(v) => setMqlVersion(v as MqlVersion)}
            disabled={isRunning}
          >
            <SelectTrigger
              id="mql-version"
              className="border-white/10 bg-black/20 text-gray-100 rounded-lg"
              aria-label="Select MQL version"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-white/10 bg-[#0d0f14]">
              <SelectItem value="auto" className="text-gray-100 focus:bg-white/10 focus:text-white">
                Auto-detect
              </SelectItem>
              <SelectItem value="mql4" className="text-gray-100 focus:bg-white/10 focus:text-white">
                MQL4
              </SelectItem>
              <SelectItem value="mql5" className="text-gray-100 focus:bg-white/10 focus:text-white">
                MQL5
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Separator className="bg-white/10" />

        {/* Asset & Timeframe */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-gray-300">Asset</Label>
            <AssetCombobox
              value={symbol}
              onChange={setSymbol}
              disabled={isRunning}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="timeframe" className="text-gray-300">
              Timeframe
            </Label>
            <Select
              value={timeframe}
              onValueChange={setTimeframe}
              disabled={isRunning}
            >
              <SelectTrigger
                id="timeframe"
                className="border-white/10 bg-black/20 text-gray-100 rounded-lg"
                aria-label="Select timeframe"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-white/10 bg-[#0d0f14]">
                {TIMEFRAMES.map((t) => (
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
        </div>

        {/* Date Range */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="start-date" className="text-gray-300">
              Start Date
            </Label>
            <Input
              id="start-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="border-white/10 bg-black/20 text-gray-100 rounded-lg"
              aria-label="Start date"
              disabled={isRunning}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="end-date" className="text-gray-300">
              End Date
            </Label>
            <Input
              id="end-date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="border-white/10 bg-black/20 text-gray-100 rounded-lg"
              aria-label="End date"
              disabled={isRunning}
            />
          </div>
        </div>

        <Separator className="bg-white/10" />

        {/* Capital & Sizing */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-gray-400">Capital & Position Sizing</h3>

          <div className="space-y-2">
            <Label htmlFor="initial-capital" className="text-gray-300">
              Initial Capital
            </Label>
            <Input
              id="initial-capital"
              type="number"
              step="100"
              value={initialCapital}
              onChange={(e) => setInitialCapital(Number(e.target.value))}
              className="border-white/10 bg-black/20 text-gray-100 rounded-lg"
              aria-label="Initial capital"
              disabled={isRunning}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-gray-300">Sizing Mode</Label>
              <RadioGroup
                value={sizingMode}
                onValueChange={(v) => setSizingMode(v as "risk_percent" | "fixed_lot")}
                className="flex gap-4 pt-2"
                aria-label="Position sizing mode"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem
                    value="risk_percent"
                    id="mql-sizing-risk"
                    className="border-gray-600 text-blue-500"
                  />
                  <Label htmlFor="mql-sizing-risk" className="cursor-pointer text-gray-300">
                    Risk %
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem
                    value="fixed_lot"
                    id="mql-sizing-lot"
                    className="border-gray-600 text-blue-500"
                  />
                  <Label htmlFor="mql-sizing-lot" className="cursor-pointer text-gray-300">
                    Fixed Lot
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {sizingMode === "risk_percent" ? (
              <div className="space-y-2">
                <Label htmlFor="risk-percent" className="text-gray-300">
                  Risk per Trade (%)
                </Label>
                <Input
                  id="risk-percent"
                  type="number"
                  step="0.01"
                  min="0.01"
                  max="100"
                  value={riskPercent}
                  onChange={(e) => setRiskPercent(Number(e.target.value))}
                  className="border-white/10 bg-black/20 text-gray-100 rounded-lg"
                  aria-label="Risk percent per trade"
                  disabled={isRunning}
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="fixed-lot" className="text-gray-300">
                  Lot Size
                </Label>
                <Input
                  id="fixed-lot"
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={fixedLot}
                  onChange={(e) => setFixedLot(Number(e.target.value))}
                  className="border-white/10 bg-black/20 text-gray-100 rounded-lg"
                  aria-label="Fixed lot size"
                  disabled={isRunning}
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="mql-commission" className="text-gray-300">
                Commission (per lot)
              </Label>
              <Input
                id="mql-commission"
                type="number"
                step="0.01"
                min="0"
                value={commission}
                onChange={(e) => setCommission(Number(e.target.value))}
                className="border-white/10 bg-black/20 text-gray-100 rounded-lg"
                aria-label="Commission per lot"
                disabled={isRunning}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="mql-slippage" className="text-gray-300">
                Slippage (pips)
              </Label>
              <Input
                id="mql-slippage"
                type="number"
                step="0.1"
                min="0"
                value={slippage}
                onChange={(e) => setSlippage(Number(e.target.value))}
                className="border-white/10 bg-black/20 text-gray-100 rounded-lg"
                aria-label="Slippage in pips"
                disabled={isRunning}
              />
            </div>
          </div>
        </div>

        {/* Validation Error */}
        {validationError && (
          <p className="text-sm text-red-400" role="alert">
            {validationError}
          </p>
        )}

        {/* Submit */}
        <Button
          type="submit"
          disabled={isRunning}
          className="w-full bg-blue-600 text-white hover:bg-blue-700 shadow-md disabled:opacity-50"
          aria-label="Convert and run backtest"
        >
          {isRunning ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Processing...
            </>
          ) : (
            <>
              <Play className="mr-2 h-4 w-4" />
              Convert & Backtest
            </>
          )}
        </Button>
      </form>
    </div>
  );
}
