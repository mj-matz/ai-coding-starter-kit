import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

// ── Zod schema ──────────────────────────────────────────────────────────────

const ParameterSchema = z.object({
  mql_input_name: z.string().min(1),
  current_value: z.union([z.number(), z.string(), z.boolean()]),
  type: z.enum(["number", "integer", "string", "boolean"]),
});

const ExportRequestSchema = z.object({
  original_mql_code: z.string().min(1, "Original MQL code is required"),
  parameters: z.array(ParameterSchema),
  symbol: z.string().min(1, "Symbol is required"),
  date_from: z.string().min(1),
  date_to: z.string().min(1),
  conversion_name: z.string().optional(),
});

type ExportParameter = z.infer<typeof ParameterSchema>;

// ── Regex replacement ───────────────────────────────────────────────────────

function replaceInputDefaults(
  mqlCode: string,
  parameters: ExportParameter[]
): { code: string; replaced: string[]; notFound: string[] } {
  let code = mqlCode;
  const replaced: string[] = [];
  const notFound: string[] = [];

  for (const param of parameters) {
    const varName = escapeRegex(param.mql_input_name);
    const formattedValue = formatValue(param);

    // Match both `input` and `extern` declarations (MQL5 / MQL4)
    // Pattern: (input|extern) <type> <varName> = <old_value>;
    const regex = new RegExp(
      `((?:input|extern)\\s+\\w+\\s+${varName}\\s*=\\s*)([^;]+)(;)`,
    );

    const match = regex.exec(code);
    if (match) {
      const oldValue = match[2].trim();
      code = code.replace(regex, `$1${formattedValue}$3`);
      if (oldValue !== formattedValue) {
        replaced.push(param.mql_input_name);
      }
    } else {
      notFound.push(param.mql_input_name);
    }
  }

  return { code, replaced, notFound };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatValue(param: ExportParameter): string {
  if (param.type === "string") {
    // Wrap string values in double quotes
    return `"${String(param.current_value).replace(/"/g, '\\"')}"`;
  }
  if (param.type === "integer") {
    return String(Math.round(Number(param.current_value)));
  }
  if (param.type === "boolean") {
    const v =
      typeof param.current_value === "boolean"
        ? param.current_value
        : String(param.current_value).toLowerCase() === "true";
    return v ? "true" : "false";
  }
  return String(param.current_value);
}

// ── Bridge OnTester() hook injection (PROJ-37) ──────────────────────────────
//
// MT5 build 5833 silently ignores the `Report=` directive in tester.ini for
// single-test runs (works only in optimisation mode). To capture results,
// the bridge instead instructs the EA itself to write a JSON file via the
// MQL5 OnTester() callback — see PROJ-37 Tech Design for the full schema.
//
// The injection adds two things to the exported .mq5:
//   1. An `input string report_uuid = "";` declaration that the bridge fills
//      via [TesterInputs] in tester.ini. Empty = "running outside the bridge"
//      and the hook short-circuits, so the EA still works manually in MT5.
//   2. A `double OnTester()` function appended to the file that collects all
//      TesterStatistics() metrics + HistoryDealGet*() trades into a single
//      JSON file at <Common>\Files\bridge_report_<uuid>.json.

const BRIDGE_REPORT_UUID_INPUT = [
  "// === Bridge result capture (PROJ-37) — do not edit ===",
  '// `report_uuid` is filled by the bridge via tester.ini [TesterInputs].',
  "// Empty value means the EA was launched manually — OnTester() will",
  "// short-circuit so manual runs are unaffected.",
  'input string report_uuid = "";',
].join("\n");

const BRIDGE_ON_TESTER_FUNCTION = `
// === Bridge result capture (PROJ-37) — do not edit ===
// Writes a JSON report to MT5's Common\\\\Files folder at test end.
// The bridge polls for bridge_report_<report_uuid>.json there.
double OnTester()
{
   // Skip silently when run outside the bridge (e.g. manual tester launch).
   if(StringLen(report_uuid) == 0) return 0.0;

   // ── Metrics via TesterStatistics() ────────────────────────────────
   double net_profit     = TesterStatistics(STAT_PROFIT);
   double gross_profit   = TesterStatistics(STAT_GROSS_PROFIT);
   double gross_loss     = TesterStatistics(STAT_GROSS_LOSS);
   double dd_abs         = TesterStatistics(STAT_BALANCE_DD);
   double dd_pct         = TesterStatistics(STAT_BALANCE_DDREL_PERCENT);
   double sharpe         = TesterStatistics(STAT_SHARPE_RATIO);
   double pf             = TesterStatistics(STAT_PROFIT_FACTOR);
   double ep             = TesterStatistics(STAT_EXPECTED_PAYOFF);
   double rf             = TesterStatistics(STAT_RECOVERY_FACTOR);
   int    total_trades   = (int)TesterStatistics(STAT_TRADES);
   int    won_trades     = (int)TesterStatistics(STAT_PROFIT_TRADES);
   int    lost_trades    = (int)TesterStatistics(STAT_LOSS_TRADES);

   // ── Trade list via HistoryDealGet*() ──────────────────────────────
   HistorySelect(0, TimeCurrent());
   int deal_count = HistoryDealsTotal();
   string trades_json = "[";
   bool first_trade = true;

   for(int i = 0; i < deal_count; i++)
   {
      ulong ticket = HistoryDealGetTicket(i);
      if(ticket == 0) continue;

      // Skip balance/deposit/withdrawal entries.
      long deal_type = HistoryDealGetInteger(ticket, DEAL_TYPE);
      if(deal_type != DEAL_TYPE_BUY && deal_type != DEAL_TYPE_SELL) continue;

      datetime open_time  = (datetime)HistoryDealGetInteger(ticket, DEAL_TIME);
      datetime close_time = open_time;  // single-leg deal; bridge pairs by ticket
      double   volume     = HistoryDealGetDouble(ticket, DEAL_VOLUME);
      double   open_price = HistoryDealGetDouble(ticket, DEAL_PRICE);
      double   profit     = HistoryDealGetDouble(ticket, DEAL_PROFIT);
      string   comment    = HistoryDealGetString(ticket, DEAL_COMMENT);
      string   direction  = (deal_type == DEAL_TYPE_BUY) ? "buy" : "sell";

      if(!first_trade) trades_json += ",";
      first_trade = false;

      trades_json += StringFormat(
         "{\\"ticket\\":%I64u,\\"open_time\\":\\"%s\\",\\"close_time\\":\\"%s\\","
         "\\"direction\\":\\"%s\\",\\"volume\\":%.5f,\\"open_price\\":%.5f,"
         "\\"close_price\\":%.5f,\\"profit\\":%.2f,\\"comment\\":\\"%s\\"}",
         ticket,
         TimeToString(open_time,  TIME_DATE|TIME_SECONDS),
         TimeToString(close_time, TIME_DATE|TIME_SECONDS),
         direction, volume, open_price, open_price, profit, comment
      );
   }
   trades_json += "]";

   // ── Assemble and write JSON ───────────────────────────────────────
   string ea_name = MQLInfoString(MQL_PROGRAM_NAME);
   string sym     = Symbol();
   string tf      = EnumToString(Period());

   string json = StringFormat(
      "{\\"schema_version\\":1,\\"job_uuid\\":\\"%s\\",\\"ea_name\\":\\"%s\\","
      "\\"symbol\\":\\"%s\\",\\"timeframe\\":\\"%s\\",\\"generated_at\\":\\"%s\\","
      "\\"metrics\\":{"
         "\\"total_net_profit\\":%.2f,\\"gross_profit\\":%.2f,\\"gross_loss\\":%.2f,"
         "\\"max_drawdown_abs\\":%.2f,\\"max_drawdown_pct\\":%.4f,"
         "\\"sharpe_ratio\\":%.4f,\\"profit_factor\\":%.4f,\\"expected_payoff\\":%.4f,"
         "\\"recovery_factor\\":%.4f,\\"total_trades\\":%d,"
         "\\"won_trades\\":%d,\\"lost_trades\\":%d"
      "},\\"trades\\":%s}",
      report_uuid, ea_name, sym, tf,
      TimeToString(TimeGMT(), TIME_DATE|TIME_SECONDS),
      net_profit, gross_profit, gross_loss, dd_abs, dd_pct,
      sharpe, pf, ep, rf, total_trades, won_trades, lost_trades,
      trades_json
   );

   string filename = "bridge_report_" + report_uuid + ".json";
   int fh = FileOpen(filename, FILE_WRITE|FILE_COMMON|FILE_TXT|FILE_ANSI);
   if(fh == INVALID_HANDLE)
   {
      Print("[Bridge] OnTester: failed to open ", filename, " - error ", GetLastError());
      return 0.0;
   }
   FileWriteString(fh, json);
   FileClose(fh);
   Print("[Bridge] OnTester: wrote result to Common\\\\Files\\\\", filename);

   return 0.0;  // ignored in single-test mode; used as fitness in optimisation
}
`;

function injectBridgeOnTesterHook(code: string): string {
  // 1. Insert the report_uuid input declaration. The convention in MQL5 EAs
  //    is to declare inputs at file scope before OnInit. We prepend our line
  //    above the FIRST `input ` / `extern ` declaration if any exist, so the
  //    new input shows up grouped with the others. If the EA has no inputs at
  //    all, we put it just before the first `void OnInit` / `int OnInit`
  //    function. As a final fallback, we put it at the very top of the file.
  let workingCode = code;

  // Avoid double-injection: if the EA already has a report_uuid declaration,
  // skip step 1.
  const hasReportUuid = /\binput\s+string\s+report_uuid\b/.test(workingCode);
  if (!hasReportUuid) {
    const firstInputMatch = workingCode.match(
      /^[ \t]*(?:input|extern)\s+\w+\s+\w+\s*=/m
    );

    if (firstInputMatch && firstInputMatch.index !== undefined) {
      const insertAt = firstInputMatch.index;
      workingCode =
        workingCode.slice(0, insertAt) +
        BRIDGE_REPORT_UUID_INPUT +
        "\n\n" +
        workingCode.slice(insertAt);
    } else {
      // No input declarations — try to put it before OnInit.
      const onInitMatch = workingCode.match(
        /^[ \t]*(?:void|int)\s+OnInit\s*\(/m
      );
      if (onInitMatch && onInitMatch.index !== undefined) {
        const insertAt = onInitMatch.index;
        workingCode =
          workingCode.slice(0, insertAt) +
          BRIDGE_REPORT_UUID_INPUT +
          "\n\n" +
          workingCode.slice(insertAt);
      } else {
        // Last resort: prepend to the file.
        workingCode = BRIDGE_REPORT_UUID_INPUT + "\n\n" + workingCode;
      }
    }
  }

  // 2. Append the OnTester() function. Skip if the EA already defines one —
  //    in that case the user has custom optimisation logic, and silently
  //    overwriting it would be surprising. The bridge will then fail loud
  //    with "EA did not produce a JSON report" and the user can re-export
  //    after removing their own OnTester.
  const hasOnTester = /\bdouble\s+OnTester\s*\(/.test(workingCode);
  if (!hasOnTester) {
    // Ensure file ends with a newline before our block.
    if (!workingCode.endsWith("\n")) {
      workingCode += "\n";
    }
    workingCode += BRIDGE_ON_TESTER_FUNCTION;
  }

  return workingCode;
}

// ── Comment block ───────────────────────────────────────────────────────────

function buildCommentBlock(
  conversionName: string | undefined,
  symbol: string,
  dateFrom: string,
  dateTo: string,
  replaced: string[],
  notFound: string[],
  parameters: ExportParameter[]
): string {
  const exportDate = new Date().toISOString().split("T")[0];
  const lines: string[] = [
    "//+------------------------------------------------------------------+",
    "//| Exported by Backtesting Platform                                  |",
    "//+------------------------------------------------------------------+",
  ];

  if (conversionName) {
    lines.push(`// Conversion: ${conversionName}`);
  }
  lines.push(`// Symbol: ${symbol}`);
  lines.push(`// Backtest period: ${dateFrom} to ${dateTo}`);
  lines.push(`// Export date: ${exportDate}`);
  lines.push("//");

  if (replaced.length === 0 && notFound.length === 0) {
    lines.push("// Parameters: unchanged (using original defaults)");
  } else {
    if (replaced.length > 0) {
      lines.push("// Modified parameters:");
      for (const name of replaced) {
        const param = parameters.find((p) => p.mql_input_name === name);
        if (param) {
          lines.push(`//   ${name} = ${formatValue(param)}`);
        }
      }
    }
    if (notFound.length > 0) {
      lines.push("//");
      lines.push("// Not found in original MQL (skipped):");
      for (const name of notFound) {
        lines.push(`//   ${name}`);
      }
    }
  }

  lines.push("//+------------------------------------------------------------------+");
  lines.push("");

  return lines.join("\n");
}

// ── Filename sanitization ───────────────────────────────────────────────────

function sanitize(str: string): string {
  return str.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_");
}

function buildFilename(
  conversionName: string | undefined,
  symbol: string
): string {
  const date = new Date().toISOString().split("T")[0];
  const symbolPart = sanitize(symbol);

  if (conversionName && conversionName.trim()) {
    return `${sanitize(conversionName)}_${symbolPart}_${date}.mq5`;
  }

  return `mql_converted_${symbolPart}_${date}.mq5`;
}

// ── Route handler ───────────────────────────────────────────────────────────

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

  // Parse body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = ExportRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const {
    original_mql_code,
    parameters,
    symbol,
    date_from,
    date_to,
    conversion_name,
  } = parsed.data;

  // Replace input defaults
  const { code, replaced, notFound } = replaceInputDefaults(
    original_mql_code,
    parameters
  );

  // PROJ-37: inject the bridge OnTester() result-capture hook so the EA
  // writes its tester result as JSON to MT5's Common\Files folder. The
  // bridge polls for that file at the end of a tester run.
  const codeWithHook = injectBridgeOnTesterHook(code);

  // Build comment block
  const commentBlock = buildCommentBlock(
    conversion_name,
    symbol,
    date_from,
    date_to,
    replaced,
    notFound,
    parameters
  );

  // Prepend comment block to code
  const finalCode = commentBlock + codeWithHook;

  // Build filename
  const filename = buildFilename(conversion_name, symbol);

  // Return as downloadable file
  return new NextResponse(finalCode, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
