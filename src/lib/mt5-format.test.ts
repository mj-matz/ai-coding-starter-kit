import { describe, expect, it } from "vitest";
import { formatDate, formatInt, formatPct, formatProfit } from "./mt5-format";

describe("formatDate", () => {
  it("formats a valid ISO string", () => {
    const result = formatDate("2025-01-15T08:30:00Z");
    expect(result).not.toBe("—");
    expect(result).toContain("2025");
  });

  it("returns — for null", () => {
    expect(formatDate(null)).toBe("—");
  });

  it("returns — for an invalid date string", () => {
    expect(formatDate("not-a-date")).toBe("—");
  });

  it("returns — for empty string", () => {
    expect(formatDate("")).toBe("—");
  });
});

describe("formatProfit", () => {
  it("formats a positive profit with $ sign", () => {
    const result = formatProfit(1234.56);
    expect(result).toMatch(/^\$/);
    expect(result).not.toBe("—");
  });

  it("formats a negative profit with -$ sign", () => {
    expect(formatProfit(-500)).toMatch(/^-\$/);
  });

  it("formats zero with $ sign", () => {
    expect(formatProfit(0)).toMatch(/^\$/);
  });

  it("returns — for null", () => {
    expect(formatProfit(null)).toBe("—");
  });

  it("returns — for undefined", () => {
    expect(formatProfit(undefined)).toBe("—");
  });

  it("returns — for Infinity", () => {
    expect(formatProfit(Infinity)).toBe("—");
  });

  it("returns — for NaN", () => {
    expect(formatProfit(NaN)).toBe("—");
  });
});

describe("formatPct", () => {
  it("formats a positive percentage with % suffix", () => {
    const result = formatPct(12.345);
    expect(result).toMatch(/^\d+\.\d+%$/);
    expect(result).toContain("12.35");
  });

  it("formats a negative value using its absolute value", () => {
    const result = formatPct(-5.5);
    expect(result).not.toMatch(/^-/);
    expect(result).toContain("5.50");
  });

  it("formats zero", () => {
    expect(formatPct(0)).toBe("0.00%");
  });

  it("returns — for null", () => {
    expect(formatPct(null)).toBe("—");
  });

  it("returns — for undefined", () => {
    expect(formatPct(undefined)).toBe("—");
  });

  it("returns — for NaN", () => {
    expect(formatPct(NaN)).toBe("—");
  });
});

describe("formatInt", () => {
  it("formats an integer as a non-dash string", () => {
    expect(formatInt(1000)).not.toBe("—");
    // Value should be formatted as a number (exact separator depends on locale)
    expect(Number(formatInt(1000).replace(/[^0-9]/g, ""))).toBe(1000);
  });

  it("rounds a float to the nearest integer", () => {
    expect(Number(formatInt(42.7).replace(/[^0-9]/g, ""))).toBe(43);
  });

  it("formats zero", () => {
    expect(formatInt(0)).toBe("0");
  });

  it("returns — for null", () => {
    expect(formatInt(null)).toBe("—");
  });

  it("returns — for undefined", () => {
    expect(formatInt(undefined)).toBe("—");
  });

  it("returns — for NaN", () => {
    expect(formatInt(NaN)).toBe("—");
  });
});
