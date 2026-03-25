import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const runtime = "edge"; // Required for progressive SSE streaming on Vercel
export const maxDuration = 300; // Vercel Pro: up to 300s

const FASTAPI_URL = process.env.FASTAPI_URL;
const UPSTREAM_TIMEOUT_MS = 300_000; // 5 minutes
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_SECONDS = 60;

// ── Validation (same as /api/backtest) ──────────────────────────────────────

const BacktestRequestSchema = z
  .object({
    strategy: z.string().min(1),
    symbol: z.string().min(1).regex(/^[A-Z0-9.]+$/i),
    timeframe: z.enum(["1m", "2m", "3m", "5m", "15m", "30m", "1h", "4h", "1d"]),
    startDate: z.string().min(1),
    endDate: z.string().min(1),
    rangeStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    rangeEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    triggerDeadline: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    timeExit: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    stopLoss: z.number().positive(),
    takeProfit: z.number().positive(),
    direction: z.enum(["long", "short", "both"]),
    commission: z.number().min(0),
    slippage: z.number().min(0),
    initialCapital: z.number().positive(),
    sizingMode: z.enum(["risk_percent", "fixed_lot"]),
    riskPercent: z.number().min(0.01).max(100).optional(),
    fixedLot: z.number().positive().optional(),
    entryDelayBars: z.number().int().min(0).default(1),
    trailTriggerPips: z.number().positive().optional(),
    trailLockPips: z.number().positive().optional(),
    tradingDays: z.array(z.number().int().min(0).max(4)).min(1).default([0, 1, 2, 3, 4]),
    tradeNewsDays: z.boolean().default(true),
    newsDates: z.array(z.string()).optional(),
    gapFill: z.boolean().default(false),
  })
  .refine((data) => new Date(data.endDate) > new Date(data.startDate), {
    message: "End date must be after start date",
  })
  .refine(
    (data) =>
      data.sizingMode === "risk_percent"
        ? data.riskPercent != null
        : data.fixedLot != null,
    {
      message: "Provide risk_percent or fixed_lot based on sizing_mode",
    }
  )
  .refine(
    (data) => {
      const hasTrigger = data.trailTriggerPips != null;
      const hasLock = data.trailLockPips != null;
      return hasTrigger === hasLock;
    },
    { message: "Both trail parameters must be set together or both omitted" }
  )
  .refine(
    (data) => {
      if (data.trailTriggerPips != null && data.trailLockPips != null) {
        return data.trailTriggerPips > data.trailLockPips;
      }
      return true;
    },
    { message: "trailTriggerPips must be greater than trailLockPips" }
  );

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

  // Rate limiting via Supabase (persistent across serverless instances)
  try {
    const { data: allowed, error: rlError } = await supabase.rpc(
      "check_rate_limit",
      {
        p_key: `backtest:${user.id}`,
        p_max_requests: RATE_LIMIT_MAX,
        p_window_seconds: RATE_LIMIT_WINDOW_SECONDS,
      }
    );

    if (rlError) {
      console.error("Rate limit check failed:", rlError.message);
    } else if (!allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Try again in 60 seconds." },
        {
          status: 429,
          headers: { "Retry-After": String(RATE_LIMIT_WINDOW_SECONDS) },
        }
      );
    }
  } catch (err) {
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
  const parsed = BacktestRequestSchema.safeParse(body);
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

  // Forward to FastAPI streaming endpoint
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

    const upstream = await fetch(`${FASTAPI_URL}/backtest/stream`, {
      method: "POST",
      headers,
      body: JSON.stringify(parsed.data),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    if (!upstream.ok) {
      const errorBody = await upstream.json().catch(() => ({}));
      return NextResponse.json(
        { error: errorBody.detail || errorBody.error || "Backtest failed" },
        { status: upstream.status }
      );
    }

    // Stream the SSE response through to the client.
    // TransformStream ensures chunks are flushed immediately (prevents Vercel buffering).
    const { readable, writable } = new TransformStream();
    upstream.body!.pipeTo(writable);

    return new NextResponse(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return NextResponse.json(
        { error: "Backtest timed out after 5 minutes. Try a shorter date range." },
        { status: 504 }
      );
    }
    console.error("Backtest stream error:", error);
    return NextResponse.json(
      { error: "Failed to connect to backtesting service" },
      { status: 502 }
    );
  }
}
