"use client";

import { useCallback, useState } from "react";

import type {
  EaDeployRequest,
  EaDeployResponse,
} from "@/lib/mt5-bridge-types";

// PROJ-40: Wraps the POST /api/mt5/ea/deploy round-trip in a stateful hook so
// the UI can render the in-flight "Deploying…" label and surface the final
// response (compile success, compile error, or a transport failure).

export type DeployPhase = "idle" | "deploying" | "compiled" | "error";

export interface DeployErrorDetails {
  /** "Compile Error" → render with CompileErrorDialog (multi-line). */
  kind: "compile" | "transport" | "timeout";
  /** Single-line summary suitable for a toast. */
  message: string;
  /** Multi-line compiler output (only set for kind === "compile"). */
  errors?: string[];
  /** Truncated tail of the compile log for context. */
  logExcerpt?: string;
  /** Echoed from the response so the dialog can re-state the EA name. */
  eaName?: string;
}

export interface UseMt5EaDeployReturn {
  phase: DeployPhase;
  /** Last successful deploy response — cleared on every new submit. */
  lastSuccess: EaDeployResponse | null;
  /** Set when phase === "error" (compile or transport). */
  error: DeployErrorDetails | null;
  deploy: (req: EaDeployRequest) => Promise<EaDeployResponse | null>;
  reset: () => void;
}

export function useMt5EaDeploy(): UseMt5EaDeployReturn {
  const [phase, setPhase] = useState<DeployPhase>("idle");
  const [lastSuccess, setLastSuccess] = useState<EaDeployResponse | null>(null);
  const [error, setError] = useState<DeployErrorDetails | null>(null);

  const reset = useCallback(() => {
    setPhase("idle");
    setLastSuccess(null);
    setError(null);
  }, []);

  const deploy = useCallback(
    async (req: EaDeployRequest): Promise<EaDeployResponse | null> => {
      setPhase("deploying");
      setError(null);
      setLastSuccess(null);

      try {
        const res = await fetch("/api/mt5/ea/deploy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req),
        });

        // The route hands back the raw upstream payload, including the
        // Python-backend status fields (compiled / compile_error / timeout /
        // failed) — so we mostly forward and translate to UI state.
        const data = (await res.json().catch(() => null)) as
          | (EaDeployResponse & { status_code?: number })
          | null;

        if (!res.ok) {
          // 5xx / 4xx from the proxy — never carries compile detail because
          // the bridge call never actually completed.
          const message =
            data?.error ??
            (res.status === 504
              ? "Deploy timed out — the bridge did not respond in time."
              : res.status === 503
                ? "MT5 service unavailable. Please try again."
                : `Deploy failed (${res.status}).`);

          const details: DeployErrorDetails = {
            kind: res.status === 504 ? "timeout" : "transport",
            message,
            eaName: data?.ea_name ?? req.ea_name,
          };
          setError(details);
          setPhase("error");
          return data ?? null;
        }

        if (data?.status === "compile_error") {
          const details: DeployErrorDetails = {
            kind: "compile",
            message: `Compilation failed for "${data.ea_name}".`,
            errors: data.errors ?? [],
            logExcerpt: data.log_excerpt,
            eaName: data.ea_name,
          };
          setError(details);
          setPhase("error");
          return data;
        }

        if (data?.status === "timeout") {
          const details: DeployErrorDetails = {
            kind: "timeout",
            message:
              data.error_message ??
              data.error ??
              "MetaEditor did not respond — please compile manually in MT5.",
            logExcerpt: data.log_excerpt,
            eaName: data.ea_name,
          };
          setError(details);
          setPhase("error");
          return data;
        }

        if (data?.status === "failed") {
          const details: DeployErrorDetails = {
            kind: "transport",
            message:
              data.error_message ?? data.error ?? "Deploy failed on the bridge.",
            logExcerpt: data.log_excerpt,
            eaName: data.ea_name,
          };
          setError(details);
          setPhase("error");
          return data;
        }

        // status === "compiled" (or anything else success-shaped)
        setLastSuccess(data);
        setPhase("compiled");
        return data;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Network error during deploy.";
        setError({ kind: "transport", message, eaName: req.ea_name });
        setPhase("error");
        return null;
      }
    },
    [],
  );

  return { phase, lastSuccess, error, deploy, reset };
}
