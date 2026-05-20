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
  /** Present in single-run detail (/api/mt5/tester/runs/[id]); absent in list view. */
  parameters?: Record<string, unknown> | null;
  /** Present in single-run detail; absent in list view. */
  model?: string | null;
  status: Mt5RunStatus;
  error_message: string | null;
  queue_position: number | null;
  bridge_job_id?: string | null;
  started_at: string | null;
  finished_at: string | null;
  last_status_at?: string | null;
  /** Joined via Supabase select; one-element array becomes the metrics row, [] means none yet. */
  metrics?: Mt5TesterMetrics[] | null;
}

export interface Mt5RunStartResponse {
  job_id: string;
  status: Mt5RunStatus;
  queue_position?: number | null;
}

export interface Mt5TesterTrade {
  id: number;
  run_id: string;
  open_time: string | null;
  close_time: string | null;
  direction: string | null;
  volume: number | null;
  open_price: number | null;
  close_price: number | null;
  profit: number | null;
  comment: string | null;
}

export interface Mt5RunStatusResponse {
  job_id: string;
  status: Mt5RunStatus;
  queue_position?: number | null;
  error_message?: string | null;
  metrics?: Mt5TesterMetrics | null;
  /** Trade list returned by the bridge on completion. Not persisted to DB in PROJ-37; persisted in PROJ-41. */
  trades?: Array<Omit<Mt5TesterTrade, "id" | "run_id">> | null;
  started_at?: string | null;
  finished_at?: string | null;
}

// ── EA Deployments (PROJ-40) ────────────────────────────────────────────────

export type EaDeploymentSource = "mql_converter" | "mt5_optimizer";

export type EaDeploymentStatus =
  | "pending"
  | "compiled"
  | "compile_error"
  | "timeout"
  | "failed";

export interface EaDeployment {
  id: string;
  ea_name: string;
  source: EaDeploymentSource;
  mql_conversion_id: string | null;
  optimizer_run_id: string | null;
  optimizer_result_rank: number | null;
  status: EaDeploymentStatus;
  error_message: string | null;
  warnings: string[] | null;
  errors: string[] | null;
  log_excerpt: string | null;
  deployed_at: string;
}

export interface EaDeploymentsListResponse {
  deployments: EaDeployment[];
  total: number;
  limit: number;
  offset: number;
}

export interface EaDeployRequestParameter {
  mql_input_name: string;
  current_value: number | string | boolean;
  type: "number" | "integer" | "string" | "boolean";
}

export interface EaDeployRequest {
  ea_name: string;
  source: EaDeploymentSource;
  /** Required for the mql_converter flow — pre-rendered .mq5 content. */
  mq5_content?: string;
  /** Required for the mt5_optimizer flow — used to look up the original MQL. */
  mql_conversion_id?: string;
  optimizer_run_id?: string;
  optimizer_result_rank?: number;
  parameters?: EaDeployRequestParameter[];
  symbol?: string;
  date_from?: string;
  date_to?: string;
  conversion_name?: string;
}

/** Outcome reported by the bridge. `timeout` is now persisted directly as
 * a first-class status — see `EaDeploymentStatus`. The alias is kept for
 * backwards compatibility within this module. */
export type EaDeployOutcome = EaDeploymentStatus;

export interface EaDeployResponse {
  status: EaDeployOutcome;
  ea_name: string;
  deployment_id?: string;
  errors?: string[];
  warnings?: string[];
  log_excerpt?: string;
  error?: string;
  error_message?: string;
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
