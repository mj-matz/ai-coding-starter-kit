/**
 * Maps trading instrument symbols to their relevant economic calendar currencies.
 * Used to filter news days from the economic_calendar table.
 */
const INSTRUMENT_CURRENCIES: Record<string, string[]> = {
  // Gold / Silver
  XAUUSD: ["USD"],
  XAGUSD: ["USD"],

  // Major Forex pairs
  EURUSD: ["USD", "EUR"],
  GBPUSD: ["USD", "GBP"],
  USDJPY: ["USD", "JPY"],
  USDCHF: ["USD", "CHF"],
  AUDUSD: ["USD", "AUD"],
  NZDUSD: ["USD", "NZD"],
  USDCAD: ["USD", "CAD"],

  // Minor Forex pairs
  EURGBP: ["EUR", "GBP"],
  EURJPY: ["EUR", "JPY"],
  GBPJPY: ["GBP", "JPY"],
  EURCHF: ["EUR", "CHF"],

  // Indices
  GER30: ["EUR"],
  GER40: ["EUR"],
  US30:  ["USD"],
  SPX500: ["USD"],
  NAS100: ["USD"],
  UK100: ["GBP"],
  FRA40: ["EUR"],
  JPN225: ["JPY"],
};

/** Returns the relevant currencies for a given instrument symbol.
 *  Falls back to ["USD"] for unknown symbols. */
export function getCurrenciesForInstrument(symbol: string): string[] {
  const upper = symbol.toUpperCase();
  return INSTRUMENT_CURRENCIES[upper] ?? ["USD"];
}
