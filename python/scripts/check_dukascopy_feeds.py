"""
Quick connectivity check for all Dukascopy tickers.
Tests one known trading hour (2025-01-07 10:00 UTC, a Tuesday).
Run from the python/ directory: python scripts/check_dukascopy_feeds.py
"""

import httpx
import lzma
from concurrent.futures import ThreadPoolExecutor, as_completed

# All unique Dukascopy tickers currently in DUKASCOPY_SYMBOLS
TICKERS = [
    # Forex Majors
    "EURUSD", "GBPUSD", "USDCHF", "USDJPY", "AUDUSD", "NZDUSD", "USDCAD",
    # Forex Crosses
    "EURGBP", "EURJPY", "GBPJPY", "EURAUD", "EURCHF", "GBPCHF",
    "AUDCAD", "AUDJPY", "CADJPY", "CHFJPY", "NZDJPY",
    # Indices
    "DEUIDXEUR", "USA30IDXUSD", "USA500IDXUSD", "USATECHIDXUSD",
    "GBRIDXGBP", "FRAIDXEUR", "JPNIDXJPY", "AUSIDXAUD",
    # Metals
    "XAUUSD", "XAGUSD",
    # Energy
    "LIGHTCMDUSD", "BRENTCMDUSD",
    # Agricultural
    "SOYBEANCMDUSX", "WHEATCMDUSX",
    # Industrial
    "COPPERCMDUSD",
]

# Test URL: 2025-01-07 (Tuesday) 10:00 UTC — month 0-indexed in Dukascopy URLs
TEST_URL = "https://datafeed.dukascopy.com/datafeed/{ticker}/2025/00/07/10h_ticks.bi5"


def check(ticker: str, client: httpx.Client) -> tuple[str, str]:
    url = TEST_URL.format(ticker=ticker)
    try:
        r = client.get(url, timeout=15)
        if r.status_code == 404 or len(r.content) == 0:
            return ticker, "NO DATA (404 / empty)"
        if r.status_code != 200:
            return ticker, f"HTTP {r.status_code}"
        raw = lzma.decompress(r.content)
        n = len(raw) // 20
        return ticker, f"OK ({n} ticks)"
    except Exception as e:
        return ticker, f"ERROR: {e}"


def main():
    results = {}
    with httpx.Client(follow_redirects=True) as client:
        with ThreadPoolExecutor(max_workers=10) as ex:
            futures = {ex.submit(check, t, client): t for t in TICKERS}
            for f in as_completed(futures):
                ticker, status = f.result()
                results[ticker] = status

    ok = {t: s for t, s in results.items() if s.startswith("OK")}
    fail = {t: s for t, s in results.items() if not s.startswith("OK")}

    print(f"\nAVAILABLE ({len(ok)}):")
    for t in sorted(ok):
        print(f"  {t:<20} {ok[t]}")

    print(f"\nNO DATA / ERROR ({len(fail)}):")
    for t in sorted(fail):
        print(f"  {t:<20} {fail[t]}")


if __name__ == "__main__":
    main()
