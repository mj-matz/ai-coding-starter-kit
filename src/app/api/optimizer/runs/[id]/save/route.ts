import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

// ── Zod schema for result rows ──────────────────────────────────────────────

const ResultRowSchema = z.object({
  params: z.record(z.string(), z.unknown()),
  params_hash: z.string().min(1),
  profit_factor: z.number().nullable().optional(),
  sharpe_ratio: z.number().nullable().optional(),
  win_rate: z.number().nullable().optional(),
  total_trades: z.number().int().min(0).default(0),
  net_profit: z.number().nullable().optional(),
  error: z.string().nullable().optional(),
});

const SaveResultsSchema = z.object({
  results: z.array(ResultRowSchema).min(1).max(2000),
  status: z.enum(["completed", "cancelled"]),
});

// ── Helper: extract ID from URL ─────────────────────────────────────────────

function extractId(request: NextRequest): string | null {
  const segments = request.nextUrl.pathname.split("/");
  // URL: /api/optimizer/runs/[id]/save → id is the second-to-last segment
  const id = segments[segments.length - 2];
  if (!id || !z.string().uuid().safeParse(id).success) {
    return null;
  }
  return id;
}

// ── POST /api/optimizer/runs/[id]/save ───────────────────────────────────────
// Persist optimizer results from the FastAPI in-memory job to Supabase.
// Called by the frontend after the job completes.

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const runId = extractId(request);
  if (!runId) {
    return NextResponse.json(
      { error: "Invalid run ID format" },
      { status: 400 }
    );
  }

  // Verify the run exists and belongs to this user
  const { data: run, error: runError } = await supabase
    .from("optimization_runs")
    .select("id, user_id, target_metric")
    .eq("id", runId)
    .eq("user_id", user.id)
    .single();

  if (runError || !run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  // Parse body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = SaveResultsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { results, status } = parsed.data;

  // Insert all result rows in a single batch
  const rows = results.map((r) => ({
    run_id: runId,
    params: r.params,
    params_hash: r.params_hash,
    profit_factor: r.profit_factor ?? null,
    sharpe_ratio: r.sharpe_ratio ?? null,
    win_rate: r.win_rate ?? null,
    total_trades: r.total_trades,
    net_profit: r.net_profit ?? null,
    error: r.error ?? null,
  }));

  const { error: insertError } = await supabase
    .from("optimization_results")
    .insert(rows);

  if (insertError) {
    console.error("Failed to save optimization results:", insertError.message);
    return NextResponse.json(
      { error: "Failed to save optimization results" },
      { status: 500 }
    );
  }

  // Find the best result for quick display in history
  const targetMetric = run.target_metric as string;
  const validResults = results.filter(
    (r) => r[targetMetric as keyof typeof r] != null && r.error == null
  );
  let bestResult = null;
  if (validResults.length > 0) {
    validResults.sort((a, b) => {
      const aVal = (a[targetMetric as keyof typeof a] as number) ?? 0;
      const bVal = (b[targetMetric as keyof typeof b] as number) ?? 0;
      return bVal - aVal;
    });
    bestResult = validResults[0];
  }

  // Update the run status and best result
  const { error: updateError } = await supabase
    .from("optimization_runs")
    .update({
      status,
      completed_combinations: results.length,
      best_result: bestResult,
      finished_at: new Date().toISOString(),
    })
    .eq("id", runId)
    .eq("user_id", user.id);

  if (updateError) {
    console.error("Failed to update optimization run:", updateError.message);
  }

  return NextResponse.json({
    success: true,
    saved_count: results.length,
    best_result: bestResult,
  });
}
