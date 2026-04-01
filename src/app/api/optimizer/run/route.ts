import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300;

const FASTAPI_URL = process.env.FASTAPI_URL;
const UPSTREAM_TIMEOUT_MS = 30_000; // 30s — only starts the job, doesn't wait

// ── Zod schemas ──────────────────────────────────────────────────────────────

const ParameterRangeSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().positive().optional(),
  values: z.array(z.number()).optional(),
}).refine(
  (d) => d.values != null || (d.min != null && d.max != null && d.step != null),
  { message: "Each parameter range needs either {min, max, step} or {values}" }
);

const OptimizerRunSchema = z.object({
  // Base backtest config
  strategy: z.string().min(1),
  symbol: z.string().min(1).regex(/^[A-Z0-9.]+$/i),
  timeframe: z.enum(["1m", "2m", "3m", "5m", "15m", "30m", "1h", "4h", "1d"]),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  // Strategy-specific params (schema-driven)
  strategyParams: z.record(z.string(), z.unknown()).default({}),
  commission: z.number().min(0).default(0),
  slippage: z.number().min(0).default(0),
  initialCapital: z.number().positive(),
  sizingMode: z.enum(["risk_percent", "fixed_lot"]),
  riskPercent: z.number().positive().max(100).optional(),
  fixedLot: z.number().positive().optional(),
  gapFill: z.boolean().default(false),
  tradingDays: z.array(z.number().int().min(0).max(4)).default([0, 1, 2, 3, 4]),
  newsDates: z.array(z.string()).optional(),

  // Optimizer-specific
  parameter_group: z.enum(["crv", "time_exit", "trigger_deadline", "range_window", "trailing_stop"]),
  target_metric: z.enum(["profit_factor", "sharpe_ratio", "win_rate", "net_profit"]),
  parameter_ranges: z.record(z.string(), ParameterRangeSchema),
});

// ── POST /api/optimizer/run ──────────────────────────────────────────────────

export async function POST(request: NextRequest) {
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
  const parsed = OptimizerRunSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Defense-in-depth: reject if user already has a running job in Supabase
  const { data: runningJob } = await supabase
    .from("optimization_runs")
    .select("id")
    .eq("user_id", user.id)
    .eq("status", "running")
    .limit(1)
    .maybeSingle();

  if (runningJob) {
    return NextResponse.json(
      { error: "You already have a running optimization job." },
      { status: 409 }
    );
  }

  if (!FASTAPI_URL) {
    return NextResponse.json(
      { error: "FastAPI service URL not configured" },
      { status: 503 }
    );
  }

  // Forward to FastAPI to start the optimizer job
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

    const { strategyParams, ...engineParams } = parsed.data;
    const fastapiBody = { ...engineParams, ...strategyParams };

    const response = await fetch(`${FASTAPI_URL}/optimize/start`, {
      method: "POST",
      headers,
      body: JSON.stringify(fastapiBody),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    // Create an optimization_runs record in Supabase
    const { parameter_group, target_metric, parameter_ranges, strategyParams: _sp, ...backtest_config } = parsed.data;

    const { error: insertError } = await supabase
      .from("optimization_runs")
      .insert({
        id: data.job_id,
        user_id: user.id,
        asset: parsed.data.symbol,
        date_from: parsed.data.startDate,
        date_to: parsed.data.endDate,
        strategy: parsed.data.strategy,
        parameter_group,
        target_metric,
        config: backtest_config,
        parameter_ranges,
        total_combinations: data.total_combinations,
        status: "running",
      });

    if (insertError) {
      console.error("Failed to save optimization run to Supabase:", insertError.message);
      // Non-fatal: the FastAPI job is already running
    }

    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return NextResponse.json(
        { error: "Request timed out while starting optimizer." },
        { status: 504 }
      );
    }
    console.error("Optimizer proxy error:", error);
    return NextResponse.json(
      { error: "Failed to connect to optimization service" },
      { status: 502 }
    );
  }
}
