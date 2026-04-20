import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const PUBLIC_COLUMNS = "id, user_id, name, description, parameter_schema, source_conversion_id, created_at, updated_at";
const RESERVED_NAMES = new Set(["breakout", "smc", "time_range_breakout"]);

const PatchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(300).nullable().optional(),
}).refine((d) => d.name !== undefined || d.description !== undefined, {
  message: "Provide at least one of: name, description",
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

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

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  if (parsed.data.name !== undefined && RESERVED_NAMES.has(parsed.data.name.toLowerCase())) {
    return NextResponse.json(
      { error: `"${parsed.data.name}" is a reserved strategy name` },
      { status: 409 }
    );
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description;

  const { data, error } = await supabase
    .from("user_strategies")
    .update(updates)
    .eq("id", id)
    .eq("user_id", user.id)
    .select(PUBLIC_COLUMNS)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
    }
    // Unique constraint violation (duplicate name)
    if (error.code === "23505") {
      return NextResponse.json({ error: "A strategy with this name already exists", conflict: true }, { status: 409 });
    }
    console.error("user_strategies PATCH error:", error.message);
    return NextResponse.json({ error: "Failed to update strategy" }, { status: 500 });
  }

  return NextResponse.json({ strategy: data });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error } = await supabase
    .from("user_strategies")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    console.error("user_strategies DELETE error:", error.message);
    return NextResponse.json({ error: "Failed to delete strategy" }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}
