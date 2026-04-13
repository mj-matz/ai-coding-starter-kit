import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

// ── Zod schema for POST ──────────────────────────────────────────────────────

const StrategyParameterSchema = z.object({
  name: z.string(),
  label: z.string(),
  type: z.enum(["number", "integer", "string"]),
  default: z.union([z.number(), z.string()]),
  mql_input_name: z.string(),
});

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
  parameters: z.array(StrategyParameterSchema).optional(),
  parameter_values: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
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

  // Build parameters JSON: store the parameter definitions with current values overlaid
  let parametersJson: unknown = null;
  if (parsed.data.parameters && parsed.data.parameters.length > 0) {
    const paramValues = parsed.data.parameter_values ?? {};
    parametersJson = {
      definitions: parsed.data.parameters,
      values: paramValues,
    };
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
      parameters: parametersJson,
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
