"use client";

import { useCallback, useEffect, useState } from "react";

import type {
  NotificationSettings,
  NotificationSettingsUpdate,
} from "@/lib/mt5-bridge-types";

// PROJ-37: Notification settings (Telegram bot config + per-run-type opt-ins).

export interface UseNotificationSettingsReturn {
  settings: NotificationSettings | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  update: (patch: NotificationSettingsUpdate) => Promise<boolean>;
  sendTest: () => Promise<{ ok: boolean; message: string }>;
}

export function useNotificationSettings(): UseNotificationSettingsReturn {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/notifications", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Failed to load settings (${res.status})`);
        return;
      }
      setSettings(data as NotificationSettings);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const update = useCallback(
    async (patch: NotificationSettingsUpdate): Promise<boolean> => {
      setIsSaving(true);
      setError(null);
      try {
        const res = await fetch("/api/settings/notifications", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? `Failed to save (${res.status})`);
          return false;
        }
        // Re-fetch to keep `telegram_bot_token_set` accurate without exposing the secret.
        await refresh();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save settings");
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [refresh]
  );

  const sendTest = useCallback(async (): Promise<{ ok: boolean; message: string }> => {
    try {
      const res = await fetch("/api/settings/notifications/test", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          ok: false,
          message: data.error ?? `Test failed (${res.status})`,
        };
      }
      return {
        ok: true,
        message: data.message ?? "Test notification queued.",
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : "Test failed",
      };
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { settings, isLoading, isSaving, error, refresh, update, sendTest };
}
