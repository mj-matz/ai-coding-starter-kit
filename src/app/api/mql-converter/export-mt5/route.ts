import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

// ── Zod schema ──────────────────────────────────────────────────────────────

const ParameterSchema = z.object({
  mql_input_name: z.string().min(1),
  current_value: z.union([z.number(), z.string()]),
  type: z.enum(["number", "integer", "string"]),
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
  return String(param.current_value);
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
  const finalCode = commentBlock + code;

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
