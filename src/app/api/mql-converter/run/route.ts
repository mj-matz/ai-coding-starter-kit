import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300; // Vercel Pro: up to 300s; Hobby: max 60s

const FASTAPI_URL = process.env.FASTAPI_URL;
const UPSTREAM_TIMEOUT_MS = 280_000; // 280s — leaves 20s buffer under maxDuration

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
    commission_per_lot: z.number().min(0).default(0),
    slippage_pips: z.number().min(0).default(0),
    time_exit: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Must be HH:MM with valid hours (00-23) and minutes (00-59)")
      .optional(),
    timezone: z.string().min(1).default("UTC"),
    trail_trigger_pips: z.number().positive().optional(),
    trail_lock_pips: z.number().positive().optional(),
    price_type: z.enum(["bid", "mid"]).default("bid"),
    mt5_mode: z.boolean().default(false),
    spread_pips: z.number().min(0).default(0),
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
  );

const RunRequestSchema = z.object({
  python_code: z.string().min(1, "Python code is required"),
  // MQL Converter loads MT5 broker data by (symbol, timeframe, date range)
  // — no Dukascopy cache_id needed.
  symbol: z.string().min(1),
  timeframe: z.string().min(1),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  config: BacktestConfigSchema,
  params: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).optional(),
});

// ── Route handler ────────────────────────────────────────────────────────────

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
  const parsed = RunRequestSchema.safeParse(body);
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

  // Forward to FastAPI sandbox
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

    // PROJ-29: MQL Converter always runs in MT5 mode (MQL code is MT5 by definition)
    const configWithMt5 = {
      ...parsed.data.config,
      mt5_mode: true,
      price_type: "bid" as const,
    };

    const sandboxPayload: Record<string, unknown> = {
      python_code: parsed.data.python_code,
      symbol: parsed.data.symbol,
      timeframe: parsed.data.timeframe,
      date_from: parsed.data.date_from,
      date_to: parsed.data.date_to,
      config: configWithMt5,
    };

    if (parsed.data.params && Object.keys(parsed.data.params).length > 0) {
      sandboxPayload.params = parsed.data.params;
    }

    const response = await fetch(`${FASTAPI_URL}/sandbox/run`, {
      method: "POST",
      headers,
      body: JSON.stringify(sandboxPayload),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    const data = await response.json();

    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return NextResponse.json(
        { error: "Sandbox execution timed out after 90 seconds. The converted strategy may be too complex." },
        { status: 504 }
      );
    }
    console.error("FastAPI sandbox proxy error:", error);
    return NextResponse.json(
      { error: "Failed to connect to sandbox service" },
      { status: 502 }
    );
  }
}
