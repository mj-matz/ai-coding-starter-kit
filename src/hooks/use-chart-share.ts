"use client";

import { useState } from "react";
import { toast } from "sonner";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import type { IChartApi } from "lightweight-charts";

interface UseChartShareOptions {
  tradeId: number;
  tradeDate: string; // ISO date-time string (entry_time)
}

interface UseChartShareReturn {
  isUploading: boolean;
  fallbackUrl: string | null;
  onShare: (chart: IChartApi) => Promise<void>;
  onCloseFallback: () => void;
}

function randomHex6(): string {
  return Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, "0");
}

function buildFileName(tradeId: number, tradeDate: string): string {
  // Extract YYYY-MM-DD from ISO string in local time
  const localDate = new Date(tradeDate).toLocaleDateString("en-CA");
  return `trade-${tradeId}-${localDate}-${randomHex6()}.png`;
}

export function useChartShare({
  tradeId,
  tradeDate,
}: UseChartShareOptions): UseChartShareReturn {
  const [isUploading, setIsUploading] = useState(false);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);

  const onShare = async (chart: IChartApi) => {
    if (isUploading) return;
    setIsUploading(true);

    try {
      // 0. Auth-Check (BUG-4): Nur eingeloggte User dürfen hochladen
      const supabase = createBrowserClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error("Bitte zuerst einloggen, um Screenshots zu teilen.");
      }

      // 1. Screenshot → canvas → blob
      const canvas = chart.takeScreenshot();
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png")
      );

      if (!blob) {
        throw new Error("Screenshot konnte nicht erstellt werden.");
      }

      // 2. Upload to Supabase Storage
      const fileName = buildFileName(tradeId, tradeDate);

      const { error: uploadError } = await supabase.storage
        .from("chart-screenshots")
        .upload(fileName, blob, { contentType: "image/png", upsert: false });

      if (uploadError) {
        console.error("[chart-share] upload error:", uploadError);
        throw new Error("Upload fehlgeschlagen: " + uploadError.message);
      }

      // 3. Get public URL
      const { data } = supabase.storage
        .from("chart-screenshots")
        .getPublicUrl(fileName);

      const publicUrl = data.publicUrl;

      // 4a. Copy to clipboard
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(publicUrl);
        toast.success("Link kopiert!", {
          description: publicUrl,
        });
      } else {
        // 4b. Clipboard not available — show fallback dialog
        setFallbackUrl(publicUrl);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unbekannter Fehler";
      toast.error("Screenshot nicht verfügbar", { description: message });
    } finally {
      setIsUploading(false);
    }
  };

  const onCloseFallback = () => setFallbackUrl(null);

  return { isUploading, fallbackUrl, onShare, onCloseFallback };
}
