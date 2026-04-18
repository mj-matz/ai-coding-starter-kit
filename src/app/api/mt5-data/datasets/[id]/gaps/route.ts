import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export interface Mt5GapsResponse {
  dataset_id: string;
  start_date: string;
  end_date: string;
  expected_days: number;
  days_with_data: number;
  missing_dates: string[];
  candles_per_day: Record<string, number>;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid dataset ID" }, { status: 400 });
  }

  const { data: dataset, error: dsError } = await supabase
    .from("mt5_datasets")
    .select("id, start_date, end_date")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (dsError || !dataset) {
    return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
  }

  const { data: rows, error: rpcError } = await supabase.rpc("get_mt5_candle_dates", {
    p_dataset_id: id,
  });

  if (rpcError) {
    console.error("get_mt5_candle_dates rpc error:", rpcError.message);
    return NextResponse.json({ error: "Failed to analyze gaps" }, { status: 500 });
  }

  const candlesPerDay: Record<string, number> = {};
  for (const row of rows ?? []) {
    candlesPerDay[row.trade_date as string] = Number(row.candle_count);
  }

  const missingDates: string[] = [];
  let expectedDays = 0;

  const cursor = new Date(dataset.start_date + "T00:00:00Z");
  const end = new Date(dataset.end_date + "T00:00:00Z");

  while (cursor <= end) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      expectedDays++;
      const dateStr = cursor.toISOString().slice(0, 10);
      if (!candlesPerDay[dateStr]) {
        missingDates.push(dateStr);
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const response: Mt5GapsResponse = {
    dataset_id: id,
    start_date: dataset.start_date,
    end_date: dataset.end_date,
    expected_days: expectedDays,
    days_with_data: expectedDays - missingDates.length,
    missing_dates: missingDates,
    candles_per_day: candlesPerDay,
  };

  return NextResponse.json(response);
}
