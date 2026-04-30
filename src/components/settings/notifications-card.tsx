"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Bell, Loader2, Save, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useNotificationSettings } from "@/hooks/use-notification-settings";
import { useToast } from "@/hooks/use-toast";

// PROJ-37: Settings card for notification preferences (Telegram + per-run-type opt-in).

const TELEGRAM_DOC_URL =
  "https://core.telegram.org/bots/tutorial#obtain-your-bot-token";

interface FormState {
  telegramEnabled: boolean;
  // Empty string = "do not change". Null = "clear stored token".
  // The PUT route treats null as an explicit clear, so we map sentinel
  // values just before the request.
  botToken: string;
  chatId: string;
  notifyOnSingleRun: boolean;
  notifyOnOptimisation: boolean;
  notifyOnWalkForward: boolean;
}

const EMPTY_FORM: FormState = {
  telegramEnabled: false,
  botToken: "",
  chatId: "",
  notifyOnSingleRun: false,
  notifyOnOptimisation: true,
  notifyOnWalkForward: true,
};

export function NotificationsCard() {
  const { settings, isLoading, isSaving, error, update, sendTest } =
    useNotificationSettings();
  const { toast } = useToast();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [tokenDirty, setTokenDirty] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);

  // Hydrate form from server payload. Token is never echoed back, so the input
  // stays empty unless the user types — `tokenDirty` lets us distinguish
  // "no change" from "user wants to clear".
  useEffect(() => {
    if (!settings) return;
    setForm({
      telegramEnabled: settings.telegram_enabled,
      botToken: "",
      chatId: settings.telegram_chat_id ?? "",
      notifyOnSingleRun: settings.notify_on_single_run,
      notifyOnOptimisation: settings.notify_on_optimisation,
      notifyOnWalkForward: settings.notify_on_walk_forward,
    });
    setTokenDirty(false);
  }, [settings]);

  function handleChange<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    const patch: Parameters<typeof update>[0] = {
      telegram_enabled: form.telegramEnabled,
      telegram_chat_id: form.chatId.trim() || null,
      notify_on_single_run: form.notifyOnSingleRun,
      notify_on_optimisation: form.notifyOnOptimisation,
      notify_on_walk_forward: form.notifyOnWalkForward,
    };
    if (tokenDirty) {
      patch.telegram_bot_token = form.botToken.trim() || null;
    }

    const ok = await update(patch);
    if (ok) {
      toast({
        title: "Settings saved",
        description: "Notification preferences updated.",
      });
    } else {
      toast({
        title: "Save failed",
        description: error ?? "Could not update notification settings.",
        variant: "destructive",
      });
    }
  }

  async function handleSendTest() {
    setSendingTest(true);
    try {
      const result = await sendTest();
      toast({
        title: result.ok ? "Test message sent" : "Test failed",
        description: result.message,
        variant: result.ok ? undefined : "destructive",
      });
    } finally {
      setSendingTest(false);
    }
  }

  // BUG-4: The test endpoint reads the saved token from the DB, so we must
  // refuse to test against an unsaved (dirty) token — the toast would
  // otherwise reflect the previously-saved value, not the one the user just
  // typed.  The hint below ("Save your changes first…") tells the user to
  // save before testing.
  const canSendTest =
    form.telegramEnabled &&
    Boolean(settings?.telegram_bot_token_set) &&
    !tokenDirty &&
    form.chatId.trim().length > 0 &&
    form.chatId.trim() === (settings?.telegram_chat_id ?? "");

  if (isLoading && !settings) {
    return (
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-md">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-500/15 text-blue-400 ring-1 ring-blue-500/30">
            <Bell className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <h3 className="text-base font-semibold text-white">Notifications</h3>
            <p className="text-xs text-slate-400">Loading preferences…</p>
          </div>
        </div>
        <div className="space-y-3">
          <Skeleton className="h-10 w-full bg-white/5" />
          <Skeleton className="h-10 w-full bg-white/5" />
          <Skeleton className="h-10 w-2/3 bg-white/5" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-md">
      {/* Header */}
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-500/15 text-blue-400 ring-1 ring-blue-500/30">
          <Bell className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <h3 className="text-base font-semibold text-white">Notifications</h3>
          <p className="mt-1 text-xs text-slate-400">
            Get pinged on Telegram when long-running jobs finish.
          </p>
        </div>
      </div>

      {/* Last error badge */}
      {settings?.last_notification_error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
          <AlertTriangle
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400"
            aria-hidden
          />
          <span>
            Last notification attempt failed:{" "}
            <span className="text-amber-100">{settings.last_notification_error}</span>
          </span>
        </div>
      )}

      {/* Telegram subsection */}
      <section className="space-y-4 rounded-xl border border-white/10 bg-black/20 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-medium text-white">Telegram</h4>
            <p className="text-xs text-slate-400">
              <a
                href={TELEGRAM_DOC_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:underline"
              >
                How to set up a Telegram bot
              </a>
            </p>
          </div>
          <Switch
            checked={form.telegramEnabled}
            onCheckedChange={(v) => handleChange("telegramEnabled", v)}
            aria-label="Enable Telegram notifications"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="telegram-bot-token" className="text-slate-300">
              Bot Token
            </Label>
            <Input
              id="telegram-bot-token"
              type="password"
              autoComplete="off"
              placeholder={
                settings?.telegram_bot_token_set ? "•••••• (saved)" : "123456:ABC-DEF..."
              }
              value={form.botToken}
              onChange={(e) => {
                setTokenDirty(true);
                handleChange("botToken", e.target.value);
              }}
              disabled={!form.telegramEnabled}
              className="border-white/10 bg-black/30 text-slate-100 placeholder:text-slate-500"
            />
            {settings?.telegram_bot_token_set && !tokenDirty && (
              <p className="text-[11px] text-slate-500">
                A token is stored. Type a new one to replace it, or leave blank to keep it.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="telegram-chat-id" className="text-slate-300">
              Chat ID
            </Label>
            <Input
              id="telegram-chat-id"
              type="text"
              autoComplete="off"
              placeholder="123456789"
              value={form.chatId}
              onChange={(e) => handleChange("chatId", e.target.value)}
              disabled={!form.telegramEnabled}
              className="border-white/10 bg-black/30 text-slate-100 placeholder:text-slate-500"
            />
          </div>
        </div>

        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSendTest}
            disabled={!canSendTest || sendingTest}
            className="border-white/20 bg-white/10 text-slate-200 hover:bg-white/20"
          >
            {sendingTest ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Sending…
              </>
            ) : (
              <>
                <Send className="mr-1.5 h-3.5 w-3.5" />
                Send test message
              </>
            )}
          </Button>
          {!canSendTest && form.telegramEnabled && (
            <p className="mt-1.5 text-[11px] text-slate-500">
              {tokenDirty ||
              form.chatId.trim() !== (settings?.telegram_chat_id ?? "")
                ? "Save your changes first — the test uses the stored configuration."
                : "Save a bot token and chat ID first."}
            </p>
          )}
        </div>
      </section>

      {/* When to notify */}
      <section className="mt-4 space-y-3 rounded-xl border border-white/10 bg-black/20 p-4">
        <h4 className="text-sm font-medium text-white">When to notify</h4>
        <div className="space-y-2">
          <NotifyCheckbox
            id="notify-single-run"
            checked={form.notifyOnSingleRun}
            disabled={!form.telegramEnabled}
            onChange={(v) => handleChange("notifyOnSingleRun", v)}
            label="Single MT5 Tester run finishes"
          />
          <NotifyCheckbox
            id="notify-optimisation"
            checked={form.notifyOnOptimisation}
            disabled={!form.telegramEnabled}
            onChange={(v) => handleChange("notifyOnOptimisation", v)}
            label="Optimisation run finishes"
          />
          <NotifyCheckbox
            id="notify-walk-forward"
            checked={form.notifyOnWalkForward}
            disabled={!form.telegramEnabled}
            onChange={(v) => handleChange("notifyOnWalkForward", v)}
            label="Walk-Forward batch finishes"
          />
        </div>
      </section>

      <div className="mt-4 flex justify-end">
        <Button
          onClick={handleSave}
          disabled={isSaving}
          className="bg-blue-600 text-white hover:bg-blue-500"
        >
          {isSaving ? (
            <>
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              Saving…
            </>
          ) : (
            <>
              <Save className="mr-1.5 h-4 w-4" />
              Save settings
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

interface NotifyCheckboxProps {
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}

function NotifyCheckbox({ id, label, checked, disabled, onChange }: NotifyCheckboxProps) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        disabled={disabled}
        className="border-white/20 data-[state=checked]:border-blue-500 data-[state=checked]:bg-blue-600"
      />
      <Label
        htmlFor={id}
        className={`cursor-pointer text-sm ${
          disabled ? "text-slate-500" : "text-slate-300"
        }`}
      >
        {label}
      </Label>
    </div>
  );
}
