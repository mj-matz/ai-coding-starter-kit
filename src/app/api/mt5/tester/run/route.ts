import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

// PROJ-37: POST /api/mt5/tester/run
// Validates the user, then proxies the run to the Python backend, which in
// turn talks to the MT5 Bridge Worker. The Python backend is the single
// component allowed to reach the bridge — Next.js never speaks to it directly.

export const maxDuration = 60;

const FASTAPI_URL = process.env.FASTAPI_URL;
const UPSTREAM_TIMEOUT_MS = 30_000;

const TIMEFRAMES = [
  "1m",
  "2m",
  "3m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
] as const;

const TesterRunSchema = z.object({
  expert_path: z.string().min(1).max(512),
  expert_name: z.string().min(1).max(128),
  symbol: z
    .string()
    .min(1)
    .max(32)
    .regex(
      /^[A-Za-z0-9._+\-]+$/,
      "Symbol must be alphanumeric (with . _ - +)",
    ),
  timeframe: z.enum(TIMEFRAMES),
  // ISO YYYY-MM-DD; refined for sanity but the Python side re-validates.
  from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  parameters: z.record(z.string(), z.unknown()).default({}),
  model: z.string().max(64).default("EveryTickRealistic"),
  initial_capital: z.number().positive().default(100000),
  mql_conversion_id: z.string().uuid().optional().nullable(),
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = TesterRunSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  if (parsed.data.from_date >= parsed.data.to_date) {
    return NextResponse.json(
      { error: "from_date must be before to_date" },
      { status: 400 }
    );
  }

  if (!FASTAPI_URL) {
    return NextResponse.json(
      { error: "FastAPI service URL not configured" },
      { status: 503 }
    );
  }

  // Forward to the Python backend with the user's JWT.
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

    const response = await fetch(`${FASTAPI_URL}/mt5/tester/run`, {
      method: "POST",
      headers,
      body: JSON.stringify(parsed.data),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return NextResponse.json(
        { error: "Request timed out while submitting MT5 run." },
        { status: 504 }
      );
    }
    console.error("MT5 tester run proxy error:", error);
    return NextResponse.json(
      { error: "Failed to connect to MT5 service" },
      { status: 502 }
    );
  }
}
