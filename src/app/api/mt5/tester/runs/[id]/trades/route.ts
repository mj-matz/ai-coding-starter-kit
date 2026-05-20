import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

// PROJ-41: GET /api/mt5/tester/runs/[id]/trades
// Returns the individual trades stored for a completed MT5 tester run.
// Explicit ownership check: returns 403 when the run belongs to a different user.

function extractRunId(request: NextRequest): string | null {
  const segments = request.nextUrl.pathname.split("/");
  // /api/mt5/tester/runs/<uuid>/trades → UUID is second-to-last segment
  const id = segments[segments.length - 2];
  if (!id || !z.string().uuid().safeParse(id).success) return null;
  return id;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = extractRunId(request);
  if (!id) {
    return NextResponse.json({ error: "Invalid run ID format" }, { status: 400 });
  }

  // Verify ownership explicitly before querying trades (RLS is the second line of defense).
  const { data: run, error: runError } = await supabase
    .from("mt5_tester_runs")
    .select("user_id")
    .eq("id", id)
    .maybeSingle();

  if (runError) {
    console.error("mt5_tester_runs ownership check error:", runError.message);
    return NextResponse.json({ error: "Failed to load run" }, { status: 500 });
  }

  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  if (run.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: trades, error: tradesError } = await supabase
    .from("mt5_tester_trades")
    .select("id, open_time, close_time, direction, volume, open_price, close_price, profit, comment")
    .eq("run_id", id)
    .order("open_time", { ascending: true })
    .limit(5000);

  if (tradesError) {
    console.error("mt5_tester_trades fetch error:", tradesError.message);
    return NextResponse.json({ error: "Failed to load trades" }, { status: 500 });
  }

  return NextResponse.json({ trades: trades ?? [] });
}
