import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const FASTAPI_URL = process.env.FASTAPI_URL;
const UPSTREAM_TIMEOUT_MS = 10_000;

// ── Helper: extract jobId from URL ──────────────────────────────────────────

function extractJobId(request: NextRequest): string | null {
  const segments = request.nextUrl.pathname.split("/");
  const id = segments[segments.length - 1];
  if (!id || !z.string().uuid().safeParse(id).success) {
    return null;
  }
  return id;
}

// ── POST /api/optimizer/cancel/[jobId] ───────────────────────────────────────

export async function POST(request: NextRequest) {
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
      "Content-Type": "application/json",
      "X-User-Id": user.id,
    };

    if (session?.access_token) {
      headers["Authorization"] = `Bearer ${session.access_token}`;
    }

    const response = await fetch(`${FASTAPI_URL}/optimize/cancel/${jobId}`, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    const data = await response.json();

    // Update Supabase status to cancelled
    if (response.ok) {
      await supabase
        .from("optimization_runs")
        .update({
          status: "cancelled",
          finished_at: new Date().toISOString(),
        })
        .eq("id", jobId)
        .eq("user_id", user.id);
    }

    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return NextResponse.json(
        { error: "Cancel request timed out" },
        { status: 504 }
      );
    }
    console.error("Optimizer cancel proxy error:", error);
    return NextResponse.json(
      { error: "Failed to cancel optimizer job" },
      { status: 502 }
    );
  }
}
