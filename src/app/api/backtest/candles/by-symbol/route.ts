import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const FASTAPI_URL = process.env.FASTAPI_URL;
const UPSTREAM_TIMEOUT_MS = 30_000;

const QuerySchema = z.object({
  symbol: z.string().min(1),
  timeframe: z.enum(["1m", "2m", "3m", "5m", "15m", "30m", "1h", "4h", "1d"]),
  entry_time: z.string().min(1),
  exit_time: z.string().min(1),
  range_start_time: z.string().optional(),
  price_type: z.enum(["bid", "mid"]).default("bid"),
});

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const parsed = QuerySchema.safeParse({
    symbol: searchParams.get("symbol"),
    timeframe: searchParams.get("timeframe"),
    entry_time: searchParams.get("entry_time"),
    exit_time: searchParams.get("exit_time"),
    range_start_time: searchParams.get("range_start_time") ?? undefined,
    price_type: searchParams.get("price_type") ?? undefined,
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

    const headers: Record<string, string> = { "X-User-Id": user.id };
    if (session?.access_token) {
      headers["Authorization"] = `Bearer ${session.access_token}`;
    }

    const upstreamParams = new URLSearchParams({
      symbol: parsed.data.symbol,
      timeframe: parsed.data.timeframe,
      entry_time: parsed.data.entry_time,
      exit_time: parsed.data.exit_time,
      price_type: parsed.data.price_type,
    });
    if (parsed.data.range_start_time) {
      upstreamParams.set("range_start_time", parsed.data.range_start_time);
    }

    const response = await fetch(
      `${FASTAPI_URL}/backtest/candles/by-symbol?${upstreamParams}`,
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
      return NextResponse.json({ error: "Candle request timed out." }, { status: 504 });
    }
    console.error("Candles by-symbol proxy error:", error);
    return NextResponse.json(
      { error: "Failed to connect to backtesting service" },
      { status: 502 }
    );
  }
}
