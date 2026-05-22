"""FastAPI service for the Data Fetcher (PROJ-1) and Backtesting Engine (PROJ-2).

Provides endpoints for fetching/caching historical OHLCV data and running
backtests against cached data sets.
"""

import ast
import asyncio
import concurrent.futures
import importlib.util
import inspect
import json
import logging
import os
import queue
import re
import subprocess
import sys
import tempfile
import threading
import traceback as _traceback
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from typing import List, Literal, Optional, Union

import numpy as np
import pandas as pd
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

from models import FetchRequest, FetchResponse, ErrorResponse, SkippedDayOut
from fetchers.dukascopy_fetcher import fetch_dukascopy
from fetchers.yfinance_fetcher import fetch_yfinance, VALID_INTERVALS as YFINANCE_INTERVALS
from services.auth import verify_jwt
from services.cache_service import (
    delete_cache_entry,
    fetch_missing_and_load,
    find_cached_entry,
    list_chunks_grouped,
    load_cached_data,
    save_to_cache,
)
from services.resampler import resample_ohlcv, TIMEFRAME_TO_RULE
from engine import run_backtest
from engine.models import BacktestConfig, InstrumentConfig
from analytics import calculate_analytics
from analytics.trade_metrics import r_multiple as compute_r_multiple
from strategies.breakout import BreakoutStrategy, BreakoutParams, SkippedDay
from strategies.registry import get_registry, get_strategy, list_strategies
from services.one_second_provider import create_1s_data_provider
from services import mt5_bridge as mt5_bridge_client
from services.mt5_bridge import (
    BridgeAuthError,
    BridgeConfigError,
    BridgeError,
    BridgeOfflineError,
)
from services.mql_param_replace import (
    MqlParameter,
    render_ea,
)
from services.notifications import format_run_summary, send_telegram
from jobs.stale_run_cleanup import (
    cleanup_orphans_after_bridge_restart,
    cleanup_stale_runs,
    start_stale_run_scheduler,
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Data Fetcher Service",
    description="Fetches and caches historical OHLCV data from Dukascopy and yfinance.",
    version="1.0.0",
)

# CORS — comma-separated list of allowed origins via CORS_ALLOWED_ORIGINS.
# Example: https://your-app.vercel.app,https://preview.vercel.app
_cors_origins = ["http://localhost:3000"]
if _extra := os.environ.get("CORS_ALLOWED_ORIGINS", os.environ.get("CORS_ALLOWED_ORIGIN", "")):
    for _origin in _extra.split(","):
        _origin = _origin.strip()
        if _origin:
            _cors_origins.append(_origin)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def _startup_jobs() -> None:
    """Start background schedulers (PROJ-37 stale-run sweeper)."""
    try:
        start_stale_run_scheduler()
    except Exception as exc:
        logger.exception("Failed to start stale-run scheduler: %s", exc)


def _timeframe_to_minutes(tf: str) -> int:
    """Convert a timeframe string (e.g. '2m', '1h') to the number of minutes per bar."""
    tf = tf.strip().lower()
    if tf.endswith("d"):
        return int(tf[:-1]) * 1440
    if tf.endswith("h"):
        return int(tf[:-1]) * 60
    if tf.endswith("m"):
        return int(tf[:-1])
    return 1


# Valid timeframes per source
DUKASCOPY_TIMEFRAMES = {"1m", "2m", "3m", "5m", "15m", "30m", "1h", "4h", "1d"}


def _validate_timeframe(source: str, timeframe: str) -> None:
    """Validate that the timeframe is supported for the given source."""
    if source == "dukascopy" and timeframe not in DUKASCOPY_TIMEFRAMES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid timeframe '{timeframe}' for Dukascopy. "
            f"Supported: {', '.join(sorted(DUKASCOPY_TIMEFRAMES))}",
        )
    if source == "yfinance" and timeframe not in YFINANCE_INTERVALS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid timeframe '{timeframe}' for yfinance. "
            f"Supported: {', '.join(sorted(YFINANCE_INTERVALS))}",
        )


def _validate_date_range(date_from: date, date_to: date) -> None:
    """Validate that the date range is sensible."""
    if date_from >= date_to:
        raise HTTPException(status_code=400, detail="date_from must be before date_to")
    if (date_to - date_from).days > 365 * 5:
        raise HTTPException(status_code=400, detail="Date range cannot exceed 5 years")


# ── PROJ-34: MT5 broker data loader ─────────────────────────────────────────

def _load_mt5_data(
    symbol: str,
    timeframe: str,
    date_from: date,
    date_to: date,
) -> pd.DataFrame:
    """Load candles from mt5_candles for (symbol, timeframe) in [date_from, date_to].

    Raises HTTPException 404 if no dataset exists for the symbol+timeframe.
    Raises HTTPException 400 if the dataset does not fully cover the requested range.
    """
    from services.cache_service import _get_supabase_client

    client = _get_supabase_client()

    # Resolve dataset and check coverage.
    ds_resp = (
        client.table("mt5_datasets")
        .select("id, start_date, end_date")
        .eq("asset", symbol.upper())
        .eq("timeframe", timeframe)
        .limit(1)
        .execute()
    )
    if not ds_resp.data:
        raise HTTPException(
            status_code=404,
            detail=f"No MT5 data uploaded for {symbol} / {timeframe}. "
                   "Upload data on the Settings page or disable MT5 Mode.",
        )

    ds = ds_resp.data[0]
    ds_start = date.fromisoformat(ds["start_date"])
    ds_end = date.fromisoformat(ds["end_date"])

    if date_from < ds_start or date_to > ds_end:
        raise HTTPException(
            status_code=400,
            detail=(
                f"MT5 data for {symbol} only covers {ds_start} – {ds_end}. "
                f"Adjust the date range or upload additional data."
            ),
        )

    # Fetch candles using timestamp-cursor pagination. Supabase silently caps
    # responses at the project's max-rows setting (typically 1000), so we
    # cannot rely on "< PAGE_SIZE" as a termination signal — we always loop
    # until the response is empty.
    PAGE_SIZE = 1_000
    ts_cursor = date_from.isoformat()
    ts_to = date_to.isoformat() + "T23:59:59Z"
    all_candles: list[dict] = []
    first_page = True

    while True:
        q = (
            client.table("mt5_candles")
            .select("ts, open, high, low, close")
            .eq("dataset_id", ds["id"])
            .lte("ts", ts_to)
            .order("ts")
            .limit(PAGE_SIZE)
        )
        # First page: inclusive lower bound; subsequent pages: exclusive to skip last row
        q = q.gte("ts", ts_cursor) if first_page else q.gt("ts", ts_cursor)
        first_page = False

        resp = q.execute()
        if not resp.data:
            break
        all_candles.extend(resp.data)
        ts_cursor = resp.data[-1]["ts"]

    if not all_candles:
        raise HTTPException(
            status_code=404,
            detail=f"No MT5 candles found for {symbol} between {date_from} and {date_to}.",
        )

    df = pd.DataFrame(all_candles)
    df.rename(columns={"ts": "datetime"}, inplace=True)
    df["datetime"] = pd.to_datetime(df["datetime"], utc=True)
    return df


# ── PROJ-27: chunked Dukascopy loader ───────────────────────────────────────

def _load_dukascopy_chunked(
    symbol: str,
    timeframe: str,
    date_from: date,
    date_to: date,
    user_id: str,
    force_refresh: bool = False,
) -> tuple[pd.DataFrame, list[dict], list]:
    """Load `symbol` for `[date_from, date_to]` using monthly chunks.

    Missing months are downloaded full-day (h00–h23) so chunks are reusable
    across different hour windows. The merged DataFrame is trimmed to the
    requested date range before returning.

    When `force_refresh=True` all months are re-downloaded and chunk rows
    overwritten — this replaces the legacy monolithic force-refresh path.

    Returns (merged_df, used_rows, fetched_months).
    """

    def _fetch_one_month(ym) -> pd.DataFrame:
        # Fetch the entire calendar month, then clip to [date_from, date_to]
        # so a partial first/last month is not over-fetched.
        m_from = max(ym.first_day(), date_from)
        m_to = min(ym.last_day(), date_to)
        if m_from > m_to:
            return pd.DataFrame()
        logger.info(
            f"PROJ-27: downloading chunk {symbol}/{timeframe}/{ym.label()} "
            f"({m_from} → {m_to}, full day)"
        )
        base_df = fetch_dukascopy(symbol, m_from, m_to, hour_from=0, hour_to=23)
        if base_df.empty:
            return pd.DataFrame()
        if base_df.attrs.get("partial"):
            # Partial download — bubble a TimeoutError so the caller can return
            # 504 without poisoning the cache with incomplete data.
            raise TimeoutError(
                f"Dukascopy fetch for {symbol} {ym.label()} timed out — partial data."
            )
        return base_df if timeframe == "1m" else resample_ohlcv(base_df, timeframe)

    df, used_rows, fetched = fetch_missing_and_load(
        symbol=symbol,
        source="dukascopy",
        timeframe=timeframe,
        date_from=date_from,
        date_to=date_to,
        created_by=user_id,
        fetch_month_fn=_fetch_one_month,
        force_refresh=force_refresh,
    )

    # Trim merged DataFrame to the exact requested range (chunks may extend
    # one day past `date_to` because monthly chunks include the whole month).
    if "datetime" in df.columns and not df.empty:
        dt_col = pd.to_datetime(df["datetime"], utc=True)
        mask = (dt_col.dt.date >= date_from) & (dt_col.dt.date <= date_to)
        df = df.loc[mask].reset_index(drop=True)

    return df, used_rows, fetched


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok", "service": "data-fetcher"}


# ── /strategies endpoint (PROJ-6) ───────────────────────────────────────────

@app.get("/strategies")
async def get_strategies():
    """Return all registered strategies with their JSON-Schema for UI rendering."""
    return list_strategies()


@app.post(
    "/fetch",
    response_model=FetchResponse,
    responses={400: {"model": ErrorResponse}, 502: {"model": ErrorResponse}, 504: {"model": ErrorResponse}},
)
async def fetch_data(
    request: FetchRequest,
    token: dict = Depends(verify_jwt),
):
    """
    Fetch OHLCV data for a given symbol, source, and timeframe.

    Checks cache first. On cache miss, downloads from the source,
    saves to cache, and returns the data.
    """
    user_id: str = token["sub"]  # verified user UUID from JWT

    symbol = request.symbol.upper()
    source = request.source
    timeframe = request.timeframe
    date_from = request.date_from
    date_to = request.date_to

    _validate_timeframe(source, timeframe)
    _validate_date_range(date_from, date_to)

    # Resolve hour range before cache lookup so the path check is correct (BUG-31).
    h_from = request.hour_from if request.hour_from is not None else 0
    h_to = request.hour_to if request.hour_to is not None else 23

    # PROJ-27: chunked monthly cache for Dukascopy (always full-day chunks).
    # Hour filtering is applied after merge so chunks are reusable across
    # different hour windows. force_refresh re-downloads all months and
    # overwrites chunk rows instead of falling back to the legacy monolithic path.
    if source == "dukascopy":
        try:
            df, used_rows, fetched = _load_dukascopy_chunked(
                symbol=symbol,
                timeframe=timeframe,
                date_from=date_from,
                date_to=date_to,
                user_id=user_id,
                force_refresh=request.force_refresh,
            )
        except TimeoutError as e:
            raise HTTPException(status_code=504, detail=str(e))
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Chunked fetch error: {e}", exc_info=True)
            raise HTTPException(
                status_code=502,
                detail=f"Failed to fetch data from {source}: {str(e)}",
            )

        if df.empty:
            raise HTTPException(
                status_code=404,
                detail=f"No data available for {symbol} from {source} between {date_from} and {date_to}",
            )

        # Apply hour filter for the response (chunks are stored full-day).
        if "datetime" in df.columns and (h_from > 0 or h_to < 23):
            dt_col = pd.to_datetime(df["datetime"], utc=True)
            df = df.loc[(dt_col.dt.hour >= h_from) & (dt_col.dt.hour <= h_to)].reset_index(drop=True)

        was_full_cache_hit = len(fetched) == 0
        warnings: list[str] = []
        actual_date_from: date | None = None
        actual_date_to: date | None = None
        if "datetime" in df.columns and not df.empty:
            dt_col = pd.to_datetime(df["datetime"], utc=True)
            actual_date_from = dt_col.min().date()
            actual_date_to = dt_col.max().date()
            if actual_date_from > date_from or actual_date_to < date_to:
                warnings.append(
                    f"Data available from {actual_date_from} to {actual_date_to}, "
                    f"requested {date_from} to {date_to}"
                )

        # Pick a representative chunk for the legacy file_path / cache_id fields.
        rep = next((r for r in used_rows if r.get("file_path")), None)
        return FetchResponse(
            symbol=symbol,
            source=source,
            timeframe=timeframe,
            date_from=date_from,
            date_to=date_to,
            row_count=len(df),
            file_path=rep["file_path"] if rep else "",
            file_size_bytes=sum(int(r.get("file_size_bytes") or 0) for r in used_rows),
            cache_id=rep["id"] if rep else None,
            cached=was_full_cache_hit,
            columns=list(df.columns),
            preview=df.head(5).to_dict(orient="records"),
            actual_date_from=actual_date_from,
            actual_date_to=actual_date_to,
            warnings=warnings,
        )

    # ── yfinance / force_refresh path: legacy single-file cache ──────────────
    if not request.force_refresh:
        cached = find_cached_entry(symbol, source, timeframe, date_from, date_to, h_from, h_to)
        if cached:
            df = load_cached_data(cached["file_path"])

            # Determine actual date range from cached data
            cached_warnings: list[str] = []
            cached_actual_from: date | None = None
            cached_actual_to: date | None = None
            if "datetime" in df.columns and not df.empty:
                dt_col = pd.to_datetime(df["datetime"], utc=True)
                cached_actual_from = dt_col.min().date()
                cached_actual_to = dt_col.max().date()
                if cached_actual_from > date_from or cached_actual_to < date_to:
                    cached_warnings.append(
                        f"Data available from {cached_actual_from} to {cached_actual_to}, "
                        f"requested {date_from} to {date_to}"
                    )

            return FetchResponse(
                symbol=symbol,
                source=source,
                timeframe=timeframe,
                date_from=date_from,
                date_to=date_to,
                row_count=len(df),
                file_path=cached["file_path"],
                file_size_bytes=cached["file_size_bytes"],
                cache_id=cached["id"],
                cached=True,
                columns=list(df.columns),
                preview=df.head(5).to_dict(orient="records"),
                actual_date_from=cached_actual_from,
                actual_date_to=cached_actual_to,
                warnings=cached_warnings,
            )

    # Fetch from source
    try:
        if source == "dukascopy":
            # Always fetch 1m data first, then resample if needed.
            # Optional hour_from/hour_to narrow the download to specific UTC hours (BUG-27).
            base_df = fetch_dukascopy(symbol, date_from, date_to, hour_from=h_from, hour_to=h_to)
            if timeframe != "1m":
                df = resample_ohlcv(base_df, timeframe)
            else:
                df = base_df
        elif source == "yfinance":
            # yfinance supports 1d/1wk/1mo directly
            df = fetch_yfinance(symbol, date_from, date_to, interval=timeframe)
        else:
            raise HTTPException(status_code=400, detail=f"Unknown source: {source}")
    except TimeoutError as e:
        raise HTTPException(status_code=504, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected fetch error: {e}", exc_info=True)
        raise HTTPException(
            status_code=502,
            detail=f"Failed to fetch data from {source}: {str(e)}",
        )

    if df.empty:
        raise HTTPException(
            status_code=404,
            detail=f"No data available for {symbol} from {source} between {date_from} and {date_to}",
        )

    # Determine actual date range from the DataFrame
    warnings: list[str] = []
    actual_date_from: date | None = None
    actual_date_to: date | None = None
    if "datetime" in df.columns and not df.empty:
        dt_col = pd.to_datetime(df["datetime"], utc=True)
        actual_date_from = dt_col.min().date()
        actual_date_to = dt_col.max().date()
        if actual_date_from > date_from or actual_date_to < date_to:
            warnings.append(
                f"Data available from {actual_date_from} to {actual_date_to}, "
                f"requested {date_from} to {date_to}"
            )

    # Partial fetch (timeout) — add warning but do not cache incomplete data (BUG-15)
    if df.attrs.get("partial"):
        warnings.append(
            "Fetch timed out — partial data returned. Re-fetch to download the full date range."
        )

    # Candle-API fallback — data is complete but was fetched via the slower tick endpoint
    if df.attrs.get("candle_fallback"):
        warnings.append(
            "Candle-API not available — tick data used as fallback. Download was slower than usual."
        )

    # Save to cache (skip for partial fetches to avoid caching incomplete data)
    cache_entry = None
    if not df.attrs.get("partial"):
        try:
            cache_entry = save_to_cache(
                df=df,
                symbol=symbol,
                source=source,
                timeframe=timeframe,
                date_from=date_from,
                date_to=date_to,
                created_by=user_id,
                hour_from=h_from,
                hour_to=h_to,
            )
        except Exception as e:
            logger.error(f"Cache save error: {e}", exc_info=True)
            # Return data even if caching fails
            return FetchResponse(
                symbol=symbol,
                source=source,
                timeframe=timeframe,
                date_from=date_from,
                date_to=date_to,
                row_count=len(df),
                file_path="",
                file_size_bytes=0,
                cached=False,
                columns=list(df.columns),
                preview=df.head(5).to_dict(orient="records"),
                actual_date_from=actual_date_from,
                actual_date_to=actual_date_to,
                warnings=warnings,
            )

    return FetchResponse(
        symbol=symbol,
        source=source,
        timeframe=timeframe,
        date_from=date_from,
        date_to=date_to,
        row_count=len(df),
        file_path=cache_entry["file_path"] if cache_entry else "",
        file_size_bytes=cache_entry["file_size_bytes"] if cache_entry else 0,
        cache_id=cache_entry["id"] if cache_entry else None,
        cached=False,
        columns=list(df.columns),
        preview=df.head(5).to_dict(orient="records"),
        actual_date_from=actual_date_from,
        actual_date_to=actual_date_to,
        warnings=warnings,
    )


@app.delete(
    "/cache/{cache_id}",
    responses={403: {"model": ErrorResponse}, 404: {"model": ErrorResponse}},
)
async def delete_cache(
    cache_id: str,
    token: dict = Depends(verify_jwt),
):
    """
    Delete a cached data entry (Parquet file + DB metadata).

    Requires a valid JWT with app_metadata.is_admin = true.
    """
    is_admin = token.get("app_metadata", {}).get("is_admin") is True
    if not is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")

    try:
        success = delete_cache_entry(cache_id)
    except Exception as e:
        logger.error(f"Cache delete error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to delete cache entry: {str(e)}")

    if not success:
        raise HTTPException(status_code=404, detail=f"Cache entry {cache_id} not found")

    return {"success": True, "deleted_id": cache_id}


@app.get("/cache/grouped")
async def get_cache_grouped(token: dict = Depends(verify_jwt)):
    """Return data_cache entries grouped by (symbol, source, timeframe).

    Powers the Settings cache-management UI. Admin-only.
    """
    is_admin = token.get("app_metadata", {}).get("is_admin") is True
    if not is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")

    try:
        groups = list_chunks_grouped()
    except Exception as e:
        logger.error(f"Cache list error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to list cache: {str(e)}")

    return {"groups": groups}


# ── Backtest rate limiter (in-memory, per user, sliding 1-minute window) ────
_rl_lock = threading.Lock()
_rl_timestamps: dict = defaultdict(list)
BACKTEST_RATE_LIMIT = 30  # requests per minute


def _check_backtest_rate_limit(user_id: str) -> bool:
    """Return True if the request is within the rate limit, False if exceeded."""
    now = datetime.now(timezone.utc)
    window_start = now - timedelta(minutes=1)
    with _rl_lock:
        times = _rl_timestamps[user_id]
        times[:] = [t for t in times if t > window_start]
        if len(times) >= BACKTEST_RATE_LIMIT:
            return False
        times.append(now)
        return True


# ── Backtest request / response models ──────────────────────────────────────

class InstrumentConfigRequest(BaseModel):
    pip_size: float = Field(gt=0)
    pip_value_per_lot: float = Field(gt=0)


class BacktestConfigRequest(BaseModel):
    initial_balance: float = Field(gt=0)
    sizing_mode: Literal["fixed_lot", "risk_percent"]
    instrument: InstrumentConfigRequest
    fixed_lot: Optional[float] = Field(default=None, gt=0)
    risk_percent: Optional[float] = Field(default=None, gt=0, le=100)
    commission_per_lot: float = Field(default=0.0, ge=0)
    slippage_pips: float = Field(default=0.0, ge=0)
    time_exit: Optional[str] = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")  # "HH:MM" (BUG-10)
    timezone: str = "UTC"                                                                    # IANA timezone (BUG-7)
    trail_trigger_pips: Optional[float] = Field(default=None, gt=0)
    trail_lock_pips: Optional[float] = Field(default=None, ge=0)                            # ge=0 allows 0.0 (breakeven); engine also defaults None → 0.0
    gap_fill: bool = False
    # PROJ-29
    price_type: Literal["bid", "mid"] = "bid"
    mt5_mode: bool = False
    already_past_rejection: bool = False
    spread_pips: float = Field(default=0.0, ge=0)

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, v: str) -> str:
        try:
            ZoneInfo(v)
        except (ZoneInfoNotFoundError, KeyError):
            raise ValueError(f"Invalid IANA timezone: '{v}'")
        return v


class SignalEntry(BaseModel):
    """One bar's worth of entry signals.  All price fields are optional."""
    ts: str                               # ISO-8601 timestamp matching the OHLCV index
    long_entry: Optional[float] = None
    long_sl: Optional[float] = None
    long_tp: Optional[float] = None
    short_entry: Optional[float] = None
    short_sl: Optional[float] = None
    short_tp: Optional[float] = None
    signal_expiry: Optional[str] = None   # ISO-8601 timestamp; None = no expiry (BUG-8)
    trail_trigger_pips: Optional[float] = None  # per-signal override (BUG-8)
    trail_lock_pips: Optional[float] = None     # per-signal override (BUG-8)


class BacktestRunRequest(BaseModel):
    cache_id: str
    config: BacktestConfigRequest
    signals: List[SignalEntry] = Field(min_length=1, max_length=500_000)


class TradeResponse(BaseModel):
    entry_time: str
    entry_price: float
    exit_time: str
    exit_price: float
    exit_reason: str
    direction: str
    lot_size: float
    pnl_pips: float
    pnl_currency: float
    initial_risk_pips: float
    initial_risk_currency: float
    r_multiple: Optional[float] = None
    used_1s_resolution: bool = False
    mae_pips: float = 0.0


class MetricResponse(BaseModel):
    name: str
    value: Optional[float]  # None for undefined
    value_string: Optional[str] = None  # Set to "Infinity" when value is float('inf')
    unit: str
    note: Optional[str] = None


class MonthlyRResponse(BaseModel):
    month: str
    r_earned: Optional[float]
    trade_count: int
    win_rate_pct: float = 0.0
    avg_loss_pips: Optional[float] = None
    avg_mae_pips: Optional[float] = None


class AnalyticsResponse(BaseModel):
    summary: List[MetricResponse]
    monthly_r: List[MonthlyRResponse]


class BacktestRunResponse(BaseModel):
    trades: List[TradeResponse]
    equity_curve: List[dict]
    final_balance: float
    initial_balance: float
    analytics: Optional[AnalyticsResponse] = None


# ── /backtest/run endpoint ───────────────────────────────────────────────────

@app.post("/backtest/run", response_model=BacktestRunResponse)
async def backtest_run(
    request: BacktestRunRequest,
    token: dict = Depends(verify_jwt),
):
    """
    Run a backtest against a previously cached OHLCV dataset.

    - Resolves cache_id → file_path via Supabase data_cache.
    - Loads the Parquet file from disk.
    - Aligns provided signals with the OHLCV index.
    - Runs the backtesting engine and returns the full result.

    Rate limit: 30 requests / minute per user.
    Any authenticated user may call this endpoint.
    """
    user_id: str = token["sub"]

    if not _check_backtest_rate_limit(user_id):
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded: max 30 backtest requests per minute.",
        )

    # ── 1. Resolve cache_id → file_path ─────────────────────────────────────
    from services.cache_service import _get_supabase_client  # reuse existing helper

    try:
        client = _get_supabase_client()
        resp = (
            client.table("data_cache")
            .select("file_path, symbol")
            .eq("id", request.cache_id)
            .eq("created_by", user_id)
            .single()
            .execute()
        )
    except Exception as e:
        logger.error(f"Supabase lookup failed for cache_id={request.cache_id}: {e}")
        raise HTTPException(status_code=502, detail="Failed to query data cache.")

    if not resp.data:
        raise HTTPException(
            status_code=404, detail=f"cache_id '{request.cache_id}' not found."
        )

    file_path: str = resp.data["file_path"]
    symbol: str = resp.data.get("symbol", "")

    # ── 2. Load OHLCV from Parquet ───────────────────────────────────────────
    try:
        df = load_cached_data(file_path)
    except FileNotFoundError:
        raise HTTPException(
            status_code=404,
            detail=f"Parquet file for cache_id '{request.cache_id}' not found on disk.",
        )
    except Exception as e:
        logger.error(f"Parquet load error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to load data.")

    # Normalise to DatetimeIndex (the Parquet stores datetime as a column)
    if "datetime" in df.columns:
        df = df.set_index("datetime")
    df.index = pd.to_datetime(df.index, utc=True)
    df.columns = [c.lower() for c in df.columns]

    required_cols = {"open", "high", "low", "close"}
    if not required_cols.issubset(set(df.columns)):
        raise HTTPException(
            status_code=400,
            detail=f"Cached data is missing required columns: {required_cols - set(df.columns)}",
        )

    # ── 3. Build signals DataFrame aligned to OHLCV index ───────────────────
    price_cols = ["long_entry", "long_sl", "long_tp", "short_entry", "short_sl", "short_tp",
                  "trail_trigger_pips", "trail_lock_pips"]
    signals_df = pd.DataFrame(np.nan, index=df.index, columns=price_cols + ["signal_expiry"], dtype=object)
    signals_df[price_cols] = signals_df[price_cols].astype(float)

    unmatched: List[str] = []
    for entry in request.signals:
        try:
            ts = pd.Timestamp(entry.ts).tz_convert("UTC")
        except Exception:
            raise HTTPException(
                status_code=400, detail=f"Invalid signal timestamp: '{entry.ts}'"
            )
        if ts not in signals_df.index:
            unmatched.append(entry.ts)
            continue
        for col in price_cols:
            val = getattr(entry, col, None)
            if val is not None:
                signals_df.at[ts, col] = val
        if entry.signal_expiry is not None:
            try:
                signals_df.at[ts, "signal_expiry"] = pd.Timestamp(entry.signal_expiry).tz_convert("UTC")
            except Exception:
                raise HTTPException(
                    status_code=400, detail=f"Invalid signal_expiry timestamp: '{entry.signal_expiry}'"
                )

    if unmatched:
        logger.warning(
            f"Backtest {request.cache_id}: {len(unmatched)} signal timestamps "
            f"did not match any OHLCV bar and were skipped."
        )

    # ── 4. Build engine config and run ──────────────────────────────────────
    cfg = request.config
    engine_config = BacktestConfig(
        initial_balance=cfg.initial_balance,
        sizing_mode=cfg.sizing_mode,
        instrument=InstrumentConfig(
            pip_size=cfg.instrument.pip_size,
            pip_value_per_lot=cfg.instrument.pip_value_per_lot,
        ),
        fixed_lot=cfg.fixed_lot,
        risk_percent=cfg.risk_percent,
        commission_per_lot=cfg.commission_per_lot,
        slippage_pips=cfg.slippage_pips,
        time_exit=cfg.time_exit,
        timezone=cfg.timezone,
        trail_trigger_pips=cfg.trail_trigger_pips,
        trail_lock_pips=cfg.trail_lock_pips,
        gap_fill=cfg.gap_fill,
        price_type=cfg.price_type,
        mt5_mode=cfg.mt5_mode,
        spread_pips=cfg.spread_pips,
    )

    _bar_minutes = (
        int(round((df.index[1] - df.index[0]).total_seconds() / 60))
        if len(df) >= 2 else 1
    )
    try:
        result = run_backtest(
            df, signals_df, engine_config,
            get_1s_data=create_1s_data_provider(symbol, bar_duration_minutes=_bar_minutes) if symbol else None,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Backtest engine error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal engine error.")

    # ── 5. Compute analytics ─────────────────────────────────────────────────
    try:
        analytics_result = calculate_analytics(result)
        analytics_out = AnalyticsResponse(
            summary=[
                MetricResponse(
                    name=m.name,
                    value=None if (m.value is None or m.value == float("inf")) else m.value,
                    value_string="Infinity" if m.value == float("inf") else None,
                    unit=m.unit,
                    note=m.note,
                )
                for m in analytics_result.summary
            ],
            monthly_r=[
                MonthlyRResponse(
                    month=mr.month,
                    r_earned=mr.r_earned,
                    trade_count=mr.trade_count,
                    win_rate_pct=mr.win_rate_pct,
                    avg_loss_pips=mr.avg_loss_pips,
                    avg_mae_pips=mr.avg_mae_pips,
                )
                for mr in analytics_result.monthly_r
            ],
        )
    except Exception as e:
        logger.error(f"Analytics calculation error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Analytics calculation failed.")

    # ── 6. Serialise and return ──────────────────────────────────────────────
    trades_out = [
        TradeResponse(
            entry_time=t.entry_time.isoformat(),
            entry_price=t.entry_price,
            exit_time=t.exit_time.isoformat(),
            exit_price=t.exit_price,
            exit_reason=t.exit_reason,
            direction=t.direction,
            lot_size=t.lot_size,
            pnl_pips=t.pnl_pips,
            pnl_currency=t.pnl_currency,
            initial_risk_pips=t.initial_risk_pips,
            initial_risk_currency=t.initial_risk_currency,
            r_multiple=compute_r_multiple(t),
            used_1s_resolution=t.used_1s_resolution,
            mae_pips=t.mae_pips,
        )
        for t in result.trades
    ]

    return BacktestRunResponse(
        trades=trades_out,
        equity_curve=result.equity_curve,
        final_balance=result.final_balance,
        initial_balance=result.initial_balance,
        analytics=analytics_out,
    )


_DIRECTION_MAP = {"long": "long_only", "short": "short_only", "both": "both"}


# ── Asset list models + endpoint ──────────────────────────────────────────────

class AssetOut(BaseModel):
    symbol: str
    name: str
    category: str


@app.get("/assets", response_model=List[AssetOut])
async def list_assets(token: dict = Depends(verify_jwt)):
    """
    Return the full list of instruments supported by the platform.

    Reads from the Supabase `instruments` table — add new assets via the
    Supabase dashboard without redeploying the service.
    """
    from services.cache_service import _get_supabase_client

    try:
        client = _get_supabase_client()
        resp = (
            client.table("instruments")
            .select("symbol, name, category")
            .order("category")
            .order("symbol")
            .execute()
        )
    except Exception as e:
        logger.error(f"Failed to fetch instruments: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail="Failed to load instrument list.")

    return resp.data or []


def _local_to_utc_hour_range(
    local_h_from: int,
    local_h_to: int,
    tz_name: str,
    date_from_: date,
    date_to_: date,
) -> tuple[int, int]:
    """Convert a local-timezone hour range to a UTC hour range suitable for
    pre-filtering a UTC-indexed DataFrame.

    Samples one date per month across the backtest period to capture all DST
    transitions, then applies a ±1h safety buffer.

    For UTC instruments the result is simply (max(0, h_from-1), min(23, h_to+1)).

    Example — Europe/Berlin (UTC+1 winter / UTC+2 summer):
        local 14:30 → UTC 12:30 (summer) or 13:30 (winter)
        utc_h_from = 14 - 2 - 1(buffer) = 11
        utc_h_to   = exit - 1 + 1(buffer) = exit
    """
    from zoneinfo import ZoneInfo

    if tz_name == "UTC":
        return max(0, local_h_from - 1), min(23, local_h_to + 1)

    tz = ZoneInfo(tz_name)
    offsets: set[int] = set()

    # Sample the 1st of each month inside [date_from_, date_to_] to catch all
    # DST transitions in the backtest window.
    d = date_from_.replace(day=1)
    while d <= date_to_:
        dt = datetime(d.year, d.month, d.day, 12, 0, tzinfo=tz)
        offsets.add(int(dt.utcoffset().total_seconds() // 3600))
        # Advance to the 1st of the next month
        d = (d.replace(day=28) + timedelta(days=4)).replace(day=1)

    # Also include the exact boundary dates
    for bd in [date_from_, date_to_]:
        dt = datetime(bd.year, bd.month, bd.day, 12, 0, tzinfo=tz)
        offsets.add(int(dt.utcoffset().total_seconds() // 3600))

    min_off = min(offsets)   # e.g. +1 for CET
    max_off = max(offsets)   # e.g. +2 for CEST

    # UTC = local − offset
    # Lower UTC bound: use the largest offset (most hours subtracted → smallest UTC hour)
    # Upper UTC bound: use the smallest offset (fewest hours subtracted → largest UTC hour)
    utc_h_from = local_h_from - max_off
    utc_h_to = local_h_to - min_off

    # For instruments with large negative UTC offsets (e.g. America/New_York UTC-5),
    # evening local times translate to UTC hours > 23 (wrapping to the next calendar day).
    # The hour-filter cannot express overnight UTC ranges, so fall back to keeping all
    # hours rather than silently dropping the needed bars (BUG-18).
    if utc_h_from > 23 or utc_h_to > 23:
        return 0, 23

    return max(0, utc_h_from - 1), min(23, utc_h_to + 1)


async def _resolve_instrument(symbol: str) -> dict:
    """
    Look up an instrument's engine config (pip_size, pip_value_per_lot, timezone)
    from the Supabase `instruments` table.

    Raises HTTPException 400 if the symbol is not in the database.
    """
    from services.cache_service import _get_supabase_client

    try:
        client = _get_supabase_client()
        resp = (
            client.table("instruments")
            .select("pip_size, pip_value_per_lot, timezone")
            .eq("symbol", symbol)
            .single()
            .execute()
        )
    except Exception as e:
        logger.error(f"Instrument lookup failed for {symbol}: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail="Failed to validate instrument.")

    if not resp.data:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Symbol '{symbol}' is not supported. "
                "See the asset list at GET /assets for supported instruments."
            ),
        )

    return resp.data


# ── Orchestration request / response models ───────────────────────────────────

class BacktestOrchestrationRequest(BaseModel):
    strategy: str
    symbol: str = Field(min_length=1)
    timeframe: str
    startDate: str
    endDate: str
    # Time-Range Breakout fields — optional for non-breakout strategies
    rangeStart: Optional[str] = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    rangeEnd: Optional[str] = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    triggerDeadline: Optional[str] = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    timeExit: Optional[str] = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    stopLoss: float = Field(gt=0)
    takeProfit: Optional[float] = Field(default=None, gt=0)
    direction: Literal["long", "short", "both"]
    commission_per_lot: float = Field(default=0.0, ge=0)
    slippage: float = Field(default=0.0, ge=0)
    initialCapital: float = Field(gt=0)
    sizingMode: Literal["risk_percent", "fixed_lot"]
    riskPercent: Optional[float] = Field(default=None, gt=0, le=100)
    fixedLot: Optional[float] = Field(default=None, gt=0)
    entryDelayBars: int = Field(default=1, ge=0)  # 0 = first bar at range_end, 1 = one bar later (default)
    trailTriggerPips: Optional[float] = Field(default=None, gt=0)
    trailLockPips: Optional[float] = Field(default=None, gt=0)
    gapFill: bool = False
    tradingDays: List[int] = Field(default=[0, 1, 2, 3, 4])  # 0=Mon … 4=Fri (Python weekday)
    newsDates: Optional[List[str]] = None  # YYYY-MM-DD strings; present only when tradeNewsDays=False
    # Moving Average Crossover fields (PROJ-6)
    fastPeriod: Optional[int] = Field(default=None, ge=2, le=500)
    slowPeriod: Optional[int] = Field(default=None, ge=2, le=500)
    # RSI Threshold fields (PROJ-6)
    rsiPeriod: Optional[int] = Field(default=None, ge=2, le=200)
    oversoldLevel: Optional[float] = Field(default=None, ge=1, le=99)
    overboughtLevel: Optional[float] = Field(default=None, ge=1, le=99)
    # PROJ-29
    price_type: Literal["bid", "mid"] = "bid"
    mt5_mode: bool = False
    already_past_rejection: bool = False
    spread_pips: float = Field(default=0.0, ge=0)


class BacktestMetricsOut(BaseModel):
    total_return_pct: float
    cagr_pct: float
    sharpe_ratio: float
    sortino_ratio: float
    max_drawdown_pct: float
    calmar_ratio: float
    longest_drawdown_days: float
    total_trades: int
    winning_trades: int
    losing_trades: int
    win_rate_pct: float
    gross_profit: float
    gross_loss: float
    gross_profit_pips: float
    gross_loss_pips: float
    avg_win: float
    avg_loss: float
    avg_win_pips: float
    avg_loss_pips: float
    avg_win_loss_ratio: float
    profit_factor: float
    avg_r_multiple: float
    total_r: float
    avg_r_per_month: float
    expectancy_pips: float
    best_trade: float
    worst_trade: float
    consecutive_wins: int
    consecutive_losses: int
    avg_trade_duration_hours: float
    final_balance: float

    # PROJ-31: Extended metrics (Optional for backwards compatibility)
    net_profit: Optional[float] = None
    max_drawdown_abs: Optional[float] = None
    recovery_factor: Optional[float] = None
    expected_payoff: Optional[float] = None
    buy_trades: Optional[int] = None
    buy_win_rate_pct: Optional[float] = None
    sell_trades: Optional[int] = None
    sell_win_rate_pct: Optional[float] = None
    min_trade_duration_minutes: Optional[float] = None
    max_trade_duration_minutes: Optional[float] = None
    max_consec_wins_count: Optional[int] = None
    max_consec_wins_profit: Optional[float] = None
    max_consec_losses_count: Optional[int] = None
    max_consec_losses_loss: Optional[float] = None
    avg_consec_wins: Optional[float] = None
    avg_consec_losses: Optional[float] = None
    ahpr: Optional[float] = None
    ghpr: Optional[float] = None
    lr_correlation: Optional[float] = None
    lr_std_error: Optional[float] = None
    z_score: Optional[float] = None
    z_score_confidence_pct: Optional[float] = None


class EquityCurveOut(BaseModel):
    date: str
    balance: float


class DrawdownCurveOut(BaseModel):
    date: str
    drawdown_pct: float


class CandleOut(BaseModel):
    time: int  # Unix-Timestamp in Sekunden
    open: float
    high: float
    low: float
    close: float


# Timeframe → buffer before entry / after exit for the candles endpoint
_CANDLE_BUFFER: dict[str, timedelta] = {
    "1m": timedelta(minutes=30),
    "2m": timedelta(hours=1),
    "3m": timedelta(hours=2),
    "5m": timedelta(hours=2),
    "15m": timedelta(hours=6),
    "30m": timedelta(hours=12),
    "1h": timedelta(hours=48),
    "4h": timedelta(days=7),
    "1d": timedelta(weeks=4),
}


class TradeDetailOut(BaseModel):
    id: int
    entry_time: str
    exit_time: str
    direction: str
    entry_price: float
    exit_price: float
    lot_size: float
    pnl_pips: float
    pnl_currency: float
    r_multiple: float
    exit_reason: str
    duration_minutes: int
    entry_gap_pips: float = 0.0
    exit_gap: bool = False
    used_1s_resolution: bool = False
    mae_pips: float = 0.0
    range_high: float = 0.0
    range_low: float = 0.0
    stop_loss: float = 0.0
    take_profit: float = 0.0


class BacktestOrchestrationResponse(BaseModel):
    metrics: BacktestMetricsOut
    equity_curve: List[EquityCurveOut]
    drawdown_curve: List[DrawdownCurveOut]
    trades: List[TradeDetailOut]
    skipped_days: List[SkippedDayOut] = []
    monthly_r: List[MonthlyRResponse] = []
    cache_id: Optional[str] = None
    symbol: str = ""
    timeframe: str = ""


# ── /backtest orchestration endpoint ─────────────────────────────────────────

async def _backtest_orchestrate_inner(
    request: BacktestOrchestrationRequest,
    user_id: str,
) -> BacktestOrchestrationResponse:
    """
    Core backtest orchestration logic (no rate-limit check).
    Called by the API endpoint (after rate-limit check) and internally by the optimizer.
    """
    # ── 1. Validate strategy ──────────────────────────────────────────────────
    registry = get_registry()
    if request.strategy not in registry:
        known = ", ".join(sorted(registry.keys()))
        raise HTTPException(
            status_code=400,
            detail=f"Unknown strategy '{request.strategy}'. Supported: {known}",
        )

    is_breakout = request.strategy == "time_range_breakout"

    # Breakout requires time fields
    if is_breakout:
        for field_name in ("rangeStart", "rangeEnd", "triggerDeadline", "timeExit"):
            if getattr(request, field_name) is None:
                raise HTTPException(
                    status_code=400,
                    detail=f"'{field_name}' is required for strategy 'time_range_breakout'",
                )
    # MA Crossover requires period fields
    if request.strategy == "moving_average_crossover":
        if request.fastPeriod is None or request.slowPeriod is None:
            raise HTTPException(
                status_code=400,
                detail="'fastPeriod' and 'slowPeriod' are required for strategy 'moving_average_crossover'",
            )
    # RSI Threshold requires rsi fields
    if request.strategy == "rsi_threshold":
        if request.rsiPeriod is None:
            raise HTTPException(
                status_code=400,
                detail="'rsiPeriod' is required for strategy 'rsi_threshold'",
            )

    symbol = request.symbol.upper()

    # ── 2. Resolve instrument config from Supabase (validates symbol) ─────────
    instrument = await _resolve_instrument(symbol)

    # ── 3. Parse and validate date range ──────────────────────────────────────
    try:
        date_from = date.fromisoformat(request.startDate)
        date_to = date.fromisoformat(request.endDate)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid date: {e}")

    _validate_date_range(date_from, date_to)
    if not request.mt5_mode:
        _validate_timeframe("dukascopy", request.timeframe)

    # ── 4. Fetch / load cached data ───────────────────────────────────────────
    # For breakout strategies: derive UTC hour range from time fields (BUG-14 / BUG-27).
    # For MA/RSI strategies: load all bars (no hour filter).
    if is_breakout:
        _range_start_h = int(request.rangeStart.split(":")[0])
        _time_exit_h = int(request.timeExit.split(":")[0])
        hour_from, hour_to = _local_to_utc_hour_range(
            _range_start_h, _time_exit_h,
            instrument["timezone"],
            date_from, date_to,
        )
    else:
        hour_from, hour_to = 0, 23  # load all bars for non-breakout strategies

    df = None
    resolved_cache_id: Optional[str] = None

    # Optimizer pre-load: if full-day data was loaded before the combination loop,
    # use it directly and skip the download/cache step entirely.
    _preloaded = _optimizer_preloaded_data.get(user_id)
    if _preloaded is not None:
        df = _preloaded.copy()
        logger.debug(f"Optimizer: using pre-loaded data for {symbol} (skipping fetch)")
    elif request.mt5_mode:
        # PROJ-34: MT5 broker data — query mt5_candles instead of Dukascopy.
        try:
            df = _load_mt5_data(
                symbol=symbol,
                timeframe=request.timeframe,
                date_from=date_from,
                date_to=date_to,
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"MT5 data load error for {symbol}: {e}", exc_info=True)
            raise HTTPException(status_code=502, detail="Failed to load MT5 data.")
    else:
        # PROJ-27: chunked monthly cache. Chunks are stored full-day so they
        # are reusable across all hour windows; the hour filter is applied
        # below (section 4c).
        try:
            df, used_rows, _fetched = _load_dukascopy_chunked(
                symbol=symbol,
                timeframe=request.timeframe,
                date_from=date_from,
                date_to=date_to,
                user_id=user_id,
            )
        except TimeoutError as e:
            raise HTTPException(status_code=504, detail=str(e))
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Fetch error for {symbol}: {e}", exc_info=True)
            raise HTTPException(status_code=502, detail="Failed to fetch data.")

        if df is None or df.empty:
            raise HTTPException(
                status_code=404,
                detail=f"No data available for {symbol} between {date_from} and {date_to}",
            )

        rep = next((r for r in used_rows if r.get("file_path")), None)
        if rep:
            resolved_cache_id = rep["id"]

    # Normalize to DatetimeIndex
    if "datetime" in df.columns:
        df = df.set_index("datetime")
    df.index = pd.to_datetime(df.index, utc=True)
    df.columns = [c.lower() for c in df.columns]

    required_cols = {"open", "high", "low", "close"}
    if not required_cols.issubset(set(df.columns)):
        raise HTTPException(
            status_code=400,
            detail=f"Data is missing required columns: {required_cols - set(df.columns)}",
        )

    # ── 4b. Filter to requested date range (BUG-14 fix) ─────────────────────
    # Cached data may cover a wider range than requested. Trim to [date_from, date_to].
    df = df[
        (df.index.date >= date_from) & (df.index.date <= date_to)
    ]
    if df.empty:
        raise HTTPException(
            status_code=404,
            detail=f"No data in range {date_from} to {date_to} (cached file may not cover this range — try force_refresh)",
        )

    # ── 4c. Filter to relevant UTC hours (BUG-27 fix) ────────────────────────
    # Keep only bars within [hour_from, hour_to]. This covers both the range-
    # formation window (rangeStart..rangeEnd) and the trade window (..timeExit),
    # with a ±1h DST buffer applied when hour_from/hour_to were derived above.
    df = df[(df.index.hour >= hour_from) & (df.index.hour <= hour_to)]
    if df.empty:
        raise HTTPException(
            status_code=404,
            detail=f"No data in UTC hour range {hour_from:02d}:00-{hour_to:02d}:00 for {symbol} ({date_from} to {date_to})",
        )

    # ── 4d. Filter by selected trading days (PROJ-23) ─────────────────────────
    trading_days_set = set(request.tradingDays)
    df = df[df.index.weekday.isin(trading_days_set)]
    if df.empty:
        raise HTTPException(status_code=404, detail="No data after trading-day filter")

    # ── 4e. Filter out news dates (PROJ-23) ───────────────────────────────────
    news_dates_set: set[str] = set(request.newsDates) if request.newsDates else set()
    if news_dates_set:
        df = df[~df.index.strftime("%Y-%m-%d").isin(news_dates_set)]
        if df.empty:
            raise HTTPException(status_code=404, detail="No data after news-date filter")

    # ── 5. Generate signals (strategy-specific) ────────────────────────────────
    if is_breakout:
        from strategies.breakout import BreakoutParams as _BP
        breakout_params = _BP(
            asset=symbol,
            range_start=time.fromisoformat(request.rangeStart),
            range_end=time.fromisoformat(request.rangeEnd),
            trigger_deadline=time.fromisoformat(request.triggerDeadline),
            stop_loss_pips=request.stopLoss,
            take_profit_pips=request.takeProfit,
            pip_size=instrument["pip_size"],
            timezone=instrument["timezone"],
            direction_filter=_DIRECTION_MAP[request.direction],
            entry_delay_bars=request.entryDelayBars,
            trail_trigger_pips=request.trailTriggerPips,
            trail_lock_pips=request.trailLockPips,
        )
        strategy = BreakoutStrategy()
        try:
            signals_df, skipped_days, _rejected_dates = strategy.generate_signals(
                df, breakout_params,
                mt5_mode=request.mt5_mode,
                already_past_rejection=request.already_past_rejection,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    elif request.strategy == "moving_average_crossover":
        from strategies.moving_average import MovingAverageCrossoverStrategy, MAParams
        ma_params = MAParams(
            asset=symbol,
            fast_period=request.fastPeriod,
            slow_period=request.slowPeriod,
            stop_loss_pips=request.stopLoss,
            take_profit_pips=request.takeProfit,
            pip_size=instrument["pip_size"],
            direction_filter=_DIRECTION_MAP[request.direction],
        )
        strategy = MovingAverageCrossoverStrategy()
        _rejected_dates: list[str] = []
        try:
            signals_df, skipped_days = strategy.generate_signals(df, ma_params)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    elif request.strategy == "rsi_threshold":
        from strategies.rsi_threshold import RSIThresholdStrategy, RSIParams
        rsi_params = RSIParams(
            asset=symbol,
            rsi_period=request.rsiPeriod,
            oversold_level=request.oversoldLevel if request.oversoldLevel is not None else 30,
            overbought_level=request.overboughtLevel if request.overboughtLevel is not None else 70,
            stop_loss_pips=request.stopLoss,
            take_profit_pips=request.takeProfit,
            pip_size=instrument["pip_size"],
            direction_filter=_DIRECTION_MAP[request.direction],
        )
        strategy = RSIThresholdStrategy()
        _rejected_dates = []
        try:
            signals_df, skipped_days = strategy.generate_signals(df, rsi_params)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    else:
        raise HTTPException(status_code=400, detail=f"Strategy '{request.strategy}' not yet implemented.")

    # Weekdays in [date_from, date_to] with zero bars in the filtered df get
    # reported as NO_BARS so they appear in the trade list as no-trade days.
    # Excluded trading days and news days are intentional — don't report them.
    from datetime import timedelta
    present_dates = set(df.index.date)
    d = date_from
    while d <= date_to:
        if d.weekday() in trading_days_set and str(d) not in news_dates_set and d not in present_dates:
            skipped_days.append(SkippedDay(date=str(d), reason="NO_BARS"))
        d += timedelta(days=1)

    # ── 6. Run backtesting engine ─────────────────────────────────────────────
    engine_config = BacktestConfig(
        initial_balance=request.initialCapital,
        sizing_mode=request.sizingMode,
        instrument=InstrumentConfig(
            pip_size=instrument["pip_size"],
            pip_value_per_lot=instrument["pip_value_per_lot"],
        ),
        fixed_lot=request.fixedLot,
        risk_percent=request.riskPercent,
        commission_per_lot=request.commission_per_lot,
        slippage_pips=request.slippage,
        time_exit=request.timeExit,
        timezone=instrument["timezone"],
        gap_fill=request.gapFill,
        price_type=request.price_type,
        mt5_mode=request.mt5_mode,
        spread_pips=request.spread_pips,
    )

    try:
        result = run_backtest(
            df, signals_df, engine_config,
            get_1s_data=create_1s_data_provider(symbol, bar_duration_minutes=_timeframe_to_minutes(request.timeframe)),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Backtest engine error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal engine error.")

    # PROJ-29: Propagate Already-Past Rejection dates into skipped_days
    # Format produced by breakout.py: "{date} (long|short|both)"
    _APR_REASON = {"long": "APR_REJECTED_LONG", "short": "APR_REJECTED_SHORT", "both": "APR_REJECTED_BOTH"}
    for apr_str in _rejected_dates:
        # e.g. "2024-01-15 (long)" → date="2024-01-15", side="long"
        if " (" in apr_str and apr_str.endswith(")"):
            apr_date, apr_side = apr_str[:-1].rsplit(" (", 1)
            skipped_days.append(SkippedDay(date=apr_date, reason=_APR_REASON.get(apr_side, "APR_REJECTED")))

    # Days where pending orders expired without triggering (Trigger Deadline days)
    for d_str in result.expired_order_dates:
        skipped_days.append(SkippedDay(date=d_str, reason="TRIGGER_EXPIRED"))

    # Gap-fill: any trading weekday that has market data but is not yet accounted
    # for (no trade, no skipped-day entry) gets listed as TRIGGER_EXPIRED so every
    # Monday–Friday appears in the Trade List.
    from zoneinfo import ZoneInfo as _ZoneInfo
    _tz_local = _ZoneInfo(instrument["timezone"])
    _traded_local_dates = {
        str(pd.Timestamp(t.entry_time).tz_convert(_tz_local).date())
        for t in result.trades
    }
    _accounted_dates = _traded_local_dates | {sd.date for sd in skipped_days}
    d = date_from
    while d <= date_to:
        d_str = str(d)
        if (d.weekday() in trading_days_set
                and d_str not in news_dates_set
                and d in present_dates
                and d_str not in _accounted_dates):
            skipped_days.append(SkippedDay(date=d_str, reason="TRIGGER_EXPIRED"))
        d += timedelta(days=1)

    # ── 7. Calculate analytics ────────────────────────────────────────────────
    try:
        analytics_result = calculate_analytics(result)
    except Exception as e:
        logger.error(f"Analytics error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Analytics calculation failed.")

    # ── 8. Build response ─────────────────────────────────────────────────────
    m = {metric.name: metric.value for metric in analytics_result.summary}

    def _f(v, default: float = 0.0) -> float:
        """Coerce None / inf / NaN to a safe float default."""
        if v is None:
            return default
        try:
            f = float(v)
        except (TypeError, ValueError):
            return default
        return default if (f != f or f == float("inf")) else f  # NaN or +inf → default

    cagr_val = _f(m.get("CAGR"))
    dd_val = _f(m.get("Max Drawdown"))
    calmar_val = round(cagr_val / abs(dd_val), 2) if dd_val != 0.0 else 0.0

    metrics_out = BacktestMetricsOut(
        total_return_pct=_f(m.get("Total Return")),
        cagr_pct=cagr_val,
        sharpe_ratio=_f(m.get("Sharpe Ratio")),
        sortino_ratio=_f(m.get("Sortino Ratio")),
        max_drawdown_pct=dd_val,
        calmar_ratio=calmar_val,
        longest_drawdown_days=_f(m.get("Max Drawdown Duration")),
        total_trades=int(m.get("Total Trades") or 0),
        winning_trades=int(m.get("Winning Trades") or 0),
        losing_trades=int(m.get("Losing Trades") or 0),
        win_rate_pct=_f(m.get("Win Rate")),
        gross_profit=_f(m.get("Gross Profit")),
        gross_loss=_f(m.get("Gross Loss")),
        gross_profit_pips=_f(m.get("Gross Profit (Pips)")),
        gross_loss_pips=_f(m.get("Gross Loss (Pips)")),
        avg_win=_f(m.get("Avg Win")),
        avg_loss=_f(m.get("Avg Loss")),
        avg_win_pips=_f(m.get("Avg Win (Pips)")),
        avg_loss_pips=_f(m.get("Avg Loss (Pips)")),
        avg_win_loss_ratio=_f(m.get("Avg Win / Avg Loss")),
        profit_factor=_f(m.get("Profit Factor (Pips)")),
        avg_r_multiple=_f(m.get("Avg R per Trade")),
        total_r=_f(m.get("Total R")),
        avg_r_per_month=_f(m.get("Avg R per Month")),
        expectancy_pips=_f(m.get("Expectancy (Pips)")),
        best_trade=_f(m.get("Best Trade")),
        worst_trade=_f(m.get("Worst Trade")),
        consecutive_wins=int(m.get("Consecutive Wins") or 0),
        consecutive_losses=int(m.get("Consecutive Losses") or 0),
        avg_trade_duration_hours=_f(m.get("Avg Trade Duration")),
        final_balance=result.final_balance,

        # PROJ-31: Extended metrics
        net_profit=m.get("Net Profit"),
        max_drawdown_abs=m.get("Max Drawdown Abs"),
        recovery_factor=m.get("Recovery Factor"),
        expected_payoff=m.get("Expected Payoff"),
        buy_trades=int(m.get("Buy Trades") or 0),
        buy_win_rate_pct=m.get("Buy Win Rate"),
        sell_trades=int(m.get("Sell Trades") or 0),
        sell_win_rate_pct=m.get("Sell Win Rate"),
        min_trade_duration_minutes=m.get("Min Trade Duration"),
        max_trade_duration_minutes=m.get("Max Trade Duration"),
        max_consec_wins_count=int(m.get("Max Consec Wins Count") or 0),
        max_consec_wins_profit=m.get("Max Consec Wins Profit"),
        max_consec_losses_count=int(m.get("Max Consec Losses Count") or 0),
        max_consec_losses_loss=m.get("Max Consec Losses Loss"),
        avg_consec_wins=m.get("Avg Consec Wins"),
        avg_consec_losses=m.get("Avg Consec Losses"),
        ahpr=m.get("AHPR"),
        ghpr=m.get("GHPR"),
        lr_correlation=m.get("LR Correlation"),
        lr_std_error=m.get("LR Standard Error"),
        z_score=m.get("Z-Score"),
        z_score_confidence_pct=m.get("Z-Score Confidence"),
    )

    # Equity curve: rename "time" → "date" to match the frontend type
    equity_curve_out = [
        EquityCurveOut(date=pt["time"], balance=pt["balance"])
        for pt in result.equity_curve
    ]

    # Drawdown curve: compute running-peak drawdown from the equity curve
    peak = result.initial_balance
    drawdown_curve_out: list[DrawdownCurveOut] = []
    for pt in result.equity_curve:
        bal = pt["balance"]
        if bal > peak:
            peak = bal
        dd_pct = round((bal - peak) / peak * 100, 4) if peak > 0 else 0.0
        drawdown_curve_out.append(DrawdownCurveOut(date=pt["time"], drawdown_pct=dd_pct))

    # Trades — enrich with range levels, SL/TP, and OHLCV candle snippet
    trades_out: list[TradeDetailOut] = []
    for i, t in enumerate(result.trades):
        duration_minutes = int((t.exit_time - t.entry_time).total_seconds() / 60)

        # Derive range_high/range_low and SL/TP from the signal that triggered this trade.
        # Find the most recent signal bar at or before entry_time.
        direction_prefix = "long" if t.direction == "long" else "short"
        entry_col = f"{direction_prefix}_entry"
        sl_col = f"{direction_prefix}_sl"
        tp_col = f"{direction_prefix}_tp"

        signal_before_entry = signals_df.loc[:t.entry_time, entry_col].dropna()
        if not signal_before_entry.empty:
            sig_ts = signal_before_entry.index[-1]
            range_high_val = float(signals_df.at[sig_ts, "long_entry"]) if pd.notna(signals_df.at[sig_ts, "long_entry"]) else 0.0
            range_low_val = float(signals_df.at[sig_ts, "short_entry"]) if pd.notna(signals_df.at[sig_ts, "short_entry"]) else 0.0
            # Undo the entry_offset to get the actual range extremes (breakout only)
            if is_breakout:
                entry_offset = breakout_params.entry_offset_pips * breakout_params.pip_size
                range_high_val = range_high_val - entry_offset if range_high_val != 0.0 else 0.0
                range_low_val = range_low_val + entry_offset if range_low_val != 0.0 else 0.0
            stop_loss_val = float(signals_df.at[sig_ts, sl_col]) if pd.notna(signals_df.at[sig_ts, sl_col]) else 0.0
            take_profit_val = float(signals_df.at[sig_ts, tp_col]) if (tp_col in signals_df.columns and pd.notna(signals_df.at[sig_ts, tp_col])) else 0.0
        else:
            range_high_val = 0.0
            range_low_val = 0.0
            stop_loss_val = 0.0
            take_profit_val = 0.0

        trades_out.append(TradeDetailOut(
            id=i + 1,
            entry_time=t.entry_time.isoformat(),
            exit_time=t.exit_time.isoformat(),
            direction=t.direction,
            entry_price=t.entry_price,
            exit_price=t.exit_price,
            lot_size=t.lot_size,
            pnl_pips=t.pnl_pips,
            pnl_currency=t.pnl_currency,
            r_multiple=_f(compute_r_multiple(t)),
            exit_reason=t.exit_reason,
            duration_minutes=duration_minutes,
            entry_gap_pips=t.entry_gap_pips,
            exit_gap=t.exit_gap,
            used_1s_resolution=t.used_1s_resolution,
            mae_pips=t.mae_pips,
            range_high=range_high_val,
            range_low=range_low_val,
            stop_loss=stop_loss_val,
            take_profit=take_profit_val,
        ))

    skipped_days_out = [
        SkippedDayOut(date=sd.date, reason=sd.reason)
        for sd in skipped_days
    ]

    monthly_r_out = [
        MonthlyRResponse(
            month=mr.month,
            r_earned=mr.r_earned,
            trade_count=mr.trade_count,
            win_rate_pct=mr.win_rate_pct,
            avg_loss_pips=mr.avg_loss_pips,
            avg_mae_pips=mr.avg_mae_pips,
        )
        for mr in analytics_result.monthly_r
    ]

    return BacktestOrchestrationResponse(
        metrics=metrics_out,
        equity_curve=equity_curve_out,
        drawdown_curve=drawdown_curve_out,
        trades=trades_out,
        skipped_days=skipped_days_out,
        monthly_r=monthly_r_out,
        cache_id=resolved_cache_id,
        symbol=symbol,
        timeframe=request.timeframe,
    )


@app.post("/backtest", response_model=BacktestOrchestrationResponse)
async def backtest_orchestrate(
    request: BacktestOrchestrationRequest,
    token: dict = Depends(verify_jwt),
):
    """
    Full orchestration: fetch data → generate signals → run engine → analytics.

    Accepts a user-friendly configuration object from the frontend UI and
    returns a complete result ready for display (metrics, equity curve,
    drawdown curve, trade list).

    Rate limit: 30 requests / minute per user (shared with /backtest/run).
    Any authenticated user may call this endpoint.
    """
    user_id: str = token["sub"]

    if not _check_backtest_rate_limit(user_id):
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded: max 30 backtest requests per minute.",
        )

    return await _backtest_orchestrate_inner(request, user_id)


@app.get("/backtest/candles", response_model=List[CandleOut])
async def get_trade_candles(
    cache_id: str,
    entry_time: str,
    exit_time: str,
    timeframe: str,
    range_start_time: Optional[str] = None,
    token: dict = Depends(verify_jwt),
):
    """
    Return OHLCV candles for a single trade window.

    Loads the cached Parquet file identified by cache_id (must belong to the
    authenticated user) and slices out a timeframe-dependent buffer around
    [entry_time, exit_time].

    If range_start_time is provided, window_start is extended to include it so
    that range-formation candles are visible in the trade chart dialog.

    Buffer per timeframe:
      1m  → ±30 min
      5m  → ±2 h
      15m → ±6 h
      1h  → ±48 h
      1d  → ±4 weeks
    """
    user_id: str = token["sub"]

    buffer = _CANDLE_BUFFER.get(timeframe)
    if buffer is None:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported timeframe '{timeframe}'. Supported: {', '.join(_CANDLE_BUFFER)}",
        )

    try:
        entry_dt = pd.Timestamp(entry_time).tz_convert("UTC")
        exit_dt = pd.Timestamp(exit_time).tz_convert("UTC")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid entry_time or exit_time (must be ISO 8601)")

    # Resolve cache_id → file_path (only the owning user may access)
    from services.cache_service import _get_supabase_client

    try:
        client = _get_supabase_client()
        resp = (
            client.table("data_cache")
            .select("file_path")
            .eq("id", cache_id)
            .eq("created_by", user_id)
            .single()
            .execute()
        )
    except Exception as e:
        logger.error(f"Supabase lookup failed for cache_id={cache_id}: {e}")
        raise HTTPException(status_code=502, detail="Failed to query data cache.")

    if not resp.data:
        raise HTTPException(status_code=404, detail=f"cache_id '{cache_id}' not found.")

    try:
        df = load_cached_data(resp.data["file_path"])
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Parquet file not found on disk.")
    except Exception as e:
        logger.error(f"Parquet load error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to load data.")

    if "datetime" in df.columns:
        df = df.set_index("datetime")
    df.index = pd.to_datetime(df.index, utc=True)
    df.columns = [c.lower() for c in df.columns]

    window_start = entry_dt - buffer
    if range_start_time:
        try:
            range_start_dt = pd.Timestamp(range_start_time).tz_convert("UTC")
            window_start = min(window_start, range_start_dt)
        except Exception:
            pass  # invalid range_start_time → fall back to default buffer
    window_end = exit_dt + buffer
    candle_df = df.loc[(df.index >= window_start) & (df.index <= window_end)]

    return [
        CandleOut(
            time=int(ts.timestamp()),
            open=float(row["open"]),
            high=float(row["high"]),
            low=float(row["low"]),
            close=float(row["close"]),
        )
        for ts, row in candle_df.iterrows()
    ]


async def _fetch_df_for_date(source: str, symbol: str, timeframe: str, trade_date: date, user_id: str, price_type: str = "bid") -> pd.DataFrame:
    """
    Fetch OHLCV data for a single day from the appropriate source and save to cache.
    Fetches trade_date and the next day to cover overnight positions.
    Runs the synchronous fetchers in a thread pool so the event loop is not blocked.
    """
    fetch_from = trade_date
    fetch_to = trade_date + timedelta(days=1)

    loop = asyncio.get_event_loop()

    if source == "dukascopy":
        base_df = await loop.run_in_executor(
            None, lambda: fetch_dukascopy(symbol, fetch_from, fetch_to, price_type=price_type)
        )
        df = base_df if timeframe == "1m" else resample_ohlcv(base_df, timeframe)
    elif source == "yfinance":
        df = await loop.run_in_executor(
            None, lambda: fetch_yfinance(symbol, fetch_from, fetch_to, interval=timeframe)
        )
    else:
        raise HTTPException(status_code=400, detail=f"Unknown source: {source}")

    if df.empty:
        raise HTTPException(
            status_code=404,
            detail=f"No data available for {symbol} on {trade_date} from {source}.",
        )

    # Persist so the next request can use the file directly
    try:
        save_to_cache(
            df=df,
            symbol=symbol,
            source=source,
            timeframe=timeframe,
            date_from=fetch_from,
            date_to=fetch_to,
            created_by=user_id,
        )
    except Exception as e:
        logger.warning(f"Could not persist re-fetched candles to cache: {e}")

    return df


@app.get("/backtest/candles/by-symbol", response_model=List[CandleOut])
async def get_trade_candles_by_symbol(
    symbol: str,
    timeframe: str,
    entry_time: str,
    exit_time: str,
    range_start_time: Optional[str] = None,
    price_type: str = "bid",
    token: dict = Depends(verify_jwt),
):
    """
    Return OHLCV candles for a single trade window without requiring a cache_id.

    1. Looks up data_cache for a matching entry (symbol + timeframe + trade date).
    2. If found and file exists on disk → serves from the Parquet file.
    3. If found but file is missing (ephemeral disk wiped) → re-fetches the day
       from the original source, saves back to cache, then serves candles.
    4. If no cache entry at all → looks up the source from the instruments table,
       fetches the day, saves to cache, then serves candles.
    """
    user_id: str = token["sub"]

    buffer = _CANDLE_BUFFER.get(timeframe)
    if buffer is None:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported timeframe '{timeframe}'. Supported: {', '.join(_CANDLE_BUFFER)}",
        )

    try:
        entry_dt = pd.Timestamp(entry_time).tz_convert("UTC")
        exit_dt = pd.Timestamp(exit_time).tz_convert("UTC")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid entry_time or exit_time (must be ISO 8601)")

    trade_date = entry_dt.date()

    from services.cache_service import _get_supabase_client
    from pathlib import Path as _Path

    # ── Step 1: Look up a cache entry covering the trade date ─────────────────
    try:
        client = _get_supabase_client()
        resp = (
            client.table("data_cache")
            .select("file_path, source")
            .eq("symbol", symbol.upper())
            .eq("timeframe", timeframe)
            .lte("date_from", trade_date.isoformat())
            .gte("date_to", trade_date.isoformat())
            .limit(1)
            .execute()
        )
    except Exception as e:
        logger.error(f"Supabase lookup failed for symbol={symbol}, timeframe={timeframe}: {e}")
        raise HTTPException(status_code=502, detail="Failed to query data cache.")

    df: pd.DataFrame | None = None

    if resp.data:
        entry = resp.data[0]
        file_path = entry["file_path"]
        source = entry["source"]

        if _Path(file_path).exists():
            # ── Step 2: Cache hit — load from disk ────────────────────────────
            try:
                df = load_cached_data(file_path)
            except Exception as e:
                logger.error(f"Parquet load error: {e}", exc_info=True)
                raise HTTPException(status_code=500, detail="Failed to load data.")
        else:
            # ── Step 3: Stale entry — file was wiped, re-fetch ────────────────
            logger.info(f"Parquet file missing for {symbol}/{timeframe}/{trade_date}, re-fetching from {source}")
            # Remove stale DB entry first
            try:
                client.table("data_cache").delete().eq("file_path", file_path).execute()
            except Exception:
                pass
            df = await _fetch_df_for_date(source, symbol.upper(), timeframe, trade_date, user_id, price_type=price_type)
    else:
        # ── Step 4: No cache entry — look up source from instruments table ────
        try:
            instr_resp = (
                client.table("instruments")
                .select("source")
                .eq("symbol", symbol.upper())
                .limit(1)
                .execute()
            )
        except Exception as e:
            logger.error(f"Instruments lookup failed for {symbol}: {e}")
            raise HTTPException(status_code=502, detail="Failed to look up instrument.")

        if not instr_resp.data:
            raise HTTPException(
                status_code=404,
                detail=f"Symbol '{symbol}' not found. Run a backtest for this period first.",
            )

        source = instr_resp.data[0]["source"]
        logger.info(f"No cache entry for {symbol}/{timeframe}/{trade_date}, fetching from {source}")
        df = await _fetch_df_for_date(source, symbol.upper(), timeframe, trade_date, user_id)

    # ── Slice the DataFrame to the candle window ──────────────────────────────
    if "datetime" in df.columns:
        df = df.set_index("datetime")
    df.index = pd.to_datetime(df.index, utc=True)
    df.columns = [c.lower() for c in df.columns]

    window_start = entry_dt - buffer
    if range_start_time:
        try:
            range_start_dt = pd.Timestamp(range_start_time).tz_convert("UTC")
            window_start = min(window_start, range_start_dt)
        except Exception:
            pass
    window_end = exit_dt + buffer
    candle_df = df.loc[(df.index >= window_start) & (df.index <= window_end)]

    return [
        CandleOut(
            time=int(ts.timestamp()),
            open=float(row["open"]),
            high=float(row["high"]),
            low=float(row["low"]),
            close=float(row["close"]),
        )
        for ts, row in candle_df.iterrows()
    ]


# ══════════════════════════════════════════════════════════════════════════════
# PROJ-19: Strategy Optimizer — In-Memory Job Management + Endpoints
# ══════════════════════════════════════════════════════════════════════════════

import hashlib
import uuid
from dataclasses import dataclass, field as dc_field
from enum import Enum


class OptimizerJobStatus(str, Enum):
    RUNNING = "running"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    FAILED = "failed"


@dataclass
class OptimizerResultRow:
    """One parameter combination's result."""
    params: dict
    params_hash: str
    profit_factor: float | None = None
    sharpe_ratio: float | None = None
    win_rate: float | None = None
    total_trades: int = 0
    net_profit: float | None = None
    max_drawdown_pct: float | None = None
    recovery_factor: float | None = None
    error: str | None = None


@dataclass
class OptimizerJob:
    """In-memory state for a running optimizer job."""
    job_id: str
    user_id: str
    total: int
    completed: int = 0
    status: OptimizerJobStatus = OptimizerJobStatus.RUNNING
    results: list[OptimizerResultRow] = dc_field(default_factory=list)
    cancel_flag: bool = False
    error_message: str | None = None
    finished_at: datetime | None = None


# In-memory job store: job_id → OptimizerJob
_optimizer_jobs: dict[str, OptimizerJob] = {}
_optimizer_jobs_lock = threading.Lock()

# Max 1 concurrent job per user
_optimizer_user_jobs: dict[str, str] = {}  # user_id → job_id

_JOB_TTL_SECONDS = 1800  # 30 minutes

# Pre-loaded data for optimizer: user_id → DataFrame (full-day, loaded once before loop)
_optimizer_preloaded_data: dict[str, "pd.DataFrame"] = {}


def _cleanup_stale_jobs() -> None:
    """Remove finished jobs that are older than JOB_TTL_SECONDS."""
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=_JOB_TTL_SECONDS)
    with _optimizer_jobs_lock:
        stale = [
            jid for jid, job in _optimizer_jobs.items()
            if job.finished_at is not None and job.finished_at < cutoff
        ]
        for jid in stale:
            del _optimizer_jobs[jid]

OPTIMIZER_MAX_COMBINATIONS = 2000


def _compute_params_hash(params: dict) -> str:
    """Deterministic hash of parameter dict for duplicate detection."""
    canonical = json.dumps(params, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()[:16]


def _generate_combinations(parameter_ranges: dict) -> list[dict]:
    """
    Generate all parameter combinations from range definitions.

    Each key in parameter_ranges maps to either:
      - { "min": X, "max": Y, "step": Z }  (numeric range)
      - { "values": [...] }                 (explicit list)

    Returns a list of dicts, e.g. [{"sl": 10, "tp": 50}, {"sl": 10, "tp": 60}, ...]
    """
    import itertools

    param_names = sorted(parameter_ranges.keys())
    param_values: list[list] = []

    for name in param_names:
        spec = parameter_ranges[name]
        if "values" in spec:
            param_values.append(spec["values"])
        else:
            min_val = float(spec["min"])
            max_val = float(spec["max"])
            step = float(spec["step"])
            if step <= 0:
                raise ValueError(f"Step for '{name}' must be > 0")
            if min_val > max_val:
                raise ValueError(f"Min ({min_val}) > Max ({max_val}) for '{name}'")
            vals = []
            v = min_val
            while v <= max_val + 1e-9:  # small epsilon for float rounding
                vals.append(round(v, 6))
                v += step
            if not vals:
                raise ValueError(f"No values generated for '{name}' (min={min_val}, max={max_val}, step={step})")
            param_values.append(vals)

    combos = []
    for combo in itertools.product(*param_values):
        combos.append(dict(zip(param_names, combo)))

    return combos


def _apply_params_to_request(
    base_request: "BacktestOrchestrationRequest",
    parameter_group: str,
    params: dict,
) -> "BacktestOrchestrationRequest":
    """
    Return a new BacktestOrchestrationRequest with the given params applied
    to the correct fields based on the parameter_group.
    """
    data = base_request.model_dump()

    if parameter_group == "crv":
        if "stopLoss" in params:
            data["stopLoss"] = params["stopLoss"]
        if "takeProfit" in params:
            data["takeProfit"] = params["takeProfit"]
    elif parameter_group == "time_exit":
        if "timeExit" in params:
            # params["timeExit"] is minutes from midnight, convert to HH:MM
            minutes = int(params["timeExit"])
            data["timeExit"] = f"{minutes // 60:02d}:{minutes % 60:02d}"
    elif parameter_group == "trigger_deadline":
        if "triggerDeadline" in params:
            minutes = int(params["triggerDeadline"])
            data["triggerDeadline"] = f"{minutes // 60:02d}:{minutes % 60:02d}"
    elif parameter_group == "range_window":
        if "rangeStart" in params:
            minutes = int(params["rangeStart"])
            data["rangeStart"] = f"{minutes // 60:02d}:{minutes % 60:02d}"
        if "rangeEnd" in params:
            minutes = int(params["rangeEnd"])
            data["rangeEnd"] = f"{minutes // 60:02d}:{minutes % 60:02d}"
    elif parameter_group == "trailing_stop":
        if "trailTriggerPips" in params:
            data["trailTriggerPips"] = params["trailTriggerPips"]
        if "trailLockPips" in params:
            data["trailLockPips"] = params["trailLockPips"]

    return BacktestOrchestrationRequest(**data)


async def _preload_optimizer_data(
    request: BacktestOrchestrationRequest,
    user_id: str,
) -> Optional["pd.DataFrame"]:
    """
    Load full-day (h00-h23) data once before the optimizer combination loop.
    Stores the result in _optimizer_preloaded_data[user_id] so that each call to
    backtest_orchestrate within the same job skips the per-combination download.
    Returns the DataFrame, or None on failure (optimizer will fall back to per-combo fetch).
    """
    import pandas as pd

    symbol = request.symbol.upper()
    try:
        date_from = date.fromisoformat(request.startDate)
        date_to = date.fromisoformat(request.endDate)
    except ValueError as e:
        logger.warning(f"Optimizer pre-load: invalid date in request: {e}")
        return None

    df = None
    try:
        logger.info(f"Optimizer pre-load: loading {symbol} {date_from}–{date_to} via chunked cache")
        df, _used, _fetched = _load_dukascopy_chunked(
            symbol=symbol,
            timeframe=request.timeframe,
            date_from=date_from,
            date_to=date_to,
            user_id=user_id,
        )
        if df is None or df.empty:
            logger.warning(f"Optimizer pre-load: no data returned for {symbol}")
            return None
        logger.info(f"Optimizer pre-load: {len(df)} rows loaded for {symbol} ({date_from}–{date_to})")
    except TimeoutError as e:
        logger.warning(f"Optimizer pre-load: timeout for {symbol}: {e}")
        return None
    except Exception as e:
        logger.warning(f"Optimizer pre-load: data fetch failed for {symbol}: {e}")
        return None

    # Normalize once here so backtest_orchestrate can skip re-normalization
    if "datetime" in df.columns:
        df = df.set_index("datetime")
    df.index = pd.to_datetime(df.index, utc=True)
    df.columns = [c.lower() for c in df.columns]

    return df


async def _run_single_backtest(request: BacktestOrchestrationRequest, user_id: str) -> dict:
    """
    Run a single backtest using the orchestration logic and return summary metrics.
    Returns a dict with keys: profit_factor, sharpe_ratio, win_rate, total_trades, net_profit, max_drawdown_pct, recovery_factor, error.
    """
    try:
        result = await _backtest_orchestrate_inner(request, user_id)
        m = result.metrics
        return {
            "profit_factor": m.profit_factor,
            "sharpe_ratio": m.sharpe_ratio,
            "win_rate": m.win_rate_pct,
            "total_trades": m.total_trades,
            "net_profit": round(m.final_balance - request.initialCapital, 2),
            "max_drawdown_pct": m.max_drawdown_pct,
            "recovery_factor": m.recovery_factor,
            "error": None,
        }
    except HTTPException as e:
        return {
            "profit_factor": None,
            "sharpe_ratio": None,
            "win_rate": None,
            "total_trades": 0,
            "net_profit": None,
            "max_drawdown_pct": None,
            "recovery_factor": None,
            "error": e.detail if isinstance(e.detail, str) else str(e.detail),
        }
    except Exception as e:
        return {
            "profit_factor": None,
            "sharpe_ratio": None,
            "win_rate": None,
            "total_trades": 0,
            "net_profit": None,
            "max_drawdown_pct": None,
            "recovery_factor": None,
            "error": str(e),
        }


async def _optimizer_worker(
    job: OptimizerJob,
    base_request: BacktestOrchestrationRequest,
    parameter_group: str,
    combinations: list[dict],
):
    """Background worker that runs all combinations sequentially."""
    try:
        # Pre-load full-day data once before the loop to avoid per-combination
        # cache misses when rangeStart / timeExit parameters change across combos.
        pre_loaded = await _preload_optimizer_data(base_request, job.user_id)
        if pre_loaded is not None:
            _optimizer_preloaded_data[job.user_id] = pre_loaded
            logger.info(f"Optimizer job {job.job_id}: pre-loaded data, skipping per-combo downloads")
        else:
            logger.warning(f"Optimizer job {job.job_id}: pre-load failed, falling back to per-combo fetch")

        for combo in combinations:
            if job.cancel_flag:
                job.status = OptimizerJobStatus.CANCELLED
                break

            params_hash = _compute_params_hash(combo)
            modified_request = _apply_params_to_request(base_request, parameter_group, combo)

            result = await _run_single_backtest(modified_request, job.user_id)

            row = OptimizerResultRow(
                params=combo,
                params_hash=params_hash,
                profit_factor=result["profit_factor"],
                sharpe_ratio=result["sharpe_ratio"],
                win_rate=result["win_rate"],
                total_trades=result["total_trades"],
                net_profit=result["net_profit"],
                max_drawdown_pct=result["max_drawdown_pct"],
                recovery_factor=result["recovery_factor"],
                error=result["error"],
            )
            job.results.append(row)
            job.completed += 1

        if job.status == OptimizerJobStatus.RUNNING:
            job.status = OptimizerJobStatus.COMPLETED
    except Exception as e:
        job.status = OptimizerJobStatus.FAILED
        job.error_message = str(e)
        logger.error(f"Optimizer job {job.job_id} failed: {e}", exc_info=True)
    finally:
        # Clean up pre-loaded data and mark job as finished
        _optimizer_preloaded_data.pop(job.user_id, None)
        with _optimizer_jobs_lock:
            job.finished_at = datetime.now(timezone.utc)
            if _optimizer_user_jobs.get(job.user_id) == job.job_id:
                del _optimizer_user_jobs[job.user_id]


# ── Optimizer Pydantic models ────────────────────────────────────────────────

class OptimizerStartRequest(BaseModel):
    """Request to start an optimizer run."""
    # Base backtest config (same fields as BacktestOrchestrationRequest)
    strategy: str
    symbol: str = Field(min_length=1)
    timeframe: str
    startDate: str
    endDate: str
    rangeStart: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    rangeEnd: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    triggerDeadline: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    timeExit: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    stopLoss: float = Field(gt=0)
    takeProfit: float = Field(gt=0)
    direction: Literal["long", "short", "both"]
    commission_per_lot: float = Field(default=0.0, ge=0)
    slippage: float = Field(default=0.0, ge=0)
    initialCapital: float = Field(gt=0)
    sizingMode: Literal["risk_percent", "fixed_lot"]
    riskPercent: Optional[float] = Field(default=None, gt=0, le=100)
    fixedLot: Optional[float] = Field(default=None, gt=0)
    entryDelayBars: int = Field(default=1, ge=0)
    trailTriggerPips: Optional[float] = Field(default=None, gt=0)
    trailLockPips: Optional[float] = Field(default=None, gt=0)
    gapFill: bool = False
    tradingDays: List[int] = Field(default=[0, 1, 2, 3, 4])
    newsDates: Optional[List[str]] = None
    # PROJ-29
    price_type: Literal["bid", "mid"] = "bid"
    mt5_mode: bool = False
    already_past_rejection: bool = False
    spread_pips: float = Field(default=0.0, ge=0)

    # Optimizer-specific fields
    parameter_group: str = Field(
        ...,
        pattern=r"^(crv|time_exit|trigger_deadline|range_window|trailing_stop)$",
    )
    target_metric: str = Field(
        ...,
        pattern=r"^(profit_factor|sharpe_ratio|win_rate|net_profit|max_drawdown_pct|recovery_factor)$",
    )
    parameter_ranges: dict  # e.g. { "sl": { "min": 10, "max": 50, "step": 5 } }


class OptimizerStartResponse(BaseModel):
    job_id: str
    total_combinations: int


class OptimizerResultOut(BaseModel):
    params: dict
    params_hash: str
    profit_factor: Optional[float] = None
    sharpe_ratio: Optional[float] = None
    win_rate: Optional[float] = None
    total_trades: int = 0
    net_profit: Optional[float] = None
    max_drawdown_pct: Optional[float] = None
    recovery_factor: Optional[float] = None
    error: Optional[str] = None


class OptimizerStatusResponse(BaseModel):
    job_id: str
    status: str
    total: int
    completed: int
    results: List[OptimizerResultOut]
    error_message: Optional[str] = None


class OptimizerCancelResponse(BaseModel):
    job_id: str
    status: str
    message: str


# ── Optimizer endpoints ──────────────────────────────────────────────────────

@app.post("/optimize/start", response_model=OptimizerStartResponse)
async def optimizer_start(
    request: OptimizerStartRequest,
    token: dict = Depends(verify_jwt),
):
    """
    Start an optimizer job. Generates all parameter combinations and runs them
    sequentially in a background task.

    Limits:
    - Max 1 concurrent job per user
    - Max 2000 combinations per job
    """
    user_id: str = token["sub"]

    # Clean up stale finished jobs before checking/creating new ones
    _cleanup_stale_jobs()

    # Check for existing running job
    with _optimizer_jobs_lock:
        existing_job_id = _optimizer_user_jobs.get(user_id)
        if existing_job_id and existing_job_id in _optimizer_jobs:
            existing_job = _optimizer_jobs[existing_job_id]
            if existing_job.status == OptimizerJobStatus.RUNNING:
                raise HTTPException(
                    status_code=409,
                    detail="You already have a running optimizer job. Cancel it first or wait for completion.",
                )

    # Generate combinations
    try:
        combinations = _generate_combinations(request.parameter_ranges)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not combinations:
        raise HTTPException(status_code=400, detail="No parameter combinations generated.")

    if len(combinations) > OPTIMIZER_MAX_COMBINATIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Too many combinations ({len(combinations)}). Maximum is {OPTIMIZER_MAX_COMBINATIONS}.",
        )

    # Create the base backtest request (without optimizer-specific fields)
    base_data = request.model_dump(exclude={"parameter_group", "target_metric", "parameter_ranges"})
    base_request = BacktestOrchestrationRequest(**base_data)

    # Create job
    job_id = str(uuid.uuid4())
    job = OptimizerJob(
        job_id=job_id,
        user_id=user_id,
        total=len(combinations),
    )

    with _optimizer_jobs_lock:
        _optimizer_jobs[job_id] = job
        _optimizer_user_jobs[user_id] = job_id

    # Start background task
    asyncio.create_task(
        _optimizer_worker(job, base_request, request.parameter_group, combinations)
    )

    return OptimizerStartResponse(
        job_id=job_id,
        total_combinations=len(combinations),
    )


@app.get("/optimize/status/{job_id}", response_model=OptimizerStatusResponse)
async def optimizer_status(
    job_id: str,
    token: dict = Depends(verify_jwt),
):
    """Get the current status and results of an optimizer job."""
    user_id: str = token["sub"]

    job = _optimizer_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    if job.user_id != user_id:
        raise HTTPException(status_code=403, detail="Not your job.")

    results_out = [
        OptimizerResultOut(
            params=r.params,
            params_hash=r.params_hash,
            profit_factor=r.profit_factor,
            sharpe_ratio=r.sharpe_ratio,
            win_rate=r.win_rate,
            total_trades=r.total_trades,
            net_profit=r.net_profit,
            max_drawdown_pct=r.max_drawdown_pct,
            recovery_factor=r.recovery_factor,
            error=r.error,
        )
        for r in job.results
    ]

    return OptimizerStatusResponse(
        job_id=job.job_id,
        status=job.status.value,
        total=job.total,
        completed=job.completed,
        results=results_out,
        error_message=job.error_message,
    )


@app.post("/optimize/cancel/{job_id}", response_model=OptimizerCancelResponse)
async def optimizer_cancel(
    job_id: str,
    token: dict = Depends(verify_jwt),
):
    """Cancel a running optimizer job. Partial results are preserved."""
    user_id: str = token["sub"]

    job = _optimizer_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    if job.user_id != user_id:
        raise HTTPException(status_code=403, detail="Not your job.")

    if job.status != OptimizerJobStatus.RUNNING:
        return OptimizerCancelResponse(
            job_id=job.job_id,
            status=job.status.value,
            message=f"Job is already {job.status.value}.",
        )

    job.cancel_flag = True

    return OptimizerCancelResponse(
        job_id=job.job_id,
        status="cancelling",
        message="Cancel signal sent. Job will stop after the current combination finishes.",
    )


# ── /mt5/* endpoints (PROJ-37: MT5 Bridge Worker) ───────────────────────────

# Health-check cache: 10s TTL so the frontend can poll the Settings card every
# 30s without hammering the bridge if multiple browser tabs open.
_MT5_HEALTH_CACHE: dict = {"value": None, "expires_at": 0.0}
_MT5_HEALTH_TTL_SECONDS = 10.0

# Bridge-restart auto-detection (event-driven from /mt5/health).
# Tracks the last `last_started_at` value the bridge advertised. When it
# increases vs. this value, we fire `cleanup_orphans_after_bridge_restart`
# once as a background task. This is a faster path than the 5-min
# APScheduler sweeper for the case where the Windows host reboots and the
# bridge resumes from scratch — runs that were `running` in the DB but no
# longer exist in the bridge's freshly-empty in-memory queue are flagged
# `failed` immediately rather than after up to 5 minutes.
_MT5_BRIDGE_LAST_STARTED_AT: dict = {"value": None}
_MT5_BRIDGE_RESTART_LOCK = threading.Lock()


def _parse_iso_timestamp(value: Optional[str]) -> Optional[datetime]:
    """Parse an ISO-8601 timestamp; tolerate the trailing-`Z` shorthand.

    Returns `None` for unparsable input. BUG-5: the bridge-restart detector
    needs `2026-04-30T08:00:00+00:00` and `2026-04-30T08:00:00Z` to compare
    equal. Python <3.11 chokes on `Z`; we substitute it with `+00:00` first.
    """
    if not value:
        return None
    try:
        normalised = value[:-1] + "+00:00" if value.endswith("Z") else value
        return datetime.fromisoformat(normalised)
    except (TypeError, ValueError):
        return None


def _maybe_handle_bridge_restart(new_last_started_at: Optional[str]) -> bool:
    """Compare the new `last_started_at` against the cached value.

    Returns True when a restart was detected and a cleanup was scheduled.
    Mutates `_MT5_BRIDGE_LAST_STARTED_AT` in-place under a lock so concurrent
    health probes don't fan out into multiple cleanups.

    BUG-5: comparison is now instant-based via `datetime.fromisoformat` so
    `...+00:00` and `...Z` (and other equivalent ISO renderings) don't
    falsely trigger orphan-cleanup. Falls back to literal string equality
    when either side is unparsable so we never mistake "garbage in" for
    "no change".
    """
    if not new_last_started_at:
        return False

    with _MT5_BRIDGE_RESTART_LOCK:
        previous = _MT5_BRIDGE_LAST_STARTED_AT["value"]
        # First-ever observation: just remember the timestamp, don't fire
        # cleanup. The 5-min sweeper handles whatever was orphaned before
        # this process started.
        if previous is None:
            _MT5_BRIDGE_LAST_STARTED_AT["value"] = new_last_started_at
            return False
        # No change → no restart. Compare as parsed instants; if either side
        # fails to parse, fall through to string equality (paranoid guard
        # against a future bridge changing serialisation format).
        prev_dt = _parse_iso_timestamp(previous)
        new_dt = _parse_iso_timestamp(new_last_started_at)
        if prev_dt is not None and new_dt is not None:
            if prev_dt == new_dt:
                # Equivalent instant; refresh the stored representation so
                # the cache stays in sync with the bridge's preferred form.
                _MT5_BRIDGE_LAST_STARTED_AT["value"] = new_last_started_at
                return False
        elif new_last_started_at == previous:
            return False
        # Different instant → bridge process restarted (we accept clock
        # moving backward as a restart signal too — what matters is "this
        # is a different bridge run" implies the in-memory queue is empty).
        _MT5_BRIDGE_LAST_STARTED_AT["value"] = new_last_started_at

    logger.info(
        "Bridge restart detected (last_started_at: %s → %s) — scheduling orphan cleanup.",
        previous, new_last_started_at,
    )

    async def _run_cleanup() -> None:
        try:
            await cleanup_orphans_after_bridge_restart()
        except Exception as exc:
            logger.exception(
                "Bridge-restart orphan cleanup failed: %s", exc
            )

    try:
        asyncio.create_task(_run_cleanup())
    except RuntimeError:
        # No running loop (test/sync context). Caller can run it directly.
        logger.debug("No running event loop — skipping orphan-cleanup task scheduling.")
        return False
    return True


def _supabase_for_user_token():
    """Return the cache_service supabase client (service role)."""
    from services.cache_service import _get_supabase_client
    return _get_supabase_client()


class MT5TesterRunRequest(BaseModel):
    """Payload to launch a MT5 Strategy Tester run via the Bridge Worker."""
    expert_path: str = Field(min_length=1)
    expert_name: str = Field(min_length=1)
    symbol: str = Field(min_length=1)
    timeframe: str = Field(min_length=1)
    from_date: str = Field(min_length=1)  # ISO date YYYY-MM-DD
    to_date: str = Field(min_length=1)
    parameters: dict = Field(default_factory=dict)
    model: str = Field(default="EveryTickRealistic")
    initial_capital: float = 100000.0
    mql_conversion_id: Optional[str] = None


class MT5TesterRunResponse(BaseModel):
    job_id: str
    status: str
    queue_position: Optional[int] = None
    bridge_job_id: Optional[str] = None


class MT5TesterStatusResponse(BaseModel):
    job_id: str
    status: str
    queue_position: Optional[int] = None
    error_message: Optional[str] = None
    metrics: Optional[dict] = None
    started_at: Optional[str] = None
    finished_at: Optional[str] = None


class MT5HealthResponse(BaseModel):
    online: bool
    status: Optional[str] = None
    terminal_logged_in: Optional[bool] = None
    broker: Optional[str] = None
    build: Optional[int] = None
    queue_length: Optional[int] = None
    current_run: Optional[str] = None
    last_started_at: Optional[str] = None
    error: Optional[str] = None


class MT5OrphanCleanupRequest(BaseModel):
    user_id: Optional[str] = None
    bridge_started_at: Optional[str] = None


@app.post("/mt5/tester/run", response_model=MT5TesterRunResponse)
async def mt5_tester_run(
    request: MT5TesterRunRequest,
    token: dict = Depends(verify_jwt),
):
    """Persist a tester-run row, then forward the job to the Bridge Worker.

    Creates a `mt5_tester_runs` row in Supabase before talking to the bridge so
    that even if the bridge is temporarily offline, the run is recoverable on
    reconnect (DB is the source of truth — bridge in-memory FIFO is a cache).
    """
    user_id: str = token["sub"]

    # ── Validate dates (ISO YYYY-MM-DD) ─────────────────────────────────
    try:
        from_d = date.fromisoformat(request.from_date)
        to_d = date.fromisoformat(request.to_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="from_date / to_date must be ISO YYYY-MM-DD")

    if from_d >= to_d:
        raise HTTPException(status_code=400, detail="from_date must be before to_date")

    client = _supabase_for_user_token()

    # ── Persist run row (status=pending) ────────────────────────────────
    try:
        insert_resp = (
            client.table("mt5_tester_runs")
            .insert(
                {
                    "user_id": user_id,
                    "mql_conversion_id": request.mql_conversion_id,
                    "expert_name": request.expert_name,
                    "symbol": request.symbol,
                    "timeframe": request.timeframe,
                    "from_date": request.from_date,
                    "to_date": request.to_date,
                    "parameters": request.parameters,
                    "model": request.model,
                    "status": "pending",
                }
            )
            .execute()
        )
    except Exception as exc:
        logger.exception("Failed to persist mt5_tester_runs row: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to record run.")

    if not insert_resp.data:
        raise HTTPException(status_code=500, detail="Insert returned no row.")

    run_row = insert_resp.data[0]
    run_id = run_row["id"]

    # ── Forward to bridge ───────────────────────────────────────────────
    bridge_payload = {
        "expert_path": request.expert_path,
        "symbol": request.symbol,
        "timeframe": request.timeframe,
        "from_date": request.from_date,
        "to_date": request.to_date,
        "parameters": request.parameters,
        "model": request.model,
        "initial_capital": request.initial_capital,
        # Pass our run_id so the bridge can echo it on completion callbacks.
        "callback_run_id": run_id,
    }

    try:
        bridge_resp = await mt5_bridge_client.submit_run(bridge_payload)
    except BridgeConfigError as exc:
        client.table("mt5_tester_runs").update(
            {"status": "failed", "error_message": str(exc)}
        ).eq("id", run_id).execute()
        raise HTTPException(status_code=503, detail=str(exc))
    except BridgeAuthError as exc:
        client.table("mt5_tester_runs").update(
            {"status": "failed", "error_message": str(exc)}
        ).eq("id", run_id).execute()
        raise HTTPException(status_code=502, detail=str(exc))
    except BridgeOfflineError as exc:
        client.table("mt5_tester_runs").update(
            {
                "status": "failed",
                "error_message": f"Bridge Worker offline: {exc}",
            }
        ).eq("id", run_id).execute()
        raise HTTPException(status_code=502, detail=f"Bridge Worker offline: {exc}")
    except BridgeError as exc:
        client.table("mt5_tester_runs").update(
            {"status": "failed", "error_message": str(exc)}
        ).eq("id", run_id).execute()
        raise HTTPException(status_code=502, detail=str(exc))

    bridge_job_id = bridge_resp.get("job_id")
    queue_position = bridge_resp.get("queue_position")
    new_status = bridge_resp.get("status", "queued")

    # ── Persist bridge_job_id + queued status ───────────────────────────
    update_payload = {
        "status": new_status if new_status in ("queued", "running") else "queued",
        "bridge_job_id": bridge_job_id,
        "queue_position": queue_position,
    }
    client.table("mt5_tester_runs").update(update_payload).eq("id", run_id).execute()

    return MT5TesterRunResponse(
        job_id=run_id,
        status=update_payload["status"],
        queue_position=queue_position,
        bridge_job_id=bridge_job_id,
    )


@app.get("/mt5/tester/status/{job_id}", response_model=MT5TesterStatusResponse)
async def mt5_tester_status(
    job_id: str,
    token: dict = Depends(verify_jwt),
):
    """Poll the bridge for status, sync the DB, and return the merged view."""
    user_id: str = token["sub"]

    client = _supabase_for_user_token()
    run_resp = (
        client.table("mt5_tester_runs")
        .select(
            "id, user_id, status, bridge_job_id, started_at, finished_at, "
            "error_message, expert_name, symbol, timeframe, queue_position"
        )
        .eq("id", job_id)
        .limit(1)
        .execute()
    )
    if not run_resp.data:
        raise HTTPException(status_code=404, detail="Run not found.")
    run_row = run_resp.data[0]
    if run_row["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="Not your run.")

    # Terminal states — return DB snapshot, no bridge call needed.
    if run_row["status"] in ("done", "failed", "cancelled"):
        metrics = _load_run_metrics(client, job_id)
        return MT5TesterStatusResponse(
            job_id=job_id,
            status=run_row["status"],
            error_message=run_row.get("error_message"),
            metrics=metrics,
            started_at=run_row.get("started_at"),
            finished_at=run_row.get("finished_at"),
        )

    bridge_job_id = run_row.get("bridge_job_id")
    if not bridge_job_id:
        # Run was inserted but bridge handoff didn't complete — surface as-is.
        return MT5TesterStatusResponse(
            job_id=job_id,
            status=run_row["status"],
            queue_position=run_row.get("queue_position"),
            error_message=run_row.get("error_message"),
            started_at=run_row.get("started_at"),
        )

    # Live status from bridge.
    try:
        bridge_data = await mt5_bridge_client.run_status(bridge_job_id)
    except (BridgeOfflineError, BridgeError) as exc:
        # Don't flip the row to failed yet — the stale-run sweeper handles long
        # outages. Just surface the current DB snapshot.
        logger.warning("Bridge status lookup failed for run %s: %s", job_id, exc)
        return MT5TesterStatusResponse(
            job_id=job_id,
            status=run_row["status"],
            queue_position=run_row.get("queue_position"),
            error_message=run_row.get("error_message"),
            started_at=run_row.get("started_at"),
        )

    new_status = bridge_data.get("status", run_row["status"])
    queue_position = bridge_data.get("queue_position")

    update_payload: dict = {}
    if new_status != run_row["status"]:
        update_payload["status"] = new_status
    if queue_position is not None and queue_position != run_row.get("queue_position"):
        update_payload["queue_position"] = queue_position

    metrics_payload: Optional[dict] = None

    if new_status == "done":
        update_payload["finished_at"] = datetime.now(timezone.utc).isoformat()
        metrics_payload = bridge_data.get("metrics")
        if metrics_payload:
            _upsert_run_metrics(client, job_id, metrics_payload)
        # Persist the parsed trade list 1:1 from the bridge's XML parser.
        # Same shape as bridge.models.TesterTrade; mapping lives in
        # _replace_run_trades.
        _replace_run_trades(client, job_id, bridge_data.get("trades"))
    elif new_status in ("failed", "cancelled"):
        update_payload["finished_at"] = datetime.now(timezone.utc).isoformat()
        update_payload["error_message"] = bridge_data.get("error_message")

    if update_payload:
        client.table("mt5_tester_runs").update(update_payload).eq("id", job_id).execute()

    # Send notification on terminal transitions.
    if new_status in ("done", "failed", "cancelled") and new_status != run_row["status"]:
        try:
            await send_telegram(
                user_id=user_id,
                message=format_run_summary(
                    run_id=job_id,
                    expert_name=run_row.get("expert_name", "?"),
                    symbol=run_row.get("symbol", "?"),
                    timeframe=run_row.get("timeframe", "?"),
                    status=new_status,
                    metrics=metrics_payload,
                    error_message=update_payload.get("error_message"),
                ),
                run_type="single_run",
            )
        except Exception as notif_exc:
            logger.warning("Notification failed for run %s: %s", job_id, notif_exc)

    return MT5TesterStatusResponse(
        job_id=job_id,
        status=new_status,
        queue_position=queue_position,
        error_message=update_payload.get("error_message") or run_row.get("error_message"),
        metrics=metrics_payload or _load_run_metrics(client, job_id),
        started_at=run_row.get("started_at"),
        finished_at=update_payload.get("finished_at") or run_row.get("finished_at"),
    )


def _load_run_metrics(client, run_id: str) -> Optional[dict]:
    """Fetch the mt5_tester_metrics row for a run, if present."""
    try:
        resp = (
            client.table("mt5_tester_metrics")
            .select(
                "total_net_profit, gross_profit, gross_loss, "
                "sharpe_ratio, profit_factor, recovery_factor, "
                "max_drawdown_abs, max_drawdown_pct, "
                "total_trades, won_trades, lost_trades, average_trade"
            )
            .eq("run_id", run_id)
            .limit(1)
            .execute()
        )
        return resp.data[0] if resp.data else None
    except Exception as exc:
        logger.warning("Failed to load metrics for run %s: %s", run_id, exc)
        return None


def _upsert_run_metrics(client, run_id: str, metrics: dict) -> None:
    """Insert or update the mt5_tester_metrics row for a completed run."""
    payload = {
        "run_id": run_id,
        "total_net_profit": metrics.get("total_net_profit"),
        "gross_profit": metrics.get("gross_profit"),
        "gross_loss": metrics.get("gross_loss"),
        "sharpe_ratio": metrics.get("sharpe_ratio"),
        "profit_factor": metrics.get("profit_factor"),
        "recovery_factor": metrics.get("recovery_factor"),
        "max_drawdown_abs": metrics.get("max_drawdown_abs"),
        "max_drawdown_pct": metrics.get("max_drawdown_pct"),
        "total_trades": metrics.get("total_trades"),
        "won_trades": metrics.get("won_trades"),
        "lost_trades": metrics.get("lost_trades"),
        "average_trade": metrics.get("average_trade"),
        "raw_xml": metrics.get("raw_xml"),
    }
    try:
        client.table("mt5_tester_metrics").upsert(payload, on_conflict="run_id").execute()
    except Exception as exc:
        logger.exception("Failed to upsert metrics for run %s: %s", run_id, exc)


# MT5 emits trade timestamps as "YYYY.MM.DD HH:MM:SS" (dot-separated date).
# Postgres' TIMESTAMPTZ accepts ISO 8601, so we normalise on the way in. The
# bridge passes the XML cell text through unchanged (see TesterTrade in
# bridge/models.py), so the conversion lives here on the persistence side.
_MT5_TS_RE = re.compile(
    r"^\s*(?P<y>\d{4})[.\-/](?P<m>\d{2})[.\-/](?P<d>\d{2})[ T]"
    r"(?P<H>\d{2}):(?P<M>\d{2})(?::(?P<S>\d{2}))?\s*$"
)


def _normalise_mt5_timestamp(value) -> Optional[str]:
    """Convert an MT5 tester timestamp into ISO 8601 (UTC-naive)."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    text = str(value).strip()
    if not text:
        return None
    m = _MT5_TS_RE.match(text)
    if m:
        seconds = m.group("S") or "00"
        return f"{m.group('y')}-{m.group('m')}-{m.group('d')}T{m.group('H')}:{m.group('M')}:{seconds}"
    # Fall back to ISO parsing — handles already-normalised payloads from the
    # bridge or test fixtures that pre-convert.
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).isoformat()
    except ValueError:
        logger.warning("Unrecognised MT5 timestamp format: %r", text)
        return None


def _normalise_direction(value) -> Optional[str]:
    """Map MT5 trade types to the CHECK-constrained 'buy'/'sell' values.

    MT5 emits 'buy'/'sell' in modern builds but older builds use 'Buy'/'Sell'
    or numeric op codes — we handle the common variants and drop anything
    else (e.g. 'balance' deposit rows) with a None so the CHECK accepts it.
    """
    if value is None:
        return None
    text = str(value).strip().lower()
    if text in ("buy", "sell"):
        return text
    if text in ("0", "buy stop", "buy limit", "buy_stop", "buy_limit"):
        return "buy"
    if text in ("1", "sell stop", "sell limit", "sell_stop", "sell_limit"):
        return "sell"
    return None


def _replace_run_trades(client, run_id: str, trades: Optional[list]) -> None:
    """Replace the mt5_tester_trades rows for a run with the bridge's parsed list.

    Idempotent: each completion poll deletes any prior rows for the run and
    re-inserts the current set. The bridge passes through the XML parser
    output 1:1; we map each dict to the column set defined in the
    20260430_mt5_tester_runs migration and skip rows whose required
    `open_time` is missing (e.g. summary rows the parser couldn't classify).
    """
    if not trades:
        return

    rows: list[dict] = []
    for raw in trades:
        if not isinstance(raw, dict):
            continue
        open_time = _normalise_mt5_timestamp(raw.get("open_time"))
        if not open_time:
            # `open_time` is NOT NULL in the schema — skip rather than fail.
            continue
        rows.append(
            {
                "run_id": run_id,
                "open_time": open_time,
                "close_time": _normalise_mt5_timestamp(raw.get("close_time")),
                "direction": _normalise_direction(raw.get("direction")),
                "volume": raw.get("volume"),
                "open_price": raw.get("open_price"),
                "close_price": raw.get("close_price"),
                "profit": raw.get("profit"),
                "comment": raw.get("comment"),
            }
        )

    if not rows:
        return

    try:
        # Replace, don't append: re-polling a 'done' run must not duplicate.
        client.table("mt5_tester_trades").delete().eq("run_id", run_id).execute()
        client.table("mt5_tester_trades").insert(rows).execute()
    except Exception as exc:
        logger.exception("Failed to persist trades for run %s: %s", run_id, exc)


@app.get("/mt5/health", response_model=MT5HealthResponse)
async def mt5_health(token: dict = Depends(verify_jwt)):
    """Proxy the bridge's /mt5/health, cached for 10s."""
    import time as _time

    now = _time.monotonic()
    if _MT5_HEALTH_CACHE["value"] is not None and now < _MT5_HEALTH_CACHE["expires_at"]:
        return _MT5_HEALTH_CACHE["value"]

    try:
        body = await mt5_bridge_client.health()
        result = MT5HealthResponse(
            online=True,
            status=body.get("status"),
            terminal_logged_in=body.get("terminal_logged_in"),
            broker=body.get("broker"),
            build=body.get("build"),
            queue_length=body.get("queue_length"),
            current_run=body.get("current_run"),
            last_started_at=body.get("last_started_at"),
        )
        # Bridge-restart auto-detection (PROJ-37 fast-path orphan cleanup).
        # Fires only on cache-miss + successful health response — i.e. event-
        # driven from the actual bridge probe, never on cache hits.
        _maybe_handle_bridge_restart(body.get("last_started_at"))
    except BridgeConfigError as exc:
        result = MT5HealthResponse(online=False, error=str(exc))
    except (BridgeAuthError, BridgeOfflineError, BridgeError) as exc:
        result = MT5HealthResponse(online=False, error=str(exc))

    _MT5_HEALTH_CACHE["value"] = result
    _MT5_HEALTH_CACHE["expires_at"] = now + _MT5_HEALTH_TTL_SECONDS
    return result


@app.get("/mt5/tester/pending-jobs")
async def mt5_pending_jobs(token: dict = Depends(verify_jwt)):
    """Return all `pending` / `queued` runs the bridge should seed into its FIFO on boot.

    The bridge calls this on startup with either a user JWT (`role=authenticated`)
    or a Supabase service-role JWT (`role=service_role`). For user JWTs the
    response is scoped to that user's pending runs; for service-role tokens
    (single-admin bridge setup) the user filter is dropped.
    """
    client = _supabase_for_user_token()

    query = (
        client.table("mt5_tester_runs")
        .select(
            "id, expert_name, symbol, timeframe, from_date, to_date, "
            "parameters, model, status, started_at"
        )
        .in_("status", ["pending", "queued"])
        .order("started_at")
        .limit(500)
    )
    if token.get("role") != "service_role":
        query = query.eq("user_id", token["sub"])

    resp = query.execute()
    return {"runs": resp.data or []}


@app.post("/mt5/orphan-cleanup")
async def mt5_orphan_cleanup(
    request: MT5OrphanCleanupRequest,
    token: dict = Depends(verify_jwt),
):
    """Bridge calls this on boot to flag in-flight runs lost in a host reboot.

    Two complementary triggers run the same underlying sweeper:
      • This explicit callback (when the bridge reaches the backend on boot).
      • The /mt5/health proxy (when it observes `last_started_at` change).
    Both paths converge on `cleanup_stale_runs` / `cleanup_orphans_after_bridge_restart`.
    The 5-min APScheduler sweep is the catch-all fallback if neither
    fast-path fires (e.g. a hard power loss where the bridge never reaches
    the backend afterwards).
    """
    is_service_role = token.get("role") == "service_role"
    user_id: str = token["sub"]

    if is_service_role:
        scope_user = request.user_id  # may be None → cleanup_stale_runs sweeps all users
    else:
        scope_user = request.user_id or user_id
        if scope_user != user_id and (token.get("app_metadata", {}) or {}).get("role") != "admin":
            raise HTTPException(status_code=403, detail="Cannot clean up other users' runs.")

    cleared = await cleanup_stale_runs(scope_user_id=scope_user)
    return {"cleared": cleared}


# ── PROJ-40: MT5 EA Auto-Deploy ────────────────────────────────────────────

# Strict EA-name validation (defence in depth — frontend coerces whitespace,
# backend strictly rejects). Also enforced by a Postgres CHECK constraint.
_EA_NAME_RE = re.compile(r"^[A-Za-z0-9_\-]+$")
# 2 MB ceiling on rendered .mq5 content. The bridge applies its own ceiling
# (5 MB per the spec) — ours is tighter so the API rejects oversized payloads
# before they cross the network.
_MAX_MQ5_BYTES: int = 2_000_000

# MQL5 OnTester() hook injected into mt5_hub EAs that don't already have one.
# The input variable is appended at file scope; MQL5 allows global declarations
# anywhere in the file so this is safe even when placed at the end.
_TESTER_HOOK_MQL5 = r"""
//+------------------------------------------------------------------+
//| Bridge reporting hook — injected automatically by the MT5 Hub.   |
//| Do not edit; this block is overwritten on each deploy.           |
//+------------------------------------------------------------------+
input string report_uuid = "";   // set by bridge via [TesterInputs]

double OnTester()
{
   if(StringLen(report_uuid) == 0) return 0.0;
   double net_profit   = TesterStatistics(STAT_PROFIT);
   double gross_profit = TesterStatistics(STAT_GROSS_PROFIT);
   double gross_loss   = TesterStatistics(STAT_GROSS_LOSS);
   double dd_abs       = TesterStatistics(STAT_BALANCE_DD);
   double dd_pct       = TesterStatistics(STAT_BALANCEDD_PERCENT);
   double sharpe       = TesterStatistics(STAT_SHARPE_RATIO);
   double pf           = TesterStatistics(STAT_PROFIT_FACTOR);
   double ep           = TesterStatistics(STAT_EXPECTED_PAYOFF);
   double rf           = TesterStatistics(STAT_RECOVERY_FACTOR);
   int total_trades    = (int)TesterStatistics(STAT_TRADES);
   int won_trades      = (int)TesterStatistics(STAT_PROFIT_TRADES);
   int lost_trades     = (int)TesterStatistics(STAT_LOSS_TRADES);
   HistorySelect(0, TimeCurrent());
   int deal_count = HistoryDealsTotal();
   string trades_json = "[";
   bool first_trade = true;
   for(int i = 0; i < deal_count; i++)
   {
      ulong ticket = HistoryDealGetTicket(i);
      if(ticket == 0) continue;
      long deal_type = HistoryDealGetInteger(ticket, DEAL_TYPE);
      if(deal_type != DEAL_TYPE_BUY && deal_type != DEAL_TYPE_SELL) continue;
      datetime open_time = (datetime)HistoryDealGetInteger(ticket, DEAL_TIME);
      double   volume    = HistoryDealGetDouble(ticket, DEAL_VOLUME);
      double   price     = HistoryDealGetDouble(ticket, DEAL_PRICE);
      double   profit    = HistoryDealGetDouble(ticket, DEAL_PROFIT);
      string   comment   = HistoryDealGetString(ticket, DEAL_COMMENT);
      string   direction = (deal_type == DEAL_TYPE_BUY) ? "buy" : "sell";
      if(!first_trade) trades_json += ",";
      first_trade = false;
      trades_json += StringFormat(
         "{\"ticket\":%llu,\"open_time\":\"%s\",\"close_time\":\"%s\","
         "\"direction\":\"%s\",\"volume\":%.5f,\"open_price\":%.5f,"
         "\"close_price\":%.5f,\"profit\":%.2f,\"comment\":\"%s\"}",
         ticket,
         TimeToString(open_time, TIME_DATE|TIME_SECONDS),
         TimeToString(open_time, TIME_DATE|TIME_SECONDS),
         direction, volume, price, price, profit, comment);
   }
   trades_json += "]";
   string json = StringFormat(
      "{\"schema_version\":1,\"job_uuid\":\"%s\",\"ea_name\":\"%s\","
      "\"symbol\":\"%s\",\"timeframe\":\"%s\",\"generated_at\":\"%s\","
      "\"metrics\":{"
         "\"total_net_profit\":%.2f,\"gross_profit\":%.2f,\"gross_loss\":%.2f,"
         "\"max_drawdown_abs\":%.2f,\"max_drawdown_pct\":%.4f,"
         "\"sharpe_ratio\":%.4f,\"profit_factor\":%.4f,\"expected_payoff\":%.4f,"
         "\"recovery_factor\":%.4f,\"total_trades\":%d,"
         "\"won_trades\":%d,\"lost_trades\":%d"
      "},\"trades\":%s}",
      report_uuid, MQLInfoString(MQL_PROGRAM_NAME), Symbol(),
      EnumToString(Period()), TimeToString(TimeGMT(), TIME_DATE|TIME_SECONDS),
      net_profit, gross_profit, gross_loss, dd_abs, dd_pct,
      sharpe, pf, ep, rf, total_trades, won_trades, lost_trades, trades_json);
   string filename = "bridge_report_" + report_uuid + ".json";
   int fh = FileOpen(filename, FILE_WRITE|FILE_COMMON|FILE_TXT|FILE_ANSI);
   if(fh == INVALID_HANDLE) { Print("[Bridge] OnTester: failed to open ", filename); return 0.0; }
   FileWriteString(fh, json);
   FileClose(fh);
   Print("[Bridge] OnTester: wrote ", filename);
   return 0.0;
}
"""


def _inject_tester_hook(mq5_content: str) -> str:
    """Append the bridge OnTester() hook if the EA doesn't already have one."""
    if "OnTester" in mq5_content:
        return mq5_content
    return mq5_content.rstrip() + "\n" + _TESTER_HOOK_MQL5


class EaDeployParameter(BaseModel):
    """One parameter override sent by the optimizer flow.

    `current_value` is a heterogeneous union — JSON `true` / `false` MUST
    deserialize to Python `bool`, not be coerced into `1.0` / `0.0` by smart
    union resolution. Pydantic v2 picks the first union member that fully
    accepts the input under strict-mode rules, so `bool` is listed first.
    `_format_value` in `mql_param_replace` is also defensive against
    non-bool values arriving on a `boolean` field.
    """
    mql_input_name: str = Field(min_length=1, max_length=128)
    current_value: Union[bool, int, float, str]
    type: Literal["number", "integer", "string", "boolean"]


class EaDeployRequest(BaseModel):
    """Payload for POST /mt5/ea/deploy.

    Two flows:
    1. **MQL Converter flow** — `mq5_content` is sent ready-to-use. The
       backend forwards it verbatim to the bridge. `parameters` is ignored.
    2. **MT5 Optimizer flow (PROJ-38)** — `mql_conversion_id` + `parameters`
       is sent. The backend loads the saved MQL source, applies the parameter
       overrides via `mql_param_replace.render_ea`, and ships the result.
    """
    ea_name: str = Field(min_length=1, max_length=64)
    source: Literal["mql_converter", "mt5_optimizer", "mt5_hub"]
    mq5_content: Optional[str] = Field(default=None, max_length=_MAX_MQ5_BYTES)
    mql_conversion_id: Optional[str] = None
    optimizer_run_id: Optional[str] = None
    optimizer_result_rank: Optional[int] = None
    parameters: Optional[List[EaDeployParameter]] = None
    # Echoed into the rendered comment header for the optimizer flow.
    symbol: Optional[str] = None
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    conversion_name: Optional[str] = None

    @field_validator("ea_name")
    @classmethod
    def _validate_ea_name(cls, v: str) -> str:
        if not _EA_NAME_RE.match(v):
            raise ValueError(
                "ea_name must match ^[A-Za-z0-9_\\-]+$ (no spaces or special chars)"
            )
        return v


class EaDeployResponse(BaseModel):
    deployment_id: str
    status: Literal["compiled", "compile_error", "timeout", "failed"]
    ea_name: str
    errors: Optional[List[str]] = None
    warnings: Optional[List[str]] = None
    log_excerpt: Optional[str] = None
    error_message: Optional[str] = None


@app.post("/mt5/ea/deploy", response_model=EaDeployResponse)
async def mt5_ea_deploy(
    request: EaDeployRequest,
    token: dict = Depends(verify_jwt),
):
    """Persist a deploy row, render .mq5 if needed, then proxy to the bridge.

    Order of operations:
    1. Validate the request shape + EA-name regex (Pydantic).
    2. Resolve mq5_content:
         • mql_converter flow → use the request's `mq5_content` directly.
         • mt5_optimizer flow → load saved MQL source from `mql_conversions`,
           apply parameter overrides via `render_ea`. 404 on missing conversion.
    3. Insert a `mt5_ea_deployments` row with status=`pending`.
    4. POST to bridge. Map bridge response back to one of:
         compiled / compile_error / failed (timeout, offline, write error).
    5. Update the row with the final state and return.

    The .mq5 content is *never* logged.
    """
    user_id: str = token["sub"]
    client = _supabase_for_user_token()

    # ── Resolve mq5_content ────────────────────────────────────────────
    mq5_content: Optional[str] = None

    if request.source in ("mql_converter", "mt5_hub"):
        # mql_converter: frontend rendered via PROJ-33 export path.
        # mt5_hub: user pasted or uploaded code directly in the MT5 Hub Tester.
        if not request.mq5_content:
            raise HTTPException(
                status_code=400,
                detail="mq5_content is required for this flow.",
            )
        mq5_content = request.mq5_content
        if request.source == "mt5_hub":
            mq5_content = _inject_tester_hook(mq5_content)

    elif request.source == "mt5_optimizer":
        # Backend renders by re-applying parameters to the saved EA source.
        # PROJ-38 has not shipped yet — the endpoint accepts the request shape
        # so the contract is stable, but resolution requires the user to have
        # a matching mql_conversion_id we can render from.
        if not request.mql_conversion_id:
            raise HTTPException(
                status_code=400,
                detail="mql_conversion_id is required for the mt5_optimizer flow.",
            )
        if not request.parameters:
            raise HTTPException(
                status_code=400,
                detail="parameters[] is required for the mt5_optimizer flow.",
            )

        try:
            conv_resp = (
                client.table("mql_conversions")
                .select("id, user_id, name, mql_code")
                .eq("id", request.mql_conversion_id)
                .limit(1)
                .execute()
            )
        except Exception as exc:
            logger.exception("Failed to load mql_conversions row: %s", exc)
            raise HTTPException(status_code=500, detail="Failed to load saved EA source.")

        if not conv_resp.data:
            # Spec edge case: "Optimizer run no longer has the original EA code".
            raise HTTPException(
                status_code=404,
                detail="Original EA code no longer available — please re-upload.",
            )
        conv = conv_resp.data[0]
        if conv["user_id"] != user_id:
            raise HTTPException(status_code=403, detail="Not your EA source.")

        params = [
            MqlParameter(
                mql_input_name=p.mql_input_name,
                current_value=p.current_value,
                type=p.type,
            )
            for p in (request.parameters or [])
        ]
        rendered, _replacement = render_ea(
            mql_code=conv["mql_code"],
            parameters=params,
            conversion_name=request.conversion_name or conv.get("name"),
            symbol=request.symbol or "Unknown",
            date_from=request.date_from or "",
            date_to=request.date_to or "",
            source="MT5 Optimizer",
        )
        mq5_content = rendered

    if mq5_content is None or len(mq5_content) == 0:
        raise HTTPException(status_code=400, detail="Empty mq5_content after render.")
    if len(mq5_content.encode("utf-8")) > _MAX_MQ5_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"mq5_content exceeds {_MAX_MQ5_BYTES} bytes after render.",
        )

    # ── Insert pending row ─────────────────────────────────────────────
    try:
        insert_resp = (
            client.table("mt5_ea_deployments")
            .insert(
                {
                    "user_id": user_id,
                    "ea_name": request.ea_name,
                    "source": request.source,
                    "mql_conversion_id": request.mql_conversion_id,
                    "optimizer_run_id": request.optimizer_run_id,
                    "optimizer_result_rank": request.optimizer_result_rank,
                    "status": "pending",
                }
            )
            .execute()
        )
    except Exception as exc:
        logger.exception("Failed to persist mt5_ea_deployments row: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to record deploy.")

    if not insert_resp.data:
        raise HTTPException(status_code=500, detail="Insert returned no row.")
    deployment_id: str = insert_resp.data[0]["id"]

    # ── Forward to bridge ──────────────────────────────────────────────
    bridge_payload = {
        "ea_name": request.ea_name,
        "mq5_content": mq5_content,
    }

    try:
        bridge_resp = await mt5_bridge_client.deploy_ea(bridge_payload)
    except BridgeConfigError as exc:
        _finalize_deploy(client, deployment_id, status="failed", error=str(exc))
        raise HTTPException(status_code=503, detail=str(exc))
    except BridgeAuthError as exc:
        _finalize_deploy(client, deployment_id, status="failed", error=str(exc))
        raise HTTPException(status_code=502, detail=str(exc))
    except BridgeOfflineError as exc:
        _finalize_deploy(
            client,
            deployment_id,
            status="failed",
            error=f"Bridge Worker offline: {exc}",
        )
        raise HTTPException(status_code=502, detail=f"Bridge Worker offline: {exc}")
    except BridgeError as exc:
        _finalize_deploy(client, deployment_id, status="failed", error=str(exc))
        raise HTTPException(status_code=502, detail=str(exc))

    bridge_status = bridge_resp.get("status")

    if bridge_status == "compiled":
        warnings_list = bridge_resp.get("warnings") or []
        log_excerpt = bridge_resp.get("log_excerpt")
        _finalize_deploy(
            client,
            deployment_id,
            status="compiled",
            warnings=warnings_list,
            log_excerpt=log_excerpt,
        )
        return EaDeployResponse(
            deployment_id=deployment_id,
            status="compiled",
            ea_name=request.ea_name,
            warnings=warnings_list,
            log_excerpt=log_excerpt,
        )

    if bridge_status == "compile_error":
        errors_list = bridge_resp.get("errors") or []
        log_excerpt = bridge_resp.get("log_excerpt")
        # Persist a short summary in error_message; the full list lives in
        # the dedicated `errors` JSONB column (split from `warnings` so each
        # column carries exactly one type of payload).
        summary = "; ".join(errors_list[:3]) if errors_list else "Compile failed"
        _finalize_deploy(
            client,
            deployment_id,
            status="compile_error",
            error=summary,
            errors=errors_list,
            log_excerpt=log_excerpt,
        )
        return EaDeployResponse(
            deployment_id=deployment_id,
            status="compile_error",
            ea_name=request.ea_name,
            errors=errors_list,
            log_excerpt=log_excerpt,
            error_message=summary,
        )

    if bridge_status == "timeout":
        # Persist `timeout` directly so the history row can distinguish
        # "compile took too long, .mq5 was written, can be compiled manually"
        # from a generic transport `failed`.
        msg = bridge_resp.get("error") or "MetaEditor compile timed out."
        _finalize_deploy(client, deployment_id, status="timeout", error=msg)
        return EaDeployResponse(
            deployment_id=deployment_id,
            status="timeout",
            ea_name=request.ea_name,
            error_message=msg,
        )

    # Unknown status — treat as failure but surface what we got.
    msg = f"Unexpected bridge status: {bridge_status!r}"
    _finalize_deploy(client, deployment_id, status="failed", error=msg)
    return EaDeployResponse(
        deployment_id=deployment_id,
        status="failed",
        ea_name=request.ea_name,
        error_message=msg,
    )


def _finalize_deploy(
    client,
    deployment_id: str,
    *,
    status: str,
    error: Optional[str] = None,
    warnings: Optional[list] = None,
    errors: Optional[list] = None,
    log_excerpt: Optional[str] = None,
) -> None:
    """Update the deployment row's terminal state. Logs but never raises."""
    payload: dict = {"status": status}
    if error is not None:
        payload["error_message"] = error
    if warnings is not None:
        payload["warnings"] = warnings
    if errors is not None:
        payload["errors"] = errors
    if log_excerpt is not None:
        payload["log_excerpt"] = log_excerpt
    try:
        client.table("mt5_ea_deployments").update(payload).eq(
            "id", deployment_id
        ).execute()
    except Exception as exc:
        logger.exception(
            "Failed to update mt5_ea_deployments %s: %s", deployment_id, exc
        )


@app.get("/mt5/ea/list")
async def mt5_ea_list(_: dict = Depends(verify_jwt)):
    """Return compiled EA names (.ex5) from the MT5 Experts folder."""
    try:
        eas = await mt5_bridge_client.list_eas()
        return {"eas": eas}
    except Exception:
        return {"eas": []}


@app.get("/mt5/ea/source/{ea_name}")
async def mt5_ea_source(ea_name: str, _: dict = Depends(verify_jwt)):
    """Return the .mq5 source for a compiled EA, or {"found": false} if absent."""
    try:
        result = await mt5_bridge_client.get_ea_source(ea_name)
        return result
    except Exception:
        return {"found": False}


@app.get("/mt5/ea/deployments")
async def mt5_ea_deployments_list(
    limit: int = 20,
    offset: int = 0,
    token: dict = Depends(verify_jwt),
):
    """Paginated history of the calling user's EA deploys (newest first).

    Pagination is offset-based to match the existing PROJ-9 history shape.
    `limit` is hard-capped at 100 to avoid accidentally pulling thousands of
    rows from the UI.
    """
    if limit < 1 or limit > 100:
        raise HTTPException(status_code=400, detail="limit must be in [1, 100]")
    if offset < 0:
        raise HTTPException(status_code=400, detail="offset must be >= 0")

    user_id: str = token["sub"]
    client = _supabase_for_user_token()

    try:
        resp = (
            client.table("mt5_ea_deployments")
            .select(
                "id, ea_name, source, mql_conversion_id, optimizer_run_id, "
                "optimizer_result_rank, status, error_message, warnings, "
                "errors, log_excerpt, deployed_at",
                count="exact",
            )
            .eq("user_id", user_id)
            .order("deployed_at", desc=True)
            .range(offset, offset + limit - 1)
            .execute()
        )
    except Exception as exc:
        logger.exception("Failed to load mt5_ea_deployments: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to load deployments.")

    return {
        "deployments": resp.data or [],
        "total": resp.count if resp.count is not None else len(resp.data or []),
        "limit": limit,
        "offset": offset,
    }


# ── /notifications/test endpoint (PROJ-37) ─────────────────────────────────

@app.post("/notifications/test")
async def notifications_test(token: dict = Depends(verify_jwt)):
    """Send a test Telegram message to the calling user.

    Surfaces a precise reason whenever delivery was skipped (Telegram disabled,
    no token / chat ID, no settings row) or rejected by Telegram (invalid
    token, blocked chat, rate-limited). The Settings UI keys off
    `sent` (boolean) and `error` (user-facing string) to render an honest
    "Test failed" toast — fixing BUG-2 (test reported success even when
    delivery was skipped or failed).

    Skip reasons are determined locally before calling `send_telegram` so we
    never have to ask the persisted `last_notification_error` "did this most
    recent send fail?" — a noisy question across concurrent attempts. Real
    Telegram-API rejections are read from `user_settings.last_notification_error`
    after the send, which `send_telegram` writes synchronously.
    """
    from services.cache_service import _get_supabase_client

    user_id: str = token["sub"]
    client = _get_supabase_client()

    # Inspect settings up-front so we can return a precise skip reason.
    settings_resp = (
        client.table("user_settings")
        .select(
            "telegram_enabled, telegram_bot_token, telegram_chat_id"
        )
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    settings_row = settings_resp.data[0] if settings_resp.data else None

    if not settings_row:
        return JSONResponse(
            status_code=400,
            content={
                "sent": False,
                "error": "No notification settings configured. Save your Telegram bot token and chat ID first.",
            },
        )
    if not settings_row.get("telegram_enabled"):
        return JSONResponse(
            status_code=400,
            content={
                "sent": False,
                "error": "Telegram is disabled. Toggle it on and save before testing.",
            },
        )
    if not settings_row.get("telegram_bot_token") or not settings_row.get("telegram_chat_id"):
        return JSONResponse(
            status_code=400,
            content={
                "sent": False,
                "error": "Bot token and chat ID are both required. Fill them in and save before testing.",
            },
        )

    sent = await send_telegram(
        user_id=user_id,
        message="Test message from MT5 Backtester. If you see this, your Telegram bridge is configured.",
        run_type="single_run",
        force=True,
    )
    if sent:
        return {"sent": True, "message": "Test message delivered to Telegram."}

    # send_telegram returned False after passing pre-flight gates → either
    # rate-limited or Telegram itself rejected the request. The actual reason
    # has just been persisted to user_settings.last_notification_error.
    err_resp = (
        client.table("user_settings")
        .select("last_notification_error")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    persisted_error: Optional[str] = None
    if err_resp.data:
        persisted_error = err_resp.data[0].get("last_notification_error")

    return JSONResponse(
        status_code=502,
        content={
            "sent": False,
            "error": persisted_error
            or "Telegram delivery failed. Check the Notifications card for the latest error.",
        },
    )


# ── /sandbox/run endpoint (PROJ-22: MQL Converter) ──────────────────────────

_SANDBOX_ALLOWED_IMPORTS = {"pandas", "pandas_ta", "numpy"}

_SANDBOX_RUN_SCRIPT = """\
import sys, importlib.util, inspect, json
import pandas as pd

strategy_path = sys.argv[1]
df_path = sys.argv[2]
output_path = sys.argv[3]
project_root = sys.argv[4]
params = json.loads(sys.argv[5]) if len(sys.argv) > 5 else {}

# BUG-12: Remove os/subprocess attributes exposed via allowed modules
import numpy as _np
import pandas as _pd
for _m in (_np, _pd):
    for _attr in ("os", "subprocess"):
        try:
            delattr(_m, _attr)
        except AttributeError:
            pass

# BUG-13: Import project dependency, then remove project root from sys.path
# so user code cannot import other internal project modules
sys.path.insert(0, project_root)
from strategies.base import BaseStrategy
sys.path.remove(project_root)

# BUG-11: Block network access at Python level.
# Must happen AFTER BaseStrategy import: pydantic's import chain reaches ssl.py
# which does `class SSLSocket(socket):` — patching socket.socket beforehand
# replaces the class with a plain function and causes a TypeError.
import socket as _socket
def _sandbox_no_network(*args, **kwargs):
    raise RuntimeError("Network access is not allowed in sandbox")
_socket.socket = _sandbox_no_network
_socket.create_connection = _sandbox_no_network
_socket.getaddrinfo = _sandbox_no_network

df = pd.read_parquet(df_path)

spec = importlib.util.spec_from_file_location("_user_sandbox_strategy", strategy_path)
mod = importlib.util.module_from_spec(spec)
mod.BaseStrategy = BaseStrategy  # inject into module namespace so user class definition resolves
spec.loader.exec_module(mod)

strategy_cls = None
for name, obj in inspect.getmembers(mod, inspect.isclass):
    if issubclass(obj, BaseStrategy) and obj is not BaseStrategy:
        strategy_cls = obj
        break

if strategy_cls is None:
    print("ERROR: No BaseStrategy subclass found.", file=sys.stderr)
    sys.exit(1)

strategy = strategy_cls()
signals_df, _ = strategy.generate_signals(df, params)
signals_df.to_parquet(output_path)
"""

_SANDBOX_VALIDATE_SCRIPT = """\
import sys, importlib.util, inspect
sys.path.insert(0, sys.argv[2])  # project root so strategies.base is importable
from strategies.base import BaseStrategy
sys.path.remove(sys.argv[2])  # BUG-13: prevent user code from accessing project modules
spec = importlib.util.spec_from_file_location("_user_strategy_validate", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
mod.BaseStrategy = BaseStrategy  # inject into module namespace so user class definition resolves
spec.loader.exec_module(mod)
found_name = None
for name, obj in inspect.getmembers(mod, inspect.isclass):
    if issubclass(obj, BaseStrategy) and obj is not BaseStrategy:
        found_name = name
        break
if not found_name:
    print("ERROR: No BaseStrategy subclass found.", file=sys.stderr)
    sys.exit(1)
print("OK:" + found_name)
"""


_SANDBOX_BLOCKED_NAMES = {"__import__", "exec", "eval", "compile", "__builtins__", "open"}


def _check_sandbox_imports(code: str) -> None:
    """Raise HTTPException if the code contains any non-whitelisted imports or dangerous builtins."""
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        raise HTTPException(
            status_code=422,
            detail={"error": f"Syntax error in Python code: {e}"},
        )
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                top = alias.name.split(".")[0]
                if top not in _SANDBOX_ALLOWED_IMPORTS:
                    raise HTTPException(
                        status_code=422,
                        detail={"error": f"Import not allowed: '{alias.name}'. Only pandas, pandas_ta, and numpy are permitted."},
                    )
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                top = node.module.split(".")[0]
                if top not in _SANDBOX_ALLOWED_IMPORTS:
                    raise HTTPException(
                        status_code=422,
                        detail={"error": f"Import not allowed: 'from {node.module} import ...'. Only pandas, pandas_ta, and numpy are permitted."},
                    )
        elif isinstance(node, ast.Name):
            if node.id in _SANDBOX_BLOCKED_NAMES:
                raise HTTPException(
                    status_code=422,
                    detail={"error": f"Use of '{node.id}' is not allowed in sandbox code."},
                )


def _merge_strategy_params(
    user_params: dict[str, Union[float, str, bool]],
    instrument: "InstrumentConfigRequest",
) -> dict[str, Union[float, str, bool]]:
    """Inject instrument-derived values into the strategy params dict.

    The MQL→Python converter prompt instructs Claude to read pip_size via
    params.get("pip_size", 0.0001). Without injection the strategy falls back
    to the forex default (0.0001) and produces 100× too small SL/TP distances
    on instruments like XAUUSD (pip_size=0.01). Server-side keys win so user-
    supplied params cannot override them.
    """
    return {
        **user_params,
        "pip_size": instrument.pip_size,
        "pip_value_per_lot": instrument.pip_value_per_lot,
    }


class SandboxRunRequest(BaseModel):
    python_code: str = Field(min_length=1)
    config: BacktestConfigRequest
    params: dict[str, Union[float, str, bool]] = Field(default_factory=dict)
    # MQL Converter always runs against MT5 broker data — query mt5_candles
    # directly by date range instead of resolving a single Dukascopy chunk.
    symbol: str = Field(min_length=1)
    timeframe: str = Field(min_length=1)
    date_from: date
    date_to: date
    # Legacy: kept optional so old clients (if any) don't break. Not used when
    # mt5_mode=True (the only path the MQL Converter takes).
    cache_id: Optional[str] = None


@app.post("/sandbox/run", response_model=BacktestOrchestrationResponse)
async def sandbox_run(
    request: SandboxRunRequest,
    token: dict = Depends(verify_jwt),
):
    """
    Validate and run a user-provided Python strategy (PROJ-22 MQL Converter).

    Safety layers:
    1. AST import whitelist (only pandas, pandas_ta, numpy allowed)
    2. Subprocess validation with 30s timeout (syntax + BaseStrategy subclass check)
    3. generate_signals() run in a thread with 60s timeout
    """
    user_id: str = token["sub"]

    if not _check_backtest_rate_limit(user_id):
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded: max 30 sandbox requests per minute.",
        )

    python_code = request.python_code
    project_root = str(Path(__file__).parent)

    # ── 1. AST import whitelist check ───────────────────────────────────────
    _check_sandbox_imports(python_code)

    # ── 2. Subprocess validation ────────────────────────────────────────────
    code_tmp = None
    validate_tmp = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False, encoding="utf-8") as f:
            f.write(python_code)
            code_tmp = f.name

        with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False, encoding="utf-8") as f:
            f.write(_SANDBOX_VALIDATE_SCRIPT)
            validate_tmp = f.name

        result = subprocess.run(
            [sys.executable, validate_tmp, code_tmp, project_root],
            capture_output=True,
            text=True,
            timeout=30,
        )

        if result.returncode != 0:
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "Strategy validation failed",
                    "traceback": (result.stderr or result.stdout).strip(),
                },
            )

    except subprocess.TimeoutExpired:
        raise HTTPException(
            status_code=422,
            detail={"error": "Strategy validation timed out (30s). The code may contain an infinite loop."},
        )
    finally:
        for p in (code_tmp, validate_tmp):
            if p:
                try:
                    os.unlink(p)
                except Exception:
                    pass

    # ── 3. Load OHLCV ───────────────────────────────────────────────────────
    # MQL Converter path: mt5_mode is always True → query mt5_candles directly
    # by date range (covers all months in [date_from, date_to]).
    symbol = request.symbol.upper()
    _validate_date_range(request.date_from, request.date_to)

    if request.config.mt5_mode:
        try:
            df = _load_mt5_data(
                symbol=symbol,
                timeframe=request.timeframe,
                date_from=request.date_from,
                date_to=request.date_to,
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"MT5 data load error for sandbox {symbol}: {e}", exc_info=True)
            raise HTTPException(status_code=502, detail="Failed to load MT5 data.")
    else:
        # Legacy Dukascopy cache_id path (unused by current UI but kept for compat).
        if not request.cache_id:
            raise HTTPException(
                status_code=400,
                detail="cache_id is required when mt5_mode is false.",
            )
        from services.cache_service import _get_supabase_client

        try:
            client = _get_supabase_client()
            resp = (
                client.table("data_cache")
                .select("file_path, symbol")
                .eq("id", request.cache_id)
                .eq("created_by", user_id)
                .single()
                .execute()
            )
        except Exception as e:
            logger.error(f"Supabase lookup failed for sandbox cache_id={request.cache_id}: {e}")
            raise HTTPException(status_code=502, detail="Failed to query data cache.")

        if not resp.data:
            raise HTTPException(status_code=404, detail=f"cache_id '{request.cache_id}' not found.")

        file_path: str = resp.data["file_path"]

        try:
            df = load_cached_data(file_path)
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail=f"Parquet file for cache_id '{request.cache_id}' not found.")
        except Exception as e:
            logger.error(f"Parquet load error (sandbox): {e}", exc_info=True)
            raise HTTPException(status_code=500, detail="Failed to load data.")

    if "datetime" in df.columns:
        df = df.set_index("datetime")
    df.index = pd.to_datetime(df.index, utc=True)
    df.columns = [c.lower() for c in df.columns]

    required_cols = {"open", "high", "low", "close"}
    if not required_cols.issubset(set(df.columns)):
        raise HTTPException(
            status_code=400,
            detail=f"Cached data is missing required columns: {required_cols - set(df.columns)}",
        )

    # ── 4. Run user strategy in isolated subprocess ───────────────────────────
    code_tmp2 = None
    df_tmp = None
    signals_tmp = None
    run_script_tmp = None
    signals_df = None

    try:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False, encoding="utf-8") as f:
            f.write(python_code)
            code_tmp2 = f.name

        with tempfile.NamedTemporaryFile(suffix=".parquet", delete=False) as f:
            df_tmp = f.name
        df.to_parquet(df_tmp)

        with tempfile.NamedTemporaryFile(suffix=".parquet", delete=False) as f:
            signals_tmp = f.name

        with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False, encoding="utf-8") as f:
            f.write(_SANDBOX_RUN_SCRIPT)
            run_script_tmp = f.name

        merged_params = _merge_strategy_params(request.params, request.config.instrument)

        try:
            result = subprocess.run(
                [sys.executable, run_script_tmp, code_tmp2, df_tmp, signals_tmp, project_root,
                 json.dumps(merged_params)],
                capture_output=True,
                text=True,
                timeout=60,
            )
        except subprocess.TimeoutExpired:
            raise HTTPException(
                status_code=422,
                detail={"error": "Strategy execution timed out (60s). The strategy may contain an infinite loop."},
            )

        if result.returncode != 0:
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "Strategy execution failed",
                    "traceback": (result.stderr or result.stdout).strip(),
                },
            )

        try:
            signals_df = pd.read_parquet(signals_tmp)
        except Exception as e:
            raise HTTPException(
                status_code=422,
                detail={"error": f"Failed to read strategy output: {e}"},
            )

    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=422,
            detail={"error": "Failed to run strategy", "traceback": _traceback.format_exc()},
        )
    finally:
        for p in (code_tmp2, df_tmp, signals_tmp, run_script_tmp):
            if p:
                try:
                    os.unlink(p)
                except Exception:
                    pass

    # Validate signals_df shape
    required_signal_cols = {"long_entry", "long_sl", "long_tp", "short_entry", "short_sl", "short_tp"}
    if not required_signal_cols.issubset(set(signals_df.columns)):
        raise HTTPException(
            status_code=422,
            detail={"error": f"Strategy returned signals missing required columns: {required_signal_cols - set(signals_df.columns)}"},
        )
    if "signal_expiry" not in signals_df.columns:
        signals_df["signal_expiry"] = pd.NaT

    # ── 5. Run backtest ──────────────────────────────────────────────────────
    cfg = request.config
    engine_config = BacktestConfig(
        initial_balance=cfg.initial_balance,
        sizing_mode=cfg.sizing_mode,
        instrument=InstrumentConfig(
            pip_size=cfg.instrument.pip_size,
            pip_value_per_lot=cfg.instrument.pip_value_per_lot,
        ),
        fixed_lot=cfg.fixed_lot,
        risk_percent=cfg.risk_percent,
        commission_per_lot=cfg.commission_per_lot,
        slippage_pips=cfg.slippage_pips,
        time_exit=cfg.time_exit,
        timezone=cfg.timezone,
        trail_trigger_pips=cfg.trail_trigger_pips,
        trail_lock_pips=cfg.trail_lock_pips,
        gap_fill=cfg.gap_fill,
        price_type=cfg.price_type,
        mt5_mode=cfg.mt5_mode,
        spread_pips=cfg.spread_pips,
    )

    _bar_minutes = (
        int(round((df.index[1] - df.index[0]).total_seconds() / 60))
        if len(df) >= 2 else 1
    )

    try:
        # Sandbox runs always use 1-minute resolution (no 1s-zoom) to avoid
        # fetching tick data from Dukascopy for every trade, which would easily
        # exceed the 90s upstream timeout with a full-year dataset.
        backtest_result = run_backtest(df, signals_df, engine_config, get_1s_data=None)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Sandbox backtest engine error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal engine error.")

    # ── 6. Analytics ────────────────────────────────────────────────────────
    try:
        analytics_result = calculate_analytics(backtest_result)
    except Exception as e:
        logger.error(f"Sandbox analytics error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Analytics calculation failed.")

    # ── 7. Build BacktestOrchestrationResponse (same format as /backtest) ────
    # The frontend expects BacktestOrchestrationResponse (metrics, drawdown_curve,
    # skipped_days, monthly_r, symbol, timeframe). Using BacktestRunResponse caused
    # a client-side crash because 'metrics' was undefined.
    m = {metric.name: metric.value for metric in analytics_result.summary}

    def _f(v, default: float = 0.0) -> float:
        if v is None:
            return default
        try:
            f = float(v)
        except (TypeError, ValueError):
            return default
        return default if (f != f or f == float("inf")) else f

    cagr_val = _f(m.get("CAGR"))
    dd_val = _f(m.get("Max Drawdown"))
    calmar_val = round(cagr_val / abs(dd_val), 2) if dd_val != 0.0 else 0.0

    metrics_out = BacktestMetricsOut(
        total_return_pct=_f(m.get("Total Return")),
        cagr_pct=cagr_val,
        sharpe_ratio=_f(m.get("Sharpe Ratio")),
        sortino_ratio=_f(m.get("Sortino Ratio")),
        max_drawdown_pct=dd_val,
        calmar_ratio=calmar_val,
        longest_drawdown_days=_f(m.get("Max Drawdown Duration")),
        total_trades=int(m.get("Total Trades") or 0),
        winning_trades=int(m.get("Winning Trades") or 0),
        losing_trades=int(m.get("Losing Trades") or 0),
        win_rate_pct=_f(m.get("Win Rate")),
        gross_profit=_f(m.get("Gross Profit")),
        gross_loss=_f(m.get("Gross Loss")),
        gross_profit_pips=_f(m.get("Gross Profit (Pips)")),
        gross_loss_pips=_f(m.get("Gross Loss (Pips)")),
        avg_win=_f(m.get("Avg Win")),
        avg_loss=_f(m.get("Avg Loss")),
        avg_win_pips=_f(m.get("Avg Win (Pips)")),
        avg_loss_pips=_f(m.get("Avg Loss (Pips)")),
        avg_win_loss_ratio=_f(m.get("Avg Win / Avg Loss")),
        profit_factor=_f(m.get("Profit Factor (Pips)")),
        avg_r_multiple=_f(m.get("Avg R per Trade")),
        total_r=_f(m.get("Total R")),
        avg_r_per_month=_f(m.get("Avg R per Month")),
        expectancy_pips=_f(m.get("Expectancy (Pips)")),
        best_trade=_f(m.get("Best Trade")),
        worst_trade=_f(m.get("Worst Trade")),
        consecutive_wins=int(m.get("Consecutive Wins") or 0),
        consecutive_losses=int(m.get("Consecutive Losses") or 0),
        avg_trade_duration_hours=_f(m.get("Avg Trade Duration")),
        final_balance=backtest_result.final_balance,
        net_profit=m.get("Net Profit"),
        max_drawdown_abs=m.get("Max Drawdown Abs"),
        recovery_factor=m.get("Recovery Factor"),
        expected_payoff=m.get("Expected Payoff"),
        buy_trades=int(m.get("Buy Trades") or 0),
        buy_win_rate_pct=m.get("Buy Win Rate"),
        sell_trades=int(m.get("Sell Trades") or 0),
        sell_win_rate_pct=m.get("Sell Win Rate"),
        min_trade_duration_minutes=m.get("Min Trade Duration"),
        max_trade_duration_minutes=m.get("Max Trade Duration"),
        max_consec_wins_count=int(m.get("Max Consec Wins Count") or 0),
        max_consec_wins_profit=m.get("Max Consec Wins Profit"),
        max_consec_losses_count=int(m.get("Max Consec Losses Count") or 0),
        max_consec_losses_loss=m.get("Max Consec Losses Loss"),
        avg_consec_wins=m.get("Avg Consec Wins"),
        avg_consec_losses=m.get("Avg Consec Losses"),
        ahpr=m.get("AHPR"),
        ghpr=m.get("GHPR"),
        lr_correlation=m.get("LR Correlation"),
        lr_std_error=m.get("LR Standard Error"),
        z_score=m.get("Z-Score"),
        z_score_confidence_pct=m.get("Z-Score Confidence"),
    )

    equity_curve_out = [
        EquityCurveOut(date=pt["time"], balance=pt["balance"])
        for pt in backtest_result.equity_curve
    ]

    peak = backtest_result.initial_balance
    drawdown_curve_out: list[DrawdownCurveOut] = []
    for pt in backtest_result.equity_curve:
        bal = pt["balance"]
        if bal > peak:
            peak = bal
        dd_pct = round((bal - peak) / peak * 100, 4) if peak > 0 else 0.0
        drawdown_curve_out.append(DrawdownCurveOut(date=pt["time"], drawdown_pct=dd_pct))

    trades_detail_out: list[TradeDetailOut] = []
    for i, t in enumerate(backtest_result.trades):
        duration_minutes = int((t.exit_time - t.entry_time).total_seconds() / 60)
        direction_prefix = "long" if t.direction == "long" else "short"
        sl_col = f"{direction_prefix}_sl"
        tp_col = f"{direction_prefix}_tp"
        signal_before_entry = signals_df.loc[:t.entry_time, f"{direction_prefix}_entry"].dropna()
        if not signal_before_entry.empty:
            sig_ts = signal_before_entry.index[-1]
            stop_loss_val = float(signals_df.at[sig_ts, sl_col]) if pd.notna(signals_df.at[sig_ts, sl_col]) else 0.0
            take_profit_val = float(signals_df.at[sig_ts, tp_col]) if (tp_col in signals_df.columns and pd.notna(signals_df.at[sig_ts, tp_col])) else 0.0
        else:
            stop_loss_val = 0.0
            take_profit_val = 0.0
        trades_detail_out.append(TradeDetailOut(
            id=i + 1,
            entry_time=t.entry_time.isoformat(),
            exit_time=t.exit_time.isoformat(),
            direction=t.direction,
            entry_price=t.entry_price,
            exit_price=t.exit_price,
            lot_size=t.lot_size,
            pnl_pips=t.pnl_pips,
            pnl_currency=t.pnl_currency,
            r_multiple=_f(compute_r_multiple(t)),
            exit_reason=t.exit_reason,
            duration_minutes=duration_minutes,
            entry_gap_pips=t.entry_gap_pips,
            exit_gap=t.exit_gap,
            used_1s_resolution=t.used_1s_resolution,
            mae_pips=t.mae_pips,
            range_high=0.0,
            range_low=0.0,
            stop_loss=stop_loss_val,
            take_profit=take_profit_val,
        ))

    monthly_r_out = [
        MonthlyRResponse(
            month=mr.month,
            r_earned=mr.r_earned,
            trade_count=mr.trade_count,
            win_rate_pct=mr.win_rate_pct,
            avg_loss_pips=mr.avg_loss_pips,
            avg_mae_pips=mr.avg_mae_pips,
        )
        for mr in analytics_result.monthly_r
    ]

    _tf_map = {1: "1m", 2: "2m", 3: "3m", 5: "5m", 15: "15m", 30: "30m", 60: "1h", 240: "4h", 1440: "1d"}
    timeframe_str = _tf_map.get(_bar_minutes, f"{_bar_minutes}m")

    return BacktestOrchestrationResponse(
        metrics=metrics_out,
        equity_curve=equity_curve_out,
        drawdown_curve=drawdown_curve_out,
        trades=trades_detail_out,
        skipped_days=[],
        monthly_r=monthly_r_out,
        cache_id=request.cache_id,
        symbol=symbol,
        timeframe=timeframe_str,
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
