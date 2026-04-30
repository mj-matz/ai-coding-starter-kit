import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

// PROJ-37: GET / PUT /api/settings/notifications
// Per-user notification preferences. Backed by `user_settings` (one row per
// user, RLS scoped to auth.uid()).
//
// `telegram_bot_token` is treated as write-only: GET never echoes the secret
// back, only a boolean indicating whether one is set.

const NotificationsUpdateSchema = z.object({
  telegram_enabled: z.boolean().optional(),
  telegram_bot_token: z
    .string()
    .max(256)
    .optional()
    .nullable(),
  telegram_chat_id: z.string().max(64).optional().nullable(),
  notify_on_single_run: z.boolean().optional(),
  notify_on_optimisation: z.boolean().optional(),
  notify_on_walk_forward: z.boolean().optional(),
});

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("user_settings")
    .select("telegram_enabled, telegram_bot_token, telegram_chat_id, notify_on_single_run, notify_on_optimisation, notify_on_walk_forward, last_notification_attempt_at, last_notification_error")
    .eq("user_id", user.id)
    .maybeSingle<{
      telegram_enabled: boolean;
      telegram_bot_token: string | null;
      telegram_chat_id: string | null;
      notify_on_single_run: boolean;
      notify_on_optimisation: boolean;
      notify_on_walk_forward: boolean;
      last_notification_attempt_at: string | null;
      last_notification_error: string | null;
    }>();

  if (error) {
    console.error("user_settings fetch error:", error.message);
    return NextResponse.json(
      { error: "Failed to load notification settings" },
      { status: 500 }
    );
  }

  if (!data) {
    return NextResponse.json({
      telegram_enabled: false,
      telegram_bot_token_set: false,
      telegram_chat_id: null,
      notify_on_single_run: false,
      notify_on_optimisation: true,
      notify_on_walk_forward: true,
      last_notification_attempt_at: null,
      last_notification_error: null,
    });
  }

  const { telegram_bot_token, ...rest } = data;
  return NextResponse.json({
    ...rest,
    telegram_bot_token_set: Boolean(telegram_bot_token),
  });
}

export async function PUT(request: NextRequest) {
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

  const parsed = NotificationsUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Drop undefined keys so we never overwrite stored values with null by
  // accident. An explicit null on telegram_bot_token / telegram_chat_id is
  // preserved (UI uses it to clear credentials).
  const updates: Record<string, unknown> = { user_id: user.id };
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value !== undefined) {
      updates[key] = value;
    }
  }

  const { error } = await supabase
    .from("user_settings")
    .upsert(updates, { onConflict: "user_id" });

  if (error) {
    console.error("user_settings upsert error:", error.message);
    return NextResponse.json(
      { error: "Failed to update notification settings" },
      { status: 500 }
    );
  }

  return NextResponse.json({ updated: true });
}
