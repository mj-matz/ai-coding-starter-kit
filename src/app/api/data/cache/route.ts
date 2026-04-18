import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const FASTAPI_URL = process.env.FASTAPI_URL;

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isAdmin = user.app_metadata?.is_admin === true;
  if (!isAdmin) {
    return NextResponse.json(
      { error: "Forbidden: admin access required" },
      { status: 403 }
    );
  }

  if (!FASTAPI_URL) {
    return NextResponse.json({ error: "FASTAPI_URL not configured" }, { status: 503 });
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  try {
    const res = await fetch(`${FASTAPI_URL}/cache/grouped`, {
      headers: {
        Authorization: `Bearer ${session?.access_token ?? ""}`,
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return NextResponse.json(
        { error: (body as { detail?: string }).detail ?? "Failed to fetch cache" },
        { status: res.status }
      );
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("FastAPI cache/grouped error:", error);
    return NextResponse.json({ error: "Failed to reach data service" }, { status: 502 });
  }
}

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

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (FASTAPI_URL) {
    // FastAPI handles both file deletion and DB row removal atomically.
    try {
      const res = await fetch(`${FASTAPI_URL}/cache/${id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return NextResponse.json(
          { error: (body as { detail?: string }).detail ?? "Failed to delete cache entry" },
          { status: res.status }
        );
      }
    } catch (error) {
      console.error("FastAPI cache delete error:", error);
      return NextResponse.json({ error: "Failed to reach data service" }, { status: 502 });
    }
  } else {
    // No FastAPI available — remove the DB row only (Parquet file cannot be cleaned up).
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
  }

  return NextResponse.json({ success: true, deleted_id: id });
}
