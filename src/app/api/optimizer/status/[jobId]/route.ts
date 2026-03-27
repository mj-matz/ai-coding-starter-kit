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

// ── GET /api/optimizer/status/[jobId] ────────────────────────────────────────

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

    const response = await fetch(`${FASTAPI_URL}/optimize/status/${jobId}`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    const data = await response.json();

    // If the job is completed or cancelled, update the Supabase record
    if (response.ok && (data.status === "completed" || data.status === "cancelled")) {
      const updatePayload: Record<string, unknown> = {
        status: data.status,
        completed_combinations: data.completed,
        finished_at: new Date().toISOString(),
      };

      // Find best result based on target metric
      if (data.results && data.results.length > 0) {
        // We need to look up the target_metric for this run
        const { data: runData } = await supabase
          .from("optimization_runs")
          .select("target_metric")
          .eq("id", jobId)
          .single();

        if (runData) {
          const metric = runData.target_metric as string;
          const metricKey = metric === "win_rate" ? "win_rate" : metric;
          const validResults = data.results.filter(
            (r: Record<string, unknown>) => r[metricKey] != null && r.error == null
          );
          if (validResults.length > 0) {
            validResults.sort(
              (a: Record<string, unknown>, b: Record<string, unknown>) =>
                ((b[metricKey] as number) ?? 0) - ((a[metricKey] as number) ?? 0)
            );
            updatePayload.best_result = validResults[0];
          }
        }
      }

      await supabase
        .from("optimization_runs")
        .update(updatePayload)
        .eq("id", jobId)
        .eq("user_id", user.id);
    } else if (response.ok && data.status === "running") {
      // Update progress
      await supabase
        .from("optimization_runs")
        .update({ completed_combinations: data.completed })
        .eq("id", jobId)
        .eq("user_id", user.id);
    }

    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return NextResponse.json(
        { error: "Status check timed out" },
        { status: 504 }
      );
    }
    console.error("Optimizer status proxy error:", error);
    return NextResponse.json(
      { error: "Failed to check optimizer status" },
      { status: 502 }
    );
  }
}
