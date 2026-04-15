import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const CheckQuerySchema = z.object({
  asset: z.string().min(1).max(32).transform((v) => v.toUpperCase()),
  timeframe: z.string().min(1),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
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

  const rawParams = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = CheckQuerySchema.safeParse(rawParams);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { asset, timeframe, start_date, end_date } = parsed.data;

  const { data: dataset, error } = await supabase
    .from("mt5_datasets")
    .select("id, asset, timeframe, start_date, end_date, candle_count")
    .eq("user_id", user.id)
    .eq("asset", asset)
    .eq("timeframe", timeframe)
    .maybeSingle();

  if (error) {
    console.error("mt5_datasets check error:", error.message);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  if (!dataset) {
    return NextResponse.json({ available: false });
  }

  let coversRange: boolean | undefined;
  if (start_date && end_date) {
    coversRange = dataset.start_date <= start_date && dataset.end_date >= end_date;
  }

  return NextResponse.json({
    available: true,
    covers_range: coversRange,
    start_date: dataset.start_date,
    end_date: dataset.end_date,
    candle_count: dataset.candle_count,
  });
}
