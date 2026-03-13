/**
 * Allowlist of symbols supported by the backtesting platform.
 *
 * HOW TO ADD A NEW SYMBOL:
 *   1. Add the ticker string to the appropriate section below.
 *   2. Add the instrument config (pip_size, pip_value_per_lot) to
 *      python/_INSTRUMENT_REGISTRY in python/main.py.
 *   3. Verify the symbol is available on Dukascopy before using it.
 *
 * Ticker format: uppercase letters, digits, and dots only (e.g. "XAUUSD", "US500").
 */

export const SUPPORTED_SYMBOLS = new Set<string>([
  // ── Forex ──────────────────────────────────────────────────────────────────
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "USDCHF",
  "AUDUSD",
  "NZDUSD",
  "USDCAD",
  "EURGBP",
  "EURJPY",
  "GBPJPY",
  "EURCHF",
  "AUDCAD",
  "AUDNZD",
  "CADJPY",
  "CHFJPY",

  // ── Metals ─────────────────────────────────────────────────────────────────
  "XAUUSD", // Gold
  "XAGUSD", // Silver

  // ── Indices ────────────────────────────────────────────────────────────────
  "GER30",  // DAX 30
  "GER40",  // DAX 40
  "US30",   // Dow Jones
  "US500",  // S&P 500
  "NAS100", // Nasdaq 100
  "UK100",  // FTSE 100
  "JP225",  // Nikkei 225
  "FRA40",  // CAC 40
]);

/** Type-safe check — used in Zod schemas. */
export function isSupportedSymbol(value: string): boolean {
  return SUPPORTED_SYMBOLS.has(value.toUpperCase());
}
