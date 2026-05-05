"""HTTP client for the MT5 Bridge Worker (PROJ-37).

The Bridge Worker is a separate FastAPI service running on a Windows host with
an installed MT5 Terminal. This module provides a thin client with retry logic,
configurable timeouts, and structured error translation.

Environment variables:
    MT5_BRIDGE_URL    — base URL of the bridge (e.g. https://bridge.example.com)
    MT5_BRIDGE_TOKEN  — shared secret sent in the X-Bridge-Token header
"""

from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)


# ── Configuration ───────────────────────────────────────────────────────────

MT5_BRIDGE_URL: str = os.environ.get("MT5_BRIDGE_URL", "").strip().rstrip("/")
MT5_BRIDGE_TOKEN: str = os.environ.get("MT5_BRIDGE_TOKEN", "").strip()
# Optional outbound proxy — set on Railway to the Tailscale userspace HTTP/SOCKS5
# proxy (e.g. http://localhost:1055) so bridge calls reach the Windows host
# through the tailnet without exposing the bridge to the public internet.
MT5_BRIDGE_PROXY: Optional[str] = (os.environ.get("TS_HTTP_PROXY") or "").strip() or None

# Per the spec: 60s for health checks, up to 1h for run submissions.
HEALTH_TIMEOUT_SECONDS: float = 60.0
RUN_TIMEOUT_SECONDS: float = 3600.0
DEFAULT_TIMEOUT_SECONDS: float = 30.0

DEFAULT_RETRY_COUNT: int = 3
RETRY_BACKOFF_BASE: float = 0.5  # seconds; doubled per attempt


class BridgeError(Exception):
    """Generic bridge failure (network, 5xx, timeout). Caller maps to 502/504."""


class BridgeAuthError(BridgeError):
    """Bridge returned 401 — translate to a clear token-mismatch message."""


class BridgeConfigError(BridgeError):
    """MT5_BRIDGE_URL or MT5_BRIDGE_TOKEN missing — caller maps to 503."""


class BridgeOfflineError(BridgeError):
    """Bridge unreachable — caller maps to 502 + UI offline state."""


@dataclass
class BridgeResponse:
    status_code: int
    json_body: Any


# ── Internal helpers ────────────────────────────────────────────────────────

def _ensure_configured() -> None:
    if not MT5_BRIDGE_URL or not MT5_BRIDGE_TOKEN:
        raise BridgeConfigError(
            "MT5_BRIDGE_URL and MT5_BRIDGE_TOKEN must be set in the environment."
        )


def _headers() -> dict:
    return {
        "X-Bridge-Token": MT5_BRIDGE_TOKEN,
        "Content-Type": "application/json",
    }


async def _request_with_retry(
    method: str,
    path: str,
    *,
    json_body: Optional[dict] = None,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
    retries: int = DEFAULT_RETRY_COUNT,
) -> BridgeResponse:
    """Perform an HTTP request with up to `retries` attempts.

    Translates 401 → BridgeAuthError, network/timeout → BridgeOfflineError,
    other 5xx → BridgeError after retries are exhausted.
    """
    _ensure_configured()

    url = f"{MT5_BRIDGE_URL}{path}"
    last_exc: Optional[Exception] = None

    client_kwargs: dict = {"timeout": timeout}
    if MT5_BRIDGE_PROXY:
        client_kwargs["proxy"] = MT5_BRIDGE_PROXY

    for attempt in range(retries):
        try:
            async with httpx.AsyncClient(**client_kwargs) as client:
                resp = await client.request(
                    method, url, json=json_body, headers=_headers()
                )

            # 401 is non-retryable — token mismatch must be surfaced immediately.
            if resp.status_code == 401:
                raise BridgeAuthError(
                    "Bridge authentication failed — check BRIDGE_TOKEN env on both sides."
                )

            # 4xx non-401: surface the JSON error to the caller without retrying.
            if 400 <= resp.status_code < 500:
                try:
                    body = resp.json()
                except Exception:
                    body = {"error": resp.text}
                return BridgeResponse(status_code=resp.status_code, json_body=body)

            # 5xx: retry.
            if resp.status_code >= 500:
                last_exc = BridgeError(
                    f"Bridge returned {resp.status_code}: {resp.text[:200]}"
                )
                logger.warning(
                    "Bridge %s %s -> %s (attempt %d/%d)",
                    method, path, resp.status_code, attempt + 1, retries,
                )
                await asyncio.sleep(RETRY_BACKOFF_BASE * (2 ** attempt))
                continue

            # 2xx
            try:
                body = resp.json()
            except Exception:
                body = {}
            return BridgeResponse(status_code=resp.status_code, json_body=body)

        except BridgeAuthError:
            raise
        except (httpx.ConnectError, httpx.ReadTimeout, httpx.ConnectTimeout) as exc:
            last_exc = BridgeOfflineError(f"Bridge unreachable: {exc}")
            logger.warning(
                "Bridge %s %s offline (attempt %d/%d): %s",
                method, path, attempt + 1, retries, exc,
            )
            await asyncio.sleep(RETRY_BACKOFF_BASE * (2 ** attempt))
        except httpx.HTTPError as exc:
            last_exc = BridgeError(f"Bridge HTTP error: {exc}")
            await asyncio.sleep(RETRY_BACKOFF_BASE * (2 ** attempt))

    # All retries exhausted.
    if isinstance(last_exc, BridgeError):
        raise last_exc
    raise BridgeOfflineError("Bridge unreachable after retries.")


# ── Public API ──────────────────────────────────────────────────────────────

async def health() -> dict:
    """Fetch the bridge's /mt5/health.

    Returns the JSON body on success. Raises BridgeError subclasses on failure.
    """
    resp = await _request_with_retry(
        "GET", "/mt5/health", timeout=HEALTH_TIMEOUT_SECONDS
    )
    if resp.status_code != 200:
        raise BridgeError(f"Bridge /mt5/health returned {resp.status_code}: {resp.json_body}")
    return resp.json_body


# Map our internal timeframe strings ("1m", "5m", "1h", …) to the MT5
# INI format the bridge expects ("M1", "M5", "H1", …). Already-normalised
# values (e.g. "M5", "D1") pass through unchanged so a re-submission never
# gets double-translated.
_TIMEFRAME_TO_MT5 = {
    "1m": "M1",  "2m": "M2",  "3m": "M3",  "5m": "M5",
    "15m": "M15", "30m": "M30",
    "1h": "H1",  "4h": "H4",
    "1d": "D1",
}


def _normalise_timeframe(tf: str) -> str:
    return _TIMEFRAME_TO_MT5.get(tf, tf)


async def submit_run(payload: dict) -> dict:
    """Submit a tester run to the bridge.

    Payload keys: expert_path, symbol, timeframe, from_date, to_date,
                  parameters (dict), model.
    Returns the bridge's JSON body, typically `{"job_id": "...", "queue_position": N}`.
    """
    if "timeframe" in payload:
        payload = {**payload, "timeframe": _normalise_timeframe(payload["timeframe"])}

    resp = await _request_with_retry(
        "POST",
        "/mt5/tester/run",
        json_body=payload,
        # The /run endpoint is fire-and-forget on the bridge side: it enqueues
        # the job and returns immediately. We use a short timeout here, not the
        # 1h run timeout (which only applies to the actual tester execution).
        timeout=DEFAULT_TIMEOUT_SECONDS,
    )
    if resp.status_code != 200:
        # Surface bridge-side validation errors (400) verbatim so the user sees
        # specific messages like "Symbol not found on broker".
        raise BridgeError(
            f"Bridge rejected run (HTTP {resp.status_code}): "
            f"{resp.json_body.get('error') or resp.json_body}"
        )
    return resp.json_body


async def run_status(bridge_job_id: str) -> dict:
    """Fetch a job's current status from the bridge."""
    resp = await _request_with_retry(
        "GET",
        f"/mt5/tester/status/{bridge_job_id}",
        timeout=DEFAULT_TIMEOUT_SECONDS,
    )
    if resp.status_code == 404:
        # Bridge has no record — likely orphaned by a worker restart.
        return {"status": "unknown", "error_message": "Bridge has no record of this job."}
    if resp.status_code != 200:
        raise BridgeError(f"Bridge status returned {resp.status_code}: {resp.json_body}")
    return resp.json_body
