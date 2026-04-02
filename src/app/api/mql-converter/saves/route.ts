import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

// ── Zod schema for POST ──────────────────────────────────────────────────────

const SaveConversionSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name must not exceed 100 characters"),
  mql_code: z.string().min(1).max(50000),
  mql_version: z.enum(["mql4", "mql5", "auto"]),
  python_code: z.string().min(1),
  mapping_report: z.array(
    z.object({
      mql_function: z.string(),
      python_equivalent: z.string(),
      status: z.enum(["mapped", "approximated", "unsupported"]),
      note: z.string().optional(),
    })
  ),
  backtest_result: z.record(z.string(), z.unknown()).optional(),
});

// ── GET: list saved conversions ──────────────────────────────────────────────

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("mql_conversions")
    .select("id, name, mql_version, created_at, backtest_result")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("Failed to list MQL conversions:", error.message);
    return NextResponse.json(
      { error: "Failed to load saved conversions" },
      { status: 500 }
    );
  }

  return NextResponse.json({ conversions: data });
}

// ── POST: save a conversion ──────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Parse body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate
  const parsed = SaveConversionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("mql_conversions")
    .insert({
      user_id: user.id,
      name: parsed.data.name,
      mql_code: parsed.data.mql_code,
      mql_version: parsed.data.mql_version,
      python_code: parsed.data.python_code,
      mapping_report: parsed.data.mapping_report,
      backtest_result: parsed.data.backtest_result ?? null,
    })
    .select("id, name, created_at")
    .single();

  if (error) {
    console.error("Failed to save MQL conversion:", error.message);
    return NextResponse.json(
      { error: "Failed to save conversion" },
      { status: 500 }
    );
  }

  return NextResponse.json({ conversion: data }, { status: 201 });
}
