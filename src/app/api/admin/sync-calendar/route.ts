import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

const FF_THIS_WEEK = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
const FF_NEXT_WEEK = "https://nfs.faireconomy.media/ff_calendar_nextweek.json";

interface ForexFactoryEvent {
  title:    string;
  country:  string;  // currency code: "USD", "EUR", "GBP", etc.
  date:     string;  // ISO datetime, e.g. "2025-03-28T12:30:00-04:00"
  impact:   string;  // "High" | "Medium" | "Low" | "Holiday"
  forecast: string;
  previous: string;
}

export async function POST(request: NextRequest) {
  // Auth — only authenticated users can trigger a sync
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Fetch this week + next week from ForexFactory
  const results = await Promise.allSettled([
    fetch(FF_THIS_WEEK,  { headers: { "User-Agent": "Mozilla/5.0" } }),
    fetch(FF_NEXT_WEEK, { headers: { "User-Agent": "Mozilla/5.0" } }),
  ]);

  const allEvents: ForexFactoryEvent[] = [];
  for (const result of results) {
    if (result.status === "rejected") {
      console.warn("ForexFactory fetch failed:", result.reason);
      continue;
    }
    if (!result.value.ok) {
      console.warn("ForexFactory responded with:", result.value.status);
      continue;
    }
    const data = await result.value.json() as ForexFactoryEvent[];
    allEvents.push(...data);
  }

  if (allEvents.length === 0) {
    return NextResponse.json({ error: "No data received from ForexFactory" }, { status: 502 });
  }

  // Filter: High-impact only, skip holidays
  const highImpact = allEvents.filter(
    (e) => e.impact === "High" && e.country && e.date
  );

  if (highImpact.length === 0) {
    return NextResponse.json({ upserted: 0 });
  }

  const syncedAt = new Date().toISOString();

  const rows = highImpact.map((e) => ({
    date:      e.date.split("T")[0],
    currency:  e.country.toUpperCase().trim(),
    impact:    "High",
    event:     e.title ?? null,
    synced_at: syncedAt,
  }));

  // Use service role key for write access (bypasses RLS)
  const serviceClient = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { error: upsertError, count } = await serviceClient
    .from("economic_calendar")
    .upsert(rows, { onConflict: "date,currency,event", count: "exact" });

  if (upsertError) {
    console.error("economic_calendar upsert failed:", upsertError);
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  return NextResponse.json({ upserted: count ?? rows.length });
}
