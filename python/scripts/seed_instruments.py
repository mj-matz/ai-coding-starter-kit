"""
Seed the `instruments` table in Supabase with all symbols supported by the platform.

Usage (from the python/ directory):
    python scripts/seed_instruments.py [--dry-run]

Options:
    --dry-run   Print the instruments that would be upserted without writing to DB.

HOW TO ADD A NEW SYMBOL:
    1. Add the entry to INSTRUMENTS below (symbol, name, category, pip_size, pip_value_per_lot).
    2. Add the symbol → Dukascopy ticker mapping in fetchers/dukascopy_fetcher.py.
    3. Run this script to upsert the new row into Supabase.
    4. No redeployment needed — the API reads from the DB at runtime.
"""

import sys
import os

# Allow running from the python/ directory without package install
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# ── Instrument definitions ────────────────────────────────────────────────────
# Each entry: (symbol, name, category, source, pip_size, pip_value_per_lot, timezone)
#
# pip_size:          Smallest price increment used by the backtesting engine.
# pip_value_per_lot: Monetary value (account currency) of a 1-pip move on
#                    1 standard lot. Adjust for your broker if needed via the
#                    Supabase dashboard.
# timezone:          IANA timezone used to interpret strategy time inputs
#                    (rangeStart, rangeEnd, triggerDeadline, timeExit).
#                    When a user enters "14:30", it means 14:30 in this timezone.
#                    Update individual rows via the Supabase dashboard if needed.

INSTRUMENTS: list[dict] = [
    # ── Forex Majors ──────────────────────────────────────────────────────────
    {"symbol": "EURUSD", "name": "Euro vs US Dollar",                    "category": "Forex",       "source": "dukascopy", "pip_size": 0.0001, "pip_value_per_lot": 10.0,   "timezone": "UTC"},
    {"symbol": "GBPUSD", "name": "Pound vs US Dollar",                   "category": "Forex",       "source": "dukascopy", "pip_size": 0.0001, "pip_value_per_lot": 10.0,   "timezone": "UTC"},
    {"symbol": "USDCHF", "name": "US Dollar vs Swiss Franc",             "category": "Forex",       "source": "dukascopy", "pip_size": 0.0001, "pip_value_per_lot": 10.0,   "timezone": "UTC"},
    {"symbol": "USDJPY", "name": "US Dollar vs Japanese Yen",            "category": "Forex",       "source": "dukascopy", "pip_size": 0.01,   "pip_value_per_lot": 1000.0, "timezone": "UTC"},
    {"symbol": "AUDUSD", "name": "Australian Dollar vs US Dollar",       "category": "Forex",       "source": "dukascopy", "pip_size": 0.0001, "pip_value_per_lot": 10.0,   "timezone": "UTC"},
    {"symbol": "NZDUSD", "name": "New Zealand Dollar vs US Dollar",      "category": "Forex",       "source": "dukascopy", "pip_size": 0.0001, "pip_value_per_lot": 10.0,   "timezone": "UTC"},
    {"symbol": "USDCAD", "name": "US Dollar vs Canadian Dollar",         "category": "Forex",       "source": "dukascopy", "pip_size": 0.0001, "pip_value_per_lot": 10.0,   "timezone": "UTC"},
    # ── Forex Crosses ─────────────────────────────────────────────────────────
    {"symbol": "EURGBP", "name": "Euro vs Pound",                        "category": "Forex",       "source": "dukascopy", "pip_size": 0.0001, "pip_value_per_lot": 10.0,   "timezone": "UTC"},
    {"symbol": "EURJPY", "name": "Euro vs Japanese Yen",                 "category": "Forex",       "source": "dukascopy", "pip_size": 0.01,   "pip_value_per_lot": 1000.0, "timezone": "UTC"},
    {"symbol": "GBPJPY", "name": "Pound vs Japanese Yen",                "category": "Forex",       "source": "dukascopy", "pip_size": 0.01,   "pip_value_per_lot": 1000.0, "timezone": "UTC"},
    {"symbol": "EURAUD", "name": "Euro vs Australian Dollar",            "category": "Forex",       "source": "dukascopy", "pip_size": 0.0001, "pip_value_per_lot": 10.0,   "timezone": "UTC"},
    {"symbol": "EURCHF", "name": "Euro vs Swiss Franc",                  "category": "Forex",       "source": "dukascopy", "pip_size": 0.0001, "pip_value_per_lot": 10.0,   "timezone": "UTC"},
    {"symbol": "GBPCHF", "name": "Pound vs Swiss Franc",                 "category": "Forex",       "source": "dukascopy", "pip_size": 0.0001, "pip_value_per_lot": 10.0,   "timezone": "UTC"},
    {"symbol": "AUDCAD", "name": "Australian Dollar vs Canadian Dollar", "category": "Forex",       "source": "dukascopy", "pip_size": 0.0001, "pip_value_per_lot": 10.0,   "timezone": "UTC"},
    {"symbol": "AUDJPY", "name": "Australian Dollar vs Japanese Yen",   "category": "Forex",       "source": "dukascopy", "pip_size": 0.01,   "pip_value_per_lot": 1000.0, "timezone": "UTC"},
    {"symbol": "CADJPY", "name": "Canadian Dollar vs Japanese Yen",     "category": "Forex",       "source": "dukascopy", "pip_size": 0.01,   "pip_value_per_lot": 1000.0, "timezone": "UTC"},
    {"symbol": "CHFJPY", "name": "Swiss Franc vs Japanese Yen",         "category": "Forex",       "source": "dukascopy", "pip_size": 0.01,   "pip_value_per_lot": 1000.0, "timezone": "UTC"},
    {"symbol": "NZDJPY", "name": "New Zealand Dollar vs Japanese Yen",  "category": "Forex",       "source": "dukascopy", "pip_size": 0.01,   "pip_value_per_lot": 1000.0, "timezone": "UTC"},
    # ── Indices ───────────────────────────────────────────────────────────────
    {"symbol": "GER30",  "name": "DAX 30 Index",                        "category": "Indices",     "source": "dukascopy", "pip_size": 1.0,    "pip_value_per_lot": 1.0,    "timezone": "Europe/Berlin"},
    {"symbol": "GER40",  "name": "DAX 40 Index",                        "category": "Indices",     "source": "dukascopy", "pip_size": 1.0,    "pip_value_per_lot": 1.0,    "timezone": "Europe/Berlin"},
    {"symbol": "US30",   "name": "Dow Jones Industrial Average",        "category": "Indices",     "source": "dukascopy", "pip_size": 1.0,    "pip_value_per_lot": 1.0,    "timezone": "America/New_York"},
    {"symbol": "US500",  "name": "S&P 500 Index",                       "category": "Indices",     "source": "dukascopy", "pip_size": 0.1,    "pip_value_per_lot": 1.0,    "timezone": "America/New_York"},
    {"symbol": "NAS100", "name": "Nasdaq 100 Index",                    "category": "Indices",     "source": "dukascopy", "pip_size": 0.1,    "pip_value_per_lot": 1.0,    "timezone": "America/New_York"},
    {"symbol": "UK100",  "name": "FTSE 100 Index",                      "category": "Indices",     "source": "dukascopy", "pip_size": 1.0,    "pip_value_per_lot": 1.0,    "timezone": "Europe/London"},
    {"symbol": "FRA40",  "name": "CAC 40 Index",                        "category": "Indices",     "source": "dukascopy", "pip_size": 1.0,    "pip_value_per_lot": 1.0,    "timezone": "Europe/Paris"},
    {"symbol": "JPN225", "name": "Nikkei 225 Index",                    "category": "Indices",     "source": "dukascopy", "pip_size": 1.0,    "pip_value_per_lot": 1.0,    "timezone": "Asia/Tokyo"},
    {"symbol": "AUS200", "name": "ASX 200 Index",                       "category": "Indices",     "source": "dukascopy", "pip_size": 1.0,    "pip_value_per_lot": 1.0,    "timezone": "Australia/Sydney"},
    # ── Precious Metals ───────────────────────────────────────────────────────
    {"symbol": "XAUUSD",    "name": "Gold vs US Dollar",                "category": "Commodities", "source": "dukascopy", "pip_size": 0.01,   "pip_value_per_lot": 1.0,    "timezone": "Europe/Berlin"},
    {"symbol": "XAGUSD",    "name": "Silver vs US Dollar",              "category": "Commodities", "source": "dukascopy", "pip_size": 0.001,  "pip_value_per_lot": 0.5,    "timezone": "Europe/Berlin"},
    # ── Energy ────────────────────────────────────────────────────────────────
    {"symbol": "WTIUSD",    "name": "WTI Crude Oil",                    "category": "Commodities", "source": "dukascopy", "pip_size": 0.01,   "pip_value_per_lot": 1.0,    "timezone": "Europe/Berlin"},
    {"symbol": "BRENTUSD",  "name": "Brent Crude Oil",                  "category": "Commodities", "source": "dukascopy", "pip_size": 0.01,   "pip_value_per_lot": 1.0,    "timezone": "Europe/Berlin"},
    # ── Agricultural ──────────────────────────────────────────────────────────
    {"symbol": "SOYBEANUSD", "name": "Soybean",                        "category": "Commodities", "source": "dukascopy", "pip_size": 0.01,   "pip_value_per_lot": 1.0,    "timezone": "Europe/Berlin"},
    # ── Industrial Metals ─────────────────────────────────────────────────────
    {"symbol": "COPPERUSD",  "name": "Copper",                          "category": "Commodities", "source": "dukascopy", "pip_size": 0.0001, "pip_value_per_lot": 10.0,   "timezone": "Europe/Berlin"},
]


def seed(dry_run: bool = False) -> None:
    if dry_run:
        print(f"DRY RUN — {len(INSTRUMENTS)} instruments would be upserted:\n")
        for inst in INSTRUMENTS:
            print(f"  {inst['symbol']:12}  {inst['category']:12}  {inst['name']}")
        return

    from services.cache_service import _get_supabase_client

    client = _get_supabase_client()
    resp = (
        client.table("instruments")
        .upsert(INSTRUMENTS, on_conflict="symbol")
        .execute()
    )
    print(f"Upserted {len(resp.data)} instrument(s) into Supabase.")


if __name__ == "__main__":
    dry_run = "--dry-run" in sys.argv
    seed(dry_run=dry_run)
