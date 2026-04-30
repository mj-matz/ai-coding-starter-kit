import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

// PROJ-37: GET /api/mt5/tester/runs
// List the current user's MT5 tester runs (history view, analogous to PROJ-9).

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  status: z
    .enum(["pending", "queued", "running", "done", "failed", "cancelled"])
    .optional(),
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

  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse({
    limit: url.searchParams.get("limit") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query parameters", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Use a Supabase join (NOT N+1) to fetch metrics with each run.
  let query = supabase
    .from("mt5_tester_runs")
    .select(
      `
      id, mql_conversion_id, expert_name, symbol, timeframe,
      from_date, to_date, status, error_message, queue_position,
      started_at, finished_at,
      metrics:mt5_tester_metrics (
        total_net_profit, sharpe_ratio, profit_factor,
        max_drawdown_abs, max_drawdown_pct,
        total_trades, won_trades, lost_trades, average_trade
      )
    `
    )
    .eq("user_id", user.id)
    .order("started_at", { ascending: false })
    .limit(parsed.data.limit);

  if (parsed.data.status) {
    query = query.eq("status", parsed.data.status);
  }

  const { data, error } = await query;

  if (error) {
    console.error("mt5_tester_runs list error:", error.message);
    return NextResponse.json(
      { error: "Failed to load MT5 runs" },
      { status: 500 }
    );
  }

  return NextResponse.json({ runs: data ?? [] });
}
