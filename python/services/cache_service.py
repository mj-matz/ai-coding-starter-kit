"""Cache service for managing Parquet files and Supabase metadata.

PROJ-27: Persistent Market Data Store (Monthly Chunks).

Each row in `data_cache` represents one monthly chunk for a
(symbol, source, timeframe) combination. Chunks are stored as separate
Parquet files under:

    DATA_DIR/parquet/{source}/{SYMBOL}/{timeframe}/{YYYY-MM}.parquet

Backwards compatible: legacy single-file entries (year/month NULL) remain
readable via `find_legacy_cached_entry`.

Public surface:
- find_missing_months(...)       — chunks needing download
- load_and_merge_chunks(...)     — concat existing chunks into one DataFrame
- save_chunk(...)                — persist one month's DataFrame + metadata
- delete_cache_entry(cache_id)   — delete a single chunk (file + DB row)
- list_chunks_grouped()          — UI helper for the Settings page
- 1-second cache helpers (unchanged from PROJ-15)
- Legacy helpers find_cached_entry/save_to_cache (kept for non-chunked paths)
"""

import logging
import os
import threading
from calendar import monthrange
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Optional

import pandas as pd
from supabase import create_client, Client

from config import SUPABASE_URL, SUPABASE_SERVICE_KEY, DATA_DIR

logger = logging.getLogger(__name__)


# ── Supabase client ─────────────────────────────────────────────────────────

def _get_supabase_client() -> Client:
    """Create a Supabase client using the service role key."""
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in environment variables"
        )
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


# ── Chunk paths & helpers ───────────────────────────────────────────────────

@dataclass(frozen=True)
class YearMonth:
    year: int
    month: int

    def label(self) -> str:
        return f"{self.year:04d}-{self.month:02d}"

    def first_day(self) -> date:
        return date(self.year, self.month, 1)

    def last_day(self) -> date:
        return date(self.year, self.month, monthrange(self.year, self.month)[1])


def _months_in_range(date_from: date, date_to: date) -> list[YearMonth]:
    """Return every YearMonth that intersects [date_from, date_to]."""
    if date_from > date_to:
        return []
    months: list[YearMonth] = []
    y, m = date_from.year, date_from.month
    end_y, end_m = date_to.year, date_to.month
    while (y, m) <= (end_y, end_m):
        months.append(YearMonth(y, m))
        if m == 12:
            y, m = y + 1, 1
        else:
            m += 1
    return months


def _build_chunk_path(source: str, symbol: str, timeframe: str, ym: YearMonth) -> Path:
    """Filesystem path for one monthly chunk."""
    return (
        DATA_DIR
        / "parquet"
        / source
        / symbol.upper()
        / timeframe
        / f"{ym.label()}.parquet"
    )


def _is_current_month_utc(ym: YearMonth) -> bool:
    """True when ym is the calendar month of "today" in UTC."""
    today = datetime.now(timezone.utc).date()
    return ym.year == today.year and ym.month == today.month


# ── In-process locks (per chunk) ────────────────────────────────────────────
# Two simultaneous backtests for the same asset must not download the same
# month twice. A short-lived per-chunk lock is enough for the single-process
# Railway deployment (write-once Parquet + idempotent Supabase upsert).

_chunk_locks_lock = threading.Lock()
_chunk_locks: dict[str, threading.Lock] = {}


def _chunk_lock(symbol: str, source: str, timeframe: str, ym: YearMonth) -> threading.Lock:
    key = f"{source}|{symbol.upper()}|{timeframe}|{ym.label()}"
    with _chunk_locks_lock:
        lk = _chunk_locks.get(key)
        if lk is None:
            lk = threading.Lock()
            _chunk_locks[key] = lk
        return lk


# ── Chunk lookup ────────────────────────────────────────────────────────────

def _fetch_chunk_rows(
    client: Client,
    symbol: str,
    source: str,
    timeframe: str,
    months: list[YearMonth],
) -> dict[tuple[int, int], dict]:
    """Return existing data_cache rows keyed by (year, month).

    Only chunks (year/month NOT NULL) are considered — legacy monolithic rows
    are ignored here.
    """
    if not months:
        return {}

    years = sorted({m.year for m in months})
    result = (
        client.table("data_cache")
        .select("*")
        .eq("symbol", symbol.upper())
        .eq("source", source)
        .eq("timeframe", timeframe)
        .in_("year", years)
        .not_.is_("month", "null")
        .limit(10_000)
        .execute()
    )

    rows: dict[tuple[int, int], dict] = {}
    for row in result.data or []:
        if row.get("year") is None or row.get("month") is None:
            continue
        rows[(int(row["year"]), int(row["month"]))] = row
    return rows


def find_missing_months(
    symbol: str,
    source: str,
    timeframe: str,
    date_from: date,
    date_to: date,
) -> list[YearMonth]:
    """Months in [date_from, date_to] that need to be (re-)downloaded.

    A month is considered missing if:
    - no chunk row exists, OR
    - the chunk row points to a Parquet file that is no longer on disk
      (stale entry — cleaned up here), OR
    - the chunk is the current calendar month (always re-downloaded so new
      trading days are picked up — see `is_complete = false`).
    """
    months = _months_in_range(date_from, date_to)
    if not months:
        return []

    client = _get_supabase_client()
    existing = _fetch_chunk_rows(client, symbol, source, timeframe, months)

    missing: list[YearMonth] = []
    for ym in months:
        if _is_current_month_utc(ym):
            missing.append(ym)
            continue

        row = existing.get((ym.year, ym.month))
        if row is None:
            missing.append(ym)
            continue

        file_path = row.get("file_path")
        if not file_path or not Path(file_path).exists():
            logger.warning(
                f"Cache row for {symbol} {ym.label()} points to missing file "
                f"({file_path!r}); will re-download."
            )
            try:
                client.table("data_cache").delete().eq("id", row["id"]).execute()
            except Exception as e:
                logger.warning(f"Failed to clean stale cache row {row['id']}: {e}")
            missing.append(ym)
            continue

        if row.get("is_complete") is False:
            # Defensive: a partial-month chunk that is no longer the current
            # month should be re-fetched once before being trusted.
            missing.append(ym)

    return missing


def list_present_months(
    symbol: str,
    source: str,
    timeframe: str,
    date_from: date,
    date_to: date,
) -> list[dict]:
    """Existing chunk rows in [date_from, date_to] that still have a valid file."""
    months = _months_in_range(date_from, date_to)
    if not months:
        return []

    client = _get_supabase_client()
    existing = _fetch_chunk_rows(client, symbol, source, timeframe, months)

    present: list[dict] = []
    for ym in months:
        row = existing.get((ym.year, ym.month))
        if row and row.get("file_path") and Path(row["file_path"]).exists():
            present.append(row)
    return present


# ── Chunk read & write ──────────────────────────────────────────────────────

def load_cached_data(file_path: str) -> pd.DataFrame:
    """Load a Parquet file into a DataFrame. Used by main.py and tests."""
    logger.info(f"Loading cached data from {file_path}")
    return pd.read_parquet(file_path)


def load_and_merge_chunks(rows: list[dict]) -> pd.DataFrame:
    """Concat the Parquet files referenced by `rows` into one DataFrame.

    Skips rows whose file is missing on disk (callers should have already
    handled that case via `find_missing_months`, but be defensive).
    """
    frames: list[pd.DataFrame] = []
    for row in rows:
        path = row.get("file_path")
        if not path or not Path(path).exists():
            continue
        try:
            frames.append(pd.read_parquet(path))
        except Exception as e:
            logger.warning(f"Failed to read chunk {path!r}: {e}")
    if not frames:
        return pd.DataFrame()
    merged = pd.concat(frames, ignore_index=True)

    # If the chunks have a `datetime` column, sort by it and drop dupes so the
    # caller can rely on a clean monotonically-increasing timeline regardless
    # of what order the chunks were stored in.
    if "datetime" in merged.columns:
        merged = (
            merged.sort_values("datetime")
            .drop_duplicates(subset=["datetime"], keep="last")
            .reset_index(drop=True)
        )
    return merged


def _filter_to_month(df: pd.DataFrame, ym: YearMonth) -> pd.DataFrame:
    """Return only the rows of df whose datetime falls inside ym."""
    if df.empty or "datetime" not in df.columns:
        return df
    dt = pd.to_datetime(df["datetime"], utc=True)
    mask = (dt.dt.year == ym.year) & (dt.dt.month == ym.month)
    return df.loc[mask].reset_index(drop=True)


def save_chunk(
    df: pd.DataFrame,
    symbol: str,
    source: str,
    timeframe: str,
    ym: YearMonth,
    created_by: str,
) -> dict:
    """Persist one month's DataFrame and upsert its metadata.

    `df` may contain rows for the entire fetch window — only the rows whose
    `datetime` falls inside `ym` are written. Empty months are stored as
    "known empty" rows (row_count = 0, file_size_bytes = 0, no Parquet file).

    Idempotent: an existing chunk row for the same (symbol, source, timeframe,
    year, month) is overwritten.
    """
    chunk_df = _filter_to_month(df, ym)
    is_complete = not _is_current_month_utc(ym)
    file_path = _build_chunk_path(source, symbol, timeframe, ym)

    if chunk_df.empty:
        # Known-empty month — no Parquet file, just a marker row.
        if file_path.exists():
            try:
                file_path.unlink()
            except OSError:
                pass
        file_size = 0
        row_count = 0
        path_str = ""
    else:
        file_path.parent.mkdir(parents=True, exist_ok=True)
        chunk_df.to_parquet(str(file_path), index=False, engine="pyarrow")
        file_size = os.path.getsize(file_path)
        row_count = len(chunk_df)
        path_str = str(file_path)
        logger.info(
            f"Saved chunk {symbol}/{source}/{timeframe}/{ym.label()} "
            f"— {row_count} rows ({file_size} bytes)"
        )

    client = _get_supabase_client()

    # Upsert by (symbol, source, timeframe, year, month). on_conflict matches
    # the partial unique index `uniq_data_cache_chunk`.
    payload = {
        "symbol": symbol.upper(),
        "source": source,
        "timeframe": timeframe,
        "year": ym.year,
        "month": ym.month,
        "is_complete": is_complete,
        "date_from": ym.first_day().isoformat(),
        "date_to": ym.last_day().isoformat(),
        "file_path": path_str,
        "file_size_bytes": file_size,
        "row_count": row_count,
        "created_by": created_by,
    }

    result = (
        client.table("data_cache")
        .upsert(payload, on_conflict="symbol,source,timeframe,year,month")
        .execute()
    )

    if result.data and len(result.data) > 0:
        return result.data[0]

    # Some Supabase client versions do not return rows on upsert — re-query.
    fallback = (
        client.table("data_cache")
        .select("*")
        .eq("symbol", symbol.upper())
        .eq("source", source)
        .eq("timeframe", timeframe)
        .eq("year", ym.year)
        .eq("month", ym.month)
        .limit(1)
        .execute()
    )
    if fallback.data:
        return fallback.data[0]

    raise RuntimeError(f"Failed to upsert chunk row for {symbol} {ym.label()}")


def fetch_missing_and_load(
    symbol: str,
    source: str,
    timeframe: str,
    date_from: date,
    date_to: date,
    created_by: str,
    fetch_month_fn,
    force_refresh: bool = False,
) -> tuple[pd.DataFrame, list[dict], list[YearMonth]]:
    """High-level chunked load.

    1. Look up existing chunks for [date_from, date_to].
    2. For every missing month, call `fetch_month_fn(year_month) -> DataFrame`
       (the caller decides whether that means hitting Dukascopy, resampling,
       etc.) and persist the result via `save_chunk`.
    3. Concat all available chunks (existing + freshly fetched) into one
       DataFrame and return it together with the cache rows used and the list
       of months that were freshly downloaded.

    When `force_refresh=True` all months in the range are re-downloaded and
    their chunk rows overwritten, even if valid cached files already exist.

    The `fetch_month_fn` may return an empty DataFrame for a month that has no
    trading days (e.g. holidays) — that's recorded as "known empty".

    Per-chunk locking ensures concurrent backtests for the same asset do not
    double-download the same month.
    """
    months = _months_in_range(date_from, date_to)
    if not months:
        return pd.DataFrame(), [], []

    # Snapshot existing chunks once to keep the DB round-trips low.
    client = _get_supabase_client()
    existing = _fetch_chunk_rows(client, symbol, source, timeframe, months)

    used_rows: list[dict] = []
    fetched: list[YearMonth] = []

    for ym in months:
        existing_row = existing.get((ym.year, ym.month))

        # Always re-fetch the running calendar month so new trading days land.
        # force_refresh bypasses all cache checks and overwrites every chunk.
        needs_fetch = (
            force_refresh
            or _is_current_month_utc(ym)
            or existing_row is None
            or existing_row.get("is_complete") is False
            or not existing_row.get("file_path")
            or not Path(existing_row["file_path"]).exists()
        )

        if not needs_fetch:
            used_rows.append(existing_row)
            continue

        with _chunk_lock(symbol, source, timeframe, ym):
            # Re-check inside the lock — another thread may have just filled it.
            recheck = (
                client.table("data_cache")
                .select("*")
                .eq("symbol", symbol.upper())
                .eq("source", source)
                .eq("timeframe", timeframe)
                .eq("year", ym.year)
                .eq("month", ym.month)
                .limit(1)
                .execute()
            )
            row_now = recheck.data[0] if recheck.data else None
            if (
                not _is_current_month_utc(ym)
                and row_now is not None
                and row_now.get("is_complete") is True
                and row_now.get("file_path")
                and Path(row_now["file_path"]).exists()
            ):
                used_rows.append(row_now)
                continue

            try:
                month_df = fetch_month_fn(ym)
            except Exception as e:
                logger.error(
                    f"Chunk fetch failed for {symbol} {ym.label()}: {e}",
                    exc_info=True,
                )
                # Re-raise so the caller can convert to an HTTPException.
                raise

            try:
                saved = save_chunk(
                    month_df if month_df is not None else pd.DataFrame(),
                    symbol=symbol,
                    source=source,
                    timeframe=timeframe,
                    ym=ym,
                    created_by=created_by,
                )
                used_rows.append(saved)
                fetched.append(ym)
            except Exception as e:
                logger.error(
                    f"Chunk save failed for {symbol} {ym.label()}: {e}",
                    exc_info=True,
                )
                # If we cannot save, still try to use the data in-memory by
                # appending a synthetic row pointing at no file — load_and_merge
                # will fall back to skipping it; we add the raw frame instead.
                if month_df is not None and not month_df.empty:
                    used_rows.append(
                        {
                            "id": None,
                            "file_path": "",
                            "_inline_df": month_df,  # consumed by merge below
                            "year": ym.year,
                            "month": ym.month,
                        }
                    )

    # Merge — supports both file-backed rows and the inline-DF fallback above.
    frames: list[pd.DataFrame] = []
    for row in used_rows:
        if "_inline_df" in row and isinstance(row["_inline_df"], pd.DataFrame):
            if not row["_inline_df"].empty:
                frames.append(row["_inline_df"])
            continue
        path = row.get("file_path")
        if not path or not Path(path).exists():
            continue
        try:
            frames.append(pd.read_parquet(path))
        except Exception as e:
            logger.warning(f"Failed to read chunk {path!r}: {e}")

    if not frames:
        merged = pd.DataFrame()
    else:
        merged = pd.concat(frames, ignore_index=True)
        if "datetime" in merged.columns:
            merged = (
                merged.sort_values("datetime")
                .drop_duplicates(subset=["datetime"], keep="last")
                .reset_index(drop=True)
            )

    return merged, used_rows, fetched


# ── UI helper ────────────────────────────────────────────────────────────────

def list_chunks_grouped() -> list[dict]:
    """Return cache entries grouped by (symbol, source, timeframe).

    Powers the Settings cache-management table. Includes both new chunk rows
    and legacy monolithic entries so admins can see and clean either.
    """
    client = _get_supabase_client()
    result = (
        client.table("data_cache")
        .select(
            "id, symbol, source, timeframe, year, month, is_complete, "
            "date_from, date_to, file_path, file_size_bytes, row_count, created_at"
        )
        .order("symbol")
        .order("timeframe")
        .order("year", desc=False)
        .order("month", desc=False)
        .limit(10_000)
        .execute()
    )

    groups: dict[tuple[str, str, str], dict] = {}
    for row in result.data or []:
        key = (row["symbol"], row["source"], row["timeframe"])
        g = groups.setdefault(
            key,
            {
                "symbol": row["symbol"],
                "source": row["source"],
                "timeframe": row["timeframe"],
                "chunks": [],
                "total_rows": 0,
                "total_size_bytes": 0,
                "earliest": None,
                "latest": None,
            },
        )
        g["chunks"].append(
            {
                "id": row["id"],
                "year": row.get("year"),
                "month": row.get("month"),
                "is_complete": row.get("is_complete", True),
                "row_count": row.get("row_count", 0) or 0,
                "file_size_bytes": row.get("file_size_bytes", 0) or 0,
                "date_from": row.get("date_from"),
                "date_to": row.get("date_to"),
            }
        )
        g["total_rows"] += row.get("row_count", 0) or 0
        g["total_size_bytes"] += row.get("file_size_bytes", 0) or 0
        d_from = row.get("date_from")
        d_to = row.get("date_to")
        if d_from and (g["earliest"] is None or d_from < g["earliest"]):
            g["earliest"] = d_from
        if d_to and (g["latest"] is None or d_to > g["latest"]):
            g["latest"] = d_to

    return sorted(
        groups.values(),
        key=lambda g: (g["symbol"], g["source"], g["timeframe"]),
    )


# ── Legacy single-file cache (kept for non-chunked endpoints) ───────────────
# These exist for backwards compatibility with code paths that still rely on
# the old "one file per request" layout (e.g. one-off candle fetches).

def _legacy_parquet_path(
    source: str,
    symbol: str,
    timeframe: str,
    date_from: date,
    date_to: date,
    hour_from: int = 0,
    hour_to: int = 23,
) -> Path:
    hour_suffix = f"_h{hour_from:02d}-{hour_to:02d}"
    return (
        DATA_DIR
        / "parquet"
        / source
        / symbol.upper()
        / timeframe
        / f"{date_from.isoformat()}_{date_to.isoformat()}{hour_suffix}.parquet"
    )


def find_cached_entry(
    symbol: str,
    source: str,
    timeframe: str,
    date_from: date,
    date_to: date,
    hour_from: int = 0,
    hour_to: int = 23,
) -> Optional[dict]:
    """Legacy single-file cache lookup.

    Looks for a cache row whose stored file_path matches the legacy naming
    convention. Chunk-based entries are ignored here (they have the same
    table but a different file_path layout).
    """
    expected_path = str(
        _legacy_parquet_path(source, symbol, timeframe, date_from, date_to, hour_from, hour_to)
    )

    client = _get_supabase_client()
    result = (
        client.table("data_cache")
        .select("*")
        .eq("symbol", symbol.upper())
        .eq("source", source)
        .eq("timeframe", timeframe)
        .lte("date_from", date_from.isoformat())
        .gte("date_to", date_to.isoformat())
        .is_("year", "null")  # only match legacy rows here
        .limit(1)
        .execute()
    )

    if result.data and len(result.data) > 0:
        entry = result.data[0]
        if entry["file_path"] != expected_path:
            return None
        if Path(entry["file_path"]).exists():
            return entry
        # Stale — clean up.
        client.table("data_cache").delete().eq("id", entry["id"]).execute()

    return None


def save_to_cache(
    df: pd.DataFrame,
    symbol: str,
    source: str,
    timeframe: str,
    date_from: date,
    date_to: date,
    created_by: str,
    hour_from: int = 0,
    hour_to: int = 23,
) -> dict:
    """Legacy single-file cache write.

    Kept so non-chunked code paths (e.g. on-demand candle fetches that are
    never used for full backtests) continue to work. New chunked code uses
    `save_chunk` instead.
    """
    file_path = _legacy_parquet_path(
        source, symbol, timeframe, date_from, date_to, hour_from, hour_to
    )
    file_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(str(file_path), index=False, engine="pyarrow")
    file_size = os.path.getsize(file_path)

    client = _get_supabase_client()
    entry = {
        "symbol": symbol.upper(),
        "source": source,
        "timeframe": timeframe,
        "date_from": date_from.isoformat(),
        "date_to": date_to.isoformat(),
        "file_path": str(file_path),
        "file_size_bytes": file_size,
        "row_count": len(df),
        "created_by": created_by,
        "is_complete": True,
    }

    result = client.table("data_cache").insert(entry).execute()
    if result.data and len(result.data) > 0:
        return result.data[0]
    raise RuntimeError("Failed to insert legacy cache entry into Supabase")


# ── 1-second cache (PROJ-15, unchanged) ─────────────────────────────────────

def find_cached_1s_entry(
    symbol: str,
    target_date: date,
    hour: int,
) -> Optional[Path]:
    file_path = (
        DATA_DIR
        / "parquet"
        / "dukascopy"
        / symbol.upper()
        / "1s"
        / f"{target_date.isoformat()}_h{hour:02d}.parquet"
    )
    if file_path.exists():
        return file_path
    return None


def save_1s_to_cache(
    df: pd.DataFrame,
    symbol: str,
    target_date: date,
    hour: int,
) -> Path:
    file_path = (
        DATA_DIR
        / "parquet"
        / "dukascopy"
        / symbol.upper()
        / "1s"
        / f"{target_date.isoformat()}_h{hour:02d}.parquet"
    )
    file_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(str(file_path), index=False, engine="pyarrow")
    file_size = os.path.getsize(file_path)
    logger.info(f"Saved {len(df)} 1s bars to {file_path} ({file_size} bytes)")
    return file_path


# ── Cache deletion ──────────────────────────────────────────────────────────

def delete_cache_entry(cache_id: str) -> bool:
    """Delete a single cache row (chunk or legacy) and its Parquet file."""
    client = _get_supabase_client()

    result = (
        client.table("data_cache")
        .select("file_path")
        .eq("id", cache_id)
        .limit(1)
        .execute()
    )

    if not result.data or len(result.data) == 0:
        logger.warning(f"Cache entry not found: {cache_id}")
        return False

    file_path_str = result.data[0]["file_path"]
    if file_path_str:
        file_path = Path(file_path_str)
        if file_path.exists():
            try:
                file_path.unlink()
                logger.info(f"Deleted Parquet file: {file_path}")
            except OSError as e:
                logger.warning(f"Failed to remove Parquet file {file_path}: {e}")

            # Best-effort cleanup of empty parent dirs.
            try:
                for parent in [
                    file_path.parent,
                    file_path.parent.parent,
                    file_path.parent.parent.parent,
                ]:
                    if parent.exists() and not any(parent.iterdir()):
                        parent.rmdir()
            except OSError:
                pass

    client.table("data_cache").delete().eq("id", cache_id).execute()
    logger.info(f"Deleted cache entry: {cache_id}")
    return True
