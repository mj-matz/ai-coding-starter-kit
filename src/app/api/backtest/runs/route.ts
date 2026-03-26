import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

// ── Rate limiting constants ─────────────────────────────────────────────────
const RATE_LIMIT_MAX = 2;
const RATE_LIMIT_WINDOW_SECONDS = 60;

// ── Zod schema for POST body ────────────────────────────────────────────────

const SaveRunSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(200, "Name must be 200 characters or less")
    .trim(),
  asset: z.string().min(1, "Asset is required"),
  strategy: z.string().min(1, "Strategy is required"),
  config: z.record(z.string(), z.unknown()),
  summary: z.record(z.string(), z.unknown()),
  trade_log: z.array(z.record(z.string(), z.unknown())),
  charts: z.object({
    equity_curve: z.array(z.record(z.string(), z.unknown())).optional(),
    drawdown_curve: z.array(z.record(z.string(), z.unknown())).optional(),
  }),
});

// ── GET /api/backtest/runs ──────────────────────────────────────────────────
// Returns list of saved runs (without trade_log and charts for performance)

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isAdmin = user.user_metadata?.role === "admin";

  // Build query — select only list-relevant columns (no trade_log, charts)
  let query = supabase
    .from("backtest_runs")
    .select("id, user_id, name, asset, strategy, summary, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  // Non-admin users: RLS already filters, but we add explicit filter for clarity
  if (!isAdmin) {
    query = query.eq("user_id", user.id);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Failed to fetch backtest runs:", error.message);
    return NextResponse.json(
      { error: "Failed to fetch backtest runs" },
      { status: 500 }
    );
  }

  return NextResponse.json({ runs: data });
}

// ── POST /api/backtest/runs ─────────────────────────────────────────────────
// Save a new backtest run

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limiting
  try {
    const { data: allowed, error: rlError } = await supabase.rpc(
      "check_rate_limit",
      {
        p_key: `backtest-save:${user.id}`,
        p_max_requests: RATE_LIMIT_MAX,
        p_window_seconds: RATE_LIMIT_WINDOW_SECONDS,
      }
    );

    if (rlError) {
      console.error("Rate limit check failed:", rlError.message);
      return NextResponse.json(
        { error: "Could not verify rate limit. Please try again." },
        { status: 503 }
      );
    }
    if (!allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Max 2 saves per minute." },
        {
          status: 429,
          headers: { "Retry-After": String(RATE_LIMIT_WINDOW_SECONDS) },
        }
      );
    }
  } catch (err) {
    console.error("Rate limit check threw:", err);
    return NextResponse.json(
      { error: "Could not verify rate limit. Please try again." },
      { status: 503 }
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
  const parsed = SaveRunSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { name, asset, strategy, config, summary, trade_log, charts } =
    parsed.data;

  // Insert
  const { data, error } = await supabase
    .from("backtest_runs")
    .insert({
      user_id: user.id,
      name,
      asset,
      strategy,
      config,
      summary,
      trade_log,
      charts,
    })
    .select("id, name, created_at")
    .single();

  if (error) {
    console.error("Failed to save backtest run:", error.message);
    return NextResponse.json(
      { error: "Failed to save backtest run" },
      { status: 500 }
    );
  }

  return NextResponse.json({ run: data }, { status: 201 });
}
