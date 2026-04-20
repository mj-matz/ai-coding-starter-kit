import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { USER_STRATEGY_LIMIT } from "@/lib/strategy-types";

const RESERVED_NAMES = new Set(["breakout", "smc", "time_range_breakout"]);

const CreateSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(300).optional(),
  python_code: z.string().min(1),
  parameter_schema: z.record(z.string(), z.unknown()).default({}),
  source_conversion_id: z.string().uuid().optional(),
  overwrite: z.boolean().default(false),
});

// Columns returned to clients — python_code is intentionally excluded
const PUBLIC_COLUMNS = "id, user_id, name, description, parameter_schema, source_conversion_id, created_at, updated_at";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isAdmin = (request.nextUrl.searchParams.get("admin") === "true")
    && (user.app_metadata?.role === "admin");

  let query = supabase
    .from("user_strategies")
    .select(PUBLIC_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(200);

  if (!isAdmin) {
    query = query.eq("user_id", user.id);
  }

  const { data, error } = await query;
  if (error) {
    console.error("user_strategies GET error:", error.message);
    return NextResponse.json({ error: "Failed to load strategies" }, { status: 500 });
  }

  return NextResponse.json({ strategies: data });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { name, description, python_code, parameter_schema, source_conversion_id, overwrite } = parsed.data;

  // Guard reserved built-in names
  if (RESERVED_NAMES.has(name.toLowerCase())) {
    return NextResponse.json(
      { error: `"${name}" is a reserved strategy name` },
      { status: 409 }
    );
  }

  if (overwrite) {
    // Upsert — delete existing by (user_id, name) then insert
    const { error: delError } = await supabase
      .from("user_strategies")
      .delete()
      .eq("user_id", user.id)
      .eq("name", name);

    if (delError) {
      console.error("user_strategies overwrite delete error:", delError.message);
      return NextResponse.json({ error: "Failed to overwrite strategy" }, { status: 500 });
    }
  } else {
    // Check name collision
    const { data: existing } = await supabase
      .from("user_strategies")
      .select("id")
      .eq("user_id", user.id)
      .eq("name", name)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: "A strategy with this name already exists", conflict: true }, { status: 409 });
    }

    // Enforce 50-strategy cap
    const { count, error: countError } = await supabase
      .from("user_strategies")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);

    if (countError) {
      console.error("user_strategies count error:", countError.message);
    } else if ((count ?? 0) >= USER_STRATEGY_LIMIT) {
      return NextResponse.json(
        { error: `Library limit reached (${USER_STRATEGY_LIMIT}). Delete a strategy to add a new one.` },
        { status: 422 }
      );
    }
  }

  const { data, error } = await supabase
    .from("user_strategies")
    .insert({
      user_id: user.id,
      name,
      description: description ?? null,
      python_code,
      parameter_schema,
      source_conversion_id: source_conversion_id ?? null,
    })
    .select(PUBLIC_COLUMNS)
    .single();

  if (error) {
    console.error("user_strategies insert error:", error.message);
    return NextResponse.json({ error: "Failed to save strategy" }, { status: 500 });
  }

  return NextResponse.json({ strategy: data }, { status: 201 });
}
