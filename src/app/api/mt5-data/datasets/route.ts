import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("mt5_datasets")
    .select("id, asset, timeframe, start_date, end_date, candle_count, uploaded_at")
    .eq("user_id", user.id)
    .order("uploaded_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("mt5_datasets fetch error:", error.message);
    return NextResponse.json({ error: "Failed to load datasets" }, { status: 500 });
  }

  return NextResponse.json({ datasets: data ?? [] });
}
