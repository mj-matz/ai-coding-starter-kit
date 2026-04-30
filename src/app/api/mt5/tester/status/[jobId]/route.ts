import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

// PROJ-37: GET /api/mt5/tester/status/[jobId]
// Polled every 2s by the MQL Converter UI. Proxies to the Python backend.

const FASTAPI_URL = process.env.FASTAPI_URL;
const UPSTREAM_TIMEOUT_MS = 10_000;

function extractJobId(request: NextRequest): string | null {
  const segments = request.nextUrl.pathname.split("/");
  const id = segments[segments.length - 1];
  if (!id || !z.string().uuid().safeParse(id).success) {
    return null;
  }
  return id;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const jobId = extractJobId(request);
  if (!jobId) {
    return NextResponse.json({ error: "Invalid job ID format" }, { status: 400 });
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

    const headers: Record<string, string> = {
      "X-User-Id": user.id,
    };
    if (session?.access_token) {
      headers["Authorization"] = `Bearer ${session.access_token}`;
    }

    const response = await fetch(`${FASTAPI_URL}/mt5/tester/status/${jobId}`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return NextResponse.json(
        { error: "Status check timed out" },
        { status: 504 }
      );
    }
    console.error("MT5 tester status proxy error:", error);
    return NextResponse.json(
      { error: "Failed to check MT5 run status" },
      { status: 502 }
    );
  }
}
