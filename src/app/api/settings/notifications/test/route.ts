import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// PROJ-37: POST /api/settings/notifications/test
// Sends a Telegram test message via the Python backend. Telegram delivery is
// currently stubbed (see python/services/notifications.py); the endpoint is
// wired up so the Settings UI can verify config end to end without code
// changes once real delivery lands.

const FASTAPI_URL = process.env.FASTAPI_URL;
const UPSTREAM_TIMEOUT_MS = 15_000;

export async function POST() {
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

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-User-Id": user.id,
    };
    if (session?.access_token) {
      headers["Authorization"] = `Bearer ${session.access_token}`;
    }

    const response = await fetch(`${FASTAPI_URL}/notifications/test`, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return NextResponse.json(
        { error: "Test notification timed out" },
        { status: 504 }
      );
    }
    console.error("Notifications test proxy error:", error);
    return NextResponse.json(
      { error: "Failed to send test notification" },
      { status: 502 }
    );
  }
}
