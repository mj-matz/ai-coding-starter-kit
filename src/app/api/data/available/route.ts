import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_SECONDS = 60;

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

  // Rate limiting via Supabase (persistent across serverless instances)
  try {
    const { data: allowed, error: rlError } = await supabase.rpc(
      "check_rate_limit",
      {
        p_key: `data-available:${user.id}`,
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

  // Parse optional query params for filtering
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");
  const source = searchParams.get("source");
  const timeframe = searchParams.get("timeframe");

  // Build query with optional filters
  let query = supabase
    .from("data_cache")
    .select(
      "id, symbol, source, timeframe, date_from, date_to, file_size_bytes, row_count, created_at, updated_at, created_by"
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (symbol) {
    query = query.eq("symbol", symbol.toUpperCase());
  }
  if (source) {
    query = query.eq("source", source);
  }
  if (timeframe) {
    query = query.eq("timeframe", timeframe);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Supabase query error:", error);
    return NextResponse.json(
      { error: "Failed to fetch cached data entries" },
      { status: 500 }
    );
  }

  return NextResponse.json({ data });
}
