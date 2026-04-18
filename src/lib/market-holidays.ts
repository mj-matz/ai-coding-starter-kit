// Market holiday calendars for gap analysis.
// Only exchange-closure days are listed — partial trading days are excluded.

function easterDate(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400000);
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  const d = utc(year, month, 1);
  let count = 0;
  while (true) {
    if (d.getUTCDay() === weekday) {
      if (++count === n) return new Date(d);
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

function lastWeekday(year: number, month: number, weekday: number): Date {
  const d = new Date(Date.UTC(year, month, 0));
  while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

// Shift a fixed holiday to the nearest weekday if it falls on a weekend.
function observedWeekday(d: Date): Date {
  const dow = d.getUTCDay();
  if (dow === 6) return addDays(d, -1); // Sat → Fri
  if (dow === 0) return addDays(d, 1);  // Sun → Mon
  return d;
}

// Frankfurt Stock Exchange (Xetra) — covers GER40, GER30, DAX
function xetraHolidays(year: number): string[] {
  const easter = easterDate(year);
  return [
    iso(utc(year, 1, 1)),           // New Year's Day
    iso(addDays(easter, -2)),        // Good Friday
    iso(addDays(easter, 1)),         // Easter Monday
    iso(utc(year, 5, 1)),           // Labour Day
    iso(utc(year, 12, 24)),         // Christmas Eve
    iso(utc(year, 12, 25)),         // Christmas Day
    iso(utc(year, 12, 26)),         // Boxing Day
    iso(utc(year, 12, 31)),         // New Year's Eve
  ];
}

// CME/COMEX — covers XAUUSD, Gold, Silver
// Only days when COMEX is fully closed (not just early close).
// MLK Day, Presidents Day, Juneteenth are equity/bond holidays — COMEX stays open.
function comexHolidays(year: number): string[] {
  const easter = easterDate(year);
  return [
    iso(observedWeekday(utc(year, 1, 1))),   // New Year's Day
    iso(addDays(easter, -2)),                 // Good Friday
    iso(lastWeekday(year, 5, 1)),             // Memorial Day (last Mon May)
    iso(observedWeekday(utc(year, 7, 4))),   // Independence Day
    iso(nthWeekday(year, 9, 1, 1)),           // Labor Day (1st Mon Sep)
    iso(nthWeekday(year, 11, 4, 4)),          // Thanksgiving (4th Thu Nov)
    iso(observedWeekday(utc(year, 12, 25))), // Christmas Day
  ];
}

export type MarketCalendar = "xetra" | "comex" | "forex";

export function detectMarketCalendar(asset: string): MarketCalendar {
  const a = asset.toUpperCase();
  if (/GER\d*|DAX/.test(a)) return "xetra";
  if (/XAU|GOLD|XAG|SILVER/.test(a)) return "comex";
  if (/SPX|SP5|NDX|NAS|US30|DOW|US500|US100/.test(a)) return "comex";
  return "forex"; // forex: no official exchange closures
}

export function getMarketHolidays(asset: string, years: number[]): Set<string> {
  const calendar = detectMarketCalendar(asset);
  const result = new Set<string>();
  if (calendar === "forex") return result;
  for (const year of years) {
    const days = calendar === "xetra" ? xetraHolidays(year) : comexHolidays(year);
    for (const d of days) result.add(d);
  }
  return result;
}
