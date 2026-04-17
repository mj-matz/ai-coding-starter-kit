import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { MT5_TEMPLATES, SUPPORTED_STRATEGIES } from "@/lib/mt5-templates";

// ── Zod schema ───────────────────────────────────────────────────────────────

const ExportMT5Schema = z.object({
  strategy_id: z.string().min(1),
  symbol: z.string().min(1),
  date_from: z.string().min(1),
  date_to: z.string().min(1),
  strategy_params: z.record(z.string(), z.unknown()).default({}),
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function sanitizeFilename(s: string): string {
  return s.replace(/[^a-zA-Z0-9_]/g, "_");
}

function numParam(params: Record<string, unknown>, key: string, fallback = 0): number {
  const v = params[key];
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return isNaN(n) ? fallback : n;
}

function strParam(params: Record<string, unknown>, key: string, fallback = ""): string {
  const v = params[key];
  return typeof v === "string" ? v : fallback;
}

function fillTemplate(template: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce(
    (t, [key, val]) => t.split(`{{${key}}}`).join(String(val)),
    template
  );
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Auth check
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Parse body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate
  const parsed = ExportMT5Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const { strategy_id, symbol, date_from, date_to, strategy_params } = parsed.data;

  // Check strategy is supported
  if (!SUPPORTED_STRATEGIES.includes(strategy_id)) {
    return NextResponse.json(
      {
        error: `Strategy "${strategy_id}" has no MQL5 template. Supported: ${SUPPORTED_STRATEGIES.join(", ")}`,
      },
      { status: 400 }
    );
  }

  const template = MT5_TEMPLATES[strategy_id];
  const exportDate = new Date().toISOString().slice(0, 10);

  // Build placeholder map per strategy
  const baseVars: Record<string, string | number> = {
    SYMBOL: symbol,
    DATE_FROM: date_from,
    DATE_TO: date_to,
    EXPORT_DATE: exportDate,
  };

  let strategyVars: Record<string, string | number> = {};

  if (strategy_id === "time_range_breakout") {
    strategyVars = {
      RANGE_START: strParam(strategy_params, "rangeStart", "02:00"),
      RANGE_END: strParam(strategy_params, "rangeEnd", "06:00"),
      TRIGGER_DEADLINE: strParam(strategy_params, "triggerDeadline", "12:00"),
      TIME_EXIT: strParam(strategy_params, "timeExit", "20:00"),
      STOP_LOSS: numParam(strategy_params, "stopLoss", 150),
      TAKE_PROFIT: numParam(strategy_params, "takeProfit", 175),
      DIRECTION: strParam(strategy_params, "direction", "both"),
      ENTRY_DELAY_BARS: numParam(strategy_params, "entryDelayBars", 1),
      TRAIL_TRIGGER_PIPS: numParam(strategy_params, "trailTriggerPips", 0),
      TRAIL_LOCK_PIPS: numParam(strategy_params, "trailLockPips", 0),
    };
  } else if (strategy_id === "moving_average_crossover") {
    strategyVars = {
      FAST_PERIOD: numParam(strategy_params, "fastPeriod", 10),
      SLOW_PERIOD: numParam(strategy_params, "slowPeriod", 50),
      STOP_LOSS: numParam(strategy_params, "stopLoss", 50),
      TAKE_PROFIT: numParam(strategy_params, "takeProfit", 0),
      DIRECTION: strParam(strategy_params, "direction", "both"),
    };
  } else if (strategy_id === "rsi_threshold") {
    strategyVars = {
      RSI_PERIOD: numParam(strategy_params, "rsiPeriod", 14),
      OVERSOLD_LEVEL: numParam(strategy_params, "oversoldLevel", 30),
      OVERBOUGHT_LEVEL: numParam(strategy_params, "overboughtLevel", 70),
      STOP_LOSS: numParam(strategy_params, "stopLoss", 50),
      TAKE_PROFIT: numParam(strategy_params, "takeProfit", 0),
      DIRECTION: strParam(strategy_params, "direction", "both"),
    };
  }

  const mqlCode = fillTemplate(template, { ...baseVars, ...strategyVars });

  // Build sanitized filename: {strategy_id}_{symbol}_{YYYY-MM-DD}.mq5
  const safeSymbol = sanitizeFilename(symbol);
  const filename = `${strategy_id}_${safeSymbol}_${exportDate}.mq5`;

  return new NextResponse(mqlCode, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
