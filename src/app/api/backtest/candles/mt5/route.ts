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

function toMt5Timeframe(tf: string): string {
  const map: Record<string, string> = {
    "1m": "M1", "2m": "M2", "3m": "M3", "5m": "M5",
    "15m": "M15", "30m": "M30", "1h": "H1", "4h": "H4", "1d": "D1",
  };
  return map[tf] ?? "M1";
}

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
  const mt5Timeframe = toMt5Timeframe(timeframe);

  // Find the dataset for this user / asset / timeframe
  const { data: dataset, error: dsError } = await supabase
    .from("mt5_datasets")
    .select("id")
    .eq("user_id", user.id)
    .eq("asset", symbol)
    .eq("timeframe", mt5Timeframe)
    .maybeSingle();

  if (dsError) {
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  if (!dataset) {
    return NextResponse.json(
      { error: `No MT5 data found for ${symbol} ${mt5Timeframe}` },
      { status: 404 }
    );
  }

  const { data: rows, error: candleError } = await supabase
    .from("mt5_candles")
    .select("ts, open, high, low, close")
    .eq("dataset_id", dataset.id)
    .gte("ts", entry_time)
    .lte("ts", exit_time)
    .order("ts")
    .limit(700);

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
