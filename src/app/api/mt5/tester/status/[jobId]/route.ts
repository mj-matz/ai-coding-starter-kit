import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { Mt5RunStatusResponse } from "@/lib/mt5-bridge-types";

// PROJ-37: GET /api/mt5/tester/status/[jobId]
// Polled every 2s by the MQL Converter UI. Proxies to the Python backend.
// PROJ-41: On first `status: "done"` response, persists metrics + trades to
// Supabase and marks the run row as done. Subsequent polls are idempotent.

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

    const data = (await response.json()) as Mt5RunStatusResponse;

    // Persist metrics and trades the first time we see status === "done".
    // Wrapped in try/catch so a DB error never blocks the status response.
    if (response.ok && data.status === "done" && data.metrics) {
      try {
        const { data: run } = await supabase
          .from("mt5_tester_runs")
          .select("id")
          .eq("bridge_job_id", jobId)
          .eq("user_id", user.id)
          .maybeSingle();

        if (run) {
          // Mark run as done in the DB
          await supabase
            .from("mt5_tester_runs")
            .update({
              status: "done",
              ...(data.finished_at && { finished_at: data.finished_at }),
            })
            .eq("id", run.id);

          // Upsert metrics — safe to call on every poll (onConflict: run_id)
          const m = data.metrics;
          await supabase.from("mt5_tester_metrics").upsert(
            {
              run_id: run.id,
              total_net_profit: m.total_net_profit,
              sharpe_ratio: m.sharpe_ratio,
              profit_factor: m.profit_factor,
              max_drawdown_abs: m.max_drawdown_abs,
              max_drawdown_pct: m.max_drawdown_pct,
              total_trades: m.total_trades,
              won_trades: m.won_trades,
              lost_trades: m.lost_trades,
              average_trade: m.average_trade,
            },
            { onConflict: "run_id" }
          );

          // Insert trades only once — COUNT check prevents duplicates on
          // subsequent polls without needing a composite unique key migration.
          if (Array.isArray(data.trades) && data.trades.length > 0) {
            const { count } = await supabase
              .from("mt5_tester_trades")
              .select("id", { count: "exact", head: true })
              .eq("run_id", run.id);

            if (count === 0) {
              await supabase.from("mt5_tester_trades").insert(
                data.trades.map((t) => ({
                  run_id: run.id,
                  open_time: t.open_time,
                  close_time: t.close_time,
                  direction: t.direction,
                  volume: t.volume,
                  open_price: t.open_price,
                  close_price: t.close_price,
                  profit: t.profit,
                  comment: t.comment,
                }))
              );
            }
          }
        }
      } catch (err) {
        console.error("MT5 metrics/trades persistence error:", err);
      }
    }

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
