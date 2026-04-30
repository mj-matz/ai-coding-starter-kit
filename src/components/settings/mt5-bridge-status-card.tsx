"use client";

import { useState } from "react";
import { CheckCircle2, RefreshCw, XCircle, Wifi, WifiOff } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useMt5Health } from "@/hooks/use-mt5-health";

// PROJ-37: Settings card showing the MT5 Bridge Worker status.
//
// - Live indicator (red/green) sourced from the 30 s health poll.
// - "Test Connection" button does a manual refetch and surfaces a toast.

function formatTimestamp(iso: string | null): string {
  if (!iso) return "Never";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

interface StatusRowProps {
  label: string;
  value: React.ReactNode;
}

function StatusRow({ label, value }: StatusRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b border-white/5 last:border-b-0">
      <span className="text-sm text-slate-400">{label}</span>
      <span className="text-sm font-medium text-slate-200 text-right">{value}</span>
    </div>
  );
}

export function Mt5BridgeStatusCard() {
  const { health, online, isLoading, error, lastCheckedAt, refresh } = useMt5Health();
  const { toast } = useToast();
  const [testing, setTesting] = useState(false);

  async function handleTest() {
    setTesting(true);
    try {
      const result = await refresh();
      const isUp =
        result &&
        (result.online === true ||
          result.status === "online" ||
          result.terminal_logged_in === true);

      if (isUp) {
        toast({
          title: "Connection successful",
          description: "MT5 Bridge Worker is online and reachable.",
        });
      } else {
        toast({
          title: "Connection failed",
          description: result?.error ?? "Bridge Worker is not responding.",
          variant: "destructive",
        });
      }
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-md">
      {/* Header */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          {online ? (
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30">
              <Wifi className="h-5 w-5" aria-hidden />
            </div>
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-500/15 text-rose-400 ring-1 ring-rose-500/30">
              <WifiOff className="h-5 w-5" aria-hidden />
            </div>
          )}
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-white">MT5 Bridge</h3>
              {online ? (
                <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/10">
                  Online
                </Badge>
              ) : (
                <Badge className="border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/10">
                  Offline
                </Badge>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Windows host running the MT5 Strategy Tester bridge.
            </p>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={handleTest}
          disabled={testing || isLoading}
          className="border-white/20 bg-white/10 text-slate-200 hover:bg-white/20"
          aria-label="Test connection to the MT5 Bridge Worker"
        >
          <RefreshCw
            className={`mr-1.5 h-3.5 w-3.5 ${testing || isLoading ? "animate-spin" : ""}`}
          />
          Test Connection
        </Button>
      </div>

      {/* Offline hint */}
      {!online && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-200">
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" aria-hidden />
          <span>
            Bridge Worker not reachable. Make sure the worker is running and the MT5 terminal
            is logged in.
            {error && (
              <>
                <span className="mx-1">·</span>
                <span className="text-rose-300/80">{error}</span>
              </>
            )}
          </span>
        </div>
      )}

      {/* Status grid */}
      <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-2">
        <StatusRow
          label="Status"
          value={
            online ? (
              <span className="flex items-center justify-end gap-1 text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Online
              </span>
            ) : (
              <span className="flex items-center justify-end gap-1 text-rose-400">
                <XCircle className="h-3.5 w-3.5" aria-hidden /> Offline
              </span>
            )
          }
        />
        <StatusRow
          label="Terminal Login"
          value={
            health?.terminal_logged_in ? (
              <span className="text-emerald-400">Logged in</span>
            ) : (
              <span className="text-slate-500">Not logged in</span>
            )
          }
        />
        <StatusRow label="Broker" value={health?.broker ?? <span className="text-slate-500">—</span>} />
        <StatusRow
          label="MT5 Build"
          value={health?.build != null ? String(health.build) : <span className="text-slate-500">—</span>}
        />
        <StatusRow
          label="Queue Length"
          value={
            typeof health?.queue_length === "number" ? (
              <span>{health.queue_length}</span>
            ) : (
              <span className="text-slate-500">—</span>
            )
          }
        />
        <StatusRow label="Last Health Check" value={formatTimestamp(lastCheckedAt)} />
      </div>
    </div>
  );
}
