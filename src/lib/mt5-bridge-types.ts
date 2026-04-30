// PROJ-37: Shared types for the MT5 Bridge Worker integration.
//
// Mirrors the contract returned by the Next.js API routes under
// `/api/mt5/*` and `/api/settings/notifications/*`. The Python backend is
// the single source of truth for these payloads — keep the keys here in
// sync if the contract ever changes.

// ── Health check ────────────────────────────────────────────────────────────

export interface Mt5HealthResponse {
  online?: boolean;
  status?: "online" | "offline" | string;
  terminal_logged_in?: boolean;
  broker?: string | null;
  build?: number | null;
  queue_length?: number;
  current_run?: string | null;
  last_health_check_at?: string | null;
  last_started_at?: string | null;
  error?: string | null;
}

// ── Tester run lifecycle ────────────────────────────────────────────────────

export type Mt5RunStatus =
  | "pending"
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "cancelled";

export interface Mt5TesterMetrics {
  total_net_profit: number | null;
  sharpe_ratio: number | null;
  profit_factor: number | null;
  max_drawdown_abs: number | null;
  max_drawdown_pct: number | null;
  total_trades: number | null;
  won_trades: number | null;
  lost_trades: number | null;
  average_trade: number | null;
}

export interface Mt5TesterRun {
  id: string;
  mql_conversion_id: string | null;
  expert_name: string;
  symbol: string;
  timeframe: string;
  from_date: string;
  to_date: string;
  status: Mt5RunStatus;
  error_message: string | null;
  queue_position: number | null;
  started_at: string | null;
  finished_at: string | null;
  /** Joined via Supabase select; one-element array becomes the metrics row, [] means none yet. */
  metrics?: Mt5TesterMetrics[] | null;
}

export interface Mt5RunStartResponse {
  job_id: string;
  status: Mt5RunStatus;
  queue_position?: number | null;
}

export interface Mt5RunStatusResponse {
  job_id: string;
  status: Mt5RunStatus;
  queue_position?: number | null;
  error_message?: string | null;
  metrics?: Mt5TesterMetrics | null;
  started_at?: string | null;
  finished_at?: string | null;
}

// ── Notification settings ───────────────────────────────────────────────────

export interface NotificationSettings {
  telegram_enabled: boolean;
  telegram_bot_token_set: boolean;
  telegram_chat_id: string | null;
  notify_on_single_run: boolean;
  notify_on_optimisation: boolean;
  notify_on_walk_forward: boolean;
  last_notification_attempt_at: string | null;
  last_notification_error: string | null;
}

export interface NotificationSettingsUpdate {
  telegram_enabled?: boolean;
  telegram_bot_token?: string | null;
  telegram_chat_id?: string | null;
  notify_on_single_run?: boolean;
  notify_on_optimisation?: boolean;
  notify_on_walk_forward?: boolean;
}
