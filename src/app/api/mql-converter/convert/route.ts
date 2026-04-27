import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 120; // Claude API calls can take a while

const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_SECONDS = 3600;

// ── Zod schema ───────────────────────────────────────────────────────────────

const ConvertRequestSchema = z.object({
  mql_code: z
    .string()
    .min(1, "MQL code is required")
    .max(50000, "MQL code must not exceed 50,000 characters"),
  mql_version: z.enum(["mql4", "mql5", "auto"]),
});

// ── MQL validation ───────────────────────────────────────────────────────────

const MQL_KEYWORDS = ["OnTick", "OrderSend", "#property"];

function looksLikeMqlCode(code: string): boolean {
  return MQL_KEYWORDS.some((kw) => code.includes(kw));
}

// ── Claude system prompt ─────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert MQL4/MQL5 to Python conversion specialist. Your task is to convert MetaTrader Expert Advisors into Python strategy classes compatible with a backtesting engine.

The target Python strategy class must:
1. Extend \`BaseStrategy\` — CRITICAL: do NOT write any import statement for BaseStrategy. It is already injected into the execution context by the sandbox. The class definition must be exactly: \`class Strategy(BaseStrategy):\`
2. Implement \`validate_params(self, params)\` and \`generate_signals(self, df, params)\`
3. The \`generate_signals\` method receives a pandas DataFrame \`df\` with columns: open, high, low, close, volume (DatetimeIndex in UTC)
4. The FIRST line inside \`generate_signals\` MUST be: \`params = params or {}\`
5. It must return a tuple of (signals_df, skipped_days) where:
   - signals_df has columns: long_entry, long_sl, long_tp, short_entry, short_sl, short_tp, signal_expiry (all float, NaN = no signal; signal_expiry is pd.Timestamp or NaT)
   - signal_expiry MUST be initialized as timezone-aware UTC: \`signals_df['signal_expiry'] = pd.Series(pd.NaT, index=df.index, dtype='datetime64[ns, UTC]')\`
   - When assigning a signal_expiry value, always ensure it is UTC-aware: \`pd.Timestamp(...).tz_localize('UTC')\` or \`pd.Timestamp(..., tz='UTC')\`. Never assign a tz-naive datetime into a tz-aware column.
   - skipped_days is a list (can be empty)
6. Use numpy and pandas for data manipulation. Use pandas_ta ONLY if the strategy uses technical indicators (moving averages, RSI, MACD, ATR, Bollinger Bands, etc.).
7. Do NOT use any network calls, file I/O, or subprocess calls
8. ONLY the following imports are permitted at the top of the file — no others:
   \`\`\`
   import pandas as pd
   import numpy as np
   \`\`\`
   If and ONLY IF the strategy uses indicator functions from pandas_ta, also include:
   \`\`\`
   import pandas_ta as ta
   \`\`\`
   Do NOT import BaseStrategy, strategies, os, sys, subprocess, socket, or any other module.

CRITICAL — DO NOT calculate lot sizes: The backtesting engine handles position sizing via its own configuration (sizing_mode, risk_percent, fixed_lot). Your strategy ONLY needs to emit price levels: entry price, stop-loss price, and take-profit price. Do not replicate AccountBalance, lot sizing, tick value, or volume constraint logic — these produce no effect and generate unnecessary warnings.

TRAILING STOP SUPPORT (fully supported via per-signal columns):
When the MQL EA uses a trailing stop (trade.PositionModify, TrailingStop, InpUseTrailing, etc.), the backtesting engine handles it natively. Set these columns on every signal row:
- \`signals_df['trail_type'] = 'continuous'\` (string column — marks this signal as using continuous trailing)
- \`signals_df['trail_trigger_pips'] = N\` (float: pip distance at which trailing begins, e.g. InpTrailStartR * sl_pips)
- \`signals_df['trail_distance_pips'] = N\` (float: pip distance of the trailing SL from the bar's favourable extreme, e.g. InpTrailDistancePips)
- \`signals_df['trail_dont_cross_entry'] = 1.0\` (float 1.0/0.0: set to 1.0 if the EA uses a dont-cross-entry guard)
These columns map directly to the engine's PROJ-30 position management. Status: "mapped" — not "unsupported".

CRITICAL — PREVIOUS-DAY LOOKUPS MUST BE WEEKEND-AWARE:
When the MQL EA references the previous day's high/low/close (e.g. \`iHigh(_Symbol, PERIOD_D1, 1)\`, \`iLow(_Symbol, PERIOD_D1, 1)\`, \`iClose(_Symbol, PERIOD_D1, 1)\`), MetaTrader's daily series skips non-trading days (weekends, holidays). On Monday, "shift 1" returns FRIDAY's value — not Sunday's.

The DataFrame \`df\` you receive is intraday (1m / 5m / 1h / etc.), so naive calendar arithmetic like \`today - timedelta(days=1)\` lands on Sunday, finds zero rows, and produces NO signal on every Monday — a silent bug.

You MUST replicate the trading-day shift. Use a per-date aggregate, shift by one row, then broadcast back onto the intraday index:

CORRECT (works for Monday — gets Friday's high):
\`\`\`python
daily = df.groupby(df.index.normalize()).agg(
    day_high=("high", "max"),
    day_low=("low", "min"),
    day_close=("close", "last"),
)
prev_day_high  = daily["day_high"].shift(1)   # one TRADING day back
prev_day_low   = daily["day_low"].shift(1)
prev_day_close = daily["day_close"].shift(1)

# Broadcast onto the intraday index by date lookup
date_key = df.index.normalize()
prev_high_series  = pd.Series(date_key.map(prev_day_high.to_dict()),  index=df.index)
prev_low_series   = pd.Series(date_key.map(prev_day_low.to_dict()),   index=df.index)
prev_close_series = pd.Series(date_key.map(prev_day_close.to_dict()), index=df.index)
\`\`\`

WRONG (no Monday signals):
\`\`\`python
yesterday = df.index.date - pd.Timedelta(days=1)            # ← Monday → Sunday → empty
prev_high = df.loc[df.index.date == yesterday, "high"].max() # ← NaN on Mondays
\`\`\`

The same rule applies to ANY "N days ago" reference (\`PERIOD_D1, N\`): shift by N rows in the per-day aggregate, never by N calendar days.

CRITICAL — STRING COLUMNS MUST USE None, NOT np.nan:
String columns (trail_type) cannot use np.nan as a fill value — numpy cannot promote string and float dtypes. Always use None as the no-value sentinel for string columns:
CORRECT:   \`signals_df['trail_type'] = np.where(condition, 'continuous', None)\`
WRONG:     \`signals_df['trail_type'] = np.where(condition, 'continuous', np.nan)\`  ← raises DTypePromotionError

PARTIAL CLOSE SUPPORT (fully supported via per-signal columns):
When the MQL EA uses partial close (ClosePartialByDeal, InpUsePartialTP, partial close at R-multiple, etc.), the backtesting engine handles it natively. Set these columns on every signal row:
- \`signals_df['partial_close_pct'] = N\` (float: percentage of lot to close, e.g. 40.0 for 40%)
- \`signals_df['partial_at_r'] = N\` (float: R-multiple of initial SL risk, e.g. 1.0 for 1R trigger) OR
- \`signals_df['partial_at_pips'] = N\` (float: fixed pip distance trigger — takes priority over partial_at_r if both set)
These columns map directly to the engine's PROJ-30 partial close logic. Status: "mapped" — not "unsupported".

MQL function mappings:
- iMA() -> pandas_ta.ema() / sma() / wma() depending on method parameter
- iRSI() -> pandas_ta.rsi()
- iMACD() -> pandas_ta.macd()
- iATR() -> pandas_ta.atr()
- iBands() -> pandas_ta.bbands()
- iCCI() -> pandas_ta.cci()
- iStochastic() -> pandas_ta.stoch()
- iHigh/iLow/iOpen/iClose on the current timeframe -> df["high"]/df["low"]/df["open"]/df["close"]
- iHigh/iLow/iOpen/iClose on PERIOD_D1 with shift>0 -> per-trading-day groupby + .shift(N); MUST be weekend-aware (see CRITICAL section above). Never use \`date - timedelta(days=N)\`.
- OrderSend(BUY) -> set long_entry, long_sl, long_tp in signals_df
- OrderSend(SELL) -> set short_entry, short_sl, short_tp in signals_df
- OnTick() -> converted to bar-by-bar iteration in generate_signals
- OnInit() -> __init__() of the strategy class
- AccountBalance/AccountEquity/lot sizing/SYMBOL_TRADE_TICK_VALUE/SYMBOL_VOLUME_MIN/MAX/STEP -> NOT NEEDED. Engine handles sizing. Do NOT replicate. Do NOT include in warnings.
- SymbolInfoInteger(SYMBOL_SPREAD)/MarketInfo(SPREAD) -> not available in backtesting; skip the spread filter and document in warning
- SymbolInfoDouble(SYMBOL_POINT)/SYMBOL_DIGITS -> use pip_size: params.get('pip_size', 0.0001)
- trade.PositionModify (trailing stop) -> per-signal columns trail_type/trail_trigger_pips/trail_distance_pips/trail_dont_cross_entry — status: "mapped"
- ClosePartialByDeal / partial close -> per-signal columns partial_close_pct/partial_at_r or partial_at_pips — status: "mapped"
- GlobalVariableCheck/Get/Set -> Python instance variables or sets scoped to generate_signals()
- TimeCurrent/TimeToStruct -> df.index (DatetimeIndex in UTC)
- OnTradeTransaction -> approximated by tracking placed dates in a Python set; document in warning

PARAMETER EXTRACTION:
After converting the code, extract all MQL \`input\` variables (e.g. \`input int InpStopLoss = 50;\`, \`input double InpTakeProfit = 100.0;\`, \`extern int Period_MA = 14;\`) into a "parameters" array. Rules:
- Only extract variables explicitly declared as \`input\` or \`extern\` in the original MQL code — never include calculated/derived values.
- For each parameter, provide: name (the Python snake_case key used in params.get()), label (human-readable display name, e.g. "Stop Loss (Pips)"), type ("number" for doubles/floats, "integer" for ints, "string" for strings), default (the original value from the MQL code), mql_input_name (the original MQL variable name).
- The generated Python code MUST read all extracted parameters via \`params.get("name", default)\` — never hardcode.
- Use snake_case names that are NOT Python keywords (e.g. use "stop_loss_pips" not "type").
- If no input/extern variables are found, return an empty "parameters" array.

You MUST respond with ONLY a valid JSON object (no markdown, no code fences) with this exact structure:
{
  "python_code": "...full Python source code...",
  "mapping_report": [
    {"mql_function": "iMA", "python_equivalent": "pandas_ta.ema()", "status": "mapped", "note": "Direct mapping"},
    {"mql_function": "trade.PositionModify", "python_equivalent": "signals_df trail_type/trail_trigger_pips/trail_distance_pips columns", "status": "mapped", "note": "Continuous trailing stop via PROJ-30 per-signal engine columns"}
  ],
  "warnings": ["List of any conversion warnings or limitations"],
  "parameters": [
    {"name": "stop_loss_pips", "label": "Stop Loss (Pips)", "type": "integer", "default": 50, "mql_input_name": "InpStopLoss"},
    {"name": "take_profit_pips", "label": "Take Profit (Pips)", "type": "number", "default": 100.0, "mql_input_name": "InpTakeProfit"}
  ]
}

The "status" field must be one of: "mapped", "approximated", "unsupported".
Include a mapping_report entry for each MQL function found in the source code.
Include warnings only for genuinely unsupported features (e.g. spread filter, OnTradeTransaction approximation, sub-minute tick logic).
Do NOT include warnings for: lot sizing, account balance, tick values, volume constraints, trailing stop, or partial close — these are all handled by the engine.`;

// ── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Auth check
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limiting via Supabase RPC
  try {
    const { data: allowed, error: rlError } = await supabase.rpc(
      "check_rate_limit",
      {
        p_key: `mql-convert:${user.id}`,
        p_max_requests: RATE_LIMIT_MAX,
        p_window_seconds: RATE_LIMIT_WINDOW_SECONDS,
      }
    );

    if (rlError) {
      console.error("Rate limit check failed:", rlError.message);
      return NextResponse.json(
        { error: "Rate limit service unavailable. Please try again." },
        { status: 503 }
      );
    } else if (!allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Max 10 conversions per hour. Try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(RATE_LIMIT_WINDOW_SECONDS) },
        }
      );
    }
  } catch (err) {
    console.error("Rate limit check threw:", err);
  }

  // Parse body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate
  const parsed = ConvertRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Sanitize: strip null bytes, trim to 50k
  const mqlCode = parsed.data.mql_code.replace(/\x00/g, "").slice(0, 50000);
  const mqlVersion = parsed.data.mql_version;

  // Basic MQL keyword check
  if (!looksLikeMqlCode(mqlCode)) {
    return NextResponse.json(
      {
        error:
          "This does not appear to be MQL code. Please paste a valid EA.",
      },
      { status: 400 }
    );
  }

  // Line count warning
  const lineCount = mqlCode.split("\n").length;
  const lineWarning =
    lineCount > 400
      ? `Warning: The MQL code has ${lineCount} lines. Very large EAs may produce less accurate conversions.`
      : null;

  // Check for Anthropic API key
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "AI conversion service is not configured. ANTHROPIC_API_KEY is missing." },
      { status: 503 }
    );
  }

  // Call Claude API
  try {
    const anthropic = new Anthropic({ apiKey });

    const userPrompt = `Convert the following ${mqlVersion === "auto" ? "MQL4/MQL5" : mqlVersion.toUpperCase()} Expert Advisor to a Python strategy class:\n\n\`\`\`\n${mqlCode}\n\`\`\``;

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    // Extract text content
    const textBlock = message.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return NextResponse.json(
        { error: "AI returned an unexpected response format. Please retry." },
        { status: 502 }
      );
    }

    // Parse Claude's JSON response
    let result: {
      python_code: string;
      mapping_report: Array<{
        mql_function: string;
        python_equivalent: string;
        status: string;
        note: string;
      }>;
      warnings: string[];
      parameters?: Array<{
        name: string;
        label: string;
        type: "number" | "integer" | "string";
        default: number | string;
        mql_input_name: string;
      }>;
    };

    try {
      // Claude might wrap the JSON in markdown code fences despite instructions
      let jsonText = textBlock.text.trim();
      if (jsonText.startsWith("```")) {
        jsonText = jsonText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      }
      result = JSON.parse(jsonText);
    } catch {
      return NextResponse.json(
        {
          error: "AI returned malformed JSON. Please retry the conversion.",
          raw_response: textBlock.text.slice(0, 500),
        },
        { status: 502 }
      );
    }

    // Validate the response structure
    if (!result.python_code || !Array.isArray(result.mapping_report)) {
      return NextResponse.json(
        { error: "AI response is missing required fields. Please retry." },
        { status: 502 }
      );
    }

    // Add line warning if applicable
    const warnings = result.warnings || [];
    if (lineWarning) {
      warnings.unshift(lineWarning);
    }

    return NextResponse.json({
      python_code: result.python_code,
      mapping_report: result.mapping_report,
      warnings,
      parameters: Array.isArray(result.parameters) ? result.parameters : [],
    });
  } catch (error) {
    console.error("Claude API error:", error);

    if (error instanceof Anthropic.APIError) {
      if (error.status === 429) {
        return NextResponse.json(
          { error: "AI service is temporarily overloaded. Please retry in a few seconds." },
          { status: 502 }
        );
      }
      if (error.status === 401) {
        return NextResponse.json(
          { error: "AI service authentication failed. Check server configuration." },
          { status: 503 }
        );
      }
    }

    return NextResponse.json(
      { error: "AI conversion failed. Please retry." },
      { status: 502 }
    );
  }
}
