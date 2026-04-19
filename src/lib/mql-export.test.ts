/**
 * Unit tests for PROJ-33: MQL Converter – MT5 EA Export
 * Tests the core regex/format logic used in /api/mql-converter/export-mt5
 *
 * Note: these functions are extracted inline here for testability.
 * The developer should extract them to src/lib/mql-export.ts so they
 * can be imported directly in the route and in tests.
 */

import { describe, it, expect } from "vitest";

// ── Inline copies of the pure utility functions from the route ──────────────

type ExportParameter = {
  mql_input_name: string;
  current_value: number | string;
  type: "number" | "integer" | "string";
};

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatValue(param: ExportParameter): string {
  if (param.type === "string") {
    return `"${String(param.current_value).replace(/"/g, '\\"')}"`;
  }
  if (param.type === "integer") {
    return String(Math.round(Number(param.current_value)));
  }
  return String(param.current_value);
}

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
    const regex = new RegExp(
      `((?:input|extern)\\s+\\w+\\s+${varName}\\s*=\\s*)([^;]+)(;)`
    );

    if (regex.test(code)) {
      code = code.replace(regex, `$1${formattedValue}$3`);
      replaced.push(param.mql_input_name);
    } else {
      notFound.push(param.mql_input_name);
    }
  }

  return { code, replaced, notFound };
}

function sanitize(str: string): string {
  return str.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_");
}

function buildFilename(conversionName: string | undefined, symbol: string): string {
  const date = new Date().toISOString().split("T")[0];
  const symbolPart = sanitize(symbol);

  if (conversionName && conversionName.trim()) {
    return `${sanitize(conversionName)}_${symbolPart}_${date}.mq5`;
  }

  return `mql_converted_${symbolPart}_${date}.mq5`;
}

// ── replaceInputDefaults ────────────────────────────────────────────────────

describe("replaceInputDefaults", () => {
  it("replaces a numeric input declaration", () => {
    const code = `input int StopLoss = 50;`;
    const { code: result, replaced } = replaceInputDefaults(code, [
      { mql_input_name: "StopLoss", current_value: 100, type: "integer" },
    ]);
    expect(result).toBe(`input int StopLoss = 100;`);
    expect(replaced).toContain("StopLoss");
  });

  it("replaces a double input declaration", () => {
    const code = `input double RiskPercent = 1.5;`;
    const { code: result } = replaceInputDefaults(code, [
      { mql_input_name: "RiskPercent", current_value: 2.5, type: "number" },
    ]);
    expect(result).toBe(`input double RiskPercent = 2.5;`);
  });

  it("replaces a string input declaration with quoted value", () => {
    const code = `input string TimeExit = "20:00";`;
    const { code: result } = replaceInputDefaults(code, [
      { mql_input_name: "TimeExit", current_value: "22:00", type: "string" },
    ]);
    expect(result).toBe(`input string TimeExit = "22:00";`);
  });

  it("handles extern (MQL4) declarations", () => {
    const code = `extern int Period = 14;`;
    const { code: result, replaced } = replaceInputDefaults(code, [
      { mql_input_name: "Period", current_value: 20, type: "integer" },
    ]);
    expect(result).toBe(`extern int Period = 20;`);
    expect(replaced).toContain("Period");
  });

  it("tracks not-found parameters and skips them without error", () => {
    const code = `input int StopLoss = 50;`;
    const { notFound, replaced } = replaceInputDefaults(code, [
      { mql_input_name: "NonExistent", current_value: 10, type: "integer" },
    ]);
    expect(notFound).toContain("NonExistent");
    expect(replaced).toHaveLength(0);
  });

  it("replaces multiple parameters in one code block", () => {
    const code = `input int StopLoss = 50;\ninput double RiskPercent = 1.5;`;
    const { replaced } = replaceInputDefaults(code, [
      { mql_input_name: "StopLoss", current_value: 80, type: "integer" },
      { mql_input_name: "RiskPercent", current_value: 2.0, type: "number" },
    ]);
    expect(replaced).toContain("StopLoss");
    expect(replaced).toContain("RiskPercent");
  });

  it("only replaces the first occurrence when duplicate variable names exist", () => {
    const code = `input int Var = 10;\ninput int Var = 20;`;
    const { code: result } = replaceInputDefaults(code, [
      { mql_input_name: "Var", current_value: 99, type: "integer" },
    ]);
    // Only first occurrence replaced (no /g flag)
    expect(result).toBe(`input int Var = 99;\ninput int Var = 20;`);
  });

  it("handles empty parameter list gracefully", () => {
    const code = `input int StopLoss = 50;`;
    const { code: result, replaced, notFound } = replaceInputDefaults(code, []);
    expect(result).toBe(code);
    expect(replaced).toHaveLength(0);
    expect(notFound).toHaveLength(0);
  });

  it("handles integer rounding for float values", () => {
    const code = `input int Period = 14;`;
    const { code: result } = replaceInputDefaults(code, [
      { mql_input_name: "Period", current_value: 14.7, type: "integer" },
    ]);
    expect(result).toBe(`input int Period = 15;`);
  });

  it("escapes inner double quotes in string parameters", () => {
    const code = `input string Label = "old";`;
    const { code: result } = replaceInputDefaults(code, [
      { mql_input_name: "Label", current_value: 'say "hello"', type: "string" },
    ]);
    expect(result).toBe(`input string Label = "say \\"hello\\"";`);
  });
});

// ── formatValue ─────────────────────────────────────────────────────────────

describe("formatValue", () => {
  it("formats a number type", () => {
    expect(formatValue({ mql_input_name: "x", current_value: 1.5, type: "number" })).toBe("1.5");
  });

  it("formats an integer type (rounds)", () => {
    expect(formatValue({ mql_input_name: "x", current_value: 3.9, type: "integer" })).toBe("4");
  });

  it("formats a string type with double quotes", () => {
    expect(formatValue({ mql_input_name: "x", current_value: "22:00", type: "string" })).toBe('"22:00"');
  });
});

// ── sanitize & buildFilename ─────────────────────────────────────────────────

describe("sanitize", () => {
  it("replaces special chars with underscores", () => {
    expect(sanitize("GER30.cash")).toBe("GER30_cash");
  });

  it("collapses multiple underscores", () => {
    expect(sanitize("GER30..cash")).toBe("GER30_cash");
  });

  it("preserves alphanumeric and underscore", () => {
    expect(sanitize("my_strategy_1")).toBe("my_strategy_1");
  });
});

describe("buildFilename", () => {
  const today = new Date().toISOString().split("T")[0];

  it("includes conversion name, symbol, and date", () => {
    expect(buildFilename("MyStrategy", "EURUSD")).toBe(
      `MyStrategy_EURUSD_${today}.mq5`
    );
  });

  it("sanitizes symbol with special characters", () => {
    expect(buildFilename("EA", "GER30.cash")).toBe(
      `EA_GER30_cash_${today}.mq5`
    );
  });

  it("uses fallback filename when no conversion name provided", () => {
    expect(buildFilename(undefined, "XAUUSD")).toBe(
      `mql_converted_XAUUSD_${today}.mq5`
    );
  });

  it("uses fallback filename when conversion name is empty/whitespace", () => {
    expect(buildFilename("   ", "XAUUSD")).toBe(
      `mql_converted_XAUUSD_${today}.mq5`
    );
  });
});
