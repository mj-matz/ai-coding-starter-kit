import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const FASTAPI_URL = process.env.FASTAPI_URL;
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_SECONDS = 60;

const fetchRequestSchema = z.object({
  symbol: z.string().min(1).max(20),
  source: z.enum(["dukascopy", "yfinance"]),
  timeframe: z.enum(["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1wk", "1mo"]),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  force_refresh: z.boolean().optional().default(false),
});

export async function POST(request: NextRequest) {
  // Auth check
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limiting via Supabase (persistent across serverless instances)
  try {
    const { data: allowed, error: rlError } = await supabase.rpc(
      "check_rate_limit",
      {
        p_key: `data-fetch:${user.id}`,
        p_max_requests: RATE_LIMIT_MAX,
        p_window_seconds: RATE_LIMIT_WINDOW_SECONDS,
      }
    );

    if (rlError) {
      console.error("Rate limit check failed:", rlError.message);
    } else if (!allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Try again in 60 seconds." },
        {
          status: 429,
          headers: { "Retry-After": String(RATE_LIMIT_WINDOW_SECONDS) },
        }
      );
    }
  } catch (err) {
    console.error("Rate limit check threw:", err);
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

  const parsed = fetchRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Validate date range
  if (parsed.data.date_from >= parsed.data.date_to) {
    return NextResponse.json(
      { error: "date_from must be before date_to" },
      { status: 400 }
    );
  }

  if (!FASTAPI_URL) {
    return NextResponse.json(
      { error: "FastAPI service URL not configured" },
      { status: 503 }
    );
  }

  // Forward to FastAPI with user context
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

    const response = await fetch(`${FASTAPI_URL}/fetch`, {
      method: "POST",
      headers,
      body: JSON.stringify(parsed.data),
    });

    const data = await response.json();

    // Strip server filesystem path before returning to client (BUG-3)
    if (data && typeof data === "object" && "file_path" in data) {
      delete (data as Record<string, unknown>).file_path;
    }

    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("FastAPI proxy error:", error);
    return NextResponse.json(
      { error: "Failed to connect to data service" },
      { status: 502 }
    );
  }
}
