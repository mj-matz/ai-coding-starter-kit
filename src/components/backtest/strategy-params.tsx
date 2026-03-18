"use client";

import { Clock } from "lucide-react";
import { type UseFormReturn } from "react-hook-form";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
  return (
    <>
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
                    className="border-gray-700 bg-gray-900 pl-9 text-gray-100 [&::-webkit-calendar-picker-indicator]:hidden"
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
                    className="border-gray-700 bg-gray-900 pl-9 text-gray-100 [&::-webkit-calendar-picker-indicator]:hidden"
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
                    className="border-gray-700 bg-gray-900 pl-9 text-gray-100 [&::-webkit-calendar-picker-indicator]:hidden"
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
                    className="border-gray-700 bg-gray-900 pl-9 text-gray-100 [&::-webkit-calendar-picker-indicator]:hidden"
                    aria-label="Time exit"
                  />
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

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
                  className="border-gray-700 bg-gray-900 text-gray-100"
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
              <FormLabel className="text-gray-300">
                Take Profit (pips)
              </FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="number"
                  step="0.1"
                  className="border-gray-700 bg-gray-900 text-gray-100"
                  aria-label="Take profit in pips"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="commission"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-gray-300">
                Commission (account currency)
              </FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="number"
                  step="0.01"
                  min="0"
                  className="border-gray-700 bg-gray-900 text-gray-100"
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
                  className="border-gray-700 bg-gray-900 text-gray-100"
                  aria-label="Slippage in pips"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className="mt-4">
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
                  className="border-gray-700 bg-gray-900 text-gray-100"
                  aria-label="Entry delay in bars after range end"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <FormField
          control={form.control}
          name="trailTriggerPips"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-gray-300">
                Trail Trigger (pips, optional)
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
                  className="border-gray-700 bg-gray-900 text-gray-100"
                  aria-label="Trail trigger in pips (profit level that activates profit lock)"
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
                Trail Lock (pips, optional)
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
                  className="border-gray-700 bg-gray-900 text-gray-100"
                  aria-label="Trail lock in pips (SL moved to this offset from entry on trigger)"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className="mt-4">
        <FormField
          control={form.control}
          name="direction"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-gray-300">Direction</FormLabel>
              <FormControl>
                <RadioGroup
                  onValueChange={field.onChange}
                  value={field.value}
                  className="flex gap-4"
                  aria-label="Trade direction"
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem
                      value="long"
                      id="dir-long"
                      className="border-gray-600 text-blue-500"
                    />
                    <Label
                      htmlFor="dir-long"
                      className="cursor-pointer text-gray-300"
                    >
                      Long
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem
                      value="short"
                      id="dir-short"
                      className="border-gray-600 text-blue-500"
                    />
                    <Label
                      htmlFor="dir-short"
                      className="cursor-pointer text-gray-300"
                    >
                      Short
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem
                      value="both"
                      id="dir-both"
                      className="border-gray-600 text-blue-500"
                    />
                    <Label
                      htmlFor="dir-both"
                      className="cursor-pointer text-gray-300"
                    >
                      Both
                    </Label>
                  </div>
                </RadioGroup>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </>
  );
}
