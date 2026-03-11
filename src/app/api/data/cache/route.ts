import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const FASTAPI_URL = process.env.FASTAPI_URL;

const deleteRequestSchema = z.object({
  id: z.string().uuid("Must be a valid UUID"),
});

export async function DELETE(request: NextRequest) {
  // Auth check
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Admin check: verify is_admin in app_metadata (not user_metadata — client-writable)
  const isAdmin = user.app_metadata?.is_admin === true;
  if (!isAdmin) {
    return NextResponse.json(
      { error: "Forbidden: admin access required" },
      { status: 403 }
    );
  }

  // Validate request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = deleteRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { id } = parsed.data;

  // First: delete the Parquet file via FastAPI (file must go before DB row — BUG-12)
  if (FASTAPI_URL) {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      await fetch(`${FASTAPI_URL}/cache/${id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
      });
    } catch (error) {
      // Log but continue — still remove the DB row even if file delete fails
      console.error("FastAPI cache delete error:", error);
    }
  }

  // Then: delete from Supabase (RLS policy enforces admin-only delete)
  const { error: deleteError } = await supabase
    .from("data_cache")
    .delete()
    .eq("id", id);

  if (deleteError) {
    console.error("Supabase delete error:", deleteError);
    return NextResponse.json(
      { error: "Failed to delete cache entry from database" },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, deleted_id: id });
}
