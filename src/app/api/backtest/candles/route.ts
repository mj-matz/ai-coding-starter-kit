import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const FASTAPI_URL = process.env.FASTAPI_URL;
const UPSTREAM_TIMEOUT_MS = 30_000; // 30 seconds — candle loads should be fast

const CandlesQuerySchema = z.object({
  cache_id: z.string().uuid("cache_id must be a valid UUID"),
  entry_time: z.string().min(1, "entry_time is required"),
  exit_time: z.string().min(1, "exit_time is required"),
  timeframe: z.enum(["1m", "2m", "3m", "5m", "15m", "30m", "1h", "4h", "1d"]),
  range_start_time: z.string().optional(),
});

export async function GET(request: NextRequest) {
  // Auth check
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Validate query params
  const { searchParams } = request.nextUrl;
  const parsed = CandlesQuerySchema.safeParse({
    cache_id: searchParams.get("cache_id"),
    entry_time: searchParams.get("entry_time"),
    exit_time: searchParams.get("exit_time"),
    timeframe: searchParams.get("timeframe"),
    range_start_time: searchParams.get("range_start_time") ?? undefined,
  });

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

  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    const headers: Record<string, string> = {
      "X-User-Id": user.id,
    };
    if (session?.access_token) {
      headers["Authorization"] = `Bearer ${session.access_token}`;
    }

    const upstreamParams = new URLSearchParams({
      cache_id: parsed.data.cache_id,
      entry_time: parsed.data.entry_time,
      exit_time: parsed.data.exit_time,
      timeframe: parsed.data.timeframe,
    });
    if (parsed.data.range_start_time) {
      upstreamParams.set("range_start_time", parsed.data.range_start_time);
    }

    const response = await fetch(
      `${FASTAPI_URL}/backtest/candles?${upstreamParams}`,
      { headers, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) }
    );

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: data.detail || data.error || "Failed to load candles" },
        { status: response.status }
      );
    }

    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return NextResponse.json(
        { error: "Candle request timed out." },
        { status: 504 }
      );
    }
    console.error("Candles proxy error:", error);
    return NextResponse.json(
      { error: "Failed to connect to backtesting service" },
      { status: 502 }
    );
  }
}
