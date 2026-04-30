import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

// PROJ-37: GET / DELETE /api/mt5/tester/runs/[id]
// Single-run detail view + owner-scoped deletion. RLS handles the
// authorization at the DB layer; we still require an authenticated user.

function extractId(request: NextRequest): string | null {
  const segments = request.nextUrl.pathname.split("/");
  const id = segments[segments.length - 1];
  if (!id || !z.string().uuid().safeParse(id).success) {
    return null;
  }
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

  const id = extractId(request);
  if (!id) {
    return NextResponse.json({ error: "Invalid run ID format" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("mt5_tester_runs")
    .select(
      `
      id, mql_conversion_id, expert_name, symbol, timeframe,
      from_date, to_date, parameters, model, status,
      error_message, queue_position, bridge_job_id,
      started_at, finished_at, last_status_at,
      metrics:mt5_tester_metrics (
        total_net_profit, sharpe_ratio, profit_factor,
        max_drawdown_abs, max_drawdown_pct,
        total_trades, won_trades, lost_trades, average_trade
      )
    `
    )
    .eq("id", id)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("mt5_tester_runs fetch error:", error.message);
    return NextResponse.json({ error: "Failed to load run" }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = extractId(request);
  if (!id) {
    return NextResponse.json({ error: "Invalid run ID format" }, { status: 400 });
  }

  const { error, count } = await supabase
    .from("mt5_tester_runs")
    .delete({ count: "exact" })
    .eq("id", id);

  if (error) {
    console.error("mt5_tester_runs delete error:", error.message);
    return NextResponse.json({ error: "Failed to delete run" }, { status: 500 });
  }

  if (!count) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  return NextResponse.json({ deleted: true });
}
