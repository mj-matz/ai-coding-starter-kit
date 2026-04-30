"""Telegram notification service (PROJ-37).

Real delivery is wired up via `httpx` against the Telegram Bot API.
The 10/hour/user rate-limit, opt-in gates, and `last_notification_*`
persistence are unchanged — this module hits Telegram for real and maps
the documented error shapes (401/403/400) into user-friendly text.
"""

from __future__ import annotations

import logging
import threading
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx

from services.cache_service import _get_supabase_client

logger = logging.getLogger(__name__)


# ── Rate limiter (in-memory, per-process) ───────────────────────────────────

_RATE_LIMIT_PER_HOUR = 10
_RATE_LIMIT_WINDOW = timedelta(hours=1)
_send_history: dict[str, deque[datetime]] = defaultdict(deque)
_rate_lock = threading.Lock()


def _consume_rate_token(user_id: str) -> bool:
    """Return True if a notification slot is available, False if rate-limited."""
    now = datetime.now(timezone.utc)
    with _rate_lock:
        history = _send_history[user_id]
        # Drop expired entries.
        while history and (now - history[0]) > _RATE_LIMIT_WINDOW:
            history.popleft()
        if len(history) >= _RATE_LIMIT_PER_HOUR:
            return False
        history.append(now)
        return True


# ── Telegram delivery ───────────────────────────────────────────────────────

_TELEGRAM_API_BASE = "https://api.telegram.org"
_TELEGRAM_TIMEOUT_SECONDS = 10.0


async def _deliver_telegram_message(
    bot_token: str,
    chat_id: str,
    message: str,
) -> tuple[bool, Optional[str]]:
    """POST to https://api.telegram.org/bot{token}/sendMessage.

    Returns (success, error_message). Maps documented Telegram error shapes
    (401 invalid token, 403 chat blocked, 400 bad chat_id) into short,
    user-facing strings persisted to `user_settings.last_notification_error`.
    """
    url = f"{_TELEGRAM_API_BASE}/bot{bot_token}/sendMessage"
    payload = {"chat_id": chat_id, "text": message, "disable_web_page_preview": True}
    try:
        async with httpx.AsyncClient(timeout=_TELEGRAM_TIMEOUT_SECONDS) as client:
            resp = await client.post(url, json=payload)
    except httpx.HTTPError as exc:
        logger.warning("Telegram network error: %s", exc)
        return False, f"Network error: {exc.__class__.__name__}"

    if resp.status_code == 200:
        try:
            body = resp.json()
        except Exception:
            body = {}
        # Telegram returns 200 with `{"ok": false, ...}` for some non-fatal
        # cases (e.g. retry_after). Treat ok=false as failure so the user gets
        # a meaningful error in last_notification_error.
        if isinstance(body, dict) and body.get("ok") is False:
            description = body.get("description", "Telegram returned ok=false.")
            logger.warning(
                "Telegram delivery returned ok=false for chat_id=%s: %s",
                chat_id, description,
            )
            return False, description
        return True, None

    try:
        description = resp.json().get("description", "")
    except Exception:
        description = resp.text[:200]

    if resp.status_code == 401:
        # Per Telegram Bot API docs: 401 is returned only for an invalid /
        # revoked bot token. Surface a fixed, user-facing string.
        error = "Invalid Telegram bot token (401)"
    elif resp.status_code == 403:
        # 403 covers "Forbidden: bot was blocked by the user" and
        # "Forbidden: bot can't initiate conversation with a user".
        # Both mean the user must re-open the chat with the bot.
        error = "Bot blocked or chat not found (403)"
    elif resp.status_code == 400:
        # 400 covers many bad-payload cases (bad chat_id, message-too-long,
        # parse-error). Relay the Telegram description verbatim.
        error = f"Telegram rejected request (400): {description}" if description else "Telegram rejected request (400)"
    else:
        error = f"Telegram error {resp.status_code}: {description}"

    logger.warning("Telegram delivery failed for chat_id=%s: %s", chat_id, error)
    return False, error


# ── Public API ──────────────────────────────────────────────────────────────

async def send_telegram(
    user_id: str,
    message: str,
    *,
    run_type: str = "single_run",
    force: bool = False,
) -> bool:
    """Send a Telegram notification to a user, respecting their settings + rate limit.

    Args:
        user_id:   Supabase auth user ID.
        message:   Plain-text message body (no Markdown formatting yet).
        run_type:  One of "single_run", "optimisation", "walk_forward".
                   Determines which opt-in flag in user_settings gates delivery.
        force:     When True, skip the per-run-type opt-in gate. Used by the
                   "Send test message" button in Settings — the user is
                   explicitly verifying config, regardless of run-type opt-ins.

    Returns True if Telegram returned 200 OK for the send. Returns False if
    delivery was skipped (settings/rate-limit) or Telegram rejected the
    message; the rejection reason is persisted to
    `user_settings.last_notification_error` for the Settings UI to display.
    """
    client = _get_supabase_client()

    # Look up user settings.
    resp = (
        client.table("user_settings")
        .select(
            "telegram_enabled, telegram_bot_token, telegram_chat_id, "
            "notify_on_single_run, notify_on_optimisation, notify_on_walk_forward"
        )
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )

    if not resp.data:
        logger.debug("send_telegram: no settings row for user %s — skipping.", user_id)
        return False

    settings = resp.data[0]
    if not settings.get("telegram_enabled"):
        return False

    bot_token = settings.get("telegram_bot_token")
    chat_id = settings.get("telegram_chat_id")
    if not bot_token or not chat_id:
        return False

    # Per-run-type opt-in gate (skipped for explicit test sends).
    if not force:
        type_flag = {
            "single_run": "notify_on_single_run",
            "optimisation": "notify_on_optimisation",
            "walk_forward": "notify_on_walk_forward",
        }.get(run_type)
        if type_flag and not settings.get(type_flag):
            return False

    # Rate limit.
    if not _consume_rate_token(user_id):
        logger.warning(
            "Telegram rate limit hit for user %s — message dropped (would aggregate in future).",
            user_id,
        )
        # Aggregation logic is a follow-up: collect dropped messages per user
        # and send a single digest at the end of the hour.
        _record_attempt(client, user_id, success=False, error="Rate-limited (10/hour)")
        return False

    success, error = await _deliver_telegram_message(bot_token, chat_id, message)
    _record_attempt(client, user_id, success=success, error=error)
    return success


def _record_attempt(client, user_id: str, *, success: bool, error: Optional[str]) -> None:
    """Persist last_notification_attempt_at + last_notification_error."""
    try:
        payload = {
            "last_notification_attempt_at": datetime.now(timezone.utc).isoformat(),
            "last_notification_error": None if success else error,
        }
        client.table("user_settings").update(payload).eq("user_id", user_id).execute()
    except Exception as exc:
        logger.warning("Failed to record notification attempt for %s: %s", user_id, exc)


def format_run_summary(
    *,
    run_id: str,
    expert_name: str,
    symbol: str,
    timeframe: str,
    status: str,
    metrics: Optional[dict] = None,
    error_message: Optional[str] = None,
    result_url: Optional[str] = None,
) -> str:
    """Build the message body for a completed/failed run."""
    lines = [
        f"MT5 Tester Run {status.upper()}",
        f"Expert: {expert_name}",
        f"Symbol: {symbol} {timeframe}",
    ]
    if metrics:
        lines.append(
            f"Profit: {metrics.get('total_net_profit', 'n/a')} | "
            f"Sharpe: {metrics.get('sharpe_ratio', 'n/a')} | "
            f"Trades: {metrics.get('total_trades', 'n/a')}"
        )
    if error_message:
        lines.append(f"Error: {error_message}")
    if result_url:
        lines.append(f"Open: {result_url}")
    return "\n".join(lines)
