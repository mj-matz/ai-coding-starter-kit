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
# Each entry: (symbol, name, category, source, pip_size, pip_value_per_lot)
#
# pip_size:          Smallest price increment used by the backtesting engine.
# pip_value_per_lot: Monetary value (account currency) of a 1-pip move on
#                    1 standard lot. Adjust for your broker if needed via the
#                    Supabase dashboard.

INSTRUMENTS: list[dict] = [
    # ── Forex Majors ──────────────────────────────────────────────────────────
    {"symbol": "EURUSD", "name": "Euro vs US Dollar",                    "category": "Forex",       "source": "dukascopy", "pip_size": 0.0001, "pip_value_per_lot": 10.0},
    {"symbol": "GBPUSD", "name": "Pound vs US Dollar",                   "category": "Forex",       "source": "dukascopy", "pip_size": 0.0001, "pip_value_per_lot": 10.0},
    {"symbol": "USDCHF", "name": "US Dollar vs Swiss Franc",             "category": "Forex",       "source": "dukascopy", "pip_size": 0.0001, "pip_value_per_lot": 10.0},
    {"symbol": "USDJPY", "name": "US Dollar vs Japanese Yen",            "category": "Forex",       "source": "dukascopy", "pip_size": 0.01,   "pip_value_per_lot": 1000.0},
    {"symbol": "AUDUSD", "name": "Australian Dollar vs US Dollar",       "category": "Forex",       "source": "dukascopy", "pip_size": 0.0001, "pip_value_per_lot": 10.0},
    {"symbol": "NZDUSD", "name": "New Zealand Dollar vs US Dollar",      "category": "Forex",       "source": "dukascopy", "pip_size": 0.0001, "pip_value_per_lot": 10.0},
    {"symbol": "USDCAD", "name": "US Dollar vs Canadian Dollar",         "category": "Forex",       "source": "dukascopy", "pip_size": 0.0001, "pip_value_per_lot": 10.0},
    # ── Forex Crosses ─────────────────────────────────────────────────────────
    {"symbol": "EURGBP", "name": "Euro vs Pound",                        "category": "Forex",       "source": "dukascopy", "pip_size": 0.0001, "pip_value_per_lot": 10.0},
    {"symbol": "EURJPY", "name": "Euro vs Japanese Yen",                 "category": "Forex",       "source": "dukascopy", "pip_size": 0.01,   "pip_value_per_lot": 1000.0},
    {"symbol": "GBPJPY", "name": "Pound vs Japanese Yen",                "category": "Forex",       "source": "dukascopy", "pip_size": 0.01,   "pip_value_per_lot": 1000.0},
    {"symbol": "EURAUD", "name": "Euro vs Australian Dollar",            "category": "Forex",       "source": "dukascopy", "pip_size": 0.0001, "pip_value_per_lot": 10.0},
    {"symbol": "EURCHF", "name": "Euro vs Swiss Franc",                  "category": "Forex",       "source": "dukascopy", "pip_size": 0.0001, "pip_value_per_lot": 10.0},
    {"symbol": "GBPCHF", "name": "Pound vs Swiss Franc",                 "category": "Forex",       "source": "dukascopy", "pip_size": 0.0001, "pip_value_per_lot": 10.0},
    {"symbol": "AUDCAD", "name": "Australian Dollar vs Canadian Dollar", "category": "Forex",       "source": "dukascopy", "pip_size": 0.0001, "pip_value_per_lot": 10.0},
    {"symbol": "AUDJPY", "name": "Australian Dollar vs Japanese Yen",   "category": "Forex",       "source": "dukascopy", "pip_size": 0.01,   "pip_value_per_lot": 1000.0},
    {"symbol": "CADJPY", "name": "Canadian Dollar vs Japanese Yen",     "category": "Forex",       "source": "dukascopy", "pip_size": 0.01,   "pip_value_per_lot": 1000.0},
    {"symbol": "CHFJPY", "name": "Swiss Franc vs Japanese Yen",         "category": "Forex",       "source": "dukascopy", "pip_size": 0.01,   "pip_value_per_lot": 1000.0},
    {"symbol": "NZDJPY", "name": "New Zealand Dollar vs Japanese Yen",  "category": "Forex",       "source": "dukascopy", "pip_size": 0.01,   "pip_value_per_lot": 1000.0},
    # ── Indices ───────────────────────────────────────────────────────────────
    {"symbol": "GER30",  "name": "DAX 30 Index",                        "category": "Indices",     "source": "dukascopy", "pip_size": 1.0,    "pip_value_per_lot": 1.0},
    {"symbol": "GER40",  "name": "DAX 40 Index",                        "category": "Indices",     "source": "dukascopy", "pip_size": 1.0,    "pip_value_per_lot": 1.0},
    {"symbol": "US30",   "name": "Dow Jones Industrial Average",        "category": "Indices",     "source": "dukascopy", "pip_size": 1.0,    "pip_value_per_lot": 1.0},
    {"symbol": "US500",  "name": "S&P 500 Index",                       "category": "Indices",     "source": "dukascopy", "pip_size": 0.1,    "pip_value_per_lot": 1.0},
    {"symbol": "NAS100", "name": "Nasdaq 100 Index",                    "category": "Indices",     "source": "dukascopy", "pip_size": 0.1,    "pip_value_per_lot": 1.0},
    {"symbol": "UK100",  "name": "FTSE 100 Index",                      "category": "Indices",     "source": "dukascopy", "pip_size": 1.0,    "pip_value_per_lot": 1.0},
    {"symbol": "FRA40",  "name": "CAC 40 Index",                        "category": "Indices",     "source": "dukascopy", "pip_size": 1.0,    "pip_value_per_lot": 1.0},
    {"symbol": "JPN225", "name": "Nikkei 225 Index",                    "category": "Indices",     "source": "dukascopy", "pip_size": 1.0,    "pip_value_per_lot": 1.0},
    {"symbol": "AUS200", "name": "ASX 200 Index",                       "category": "Indices",     "source": "dukascopy", "pip_size": 1.0,    "pip_value_per_lot": 1.0},
    # ── Precious Metals ───────────────────────────────────────────────────────
    {"symbol": "XAUUSD",    "name": "Gold vs US Dollar",                "category": "Commodities", "source": "dukascopy", "pip_size": 0.01,   "pip_value_per_lot": 1.0},
    {"symbol": "XAGUSD",    "name": "Silver vs US Dollar",              "category": "Commodities", "source": "dukascopy", "pip_size": 0.001,  "pip_value_per_lot": 0.5},
    {"symbol": "XPTUSD",    "name": "Platinum vs US Dollar",            "category": "Commodities", "source": "dukascopy", "pip_size": 0.01,   "pip_value_per_lot": 0.5},
    {"symbol": "XPDUSD",    "name": "Palladium vs US Dollar",           "category": "Commodities", "source": "dukascopy", "pip_size": 0.01,   "pip_value_per_lot": 0.5},
    # ── Energy ────────────────────────────────────────────────────────────────
    {"symbol": "WTIUSD",    "name": "WTI Crude Oil",                    "category": "Commodities", "source": "dukascopy", "pip_size": 0.01,   "pip_value_per_lot": 1.0},
    {"symbol": "BRENTUSD",  "name": "Brent Crude Oil",                  "category": "Commodities", "source": "dukascopy", "pip_size": 0.01,   "pip_value_per_lot": 1.0},
    {"symbol": "NATGASUSD", "name": "Natural Gas",                      "category": "Commodities", "source": "dukascopy", "pip_size": 0.001,  "pip_value_per_lot": 1.0},
    # ── Agricultural ──────────────────────────────────────────────────────────
    {"symbol": "CORNUSD",    "name": "Corn",                            "category": "Commodities", "source": "dukascopy", "pip_size": 0.01,   "pip_value_per_lot": 1.0},
    {"symbol": "SOYBEANUSD", "name": "Soybean",                        "category": "Commodities", "source": "dukascopy", "pip_size": 0.01,   "pip_value_per_lot": 1.0},
    {"symbol": "WHEATUSD",   "name": "Wheat",                           "category": "Commodities", "source": "dukascopy", "pip_size": 0.01,   "pip_value_per_lot": 1.0},
    # ── Industrial Metals ─────────────────────────────────────────────────────
    {"symbol": "COPPERUSD",  "name": "Copper",                          "category": "Commodities", "source": "dukascopy", "pip_size": 0.0001, "pip_value_per_lot": 10.0},
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
