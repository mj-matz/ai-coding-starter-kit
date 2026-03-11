import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";

const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute

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

  // Rate limiting (per user)
  const rateLimit = checkRateLimit(
    `data-available:${user.id}`,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS
  );

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(
            Math.ceil((rateLimit.resetAt - Date.now()) / 1000)
          ),
        },
      }
    );
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
