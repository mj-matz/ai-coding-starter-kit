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
