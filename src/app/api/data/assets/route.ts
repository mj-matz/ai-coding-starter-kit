import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const FASTAPI_URL = process.env.FASTAPI_URL;

export async function GET() {
  // Auth check
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!FASTAPI_URL) {
    return NextResponse.json(
      { error: "FastAPI service URL not configured" },
      { status: 503 }
    );
  }

  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    const headers: Record<string, string> = {};

    if (session?.access_token) {
      headers["Authorization"] = `Bearer ${session.access_token}`;
    }

    const response = await fetch(`${FASTAPI_URL}/assets`, {
      headers,
      // Cache for 5 minutes — the instrument list rarely changes
      next: { revalidate: 300 },
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      return NextResponse.json(
        { error: body.detail || "Failed to load asset list" },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    console.error("Assets proxy error:", error);
    return NextResponse.json(
      { error: "Failed to connect to backtesting service" },
      { status: 502 }
    );
  }
}
