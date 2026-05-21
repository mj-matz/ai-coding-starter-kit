import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/mt5/ea/list — returns compiled EAs from the MT5 Experts folder
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const FASTAPI_URL = process.env.FASTAPI_URL;
  if (!FASTAPI_URL) {
    return NextResponse.json({ error: "FastAPI service URL not configured" }, { status: 503 });
  }

  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    const headers: Record<string, string> = { "X-User-Id": user.id };
    if (session?.access_token) {
      headers["Authorization"] = `Bearer ${session.access_token}`;
    }

    const response = await fetch(`${FASTAPI_URL}/mt5/ea/list`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });

    const data = await response.json();
    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return NextResponse.json({ error: "Bridge did not respond in time." }, { status: 504 });
    }
    return NextResponse.json({ error: "Failed to connect to MT5 service" }, { status: 502 });
  }
}
