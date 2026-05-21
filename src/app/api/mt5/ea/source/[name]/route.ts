import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/mt5/ea/source/[name]
// Returns { found: true, content: "..." } or { found: false }.
// Proxies to Railway Python which in turn calls the bridge.

const FASTAPI_URL = process.env.FASTAPI_URL;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { name } = await params;

  if (!FASTAPI_URL) {
    return NextResponse.json({ found: false });
  }

  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    const headers: Record<string, string> = { "X-User-Id": user.id };
    if (session?.access_token) {
      headers["Authorization"] = `Bearer ${session.access_token}`;
    }

    const response = await fetch(
      `${FASTAPI_URL}/mt5/ea/source/${encodeURIComponent(name)}`,
      { headers, signal: AbortSignal.timeout(10_000) }
    );

    if (!response.ok) {
      return NextResponse.json({ found: false });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ found: false });
  }
}
