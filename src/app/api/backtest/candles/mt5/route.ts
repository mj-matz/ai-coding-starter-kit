import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { Candle } from "@/lib/backtest-types";

const QuerySchema = z.object({
  symbol: z.string().min(1),
  timeframe: z.enum(["1m", "2m", "3m", "5m", "15m", "30m", "1h", "4h", "1d"]),
  entry_time: z.string().min(1),
  exit_time: z.string().min(1),
});

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const parsed = QuerySchema.safeParse({
    symbol: searchParams.get("symbol"),
    timeframe: searchParams.get("timeframe"),
    entry_time: searchParams.get("entry_time"),
    exit_time: searchParams.get("exit_time"),
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { symbol, timeframe, entry_time, exit_time } = parsed.data;

  // mt5_datasets stores timeframe in the lowercase form ("1m", "5m", ...) — same
  // contract as the upload route + Python loader. Don't translate to "M1"/"M5"
  // here or the lookup misses every dataset.
  const { data: dataset, error: dsError } = await supabase
    .from("mt5_datasets")
    .select("id")
    .eq("user_id", user.id)
    .eq("asset", symbol)
    .eq("timeframe", timeframe)
    .maybeSingle();

  if (dsError) {
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  if (!dataset) {
    return NextResponse.json(
      { error: `No MT5 data found for ${symbol} ${timeframe}` },
      { status: 404 }
    );
  }

  // 1500 covers a full 24h day at 1m resolution (1440 bars) plus a small buffer
  // for trade modals that span the whole instrument-tz day.
  const { data: rows, error: candleError } = await supabase
    .from("mt5_candles")
    .select("ts, open, high, low, close")
    .eq("dataset_id", dataset.id)
    .gte("ts", entry_time)
    .lte("ts", exit_time)
    .order("ts")
    .limit(1500);

  if (candleError) {
    return NextResponse.json({ error: "Failed to load candles" }, { status: 500 });
  }

  const candles: Candle[] = (rows ?? []).map((r) => ({
    time: Math.floor(new Date(r.ts as string).getTime() / 1000),
    open: r.open as number,
    high: r.high as number,
    low: r.low as number,
    close: r.close as number,
  }));

  return NextResponse.json(candles);
}
