import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300;

const RATE_LIMIT_MAX = 100;
const RATE_LIMIT_WINDOW_SECONDS = 60;
const MT5_TIMEFRAME_VALUES = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"] as const;

const Mt5CandleSchema = z.object({
  timestamp: z.string().min(1),
  open: z.number().finite(),
  high: z.number().finite(),
  low: z.number().finite(),
  close: z.number().finite(),
  tick_volume: z.number().finite().optional(),
  volume: z.number().finite().optional(),
  spread: z.number().finite().optional(),
});

const UploadRequestSchema = z.object({
  asset: z
    .string()
    .min(1)
    .max(32)
    .transform((v) => v.toUpperCase()),
  timeframe: z.enum(MT5_TIMEFRAME_VALUES),
  candles: z.array(Mt5CandleSchema).min(1).max(500_000),
  broker_timezone: z.string().min(1).max(64).default("UTC"),
  conflict_resolution: z.enum(["merge", "replace"]).optional(),
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Admin-only upload
  const jwt = await supabase.auth.getSession();
  const role = (jwt.data.session?.user?.app_metadata as Record<string, unknown> | undefined)?.role;
  if (role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Rate limiting
  try {
    const { data: allowed, error: rlError } = await supabase.rpc("check_rate_limit", {
      p_key: `mt5-upload:${user.id}`,
      p_max_requests: RATE_LIMIT_MAX,
      p_window_seconds: RATE_LIMIT_WINDOW_SECONDS,
    });
    if (rlError) {
      console.error("Rate limit check failed:", rlError.message);
    } else if (!allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Try again later." },
        { status: 429, headers: { "Retry-After": String(RATE_LIMIT_WINDOW_SECONDS) } }
      );
    }
  } catch (err) {
    console.error("Rate limit check threw:", err);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = UploadRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { asset, timeframe, candles, broker_timezone, conflict_resolution } = parsed.data;

  // OHLC sanity check
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (c.high < Math.max(c.open, c.close) || c.low > Math.min(c.open, c.close)) {
      return NextResponse.json(
        { error: `OHLC sanity check failed at row ${i + 1} (timestamp: ${c.timestamp})` },
        { status: 422 }
      );
    }
  }

  // Check for existing dataset
  const { data: existing, error: existingError } = await supabase
    .from("mt5_datasets")
    .select("id")
    .eq("user_id", user.id)
    .eq("asset", asset)
    .eq("timeframe", timeframe)
    .maybeSingle();

  if (existingError) {
    console.error("mt5_datasets lookup error:", existingError.message);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  const hadConflict = existing != null;

  if (hadConflict && !conflict_resolution) {
    return NextResponse.json(
      {
        error: `A dataset for ${asset} / ${timeframe} already exists. Pass conflict_resolution: "merge" or "replace".`,
        had_conflict: true,
      },
      { status: 409 }
    );
  }

  let datasetId: string;
  let isNewDataset = false;

  if (hadConflict && existing) {
    datasetId = existing.id;
    if (conflict_resolution === "replace") {
      // Wipe existing candles; ON DELETE CASCADE handles mt5_candles.
      const { error: deleteError } = await supabase
        .from("mt5_candles")
        .delete()
        .eq("dataset_id", datasetId);
      if (deleteError) {
        console.error("mt5_candles delete error:", deleteError.message);
        return NextResponse.json({ error: "Failed to replace existing data" }, { status: 500 });
      }
    }
    // For "merge", existing candles stay; upsert below overwrites same timestamps.
  } else {
    // Create new dataset row
    isNewDataset = true;
    const { data: newDataset, error: insertError } = await supabase
      .from("mt5_datasets")
      .insert({
        user_id: user.id,
        asset,
        timeframe,
        start_date: candles[0].timestamp.slice(0, 10),
        end_date: candles[candles.length - 1].timestamp.slice(0, 10),
        candle_count: 0,
        broker_timezone,
      })
      .select("id")
      .single();

    if (insertError || !newDataset) {
      console.error("mt5_datasets insert error:", insertError?.message);
      return NextResponse.json({ error: "Failed to create dataset" }, { status: 500 });
    }
    datasetId = newDataset.id;
  }

  // Insert candles in batches of 1000
  const rows = candles.map((c) => ({
    dataset_id: datasetId,
    ts: c.timestamp,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    tick_volume: c.tick_volume ?? null,
    volume: c.volume ?? null,
    spread: c.spread ?? null,
  }));

  const BATCH = 1000;
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error: upsertError } = await supabase
      .from("mt5_candles")
      .upsert(rows.slice(i, i + BATCH), { onConflict: "dataset_id,ts", ignoreDuplicates: false });

    if (upsertError) {
      console.error(`mt5_candles upsert error (batch ${i / BATCH}):`, upsertError.message);
      // Roll back orphan dataset if we created it this request
      if (isNewDataset) {
        await supabase.from("mt5_datasets").delete().eq("id", datasetId);
      }
      return NextResponse.json({ error: "Failed to store candle data" }, { status: 500 });
    }
  }

  // Recompute metadata from actual stored rows (source of truth = DB)
  const { data: stats, error: statsError } = await supabase
    .from("mt5_candles")
    .select("ts")
    .eq("dataset_id", datasetId)
    .order("ts", { ascending: true })
    .limit(1);

  const { data: statsLast, error: statsLastError } = await supabase
    .from("mt5_candles")
    .select("ts")
    .eq("dataset_id", datasetId)
    .order("ts", { ascending: false })
    .limit(1);

  const { count, error: countError } = await supabase
    .from("mt5_candles")
    .select("*", { count: "exact", head: true })
    .eq("dataset_id", datasetId);

  if (statsError || statsLastError || countError) {
    console.error("mt5_candles stats error");
    return NextResponse.json({ error: "Failed to compute dataset metadata" }, { status: 500 });
  }

  const startDate = stats?.[0]?.ts.slice(0, 10) ?? candles[0].timestamp.slice(0, 10);
  const endDate = statsLast?.[0]?.ts.slice(0, 10) ?? candles[candles.length - 1].timestamp.slice(0, 10);
  const candleCount = count ?? candles.length;

  const { data: updatedDataset, error: updateError } = await supabase
    .from("mt5_datasets")
    .update({
      start_date: startDate,
      end_date: endDate,
      candle_count: candleCount,
      uploaded_at: new Date().toISOString(),
    })
    .eq("id", datasetId)
    .select("id, asset, timeframe, start_date, end_date, candle_count, uploaded_at, broker_timezone")
    .single();

  if (updateError || !updatedDataset) {
    console.error("mt5_datasets update error:", updateError?.message);
    return NextResponse.json({ error: "Failed to update dataset metadata" }, { status: 500 });
  }

  return NextResponse.json(
    { dataset: updatedDataset, had_conflict: hadConflict },
    { status: isNewDataset ? 201 : 200 }
  );
}
