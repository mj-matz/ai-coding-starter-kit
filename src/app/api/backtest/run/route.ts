import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
const FASTAPI_URL = process.env.FASTAPI_URL;
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_SECONDS = 60;

// ── Zod schemas ──────────────────────────────────────────────────────────────

const InstrumentConfigSchema = z.object({
  pip_size: z.number().positive(),
  pip_value_per_lot: z.number().positive(),
});

const BacktestConfigSchema = z
  .object({
    initial_balance: z.number().positive(),
    sizing_mode: z.enum(["fixed_lot", "risk_percent"]),
    instrument: InstrumentConfigSchema,
    fixed_lot: z.number().positive().optional(),
    risk_percent: z.number().positive().max(100).optional(),
    commission: z.number().min(0).default(0),
    slippage_pips: z.number().min(0).default(0),
    time_exit: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Must be HH:MM with valid hours (00-23) and minutes (00-59)")
      .optional(),
    timezone: z.string().min(1).default("UTC"),
    trail_trigger_pips: z.number().positive().optional(),
    trail_lock_pips: z.number().positive().optional(),
  })
  .refine(
    (d) =>
      d.sizing_mode === "fixed_lot" ? d.fixed_lot != null : d.risk_percent != null,
    { message: "fixed_lot required for fixed_lot mode; risk_percent required for risk_percent mode" }
  )
  .refine(
    (d) => {
      const hasTrigger = d.trail_trigger_pips != null;
      const hasLock = d.trail_lock_pips != null;
      return hasTrigger === hasLock;
    },
    { message: "trail_trigger_pips and trail_lock_pips must both be set or both be omitted" }
  )
  .refine(
    (d) =>
      d.trail_trigger_pips == null ||
      d.trail_lock_pips == null ||
      d.trail_trigger_pips > d.trail_lock_pips,
    { message: "trail_trigger_pips must be greater than trail_lock_pips" }
  )
  // Note: trail_trigger_pips < take_profit_pips is validated in Python (BreakoutParams.validate_params),
  // since take_profit_pips belongs to BreakoutParams, not BacktestConfig.

const SignalEntrySchema = z.object({
  ts: z.string().min(1),
  long_entry: z.number().optional(),
  long_sl: z.number().optional(),
  long_tp: z.number().optional(),
  short_entry: z.number().optional(),
  short_sl: z.number().optional(),
  short_tp: z.number().optional(),
  signal_expiry: z.string().optional(),
  trail_trigger_pips: z.number().positive().optional(),
  trail_lock_pips: z.number().positive().optional(),
});

const BacktestRunRequestSchema = z.object({
  cache_id: z.string().uuid("cache_id must be a valid UUID"),
  config: BacktestConfigSchema,
  signals: z.array(SignalEntrySchema).min(1).max(500_000),
});

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

  // Rate limiting via Supabase (persistent across serverless instances)
  try {
    const { data: allowed, error: rlError } = await supabase.rpc(
      "check_rate_limit",
      {
        p_key: `backtest-run:${user.id}`,
        p_max_requests: RATE_LIMIT_MAX,
        p_window_seconds: RATE_LIMIT_WINDOW_SECONDS,
      }
    );

    if (rlError) {
      // Fail open: log but don't block the user if the DB check fails
      console.error("Rate limit check failed:", rlError.message);
    } else if (!allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(RATE_LIMIT_WINDOW_SECONDS) },
        }
      );
    }
  } catch (err) {
    // Fail open
    console.error("Rate limit check threw:", err);
  }

  // Parse body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate
  const parsed = BacktestRunRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  if (!FASTAPI_URL) {
    return NextResponse.json(
      { error: "FastAPI service URL not configured" },
      { status: 503 }
    );
  }

  // Forward to FastAPI
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-User-Id": user.id,
    };

    if (session?.access_token) {
      headers["Authorization"] = `Bearer ${session.access_token}`;
    }

    const response = await fetch(`${FASTAPI_URL}/backtest/run`, {
      method: "POST",
      headers,
      body: JSON.stringify(parsed.data),
    });

    const data = await response.json();

    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("FastAPI proxy error:", error);
    return NextResponse.json(
      { error: "Failed to connect to backtesting service" },
      { status: 502 }
    );
  }
}
