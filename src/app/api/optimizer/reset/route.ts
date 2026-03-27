import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/optimizer/reset
// Force-cancels all stuck "running" optimization jobs for the current user.
// Use this when a job is stuck in "running" state (e.g. after a page navigation
// without cancellation, or after a server restart).

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error } = await supabase
    .from("optimization_runs")
    .update({
      status: "cancelled",
      finished_at: new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .eq("status", "running");

  if (error) {
    console.error("Optimizer reset error:", error);
    return NextResponse.json({ error: "Failed to reset optimization jobs" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
