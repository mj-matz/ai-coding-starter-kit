import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

// ── Zod schema for PATCH body (rename) ──────────────────────────────────────

const RenameRunSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(200, "Name must be 200 characters or less")
    .trim(),
});

// ── Helper: extract ID from URL ─────────────────────────────────────────────

function extractId(request: NextRequest): string | null {
  const segments = request.nextUrl.pathname.split("/");
  // URL: /api/backtest/runs/[id] → last segment is the id
  const id = segments[segments.length - 1];
  if (!id || !z.string().uuid().safeParse(id).success) {
    return null;
  }
  return id;
}

// ── GET /api/backtest/runs/[id] ─────────────────────────────────────────────
// Returns a single run with all data (including trade_log and charts)

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
  const { data, error } = await supabase
    .from("backtest_runs")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  return NextResponse.json({ run: data });
}

// ── DELETE /api/backtest/runs/[id] ──────────────────────────────────────────
// Permanently delete a run

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
    .from("backtest_runs")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    console.error("Failed to delete backtest run:", error.message);
    return NextResponse.json(
      { error: "Failed to delete backtest run" },
      { status: 500 }
    );
  }

  if (count === 0) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}

// ── PATCH /api/backtest/runs/[id] ───────────────────────────────────────────
// Rename a run

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
    return NextResponse.json(
      { error: "Invalid run ID format" },
      { status: 400 }
    );
  }

  // Parse body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate
  const parsed = RenameRunSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // RLS ensures only owner can update
  const { data, error } = await supabase
    .from("backtest_runs")
    .update({ name: parsed.data.name })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, name")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Run not found or update failed" },
      { status: 404 }
    );
  }

  return NextResponse.json({ run: data });
}
