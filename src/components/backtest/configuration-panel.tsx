"use client";

import { useEffect, useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Play, ChevronDown, ChevronRight, HelpCircle } from "lucide-react";

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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

import { DynamicParamForm, buildDefaultParams } from "@/components/backtest/dynamic-param-form";
import { AssetCombobox } from "@/components/backtest/asset-combobox";

import {
  backtestFormSchema,
  defaultFormValues,
  loadConfigFromStorage,
  saveConfigToStorage,
  type BacktestFormValues,
} from "@/lib/backtest-types";
import { useStrategies } from "@/hooks/use-strategies";
import { cn } from "@/lib/utils";

interface ConfigurationPanelProps {
  onSubmit: (config: BacktestFormValues) => void;
  isRunning: boolean;
  preloadConfig?: BacktestFormValues;
}

const TIMEFRAMES = [
  { value: "1m", label: "1 minute" },
  { value: "2m", label: "2 minutes" },
  { value: "3m", label: "3 minutes" },
  { value: "5m", label: "5 minutes" },
  { value: "15m", label: "15 minutes" },
  { value: "30m", label: "30 minutes" },
  { value: "1h", label: "1 hour" },
  { value: "4h", label: "4 hours" },
  { value: "1d", label: "1 day" },
];

export function ConfigurationPanel({
  onSubmit,
  isRunning,
  preloadConfig,
}: ConfigurationPanelProps) {
  const { strategies, isLoading: strategiesLoading } = useStrategies();
  const [engineAdvancedOpen, setEngineAdvancedOpen] = useState(false);

  const form = useForm<BacktestFormValues>({
    resolver: zodResolver(backtestFormSchema) as Resolver<BacktestFormValues>,
    defaultValues: defaultFormValues,
  });

  const sizingMode = form.watch("sizingMode");
  const selectedStrategyId = form.watch("strategy");
  const selectedStrategy = strategies.find((s) => s.id === selectedStrategyId);

  // Restore config: preloadConfig (from URL) takes priority over localStorage
  useEffect(() => {
    if (preloadConfig) {
      form.reset(preloadConfig);
      return;
    }
    const saved = loadConfigFromStorage();
    if (saved) {
      form.reset(saved);
    }
  }, [form, preloadConfig]);

  // Auto-save config to localStorage on every field change
  useEffect(() => {
    const subscription = form.watch((values) => {
      if (values.strategy) {
        saveConfigToStorage(values as BacktestFormValues);
      }
    });
    return () => subscription.unsubscribe();
  }, [form]);

  // Save config on page unload as a fallback
  useEffect(() => {
    function handleBeforeUnload() {
      const values = form.getValues();
      saveConfigToStorage(values);
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [form]);

  // When strategy changes, reset strategyParams to the new strategy's defaults
  function handleStrategyChange(strategyId: string) {
    form.setValue("strategy", strategyId);
    const strategy = strategies.find((s) => s.id === strategyId);
    if (strategy) {
      form.setValue("strategyParams", buildDefaultParams(strategy.parameters_schema));
    }
  }

  function handleSubmit(values: BacktestFormValues) {
    saveConfigToStorage(values);
    onSubmit(values);
  }

  return (
    <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-3xl p-6">
      <h2 className="text-lg font-semibold text-white mb-6">Backtest Configuration</h2>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">

          {/* Strategy & Asset */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Strategy selector */}
            <div className="space-y-1">
              <FormField
                control={form.control}
                name="strategy"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center gap-1.5">
                      <FormLabel className="text-gray-300">Strategy</FormLabel>
                      {selectedStrategy && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <HelpCircle className="h-3.5 w-3.5 text-gray-500 cursor-pointer hover:text-gray-300 transition-colors" />
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs text-xs" side="right">
                              {selectedStrategy.description}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                    <Select
                      onValueChange={handleStrategyChange}
                      value={field.value}
                      disabled={strategiesLoading}
                    >
                      <FormControl>
                        <SelectTrigger
                          className="border-white/10 bg-black/20 text-gray-100 rounded-lg [&>span]:flex-1 [&>span]:text-left"
                          aria-label="Select strategy"
                        >
                          {strategiesLoading ? (
                            <span className="flex items-center gap-2 text-gray-500">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              Loading…
                            </span>
                          ) : (
                            <SelectValue placeholder="Select strategy" />
                          )}
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="border-white/10 bg-[#0d0f14]">
                        {strategies.map((s) => (
                          <SelectItem
                            key={s.id}
                            value={s.id}
                            className="text-gray-100 focus:bg-white/10 focus:text-white"
                          >
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="symbol"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-300">Asset</FormLabel>
                  <FormControl>
                    <AssetCombobox
                      value={field.value}
                      onChange={field.onChange}
                      disabled={isRunning}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {/* Timeframe & Date Range */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormField
              control={form.control}
              name="timeframe"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-300">Timeframe</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger
                        className="border-white/10 bg-black/20 text-gray-100 rounded-lg"
                        aria-label="Select timeframe"
                      >
                        <SelectValue placeholder="Select timeframe" />
                      </SelectTrigger>
                    </FormControl>
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
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="startDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-300">Start Date</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="date"
                      className="border-white/10 bg-black/20 text-gray-100 rounded-lg"
                      aria-label="Start date"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="endDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-300">End Date</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="date"
                      className="border-white/10 bg-black/20 text-gray-100 rounded-lg"
                      aria-label="End date"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <Separator className="bg-white/10" />

          {/* Strategy Parameters (schema-driven) */}
          <div>
            <h3 className="mb-3 text-sm font-medium text-gray-400">Strategy Parameters</h3>
            {selectedStrategy ? (
              <DynamicParamForm
                schema={selectedStrategy.parameters_schema}
                form={form}
              />
            ) : strategiesLoading ? (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading parameters…
              </div>
            ) : (
              <p className="text-sm text-gray-500">Select a strategy to configure parameters.</p>
            )}
          </div>

          <Separator className="bg-white/10" />

          {/* Engine Parameters (collapsible) */}
          <Collapsible open={engineAdvancedOpen} onOpenChange={setEngineAdvancedOpen}>
            <CollapsibleTrigger className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors">
              {engineAdvancedOpen ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              Engine Parameters
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 space-y-4">
              {/* Trading Days */}
              <FormField
                control={form.control}
                name="tradingDays"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-gray-300">Trading Days</FormLabel>
                    <FormControl>
                      <div className="flex gap-1.5">
                        {(
                          [
                            { label: "Mo", value: 0 },
                            { label: "Di", value: 1 },
                            { label: "Mi", value: 2 },
                            { label: "Do", value: 3 },
                            { label: "Fr", value: 4 },
                          ] as const
                        ).map((day) => {
                          const selected = (field.value as number[]).includes(day.value);
                          return (
                            <button
                              key={day.value}
                              type="button"
                              onClick={() => {
                                const current = field.value as number[];
                                if (selected) {
                                  if (current.length > 1) {
                                    field.onChange(current.filter((d) => d !== day.value));
                                  }
                                } else {
                                  field.onChange([...current, day.value].sort((a, b) => a - b));
                                }
                              }}
                              aria-pressed={selected}
                              className={cn(
                                "flex-1 rounded-md py-1.5 text-xs font-medium transition-colors",
                                selected
                                  ? "bg-white text-black"
                                  : "border border-white/10 bg-black/20 text-gray-400 hover:text-gray-200"
                              )}
                            >
                              {day.label}
                            </button>
                          );
                        })}
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* News Days */}
              <FormField
                control={form.control}
                name="tradeNewsDays"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center gap-2">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          className="border-white/20 data-[state=checked]:bg-white data-[state=checked]:text-black"
                        />
                      </FormControl>
                      <FormLabel className="cursor-pointer text-gray-300">
                        Trade on News Days
                      </FormLabel>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Commission & Slippage */}
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="commission"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-gray-300">Commission (per lot)</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          step="0.01"
                          min="0"
                          className="border-white/10 bg-black/20 text-gray-100 rounded-lg"
                          aria-label="Commission in account currency per trade"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="slippage"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-gray-300">Slippage (pips)</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          step="0.1"
                          min="0"
                          className="border-white/10 bg-black/20 text-gray-100 rounded-lg"
                          aria-label="Slippage in pips"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CollapsibleContent>
          </Collapsible>

          <Separator className="bg-white/10" />

          {/* Capital & Sizing */}
          <div>
            <h3 className="mb-3 text-sm font-medium text-gray-400">Capital & Position Sizing</h3>
            <div className="space-y-4">
              <FormField
                control={form.control}
                name="initialCapital"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-gray-300">Initial Capital</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        step="100"
                        className="border-white/10 bg-black/20 text-gray-100 rounded-lg"
                        aria-label="Initial capital"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="sizingMode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-gray-300">Sizing Mode</FormLabel>
                      <FormControl>
                        <RadioGroup
                          onValueChange={field.onChange}
                          value={field.value}
                          className="flex gap-4 pt-2"
                          aria-label="Position sizing mode"
                        >
                          <div className="flex items-center gap-2">
                            <RadioGroupItem
                              value="risk_percent"
                              id="sizing-risk"
                              className="border-gray-600 text-blue-500"
                            />
                            <Label htmlFor="sizing-risk" className="cursor-pointer text-gray-300">
                              Risk %
                            </Label>
                          </div>
                          <div className="flex items-center gap-2">
                            <RadioGroupItem
                              value="fixed_lot"
                              id="sizing-lot"
                              className="border-gray-600 text-blue-500"
                            />
                            <Label htmlFor="sizing-lot" className="cursor-pointer text-gray-300">
                              Fixed Lot
                            </Label>
                          </div>
                        </RadioGroup>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {sizingMode === "risk_percent" ? (
                  <FormField
                    control={form.control}
                    name="riskPercent"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-gray-300">Risk per Trade (%)</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="number"
                            step="0.01"
                            min="0.01"
                            max="100"
                            className="border-white/10 bg-black/20 text-gray-100 rounded-lg"
                            aria-label="Risk percent per trade"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ) : (
                  <FormField
                    control={form.control}
                    name="fixedLot"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-gray-300">Lot Size</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="number"
                            step="0.01"
                            min="0.01"
                            className="border-white/10 bg-black/20 text-gray-100 rounded-lg"
                            aria-label="Fixed lot size"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>

              <FormField
                control={form.control}
                name="gapFill"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-md border border-white/10 bg-black/20 px-4 py-3">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <FormLabel className="cursor-help text-gray-300 underline decoration-dotted underline-offset-2">
                            Gap Fill
                          </FormLabel>
                        </TooltipTrigger>
                        <TooltipContent side="top" align="start" className="max-w-72">
                          Gaps at market open lead to worse fills. Off = TradingView-compatible mode (default).
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        aria-label="Enable Gap Fill"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>
          </div>

          <Button
            type="submit"
            disabled={isRunning}
            className="w-full bg-blue-600 text-white hover:bg-blue-700 shadow-md disabled:opacity-50"
            aria-label="Run backtest"
          >
            {isRunning ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Running...
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" />
                Run Backtest
              </>
            )}
          </Button>
        </form>
      </Form>
    </div>
  );
}
