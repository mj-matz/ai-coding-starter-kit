import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Strategy } from "@/lib/strategy-types";
import { USER_STRATEGY_LIMIT } from "@/lib/strategy-types";

const FASTAPI_URL = process.env.FASTAPI_URL;

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

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
    const { data: { session } } = await supabase.auth.getSession();

    const headers: Record<string, string> = { "X-User-Id": user.id };
    if (session?.access_token) {
      headers["Authorization"] = `Bearer ${session.access_token}`;
    }

    // Fetch built-in strategies and user strategies in parallel
    const [builtinResponse, userStrategiesResult] = await Promise.all([
      fetch(`${FASTAPI_URL}/strategies`, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(10_000),
      }),
      supabase
        .from("user_strategies")
        .select("id, name, description, parameter_schema")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(USER_STRATEGY_LIMIT),
    ]);

    const builtinData = await builtinResponse.json();

    if (!builtinResponse.ok) {
      return NextResponse.json(
        { error: builtinData.detail || "Failed to fetch strategies" },
        { status: builtinResponse.status }
      );
    }

    const builtinStrategies: Strategy[] = builtinData.strategies ?? builtinData ?? [];

    const userStrategies: Strategy[] = (userStrategiesResult.data ?? []).map((s) => ({
      id: `user_${s.id}`,
      name: s.name,
      description: s.description ?? "",
      parameters_schema: s.parameter_schema ?? { properties: {} },
      is_custom: true,
    }));

    const strategies = [...builtinStrategies, ...userStrategies];

    return NextResponse.json(
      Array.isArray(builtinData) ? strategies : { ...builtinData, strategies },
      { status: 200 }
    );
  } catch (error) {
    console.error("Strategies fetch error:", error);
    return NextResponse.json(
      { error: "Failed to connect to backtesting service" },
      { status: 502 }
    );
  }
}
