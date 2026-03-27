import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// ── GET /api/optimizer/runs ──────────────────────────────────────────────────
// Returns list of past optimization runs (without individual results for perf)

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isAdmin = user.app_metadata?.role === "admin";

  let query = supabase
    .from("optimization_runs")
    .select(
      "id, user_id, asset, date_from, date_to, strategy, parameter_group, target_metric, total_combinations, completed_combinations, status, best_result, created_at, finished_at"
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (!isAdmin) {
    query = query.eq("user_id", user.id);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Failed to fetch optimization runs:", error.message);
    return NextResponse.json(
      { error: "Failed to fetch optimization runs" },
      { status: 500 }
    );
  }

  return NextResponse.json({ runs: data });
}
