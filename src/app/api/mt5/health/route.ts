import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// PROJ-37: GET /api/mt5/health
// Cached 10s on the route layer (matches the Python-side cache TTL) so that
// background-tab polling at 30s never overwhelms the bridge even with
// multiple browser tabs open.

const FASTAPI_URL = process.env.FASTAPI_URL;
const UPSTREAM_TIMEOUT_MS = 10_000;

type CachedHealth = {
  expiresAt: number;
  payload: unknown;
  status: number;
};

const CACHE_TTL_MS = 10_000;
const cache: { value: CachedHealth | null } = { value: null };

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  if (cache.value && cache.value.expiresAt > now) {
    return NextResponse.json(cache.value.payload, { status: cache.value.status });
  }

  if (!FASTAPI_URL) {
    return NextResponse.json(
      { online: false, error: "FastAPI service URL not configured" },
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

    const response = await fetch(`${FASTAPI_URL}/mt5/health`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    const data = await response.json();
    cache.value = {
      expiresAt: now + CACHE_TTL_MS,
      payload: data,
      status: response.status,
    };
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    const offlinePayload = {
      online: false,
      error:
        error instanceof Error && error.name === "TimeoutError"
          ? "Health check timed out"
          : "Bridge Worker not reachable",
    };
    cache.value = {
      expiresAt: now + CACHE_TTL_MS,
      payload: offlinePayload,
      status: 200, // 200 with online:false so the UI can render the offline state
    };
    return NextResponse.json(offlinePayload, { status: 200 });
  }
}
