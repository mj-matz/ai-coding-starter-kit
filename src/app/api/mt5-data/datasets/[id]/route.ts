import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Admin-only delete
  const jwt = await supabase.auth.getSession();
  const role = (jwt.data.session?.user?.app_metadata as Record<string, unknown> | undefined)?.role;
  if (role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  // Basic UUID format check
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid dataset ID" }, { status: 400 });
  }

  const { error, count } = await supabase
    .from("mt5_datasets")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    console.error("mt5_datasets delete error:", error.message);
    return NextResponse.json({ error: "Failed to delete dataset" }, { status: 500 });
  }

  if (count === 0) {
    return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
  }

  return new NextResponse(null, { status: 204 });
}
