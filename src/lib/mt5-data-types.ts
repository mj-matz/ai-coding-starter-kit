/**
 * Types + utilities for MT5 broker market data.
 *
 * PROJ-34: MT5 Broker Data Import
 *
 * Users upload CSV exports from the MT5 History Center. The files are parsed
 * in the browser (no server round-trip for the raw file), validated against
 * this schema, and then pushed as JSON rows to the API for storage.
 */

// ── Broker server timezones ─────────────────────────────────────────────────
// MT5 History Center exports candles in the broker's server time, not UTC.
// Users must select the timezone that matches their broker's server clock.

export const BROKER_TIMEZONES = [
  { value: "UTC",               label: "UTC (GMT+0) – no conversion" },
  { value: "Europe/Athens",     label: "EET/EEST (GMT+2/+3) – Startrader, most EU brokers" },
  { value: "Europe/Helsinki",   label: "EET/EEST (GMT+2/+3) – Finland / Baltic" },
  { value: "Europe/Berlin",     label: "CET/CEST (GMT+1/+2) – Western Europe" },
  { value: "Europe/London",     label: "GMT/BST (GMT+0/+1) – UK" },
  { value: "America/New_York",  label: "EST/EDT (GMT-5/-4) – New York" },
  { value: "Asia/Dubai",        label: "GST (GMT+4) – Dubai, no DST" },
  { value: "Asia/Singapore",    label: "SGT (GMT+8) – Singapore" },
  { value: "Asia/Tokyo",        label: "JST (GMT+9) – Tokyo" },
  { value: "Australia/Sydney",  label: "AEST/AEDT (GMT+10/+11) – Sydney" },
] as const;

export type BrokerTimezone = (typeof BROKER_TIMEZONES)[number]["value"];

// ── Supported timeframes (must match Python backend) ────────────────────────

export const MT5_TIMEFRAMES = [
  { value: "1m", label: "M1 (1 minute)" },
  { value: "5m", label: "M5 (5 minutes)" },
  { value: "15m", label: "M15 (15 minutes)" },
  { value: "30m", label: "M30 (30 minutes)" },
  { value: "1h", label: "H1 (1 hour)" },
  { value: "4h", label: "H4 (4 hours)" },
  { value: "1d", label: "D1 (1 day)" },
] as const;

export type Mt5Timeframe = (typeof MT5_TIMEFRAMES)[number]["value"];

export const MT5_TIMEFRAME_VALUES = MT5_TIMEFRAMES.map((t) => t.value) as readonly string[];

// ── Size limits ─────────────────────────────────────────────────────────────

export const MT5_MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
export const MT5_MIN_CANDLES = 10;

// ── API types ───────────────────────────────────────────────────────────────

export interface Mt5Dataset {
  id: string;
  asset: string;
  timeframe: Mt5Timeframe;
  start_date: string;          // ISO date (UTC)
  end_date: string;            // ISO date (UTC)
  candle_count: number;
  uploaded_at: string;         // ISO datetime
  broker_timezone: string;     // IANA timezone of the broker server clock
}

export interface Mt5Candle {
  timestamp: string;   // ISO datetime (UTC)
  open: number;
  high: number;
  low: number;
  close: number;
  tick_volume?: number;
  volume?: number;
  spread?: number;
}

export interface Mt5UploadRequest {
  asset: string;
  timeframe: Mt5Timeframe;
  candles: Mt5Candle[];
  /** IANA timezone of the broker server clock (candle timestamps are already in UTC after client-side conversion). */
  broker_timezone: string;
  /** How to handle overlap with existing dataset for same asset+timeframe. */
  conflict_resolution?: "merge" | "replace";
}

export interface Mt5UploadResponse {
  dataset: Mt5Dataset;
  /** If a conflict existed and resolution was required, this is true. */
  had_conflict: boolean;
}

export interface Mt5CheckResponse {
  available: boolean;
  /** When available: covers the entire requested date range. */
  covers_range?: boolean;
  start_date?: string;
  end_date?: string;
  candle_count?: number;
}

// ── CSV parsing ─────────────────────────────────────────────────────────────

export interface CsvParseResult {
  candles: Mt5Candle[];
  detected_delimiter: ";" | "," | "\t";
  detected_date_format: string;
  has_tick_volume: boolean;
  has_volume: boolean;
  has_spread: boolean;
  /** Total rows that were parsed (excludes header row). */
  total_rows: number;
  /** First and last timestamp in the parsed data. */
  first_timestamp: string;
  last_timestamp: string;
}

export class CsvParseError extends Error {
  readonly hint?: string;
  constructor(message: string, hint?: string) {
    super(message);
    this.name = "CsvParseError";
    this.hint = hint;
  }
}

/**
 * Parse a raw MT5 History Center CSV export into structured candle rows.
 *
 * Supported layouts:
 *   Date;Time;Open;High;Low;Close;TickVol;Volume;Spread
 *   Date,Time,Open,High,Low,Close,TickVol,Volume,Spread
 *   <DATE>\t<TIME>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\t<TICKVOL>\t<VOL>\t<SPREAD>
 *   "Date  Time","Open","High","Low","Close","TickVol","Volume","Spread"
 *
 * @param brokerTimezone IANA timezone of the broker server clock (e.g. "Europe/Athens").
 *   Candle timestamps in the CSV are in broker-local time; this parameter is used to
 *   convert them to UTC before storing.  Defaults to "UTC" (no conversion).
 */
export async function parseMt5Csv(raw: string, brokerTimezone = "UTC"): Promise<CsvParseResult> {
  const trimmed = raw.replace(/^\uFEFF/, "").trim();
  if (!trimmed) {
    throw new CsvParseError(
      "The CSV file is empty.",
      "Please export your data from MT5 -> Tools -> History Center -> right-click -> Export."
    );
  }

  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    throw new CsvParseError(
      "The CSV file has no data rows.",
      "At least one header row + one candle row is required."
    );
  }

  // Detect delimiter (prefer the one that yields the most columns in the first row).
  const delimiter = detectDelimiter(lines[0]);

  // Parse header row (case-insensitive).
  const headerCells = splitCsvLine(lines[0], delimiter).map((c) =>
    c.replace(/^["<]|[">]$/g, "").trim().toLowerCase()
  );

  // Find column indices.
  const idx = {
    date: headerCells.findIndex((c) => c === "date" || c === "<date>"),
    time: headerCells.findIndex((c) => c === "time" || c === "<time>"),
    open: headerCells.findIndex((c) => c === "open" || c === "<open>"),
    high: headerCells.findIndex((c) => c === "high" || c === "<high>"),
    low: headerCells.findIndex((c) => c === "low" || c === "<low>"),
    close: headerCells.findIndex((c) => c === "close" || c === "<close>"),
    tickVol: headerCells.findIndex((c) => c === "tickvol" || c === "<tickvol>"),
    volume: headerCells.findIndex((c) => c === "volume" || c === "vol" || c === "<vol>"),
    spread: headerCells.findIndex((c) => c === "spread" || c === "<spread>"),
  };

  // Mandatory columns
  for (const key of ["date", "open", "high", "low", "close"] as const) {
    if (idx[key] === -1) {
      throw new CsvParseError(
        `Column '${key[0].toUpperCase() + key.slice(1)}' not found in the CSV header.`,
        "Please export from MT5 -> History Center -> right-click -> Export."
      );
    }
  }

  const candles: Mt5Candle[] = [];
  let detectedDateFormat = "";

  for (let i = 1; i < lines.length; i++) {
    // Yield to the browser every 10K rows to keep the UI responsive
    if (i % 10_000 === 0) await new Promise<void>((r) => setTimeout(r, 0));

    const cells = splitCsvLine(lines[i], delimiter);
    if (cells.length < 5) continue;

    const dateStr = cells[idx.date]?.trim() ?? "";
    const timeStr = idx.time !== -1 ? (cells[idx.time]?.trim() ?? "") : "";

    const parsed = parseMt5DateTime(dateStr, timeStr, brokerTimezone);
    if (!parsed) {
      throw new CsvParseError(
        `Invalid date/time in row ${i + 1}: "${dateStr} ${timeStr}".`,
        "Expected formats: 2026.01.05 00:00 or 2026-01-05 00:00."
      );
    }
    if (!detectedDateFormat) detectedDateFormat = parsed.format;

    const open = parseNumber(cells[idx.open]);
    const high = parseNumber(cells[idx.high]);
    const low = parseNumber(cells[idx.low]);
    const close = parseNumber(cells[idx.close]);

    if (open == null || high == null || low == null || close == null) {
      throw new CsvParseError(
        `Invalid OHLC value in row ${i + 1}.`,
        "OHLC columns must contain numeric values (no text)."
      );
    }

    const candle: Mt5Candle = {
      timestamp: parsed.iso,
      open,
      high,
      low,
      close,
    };

    if (idx.tickVol !== -1) {
      const v = parseNumber(cells[idx.tickVol]);
      if (v != null) candle.tick_volume = v;
    }
    if (idx.volume !== -1) {
      const v = parseNumber(cells[idx.volume]);
      if (v != null) candle.volume = v;
    }
    if (idx.spread !== -1) {
      const v = parseNumber(cells[idx.spread]);
      if (v != null) candle.spread = v;
    }

    candles.push(candle);
  }

  if (candles.length < MT5_MIN_CANDLES) {
    throw new CsvParseError(
      `Only ${candles.length} candle(s) found. At least ${MT5_MIN_CANDLES} are required.`,
      "Make sure the CSV export contains the full history range."
    );
  }

  // Sort by timestamp ascending (MT5 exports are usually already sorted, but be safe).
  candles.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  return {
    candles,
    detected_delimiter: delimiter,
    detected_date_format: detectedDateFormat,
    has_tick_volume: idx.tickVol !== -1,
    has_volume: idx.volume !== -1,
    has_spread: idx.spread !== -1,
    total_rows: candles.length,
    first_timestamp: candles[0].timestamp,
    last_timestamp: candles[candles.length - 1].timestamp,
  };
}

// ── Timezone conversion helper ───────────────────────────────────────────────

// One formatter per timezone — creating Intl.DateTimeFormat is expensive; reuse it.
const _tzFmtCache = new Map<string, Intl.DateTimeFormat>();
function getTzFormatter(timezone: string): Intl.DateTimeFormat {
  let fmt = _tzFmtCache.get(timezone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hourCycle: "h23",
    });
    _tzFmtCache.set(timezone, fmt);
  }
  return fmt;
}

/**
 * Convert a naive local datetime (as parsed from an MT5 CSV) to a UTC ISO string,
 * accounting for DST via the Intl API.  Works by finding how far the given IANA
 * timezone is ahead of/behind UTC at approximately that moment, then subtracting
 * that offset.
 */
function naiveLocalToUtcIso(
  year: number, month: number, day: number,
  hour: number, minute: number, second: number,
  timezone: string,
): string {
  const p2 = (n: number) => String(n).padStart(2, "0");
  if (timezone === "UTC") {
    return `${year}-${p2(month)}-${p2(day)}T${p2(hour)}:${p2(minute)}:${p2(second)}Z`;
  }

  // Treat the naive time as UTC to get a reference millisecond value.
  const approxUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);

  // Ask the Intl API what local time the target timezone shows for that ms value.
  const fmt = getTzFormatter(timezone);
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date(approxUtcMs)).map((p) => [p.type, p.value]),
  );

  const tzDisplayMs = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second),
  );

  // offsetMs = how many ms the timezone is ahead of UTC (positive = east of UTC).
  // tzDisplay - approxUtcMs = how much the timezone clock leads UTC.
  // True UTC for the naive local time = approxUtcMs - (tzDisplay - approxUtcMs)
  //   but simpler: utcMs = approxUtcMs + (approxUtcMs - tzDisplayMs)
  const utcMs = approxUtcMs + (approxUtcMs - tzDisplayMs);
  return new Date(utcMs).toISOString().replace(/\.\d{3}Z$/, "Z");
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function detectDelimiter(headerLine: string): ";" | "," | "\t" {
  const semi = (headerLine.match(/;/g) ?? []).length;
  const comma = (headerLine.match(/,/g) ?? []).length;
  const tab = (headerLine.match(/\t/g) ?? []).length;
  if (tab > semi && tab > comma) return "\t";
  return semi >= comma ? ";" : ",";
}

function splitCsvLine(line: string, delimiter: string): string[] {
  // Minimal CSV splitter: handles quoted values with embedded delimiter.
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === delimiter && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current);
  return cells;
}

function parseNumber(raw: string | undefined): number | null {
  if (raw == null) return null;
  const cleaned = raw.trim().replace(/"/g, "");
  if (!cleaned) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

interface ParsedDateTime {
  iso: string;
  format: string;
}

function parseMt5DateTime(date: string, time: string, timezone: string): ParsedDateTime | null {
  const cleanDate = date.replace(/"/g, "").trim();
  const cleanTime = time.replace(/"/g, "").trim();

  // The Date column may already contain both date + time (e.g. "2026.01.05 00:00").
  const parts = cleanDate.split(/\s+/);
  const datePart = parts[0];
  const timePart = parts.length > 1 ? parts.slice(1).join(" ") : cleanTime;

  // Try YYYY.MM.DD (MT5 default)
  let match = datePart.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})$/);
  let format = "YYYY.MM.DD";

  // Fallback: YYYY-MM-DD (ISO)
  if (!match) {
    match = datePart.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (match) format = "YYYY-MM-DD";
  }

  if (!match) return null;

  const [, yyyy, mm, dd] = match;

  // Parse time portion (HH:MM or HH:MM:SS)
  let hour = 0;
  let minute = 0;
  let second = 0;
  if (timePart) {
    const tMatch = timePart.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!tMatch) return null;
    hour = Number(tMatch[1]);
    minute = Number(tMatch[2]);
    second = tMatch[3] ? Number(tMatch[3]) : 0;
  }

  const iso = naiveLocalToUtcIso(Number(yyyy), Number(mm), Number(dd), hour, minute, second, timezone);

  // Validate that it's a real date
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;

  return { iso, format: timePart ? `${format} HH:MM` : format };
}

// ── Formatting helpers ──────────────────────────────────────────────────────

export function formatMt5Date(isoDatetime: string): string {
  try {
    return new Date(isoDatetime).toLocaleDateString(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return isoDatetime;
  }
}

export function formatMt5DateTime(isoDatetime: string): string {
  try {
    return new Date(isoDatetime).toLocaleString(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return isoDatetime;
  }
}

export function formatMt5Timeframe(tf: Mt5Timeframe): string {
  const match = MT5_TIMEFRAMES.find((t) => t.value === tf);
  return match?.label ?? tf;
}
