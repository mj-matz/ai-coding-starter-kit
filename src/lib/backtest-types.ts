import { z } from "zod";

// ── Form Schema ──────────────────────────────────────────────────────────────

export const backtestFormSchema = z
  .object({
    strategy: z.string().min(1, "Strategy is required"),
    symbol: z
      .string()
      .min(1, "Symbol is required")
      .regex(/^[A-Z0-9.]+$/i, "Invalid symbol format"),
    timeframe: z.enum(["1m", "2m", "3m", "5m", "15m", "30m", "1h", "4h", "1d"]),
    startDate: z.string().min(1, "Start date is required"),
    endDate: z.string().min(1, "End date is required"),

    // Strategy-specific params (schema-driven — populated from Python strategy Pydantic schema)
    strategyParams: z.record(z.string(), z.unknown()).default({}),

    // Engine params (always present regardless of strategy)
    // PROJ-29: commission is now per-lot (replaces flat commission)
    commissionPerLot: z.coerce.number().min(0, "Commission per lot must be >= 0").default(0),
    slippage: z.coerce.number().min(0, "Slippage must be >= 0"),

    // Trading day filter (0=Mo … 4=Fr)
    tradingDays: z
      .array(z.number().int().min(0).max(4))
      .min(1, "At least one trading day required")
      .default([0, 1, 2, 3, 4]),

    // News day filter
    tradeNewsDays: z.boolean().default(true),

    // Simulation options
    gapFill: z.boolean().default(false),

    // PROJ-29: Backtest Realism – MT5 execution mode (price_type is always "bid")
    mt5Mode: z.boolean().default(false),
    spreadPips: z.coerce.number().min(0, "Spread must be >= 0").default(0),

    // Capital & sizing
    initialCapital: z.coerce.number().positive("Initial capital must be > 0"),
    sizingMode: z.enum(["risk_percent", "fixed_lot"]),
    riskPercent: z.coerce
      .number()
      .min(0.01, "Risk must be >= 0.01%")
      .max(100, "Risk must be <= 100%")
      .optional(),
    fixedLot: z.coerce.number().positive("Lot size must be > 0").optional(),
  })
  .refine((data) => new Date(data.endDate) > new Date(data.startDate), {
    message: "End date must be after start date",
    path: ["endDate"],
  })
  .refine(
    (data) =>
      data.sizingMode === "risk_percent"
        ? data.riskPercent != null
        : data.fixedLot != null,
    {
      message: "Provide risk % or fixed lot size based on selected sizing mode",
      path: ["riskPercent"],
    }
  );

export type BacktestFormValues = z.infer<typeof backtestFormSchema>;

// ── Default Form Values ──────────────────────────────────────────────────────

export const defaultFormValues: BacktestFormValues = {
  strategy: "time_range_breakout",
  symbol: "XAUUSD",
  timeframe: "1m",
  startDate: "",
  endDate: "",
  strategyParams: {
    rangeStart: "02:00",
    rangeEnd: "06:00",
    triggerDeadline: "12:00",
    timeExit: "20:00",
    stopLoss: 150,
    takeProfit: 175,
    direction: "both",
    entryDelayBars: 1,
  },
  commissionPerLot: 0,
  slippage: 0,
  tradingDays: [0, 1, 2, 3, 4],
  tradeNewsDays: true,
  gapFill: false,
  initialCapital: 10000,
  sizingMode: "risk_percent",
  riskPercent: 1.0,
  fixedLot: undefined,
  // PROJ-29: MT5 mode opt-in (price_type is always "bid")
  mt5Mode: false,
  spreadPips: 0,
};

// ── API Response Types ───────────────────────────────────────────────────────

export interface BacktestMetrics {
  total_return_pct: number;
  cagr_pct: number;
  sharpe_ratio: number;
  sortino_ratio: number;
  max_drawdown_pct: number;
  calmar_ratio: number;
  longest_drawdown_days: number;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate_pct: number;
  gross_profit: number;
  gross_loss: number;
  gross_profit_pips: number;
  gross_loss_pips: number;
  avg_win: number;
  avg_loss: number;
  avg_win_pips: number;
  avg_loss_pips: number;
  avg_win_loss_ratio: number;
  profit_factor: number;
  avg_r_multiple: number;
  total_r: number;
  avg_r_per_month: number;
  expectancy_pips: number;
  best_trade: number;
  worst_trade: number;
  consecutive_wins: number;
  consecutive_losses: number;
  avg_trade_duration_hours: number;
  final_balance: number;

  // PROJ-31: Extended metrics
  net_profit?: number;
  max_drawdown_abs?: number;
  recovery_factor?: number;
  expected_payoff?: number;
  buy_trades?: number;
  buy_win_rate_pct?: number;
  sell_trades?: number;
  sell_win_rate_pct?: number;
  min_trade_duration_minutes?: number;
  max_trade_duration_minutes?: number;
  max_consec_wins_count?: number;
  max_consec_wins_profit?: number;
  max_consec_losses_count?: number;
  max_consec_losses_loss?: number;
  avg_consec_wins?: number;
  avg_consec_losses?: number;
  ahpr?: number;
  ghpr?: number;
  lr_correlation?: number;
  lr_std_error?: number;
  z_score?: number;
  z_score_confidence_pct?: number;
}

export interface MonthlyR {
  month: string;
  r_earned: number | null;
  trade_count: number;
  win_rate_pct: number;
  avg_loss_pips: number | null;
  avg_mae_pips: number | null;
}

export interface EquityCurvePoint {
  date: string;
  balance: number;
}

export interface DrawdownCurvePoint {
  date: string;
  drawdown_pct: number;
}

export interface Candle {
  time: number; // Unix-Timestamp in Sekunden
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface TradeRecord {
  id: number;
  entry_time: string;
  exit_time: string;
  direction: "long" | "short";
  entry_price: number;
  exit_price: number;
  lot_size: number;
  pnl_pips: number;
  pnl_currency: number;
  r_multiple: number;
  exit_reason: string;
  duration_minutes: number;
  entry_gap_pips: number;
  exit_gap: boolean;
  used_1s_resolution: boolean;
  mae_pips: number;
  range_high: number;
  range_low: number;
  stop_loss: number;
  take_profit: number;
}

export interface SkippedDay {
  date: string;
  reason: string;
}

// PROJ-29: Already-Past Rejection record
export interface RejectedOrderDate {
  date: string;
  side: "long" | "short";
}

export interface BacktestResult {
  metrics: BacktestMetrics;
  equity_curve: EquityCurvePoint[];
  drawdown_curve: DrawdownCurvePoint[];
  trades: TradeRecord[];
  skipped_days: SkippedDay[];
  monthly_r: MonthlyR[];
  cache_id?: string;
  symbol: string;
  timeframe: string;
  // PROJ-29: MT5-mode rejected stop-orders (Already-Past Rejection)
  rejected_order_dates?: RejectedOrderDate[];
}

// ── localStorage helpers ─────────────────────────────────────────────────────

const STORAGE_KEY = "backtest-config";

export function saveConfigToStorage(config: BacktestFormValues): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Silently fail if localStorage is unavailable
  }
}

export function loadConfigFromStorage(): BacktestFormValues | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Validate against schema — returns null if shape changed (e.g. after schema migration)
    const result = backtestFormSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
