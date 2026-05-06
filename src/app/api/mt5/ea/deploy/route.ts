import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

// PROJ-40: POST /api/mt5/ea/deploy
//
// Validates the user, rate-limits per-user, then proxies the deploy to the
// Python backend, which renders the .mq5 (when needed) and forwards it to the
// MT5 Bridge Worker for compile. Next.js never speaks to the bridge directly.

export const maxDuration = 150;

const FASTAPI_URL = process.env.FASTAPI_URL;
// Python deploy timeout = 120s (compile + headroom). Add 10s margin so the
// upstream's own timeout error reaches us before our AbortSignal fires.
const UPSTREAM_TIMEOUT_MS = 130_000;

// 10 deploys per minute, per user. Aligns with the Bridge Worker's
// single-threaded compile process — burst protection more than throttling.
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_SECONDS = 60;

// 2 MB ceiling on the .mq5 payload. Mirrors the Python validator; the API
// rejects oversized bodies before we cross the network to FastAPI.
const MAX_MQ5_BYTES = 2_000_000;

const EaDeployParameterSchema = z.object({
  mql_input_name: z.string().min(1).max(128),
  current_value: z.union([z.number(), z.string(), z.boolean()]),
  type: z.enum(["number", "integer", "string", "boolean"]),
});

const EaDeployRequestSchema = z
  .object({
    ea_name: z
      .string()
      .min(1)
      .max(64)
      .regex(
        /^[A-Za-z0-9_\-]+$/,
        "ea_name may contain only letters, digits, underscore and hyphen.",
      ),
    source: z.enum(["mql_converter", "mt5_optimizer"]),
    mq5_content: z.string().max(MAX_MQ5_BYTES).optional(),
    mql_conversion_id: z.string().uuid().optional(),
    optimizer_run_id: z.string().uuid().optional(),
    optimizer_result_rank: z.number().int().min(0).optional(),
    parameters: z.array(EaDeployParameterSchema).max(256).optional(),
    symbol: z.string().max(32).optional(),
    date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    conversion_name: z.string().max(128).optional(),
  })
  .refine(
    (v) => v.source !== "mql_converter" || !!v.mq5_content,
    {
      message: "mq5_content is required for the mql_converter flow.",
      path: ["mq5_content"],
    },
  )
  .refine(
    (v) => v.source !== "mt5_optimizer" || !!v.mql_conversion_id,
    {
      message: "mql_conversion_id is required for the mt5_optimizer flow.",
      path: ["mql_conversion_id"],
    },
  );

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Rate limit ─────────────────────────────────────────────────────────
  try {
    const { data: allowed, error: rlError } = await supabase.rpc(
      "check_rate_limit",
      {
        p_key: `mt5-ea-deploy:${user.id}`,
        p_max_requests: RATE_LIMIT_MAX,
        p_window_seconds: RATE_LIMIT_WINDOW_SECONDS,
      },
    );

    if (rlError) {
      console.error("EA deploy rate limit check failed:", rlError.message);
      return NextResponse.json(
        { error: "Rate limit service unavailable. Please try again." },
        { status: 503 },
      );
    }
    if (!allowed) {
      return NextResponse.json(
        {
          error: `Rate limit exceeded. Max ${RATE_LIMIT_MAX} deploys per minute.`,
        },
        {
          status: 429,
          headers: { "Retry-After": String(RATE_LIMIT_WINDOW_SECONDS) },
        },
      );
    }
  } catch (err) {
    console.error("EA deploy rate limit check threw:", err);
    // Fall through — don't fail-closed on a transient RPC outage. The Python
    // backend still validates and the bridge is single-threaded anyway.
  }

  // ── Parse + validate body ──────────────────────────────────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = EaDeployRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  if (!FASTAPI_URL) {
    return NextResponse.json(
      { error: "FastAPI service URL not configured" },
      { status: 503 },
    );
  }

  // ── Forward to Python backend ──────────────────────────────────────────
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

    const response = await fetch(`${FASTAPI_URL}/mt5/ea/deploy`, {
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
        { error: "Deploy timed out — the bridge did not respond in time." },
        { status: 504 },
      );
    }
    console.error("MT5 EA deploy proxy error:", error);
    return NextResponse.json(
      { error: "Failed to connect to MT5 service" },
      { status: 502 },
    );
  }
}
