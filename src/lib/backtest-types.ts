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

    // Strategy parameters (Time-Range Breakout)
    rangeStart: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Must be HH:MM"),
    rangeEnd: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Must be HH:MM"),
    triggerDeadline: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Must be HH:MM"),
    timeExit: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Must be HH:MM"),
    stopLoss: z.coerce.number().positive("Stop Loss must be > 0"),
    takeProfit: z.coerce.number().positive("Take Profit must be > 0"),
    direction: z.enum(["long", "short", "both"]),
    commission: z.coerce.number().min(0, "Commission must be >= 0"),
    slippage: z.coerce.number().min(0, "Slippage must be >= 0"),
    entryDelayBars: z.coerce.number().int().min(0, "Entry delay must be >= 0").default(1),

    // Optional profit-lock (trail)
    trailTriggerPips: z.coerce.number().positive("Trail trigger must be > 0").optional(),
    trailLockPips: z.coerce.number().positive("Trail lock must be > 0").optional(),

    // Trading day filter (0=Mo, 1=Di, 2=Mi, 3=Do, 4=Fr — Python weekday())
    tradingDays: z
      .array(z.number().int().min(0).max(4))
      .min(1, "At least one trading day required")
      .default([0, 1, 2, 3, 4]),

    // News day filter — when true, days with high-impact events are skipped
    tradeNewsDays: z.boolean().default(true),

    // Simulation options
    gapFill: z.boolean().default(false),

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
    (data) => {
      const hasTrigger = data.trailTriggerPips != null;
      const hasLock = data.trailLockPips != null;
      return hasTrigger === hasLock;
    },
    {
      message: "Both trail parameters must be set together or both left empty",
      path: ["trailTriggerPips"],
    }
  )
  .refine(
    (data) => {
      if (data.trailTriggerPips != null && data.trailLockPips != null) {
        return data.trailTriggerPips > data.trailLockPips;
      }
      return true;
    },
    {
      message: "Trail trigger must be greater than trail lock",
      path: ["trailTriggerPips"],
    }
  )
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
  rangeStart: "02:00",
  rangeEnd: "06:00",
  triggerDeadline: "12:00",
  timeExit: "20:00",
  stopLoss: 150,
  takeProfit: 175,
  direction: "both",
  commission: 0,
  slippage: 0,
  entryDelayBars: 1,
  trailTriggerPips: undefined,
  trailLockPips: undefined,
  tradingDays: [0, 1, 2, 3, 4],
  tradeNewsDays: true,
  gapFill: false,
  initialCapital: 10000,
  sizingMode: "risk_percent",
  riskPercent: 1.0,
  fixedLot: undefined,
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
}

export interface MonthlyR {
  month: string;
  r_earned: number | null;
  trade_count: number;
  win_rate_pct: number;
  avg_loss_pips: number | null;
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
  range_high: number;
  range_low: number;
  stop_loss: number;
  take_profit: number;
}

export interface SkippedDay {
  date: string;
  reason: string;
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
    // Validate against schema - if invalid, return null
    const result = backtestFormSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
