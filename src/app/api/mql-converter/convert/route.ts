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
1. Extend \`BaseStrategy\` from \`strategies.base\`
2. Implement \`validate_params(self, params)\` and \`generate_signals(self, df, params)\`
3. The \`generate_signals\` method receives a pandas DataFrame \`df\` with columns: open, high, low, close, volume (DatetimeIndex in UTC)
4. It must return a tuple of (signals_df, skipped_days) where:
   - signals_df has columns: long_entry, long_sl, long_tp, short_entry, short_sl, short_tp, signal_expiry (all float, NaN = no signal; signal_expiry is pd.Timestamp or NaT)
   - skipped_days is a list (can be empty)
5. Use pandas_ta for indicators (e.g. pandas_ta.ema, pandas_ta.rsi, pandas_ta.macd, pandas_ta.atr, pandas_ta.bbands)
6. Use numpy and pandas for data manipulation
7. Do NOT use any network calls, file I/O, or subprocess calls
8. Do NOT import anything besides pandas, numpy, and pandas_ta

MQL function mappings:
- iMA() -> pandas_ta.ema() / sma() / wma() depending on method parameter
- iRSI() -> pandas_ta.rsi()
- iMACD() -> pandas_ta.macd()
- iATR() -> pandas_ta.atr()
- iBands() -> pandas_ta.bbands()
- iCCI() -> pandas_ta.cci()
- iStochastic() -> pandas_ta.stoch()
- iHigh/iLow/iOpen/iClose -> df["high"]/df["low"]/df["open"]/df["close"]
- OrderSend(BUY) -> set long_entry, long_sl, long_tp in signals_df
- OrderSend(SELL) -> set short_entry, short_sl, short_tp in signals_df
- OnTick() -> converted to bar-by-bar iteration in generate_signals
- OnInit() -> __init__() of the strategy class
- AccountBalance/AccountEquity -> approximate from initial_balance parameter (document in warning)
- MarketInfo(SPREAD) -> not available, document in warning

You MUST respond with ONLY a valid JSON object (no markdown, no code fences) with this exact structure:
{
  "python_code": "...full Python source code...",
  "mapping_report": [
    {"mql_function": "iMA", "python_equivalent": "pandas_ta.ema()", "status": "mapped", "note": "Direct mapping"},
    {"mql_function": "AccountBalance", "python_equivalent": "N/A", "status": "approximated", "note": "Approximated from initial_balance parameter"}
  ],
  "warnings": ["List of any conversion warnings or limitations"]
}

The "status" field must be one of: "mapped", "approximated", "unsupported".
Include a mapping_report entry for each MQL function found in the source code.
Include warnings for any broker-specific functions, unsupported features, or approximations made.`;

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
