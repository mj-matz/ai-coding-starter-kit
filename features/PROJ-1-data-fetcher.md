# PROJ-1: Data Fetcher

## Status: Deployed
**Created:** 2026-03-09
**Last Updated:** 2026-03-14

## Dependencies
- None

## User Stories
- As a trader, I want to download historical OHLCV data for XAUUSD on 1-minute resolution so that I can backtest intraday strategies with sufficient history.
- As a trader, I want to download DAX (GER30) 1-minute data from Dukascopy so that I can apply the same strategy templates to index instruments.
- As a trader, I want to download daily stock/ETF data via yfinance so that I can backtest longer-term strategies on equities.
- As a trader, I want downloaded data to be cached locally so that repeated backtests don't re-download the same data.
- As a trader, I want to see the available date range for a given asset so that I know how far back my backtest can go.

## Acceptance Criteria
- [ ] Dukascopy data can be fetched for: XAUUSD, GER30 (DAX), major Forex pairs (EUR/USD, GBP/USD, USD/CHF, etc.)
- [ ] yfinance data can be fetched for any valid ticker symbol (stocks, ETFs, indices) at daily resolution
- [ ] Fetched data is stored as local cache (e.g. Parquet files) to avoid redundant downloads
- [ ] Data is returned as OHLCV DataFrame with columns: datetime (UTC), open, high, low, close, volume
- [ ] Datetime index is timezone-aware (UTC) and monotonically increasing (no duplicates, no gaps beyond market hours)
- [ ] Resampling from tick/1m to higher timeframes (5m, 15m, 1h, 1d) works correctly (OHLCV aggregation rules respected)
- [ ] API returns clear error if asset symbol is not supported or data is unavailable for the requested date range
- [ ] Cache invalidation: user can force a refresh to re-download data

## Edge Cases
- Dukascopy returns no data for a weekend or holiday → filter these rows, don't treat as error
- Requested start date is before available history → return available range and warn user
- Network timeout during download → return partial data with error message, do not corrupt cache
- yfinance returns adjusted vs. unadjusted prices → always use adjusted close for daily data
- Timezone handling: Dukascopy data is in UTC; local market hours (e.g. 14:30 Frankfurt time) must be correctly mapped to UTC

## Technical Requirements
- Python script/module callable from Next.js API route via subprocess or FastAPI endpoint
- Cache stored under `/data/parquet/` using a directory structure: `{source}/{symbol}/{timeframe}/{start}_{end}.parquet`
- Dukascopy access via `duka` Python library or direct HTTP download
- yfinance access via `yfinance` Python library
- All datetimes stored and returned in UTC

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)

### Overview

A Python-powered backend service that fetches, caches, and serves historical OHLCV data from two sources (Dukascopy, yfinance). Uses a **hybrid cache strategy**: actual data stored as Parquet files on disk for fast bulk reads; cache metadata stored in Supabase for queryability and UI integration.

---

### Component Structure

```
Data Fetcher System
+-- FastAPI Service (Python)
|   +-- GET  /data/fetch       ← request OHLCV data for a symbol + range
|   +-- GET  /data/available   ← list cached datasets (reads from Supabase)
|   +-- DELETE /data/cache     ← force-refresh (invalidate cache + DB row)
|
+-- Data Sources (Python modules)
|   +-- Dukascopy Fetcher      ← intraday 1m data (XAUUSD, GER30, Forex)
|   +-- yfinance Fetcher       ← daily data (stocks, ETFs, indices)
|
+-- Resampler                  ← 1m → 5m / 15m / 1h / 1d aggregation
|
+-- Cache Layer (Hybrid)
|   +-- /data/parquet/{source}/{symbol}/{timeframe}/  ← Parquet files on disk (actual OHLCV rows)
|   +-- Supabase: data_cache   ← metadata only (symbol, dates, file path)
|
+-- Next.js API Proxy
    +-- /api/data/fetch        ← forwards to FastAPI, adds auth check
    +-- /api/data/available    ← forwards to FastAPI, adds auth check
    +-- /api/data/cache        ← forwards to FastAPI, adds auth check
```

---

### Data Model

**OHLCV Record** — stored in Parquet files on disk:
```
- datetime   UTC timestamp
- open       Opening price
- high       Highest price in the period
- low        Lowest price in the period
- close      Closing price (adjusted close for daily yfinance data)
- volume     Trade volume (0 for Forex if unavailable)
```

**Cache Metadata** — one row per Parquet file, stored in Supabase:
```
- id               UUID
- symbol           e.g. "XAUUSD", "GER30", "SPY"
- source           "dukascopy" or "yfinance"
- timeframe        "1m", "5m", "15m", "1h", "1d"
- start_date       UTC date (actual data start)
- end_date         UTC date (actual data end)
- file_path        Path to the Parquet file on disk
- file_size_bytes  Size of the Parquet file
- row_count        Number of OHLCV rows
- downloaded_at    Timestamp of last download
```

> Storage estimate: ~300 bytes per cache entry. 500 files ≈ 150 KB in Supabase.
> The 500 MB free tier limit is not a concern for realistic solo-trader usage.

**Data Request** — what callers send:
```
- symbol          e.g. "XAUUSD", "GER30", "SPY"
- source          "dukascopy" or "yfinance"
- timeframe       "1m", "5m", "15m", "1h", "1d"
- start_date      UTC date
- end_date        UTC date
- force_refresh   boolean (skip cache, re-download)
```

---

### Request Flow

```
1. Frontend or backtesting engine requests data
2. Next.js API route verifies user is authenticated (PROJ-8)
3. Request forwarded to FastAPI service
4. FastAPI queries Supabase data_cache for a matching entry
   → Cache HIT:  load Parquet file from disk, return data
   → Cache MISS: download from Dukascopy or yfinance
5. Downloaded data cleaned:
   - Remove weekend/holiday rows
   - Normalize timezone to UTC
   - Validate no duplicate timestamps or unexpected gaps
6. Data saved as Parquet file to /data/cache/
7. Metadata row written to Supabase data_cache table
8. If timeframe > 1m: resample using OHLCV aggregation rules
   (open=first, high=max, low=min, close=last, volume=sum)
9. Return clean OHLCV dataset
```

---

### Tech Decisions

| Decision | Choice | Why |
|---|---|---|
| Python web framework | FastAPI + Uvicorn | Async support, auto-generated API docs, easy to extend for backtesting engine (PROJ-2) |
| Cache format | Parquet (via pandas + pyarrow) | Columnar, compressed, pandas-native — ideal for large time-series bulk reads |
| Cache metadata | Supabase (data_cache table) | Queryable from UI, consistent with rest of stack, negligible storage cost |
| Intraday data | `duka` library | Purpose-built for Dukascopy HTTP downloads |
| Daily data | `yfinance` library | De-facto standard, adjusted close built-in |
| Communication | Next.js proxies to FastAPI | Auth stays in Next.js; Python service never exposed directly to browser |
| Resampling | pandas `resample()` | Correct OHLCV aggregation rules, well-tested |

---

### New Dependencies

**Python:**
- `fastapi` + `uvicorn` — web server
- `pandas` + `pyarrow` — data manipulation and Parquet I/O
- `duka` — Dukascopy data downloader
- `yfinance` — Yahoo Finance data

**Next.js:** no new packages

**Supabase:** one new table (`data_cache`) — metadata only, no OHLCV rows in the database

---

### What Does NOT Change

- No new UI pages (this is infrastructure for PROJ-5)
- Existing auth system (PROJ-8) reused as-is for all API routes

## QA Test Results

**Last tested:** 2026-03-18 (Round 3) | **Tester:** QA Engineer (AI) | **Status:** In Review

### Acceptance Criteria: 7/8 passed

| AC | Description | Result |
|----|-------------|--------|
| AC-1 | Dukascopy fetch for XAUUSD, GER30, Forex pairs | PASS (code verified: POINT_VALUES fixed, symbol mapping correct) |
| AC-2 | yfinance fetch for any valid ticker at daily resolution | PASS |
| AC-3 | Parquet cache storage | PASS |
| AC-4 | OHLCV DataFrame with correct columns | PASS |
| AC-5 | UTC-aware, monotonically increasing datetime | PASS |
| AC-6 | Resampling with correct OHLCV aggregation | PASS |
| AC-7 | Clear errors for invalid symbols/ranges | PARTIAL FAIL (BUG-29: broken symbols still in instruments table) |
| AC-8 | Cache invalidation via force_refresh and DELETE | PASS |

### Edge Cases: 4/5 passed

| EC | Description | Result |
|----|-------------|--------|
| EC-1 | Weekend/holiday filtering | PASS |
| EC-2 | Start date before available history | PASS |
| EC-3 | Network timeout handling | PASS |
| EC-4 | Adjusted close for yfinance | PASS |
| EC-5 | Timezone handling | PARTIAL FAIL (BUG-32: half-hour timezone offsets truncated) |

### Bug Tracker (Round 1-2 — All Previous)

| ID | Severity | Description | Status |
|----|----------|-------------|--------|
| BUG-1 | CRITICAL | Service role key committed in `python/services/.env` (not gitignored) | **Fixed by dev** |
| BUG-2 | CRITICAL | FastAPI has no JWT auth — any caller can spoof X-User-Id | **Fixed** |
| BUG-3 | HIGH | `file_path` (server path) leaked in API responses to browser | **Fixed** |
| BUG-4 | HIGH | FastAPI DELETE `/cache/{id}` has no auth | **Fixed** |
| BUG-5 | MEDIUM | Next.js accepted any timeframe string; no enum validation | **Fixed** |
| BUG-6 | LOW | Parquet naming convention deviates from spec | **Fixed** (spec updated) |
| BUG-7 | MEDIUM | No range warning when requested start date is before available history | **Fixed** |
| BUG-8 | MEDIUM | No network timeout on Dukascopy or yfinance fetches | **Fixed** |
| BUG-9 | MEDIUM | No rate limiting on `/api/data/available` and `/api/data/cache` routes | **Fixed** |
| BUG-10 | MEDIUM | No rate limiting on FastAPI endpoints | Deferred (local only) |
| BUG-11 | HIGH | Admin check used `user_metadata` (client-writable); should use `app_metadata` | **Fixed** |
| BUG-12 | MEDIUM | Delete order wrong: DB row deleted before Parquet file | **Fixed** |
| BUG-13 | LOW | DELETE endpoint returned 200 even when cache entry not found | **Fixed** |
| BUG-14 | HIGH | `cache_service.py` uses service role key, bypassing RLS; `created_by` forgeable | **Fixed** |
| BUG-15 | LOW | On timeout, spec says return partial data; implementation returns error with no data | **Fixed** |
| BUG-16 | HIGH | RLS DELETE policy used `user_metadata` | **Fixed** |
| BUG-17 | MEDIUM | Symbol field allowed path traversal characters | **Fixed** |
| BUG-18 | -- | `python/services/.env` has real credentials on disk — expected for local dev, gitignored | Not a bug |
| BUG-25 | MEDIUM | FastAPI bound to `0.0.0.0` | **Fixed** |
| BUG-26 | CRITICAL | `POINT_VALUES` wrong for XAUUSD and indices | **Fixed** |
| BUG-27 | HIGH | `fetch_dukascopy` downloads all 24 hours per day | **Fixed** |
| BUG-28 | HIGH | Four symbols in `DUKASCOPY_SYMBOLS` return no data | **Fixed** (removed from fetcher) |

### Bug Tracker (Round 3 — New Findings)

| ID | Severity | Description | Status |
|----|----------|-------------|--------|
| BUG-29 | HIGH | Broken symbols still in `instruments` table and seed script | **Fixed** |
| BUG-30 | MEDIUM | `/api/data/available` leaks `created_by` UUID of other users | Open |
| BUG-31 | MEDIUM | `_build_parquet_path` does not include hour range -- cache collisions possible | **Fixed** |
| BUG-32 | MEDIUM | `_local_to_utc_hour_range` truncates half-hour UTC offsets | Open |
| BUG-33 | LOW | BUG-28 status inconsistency: spec says "Open" in details but "Fixed" in tracker | **Fixed** |
| BUG-34 | LOW | `.env.example` missing `SUPABASE_JWT_SECRET` variable | **Fixed** |
| BUG-35 | LOW | `/fetch` response includes `file_path` field on FastAPI level (stripped by Next.js proxy, but exposed if FastAPI accessed directly) | Open |
| BUG-36 | MEDIUM | `_download_hour` shares a single `httpx.Client` across threads (not thread-safe) | Open |

### Bug Details (Round 3)

#### BUG-29 -- HIGH: Broken symbols still in `instruments` table and seed script

- **Severity:** HIGH
- **Files:** `python/scripts/seed_instruments.py` lines 69-78, Supabase `instruments` table
- **Problem:** BUG-28 identified four symbols that return no data from Dukascopy: `NATGASUSD`, `CORNUSD`, `XPDUSD`, `XPTUSD`. These were removed from `DUKASCOPY_SYMBOLS` in `dukascopy_fetcher.py`, but they are **still present** in `seed_instruments.py` and therefore in the `instruments` database table. The `/assets` endpoint reads from the `instruments` table, so these symbols still appear in the UI asset selector. Additionally, `WHEATUSD` is in the seed script (line 78) but has no mapping in `DUKASCOPY_SYMBOLS`, making it a fifth broken symbol.
- **Steps to Reproduce:**
  1. Open the backtest UI
  2. Open the asset selector dropdown
  3. Observe: NATGASUSD, CORNUSD, XPDUSD, XPTUSD, WHEATUSD are listed
  4. Select any of them and run a backtest
  5. Expected: Symbol not shown, or greyed out with "unavailable" tooltip
  6. Actual: User can select the symbol; backtest fails with a confusing error
- **Priority:** Fix before next deployment

#### BUG-30 -- MEDIUM: `/api/data/available` leaks `created_by` UUID of other users

- **Severity:** MEDIUM (information disclosure)
- **File:** `src/app/api/data/available/route.ts` line 55-56
- **Problem:** The available-data endpoint selects `created_by` from the `data_cache` table and returns it to the client. Since the RLS SELECT policy allows all authenticated users to view all cache entries (`USING (true)`), any logged-in user can see the UUIDs of other users who created cache entries. While UUIDs alone are not directly exploitable, they violate the principle of least privilege and could be used for targeted attacks if combined with other vulnerabilities.
- **Steps to Reproduce:**
  1. Log in as any user
  2. Call `GET /api/data/available`
  3. Inspect response: each entry contains `created_by` with another user's UUID
- **Fix:** Remove `created_by` from the `.select()` column list in `available/route.ts`.
- **Priority:** Fix in next sprint

#### BUG-31 -- MEDIUM: `_build_parquet_path` does not include hour range in filename

- **Severity:** MEDIUM
- **File:** `python/services/cache_service.py` lines 33-44
- **Problem:** BUG-27's fix added `hour_from`/`hour_to` parameters to `fetch_dukascopy`, but the Parquet filename built by `_build_parquet_path` does not include the hour range. This means: if a user backtests GER40 for 2025-12-01 to 2025-12-10 with strategy hours 08:00-16:00 (UTC 07-15), the cached file is `dukascopy/GER40/1m/2025-12-01_2025-12-10.parquet` containing only hours 07-15. If the same user (or another) later backtests GER40 for the same dates but with strategy hours 00:00-23:00, `find_cached_entry` will return the same cache entry, but it only contains hours 07-15 -- silently missing data.
- **Steps to Reproduce:**
  1. Run backtest for GER40 with rangeStart=08:00, timeExit=16:00 (caches hours 06-17 UTC)
  2. Run backtest for GER40 with rangeStart=02:00, timeExit=22:00
  3. Expected: Full-range data fetched
  4. Actual: Stale cache hit returns partial-hour data
- **Priority:** Fix before next deployment

#### BUG-32 -- MEDIUM: `_local_to_utc_hour_range` truncates half-hour UTC offsets

- **Severity:** MEDIUM
- **File:** `python/main.py` line 663
- **Problem:** The function computes UTC offsets via `int(dt.utcoffset().total_seconds() // 3600)`. For timezones with half-hour offsets (e.g., `Asia/Kolkata` = UTC+5:30, `Australia/Adelaide` = UTC+9:30 / +10:30), this truncates to +5 or +9/+10 instead of properly accounting for the 30-minute component. The resulting UTC hour window may be off by 1 hour, potentially excluding needed data bars.
- **Example:** A strategy running at local 14:00 in Asia/Kolkata (UTC+5:30) should map to UTC 08:30. With `int(5.5 // 1) = 5`, the function computes UTC hour = 14 - 5 = 9 (should be 8). The safety buffer of 1h may cover this, but it is not guaranteed for all edge cases.
- **Priority:** Fix in next sprint

#### BUG-33 -- LOW: BUG-28 status inconsistency in spec

- **Severity:** LOW (documentation only)
- **Problem:** In the Round 2 bug tracker table, BUG-28 is marked as "**Fixed**", but the detailed description section at the bottom says "**Status: Open**". This is confusing for anyone reading the spec.
- **Priority:** Nice to have

#### BUG-34 -- LOW: `.env.example` missing `SUPABASE_JWT_SECRET`

- **Severity:** LOW
- **File:** `python/.env.example`
- **Problem:** The example env file lists `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `DATA_DIR`, `FETCH_TIMEOUT_SECONDS` but omits `SUPABASE_JWT_SECRET`, which is required by `python/services/auth.py` for HS256 JWT verification. A developer setting up the project from scratch would miss this variable and get a 500 error when the auth middleware runs.
- **Priority:** Nice to have

#### BUG-35 -- LOW: FastAPI `/fetch` response includes `file_path`

- **Severity:** LOW
- **File:** `python/main.py` (FetchResponse), `python/models.py` line 44
- **Problem:** The `FetchResponse` model includes `file_path` (server filesystem path). The Next.js proxy correctly strips this field before returning to the browser (BUG-3 fix in `src/app/api/data/fetch/route.ts` line 114). However, if someone were to access the FastAPI service directly (e.g., via port forwarding, or if the Railway deployment URL is discovered), the server path would be exposed. Since FastAPI is bound to 127.0.0.1 locally and requires JWT auth on Railway, this is low risk.
- **Priority:** Nice to have

#### BUG-36 -- MEDIUM: `_download_hour` shares `httpx.Client` across threads

- **Severity:** MEDIUM
- **File:** `python/fetchers/dukascopy_fetcher.py` lines 204-214
- **Problem:** The `fetch_dukascopy` function creates a single `httpx.Client` instance and passes it to all `_download_hour` calls executed in a `ThreadPoolExecutor` with 24 workers. Per httpx documentation, `httpx.Client` is **not thread-safe** -- concurrent use from multiple threads can cause race conditions on the internal connection pool, leading to intermittent connection errors, corrupted responses, or stalled downloads. This may be the root cause of occasional unexplained fetch failures reported in production.
- **Fix:** Either (a) create one `httpx.Client` per thread (e.g., using `threading.local`), or (b) use `httpx.AsyncClient` with `asyncio` instead of threads, or (c) use a simple `httpx.get()` call per request (creates a new connection each time, simpler but slightly slower).
- **Priority:** Fix in next sprint

### Security Audit (Round 3)

| Check | Result | Notes |
|-------|--------|-------|
| Authentication on all endpoints | PASS | All Next.js API routes check `supabase.auth.getUser()`; all FastAPI endpoints use `Depends(verify_jwt)` |
| Authorization (user isolation) | PASS | `/backtest/run` filters `data_cache` by `created_by = user_id`; admin-only operations check `app_metadata.is_admin` |
| Input validation (Next.js) | PASS | Zod schemas validate all inputs before forwarding to FastAPI |
| Input validation (FastAPI) | PASS | Pydantic models with field validators; symbol regex prevents path traversal (BUG-17 fixed) |
| Rate limiting | PASS | Supabase-backed rate limiter on Next.js routes; in-memory rate limiter on FastAPI `/backtest` |
| Secret exposure in code | PASS | No hardcoded secrets; `.env` files gitignored; `.env.example` uses dummy values |
| Server path exposure | PARTIAL | Next.js strips `file_path` (BUG-3 fix), but FastAPI still returns it (BUG-35 -- low risk) |
| User data leakage | FAIL | BUG-30: `created_by` UUIDs exposed via `/api/data/available` |
| CORS configuration | PASS | FastAPI only allows `http://localhost:3000` |
| JWT algorithm confusion | PASS | `auth.py` reads algorithm from token header and uses appropriate verification (HS256 vs RS256/JWKS) |
| RLS policies | PASS | DELETE policy uses `app_metadata` (BUG-16 fixed); INSERT policy enforces `auth.uid() = created_by` |
| Service role key usage | ACCEPTABLE | `cache_service.py` uses service role key for cache operations (needed to bypass RLS for cross-user cache sharing); backtest endpoint adds `created_by` filter |

### Summary

- **Acceptance Criteria:** 7/8 passed (1 partial fail: AC-7)
- **Edge Cases:** 4/5 passed (1 partial fail: EC-5)
- **New Bugs Found (Round 3):** 8 total (1 HIGH, 4 MEDIUM, 3 LOW)
- **Security:** 1 finding (BUG-30 -- MEDIUM: user UUID leakage)
- **Production Ready:** NO -- BUG-29 (HIGH) and BUG-31 (MEDIUM) should be fixed first
- **Recommendation:** Fix BUG-29 and BUG-31 before next deployment. BUG-30, BUG-32, BUG-36 should be addressed in the next sprint.

### Previous Bug Details (Round 1-2, kept for reference)

#### BUG-6 -- LOW: Parquet naming convention deviates from spec

- **File:** `python/services/cache_service.py` -- `_build_parquet_path()`
- **Problem:** The original spec defined a flat file naming scheme (`{source}_{symbol}_{timeframe}_{start}_{end}.parquet` under `/data/cache/`). The implementation uses a directory-based structure (`/data/parquet/{source}/{symbol}/{timeframe}/{start}_{end}.parquet`).
- **Decision:** Spec updated to match implementation. The directory-based structure is superior for real-world usage: it keeps the cache directory navigable as the number of files grows, avoids flat-directory performance issues, and enables per-symbol cleanup without filename parsing.
- **Status:** Fixed -- spec updated in Technical Requirements and Component Structure sections.

---

#### BUG-15 -- LOW: Timeout returned error instead of partial data

- **Files:** `python/fetchers/dukascopy_fetcher.py`, `python/main.py`
- **Problem:** When `as_completed(..., timeout=FETCH_TIMEOUT_SECONDS)` expired, a `TimeoutError` propagated to `main.py` which returned HTTP 504 with no data. The spec requires partial data to be returned and the cache to not be corrupted.
- **Fix:**
  - `dukascopy_fetcher.py`: Wrapped `as_completed` loop in `try/except TimeoutError`. On timeout, logs a warning with `{downloaded} of {total} hours` and continues with whatever frames were already collected. Sets `df.attrs["partial"] = True` on the returned DataFrame to signal incompleteness to callers.
  - `main.py` (`/fetch` endpoint): Skips `save_to_cache` when `df.attrs.get("partial")` is set; appends a user-facing warning to the response instead.
  - `main.py` (`/backtest` endpoint): Skips `save_to_cache` when `base_df.attrs.get("partial")` is set; logs an info message.
- **Behaviour after fix:** Partial data is returned and usable, but never written to the Parquet cache or Supabase metadata. A subsequent fetch will re-attempt the full download.
- **Status:** Fixed.

---

#### BUG-26 -- CRITICAL: Wrong `POINT_VALUES` for XAUUSD and all indices

- **File:** `python/fetchers/dukascopy_fetcher.py` lines 64-85 (`POINT_VALUES` dict)
- **Problem:** Dukascopy encodes these instruments with **3 decimal places** (divisor = 1000), but the current values were wrong:
  - `"XAUUSD": 100` -> prices displayed ~10x too high
  - All indices `10` -> prices displayed ~100x too high
- **Status:** Fixed.

#### BUG-27 -- HIGH: `fetch_dukascopy` downloads unnecessary hours

- **Status:** Fixed -- `fetch_dukascopy` accepts `hour_from`/`hour_to` params; `main.py` derives them via `_local_to_utc_hour_range()`.

#### BUG-28 -- HIGH: Several symbols in `DUKASCOPY_SYMBOLS` return no data

- **Status:** Fixed -- symbols removed from `DUKASCOPY_SYMBOLS` in `dukascopy_fetcher.py` and from `seed_instruments.py` (BUG-29 fixed).

### Production Readiness

**READY** -- BUG-29 (HIGH) and BUG-31 (MEDIUM, data integrity) fixed. Remaining open bugs (BUG-30, BUG-32, BUG-36) deferred to next sprint.

## Deployment

**Deployed:** 2026-03-11

| Component | Platform | URL |
|-----------|----------|-----|
| Next.js API proxy (`/api/data/*`) | Vercel | https://trading-backtester-production.up.railway.app (via Vercel frontend) |
| Python FastAPI service | Railway | https://trading-backtester-production.up.railway.app |

**Environment variables set:**
- Vercel: `FASTAPI_URL=https://trading-backtester-production.up.railway.app`
- Railway: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_JWT_SECRET`, `DATA_DIR`, `FETCH_TIMEOUT_SECONDS`

**Supabase migrations applied:**
- `20260311_data_cache` — `data_cache` table + RLS policies
- `20260312_fix_rls_delete_policy` — DELETE policy uses `app_metadata`
