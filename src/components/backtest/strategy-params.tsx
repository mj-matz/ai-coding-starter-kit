"use client";

import { useState } from "react";
import { Clock, ChevronDown, ChevronRight } from "lucide-react";
import { type UseFormReturn } from "react-hook-form";

import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

import type { BacktestFormValues } from "@/lib/backtest-types";

interface StrategyParamsProps {
  strategy: string;
  form: UseFormReturn<BacktestFormValues>;
}

/**
 * Registry of strategy parameter components. To add a new strategy,
 * register its parameter component here — no switch/case needed.
 * This pattern makes it easy for PROJ-6 (Strategy Library) to add
 * strategies dynamically.
 */
const strategyParamsRegistry: Record<
  string,
  React.ComponentType<{ form: UseFormReturn<BacktestFormValues> }>
> = {
  time_range_breakout: TimeRangeBreakoutParams,
};

export function StrategyParams({ strategy, form }: StrategyParamsProps) {
  const ParamsComponent = strategyParamsRegistry[strategy];

  if (!ParamsComponent) {
    return (
      <p className="text-sm text-gray-500">
        No parameters available for this strategy.
      </p>
    );
  }

  return <ParamsComponent form={form} />;
}

function TimeRangeBreakoutParams({
  form,
}: {
  form: UseFormReturn<BacktestFormValues>;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  return (
    <>
      {/* Time windows */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField
          control={form.control}
          name="rangeStart"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-gray-300">Range Start</FormLabel>
              <FormControl>
                <div className="relative">
                  <Clock className="pointer-events-none absolute left-3 top-1/2 h-[1.1rem] w-[1.1rem] -translate-y-1/2 text-gray-500" />
                  <Input
                    {...field}
                    type="time"
                    className="border-white/10 bg-black/20 pl-9 text-gray-100 rounded-lg [&::-webkit-calendar-picker-indicator]:hidden"
                    aria-label="Range start time"
                  />
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="rangeEnd"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-gray-300">Range End</FormLabel>
              <FormControl>
                <div className="relative">
                  <Clock className="pointer-events-none absolute left-3 top-1/2 h-[1.1rem] w-[1.1rem] -translate-y-1/2 text-gray-500" />
                  <Input
                    {...field}
                    type="time"
                    className="border-white/10 bg-black/20 pl-9 text-gray-100 rounded-lg [&::-webkit-calendar-picker-indicator]:hidden"
                    aria-label="Range end time"
                  />
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="triggerDeadline"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-gray-300">Trigger Deadline</FormLabel>
              <FormControl>
                <div className="relative">
                  <Clock className="pointer-events-none absolute left-3 top-1/2 h-[1.1rem] w-[1.1rem] -translate-y-1/2 text-gray-500" />
                  <Input
                    {...field}
                    type="time"
                    className="border-white/10 bg-black/20 pl-9 text-gray-100 rounded-lg [&::-webkit-calendar-picker-indicator]:hidden"
                    aria-label="Trigger deadline time"
                  />
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="timeExit"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-gray-300">Time Exit</FormLabel>
              <FormControl>
                <div className="relative">
                  <Clock className="pointer-events-none absolute left-3 top-1/2 h-[1.1rem] w-[1.1rem] -translate-y-1/2 text-gray-500" />
                  <Input
                    {...field}
                    type="time"
                    className="border-white/10 bg-black/20 pl-9 text-gray-100 rounded-lg [&::-webkit-calendar-picker-indicator]:hidden"
                    aria-label="Time exit"
                  />
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      {/* SL / TP */}
      <div className="mt-4 grid grid-cols-2 gap-4">
        <FormField
          control={form.control}
          name="stopLoss"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-gray-300">Stop Loss (pips)</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="number"
                  step="0.1"
                  className="border-white/10 bg-black/20 text-gray-100 rounded-lg"
                  aria-label="Stop loss in pips"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="takeProfit"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-gray-300">Take Profit (pips)</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="number"
                  step="0.1"
                  className="border-white/10 bg-black/20 text-gray-100 rounded-lg"
                  aria-label="Take profit in pips"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      {/* Advanced Parameters (collapsed by default) */}
      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger className="mt-4 flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors">
          {advancedOpen ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
          Advanced Parameters
        </CollapsibleTrigger>

        <CollapsibleContent className="mt-3 space-y-4">
          {/* Trading Days */}
          <FormField
            control={form.control}
            name="tradingDays"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-gray-300">Handelstage</FormLabel>
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

          {/* News-Tage */}
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
                    Handel an News-Tagen
                  </FormLabel>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="commission"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-300">
                    Commission (per lot)
                  </FormLabel>
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

          <FormField
            control={form.control}
            name="entryDelayBars"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-gray-300">
                  Entry Delay (bars after range end)
                </FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="number"
                    step="1"
                    min="0"
                    className="border-white/10 bg-black/20 text-gray-100 rounded-lg"
                    aria-label="Entry delay in bars after range end"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="trailTriggerPips"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-300">
                    Trail Trigger (pips)
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      value={field.value ?? ""}
                      onChange={(e) =>
                        field.onChange(
                          e.target.value === "" ? undefined : e.target.valueAsNumber
                        )
                      }
                      type="number"
                      step="0.1"
                      min="0"
                      placeholder="e.g. 100"
                      className="border-white/10 bg-black/20 text-gray-100 rounded-lg"
                      aria-label="Trail trigger in pips"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="trailLockPips"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-300">
                    Trail Lock (pips)
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      value={field.value ?? ""}
                      onChange={(e) =>
                        field.onChange(
                          e.target.value === "" ? undefined : e.target.valueAsNumber
                        )
                      }
                      type="number"
                      step="0.1"
                      min="0"
                      placeholder="e.g. 50"
                      className="border-white/10 bg-black/20 text-gray-100 rounded-lg"
                      aria-label="Trail lock in pips"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </>
  );
}
