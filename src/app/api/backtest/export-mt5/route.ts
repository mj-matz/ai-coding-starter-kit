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
  trading_days: z.array(z.number().int().min(0).max(4)).default([0, 1, 2, 3, 4]),
  sizing_mode: z.enum(["risk_percent", "fixed_lot"]).default("risk_percent"),
  risk_percent: z.number().min(0.01).max(100).default(1.0),
  fixed_lot: z.number().positive().default(0.01),
  broker_offset_hours: z.number().int().min(-12).max(12).default(1),
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

function parseHHMM(time: string, fallbackH: number, fallbackM: number): [number, number] {
  const parts = time.split(":");
  if (parts.length < 2) return [fallbackH, fallbackM];
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  return [isNaN(h) ? fallbackH : h, isNaN(m) ? fallbackM : m];
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

  const {
    strategy_id, symbol, date_from, date_to, strategy_params,
    trading_days, sizing_mode, risk_percent, fixed_lot, broker_offset_hours,
  } = parsed.data;

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
    const [rsH, rsM] = parseHHMM(strParam(strategy_params, "rangeStart", "02:00"), 2, 0);
    const [reH, reM] = parseHHMM(strParam(strategy_params, "rangeEnd", "06:00"), 6, 0);
    const [ctH, ctM] = parseHHMM(strParam(strategy_params, "triggerDeadline", "12:00"), 12, 0);
    const [clH, clM] = parseHHMM(strParam(strategy_params, "timeExit", "20:00"), 20, 0);
    strategyVars = {
      BROKER_OFFSET: broker_offset_hours,
      RANGE_START_H: rsH, RANGE_START_M: rsM,
      RANGE_END_H: reH,   RANGE_END_M: reM,
      CUTOFF_H: ctH,      CUTOFF_M: ctM,
      CLOSE_H: clH,       CLOSE_M: clM,
      TRADE_MON: trading_days.includes(0) ? "true" : "false",
      TRADE_TUE: trading_days.includes(1) ? "true" : "false",
      TRADE_WED: trading_days.includes(2) ? "true" : "false",
      TRADE_THU: trading_days.includes(3) ? "true" : "false",
      TRADE_FRI: trading_days.includes(4) ? "true" : "false",
      LOT_MODE: sizing_mode === "risk_percent" ? 1 : 0,
      FIXED_LOT: fixed_lot,
      RISK_PERCENT: risk_percent,
      SL_POINTS: numParam(strategy_params, "stopLoss", 150),
      TP_POINTS: numParam(strategy_params, "takeProfit", 175),
      DIRECTION: strParam(strategy_params, "direction", "both"),
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
