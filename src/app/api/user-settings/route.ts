import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _NextRequest = NextRequest;

// PROJ-37: /api/user-settings
// GET — return the current user's settings row (or default values if none exist)
// PUT — upsert the user's settings (Telegram credentials + notification opt-ins)

const SettingsUpdateSchema = z.object({
  telegram_enabled: z.boolean().optional(),
  // Bot tokens look like "123456789:ABCdefGHIjkl..."; allow chars Telegram uses.
  telegram_bot_token: z
    .string()
    .max(128)
    .regex(/^[\w:.\-]+$/, "Invalid bot token format")
    .nullable()
    .optional(),
  telegram_chat_id: z
    .string()
    .max(64)
    .regex(/^-?\d+$/, "Chat ID must be numeric")
    .nullable()
    .optional(),
  notify_on_single_run: z.boolean().optional(),
  notify_on_optimisation: z.boolean().optional(),
  notify_on_walk_forward: z.boolean().optional(),
});

const DEFAULT_SETTINGS = {
  telegram_enabled: false,
  telegram_bot_token: null as string | null,
  telegram_chat_id: null as string | null,
  notify_on_single_run: false,
  notify_on_optimisation: true,
  notify_on_walk_forward: true,
  last_notification_attempt_at: null as string | null,
  last_notification_error: null as string | null,
};

export async function GET(_request: NextRequest) {
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
    .select(
      "telegram_enabled, telegram_bot_token, telegram_chat_id, " +
        "notify_on_single_run, notify_on_optimisation, notify_on_walk_forward, " +
        "last_notification_attempt_at, last_notification_error"
    )
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("user_settings fetch error:", error.message);
    return NextResponse.json(
      { error: "Failed to load settings" },
      { status: 500 }
    );
  }

  return NextResponse.json({ settings: data ?? DEFAULT_SETTINGS });
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

  const parsed = SettingsUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Refuse to enable Telegram without a token + chat ID.
  if (
    parsed.data.telegram_enabled === true &&
    (!parsed.data.telegram_bot_token || !parsed.data.telegram_chat_id)
  ) {
    return NextResponse.json(
      {
        error:
          "Telegram cannot be enabled without both bot token and chat ID.",
      },
      { status: 400 }
    );
  }

  const upsertPayload = {
    user_id: user.id,
    ...parsed.data,
  };

  const { data, error } = await supabase
    .from("user_settings")
    .upsert(upsertPayload, { onConflict: "user_id" })
    .select(
      "telegram_enabled, telegram_bot_token, telegram_chat_id, " +
        "notify_on_single_run, notify_on_optimisation, notify_on_walk_forward, " +
        "last_notification_attempt_at, last_notification_error"
    )
    .single();

  if (error) {
    console.error("user_settings upsert error:", error.message);
    return NextResponse.json(
      { error: "Failed to save settings" },
      { status: 500 }
    );
  }

  return NextResponse.json({ settings: data });
}
