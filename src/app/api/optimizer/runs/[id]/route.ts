import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

// ── Helper: extract ID from URL ─────────────────────────────────────────────

function extractId(request: NextRequest): string | null {
  const segments = request.nextUrl.pathname.split("/");
  const id = segments[segments.length - 1];
  if (!id || !z.string().uuid().safeParse(id).success) {
    return null;
  }
  return id;
}

// ── GET /api/optimizer/runs/[id] ─────────────────────────────────────────────
// Returns a single optimization run with all result rows

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
    return NextResponse.json(
      { error: "Invalid run ID format" },
      { status: 400 }
    );
  }

  // RLS handles access control (user sees own + admin sees all)
  const { data: run, error: runError } = await supabase
    .from("optimization_runs")
    .select("*")
    .eq("id", id)
    .single();

  if (runError || !run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  // Fetch all result rows for this run
  const { data: results, error: resultsError } = await supabase
    .from("optimization_results")
    .select("*")
    .eq("run_id", id)
    .order("id", { ascending: true });

  if (resultsError) {
    console.error("Failed to fetch optimization results:", resultsError.message);
    return NextResponse.json(
      { error: "Failed to fetch optimization results" },
      { status: 500 }
    );
  }

  return NextResponse.json({ run, results: results ?? [] });
}

// ── PATCH /api/optimizer/runs/[id] ───────────────────────────────────────────
// Merge a partial config update (e.g. post-hoc hard constraint) into the run's config JSON.

const PatchRunSchema = z.object({
  hard_constraint: z.object({
    metric: z.enum(["profit_factor", "sharpe_ratio", "win_rate", "net_profit", "max_drawdown_pct", "recovery_factor"]),
    threshold: z.number(),
    direction: z.enum([">=", "<="]),
  }).nullable(),
});

export async function PATCH(request: NextRequest) {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = PatchRunSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Fetch current config to merge into
  const { data: run, error: fetchError } = await supabase
    .from("optimization_runs")
    .select("config")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (fetchError || !run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const updatedConfig = {
    ...(run.config as Record<string, unknown>),
    hard_constraint: parsed.data.hard_constraint,
  };

  const { error: updateError } = await supabase
    .from("optimization_runs")
    .update({ config: updatedConfig })
    .eq("id", id)
    .eq("user_id", user.id);

  if (updateError) {
    console.error("Failed to patch optimization run config:", updateError.message);
    return NextResponse.json({ error: "Failed to update run" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

// ── DELETE /api/optimizer/runs/[id] ──────────────────────────────────────────
// Permanently delete an optimization run and its results (CASCADE)

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
    return NextResponse.json(
      { error: "Invalid run ID format" },
      { status: 400 }
    );
  }

  // RLS ensures only owner can delete
  const { error, count } = await supabase
    .from("optimization_runs")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    console.error("Failed to delete optimization run:", error.message);
    return NextResponse.json(
      { error: "Failed to delete optimization run" },
      { status: 500 }
    );
  }

  if (count === 0) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
