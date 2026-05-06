import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

// PROJ-40: GET /api/mt5/ea/deployments
//
// Paginated history of the calling user's EA deploys (newest first).
// Reads directly from Supabase via RLS — no need to round-trip through the
// Python backend for a plain list query.

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  status: z
    .enum(["pending", "compiled", "compile_error", "timeout", "failed"])
    .optional(),
});

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse({
    limit: url.searchParams.get("limit") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query parameters", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { limit, offset, status } = parsed.data;

  let query = supabase
    .from("mt5_ea_deployments")
    .select(
      `id, ea_name, source, mql_conversion_id, optimizer_run_id,
       optimizer_result_rank, status, error_message, warnings,
       errors, log_excerpt, deployed_at`,
      { count: "exact" },
    )
    .eq("user_id", user.id)
    .order("deployed_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) {
    query = query.eq("status", status);
  }

  const { data, count, error } = await query;

  if (error) {
    console.error("mt5_ea_deployments list error:", error.message);
    return NextResponse.json(
      { error: "Failed to load EA deployments" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    deployments: data ?? [],
    total: count ?? (data?.length ?? 0),
    limit,
    offset,
  });
}
