"""APScheduler job that clears stale MT5 tester runs (PROJ-37).

Scans `mt5_tester_runs` every 5 minutes for rows where
    status IN ('queued', 'running')
    AND last_status_at < now() - INTERVAL '4 hours'
and transitions them to `failed` with a clear error message.

This is the safety net for the case where the Bridge Worker host (a non-24/7
Windows PC) crashes or shuts down mid-run — the bridge can't always self-report
orphans, so the backend must sweep them.

The scheduler itself is started from main.py via `start_stale_run_scheduler()`.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from services.cache_service import _get_supabase_client
from services.notifications import format_run_summary, send_telegram

logger = logging.getLogger(__name__)


STALE_AGE = timedelta(hours=4)
SCAN_INTERVAL_MINUTES = 5
STALE_ERROR_MESSAGE = (
    "Stale run cleared by automatic cleanup (host likely went offline)."
)
ORPHAN_AFTER_RESTART_ERROR_MESSAGE = (
    "Bridge Worker restarted; in-flight run has no MT5 process to resume."
)

_scheduler: Optional[AsyncIOScheduler] = None


async def cleanup_stale_runs(scope_user_id: Optional[str] = None) -> int:
    """Sweep stale runs and mark them failed. Returns number of rows cleared.

    Args:
        scope_user_id: If provided, only sweep runs belonging to this user.
                       Used by the bridge-reconnect callback so the backend
                       can target the runs that the freshly-restarted bridge
                       has no record of.
    """
    client = _get_supabase_client()
    cutoff = (datetime.now(timezone.utc) - STALE_AGE).isoformat()

    query = (
        client.table("mt5_tester_runs")
        .select(
            "id, user_id, expert_name, symbol, timeframe, status, last_status_at"
        )
        .in_("status", ["queued", "running"])
        .lt("last_status_at", cutoff)
    )
    if scope_user_id:
        query = query.eq("user_id", scope_user_id)

    resp = query.execute()
    stale_rows = resp.data or []

    if not stale_rows:
        return 0

    cleared = 0
    for row in stale_rows:
        try:
            client.table("mt5_tester_runs").update(
                {
                    "status": "failed",
                    "error_message": STALE_ERROR_MESSAGE,
                    "finished_at": datetime.now(timezone.utc).isoformat(),
                }
            ).eq("id", row["id"]).execute()
            cleared += 1

            # Fire-and-forget notification (gated by user settings).
            try:
                await send_telegram(
                    user_id=row["user_id"],
                    message=format_run_summary(
                        run_id=row["id"],
                        expert_name=row.get("expert_name", "?"),
                        symbol=row.get("symbol", "?"),
                        timeframe=row.get("timeframe", "?"),
                        status="failed",
                        error_message=STALE_ERROR_MESSAGE,
                    ),
                    run_type="single_run",
                )
            except Exception as notif_exc:
                logger.warning(
                    "Stale-run notification failed for run %s: %s",
                    row["id"], notif_exc,
                )
        except Exception as exc:
            logger.error(
                "Failed to mark run %s as failed during stale sweep: %s",
                row["id"], exc,
            )

    if cleared:
        logger.info("Stale-run sweep cleared %d run(s).", cleared)
    return cleared


async def cleanup_orphans_after_bridge_restart(
    scope_user_id: Optional[str] = None,
) -> int:
    """Clear runs the (just-restarted) bridge has no record of.

    Triggered by `/mt5/health` when the bridge's `last_started_at` increases
    versus the previously-seen value. Distinct from the 5-min sweeper because
    it ignores the 4-hour age cutoff: a fresh bridge restart can orphan a run
    that started seconds ago.

    For each `mt5_tester_runs` row in `running`/`queued`, ask the bridge if it
    knows the `bridge_job_id`. If the bridge returns 404 / `unknown`, the run
    is an orphan and we transition it to `failed`. Runs without a
    `bridge_job_id` (the run never made it past the DB-insert step before the
    bridge dropped its in-memory queue) are also treated as orphans.

    Returns the number of rows transitioned.
    """
    # Local import to avoid a module-load-time cycle with main.py.
    from services import mt5_bridge as mt5_bridge_client
    from services.mt5_bridge import BridgeError

    client = _get_supabase_client()

    query = (
        client.table("mt5_tester_runs")
        .select(
            "id, user_id, expert_name, symbol, timeframe, status, bridge_job_id"
        )
        .in_("status", ["queued", "running"])
    )
    if scope_user_id:
        query = query.eq("user_id", scope_user_id)

    resp = query.execute()
    candidate_rows = resp.data or []

    if not candidate_rows:
        return 0

    cleared = 0
    for row in candidate_rows:
        bridge_job_id = row.get("bridge_job_id")
        is_orphan = False

        if not bridge_job_id:
            # Run never received a bridge job ID — definitely orphaned.
            is_orphan = True
        else:
            try:
                status_body = await mt5_bridge_client.run_status(bridge_job_id)
            except BridgeError as exc:
                # Bridge unreachable / 5xx — leave the run alone. The 5-min
                # sweeper will pick it up later if the bridge stays down.
                logger.warning(
                    "Bridge probe failed for run %s while checking orphans: %s",
                    row["id"], exc,
                )
                continue

            # `run_status` returns `{"status": "unknown", ...}` for HTTP 404.
            if status_body.get("status") == "unknown":
                is_orphan = True

        if not is_orphan:
            continue

        try:
            client.table("mt5_tester_runs").update(
                {
                    "status": "failed",
                    "error_message": ORPHAN_AFTER_RESTART_ERROR_MESSAGE,
                    "finished_at": datetime.now(timezone.utc).isoformat(),
                }
            ).eq("id", row["id"]).execute()
            cleared += 1

            try:
                await send_telegram(
                    user_id=row["user_id"],
                    message=format_run_summary(
                        run_id=row["id"],
                        expert_name=row.get("expert_name", "?"),
                        symbol=row.get("symbol", "?"),
                        timeframe=row.get("timeframe", "?"),
                        status="failed",
                        error_message=ORPHAN_AFTER_RESTART_ERROR_MESSAGE,
                    ),
                    run_type="single_run",
                )
            except Exception as notif_exc:
                logger.warning(
                    "Orphan-cleanup notification failed for run %s: %s",
                    row["id"], notif_exc,
                )
        except Exception as exc:
            logger.error(
                "Failed to mark orphaned run %s as failed: %s",
                row["id"], exc,
            )

    if cleared:
        logger.info(
            "Bridge-restart orphan cleanup cleared %d run(s).", cleared
        )
    return cleared


async def _scheduled_job() -> None:
    """APScheduler entry point — wraps cleanup_stale_runs with error suppression."""
    try:
        await cleanup_stale_runs()
    except Exception as exc:
        logger.exception("Stale-run sweep crashed: %s", exc)


def start_stale_run_scheduler() -> None:
    """Start the 5-min APScheduler job. Idempotent."""
    global _scheduler
    if _scheduler is not None:
        return

    scheduler = AsyncIOScheduler(timezone="UTC")
    scheduler.add_job(
        _scheduled_job,
        trigger="interval",
        minutes=SCAN_INTERVAL_MINUTES,
        id="mt5_stale_run_cleanup",
        max_instances=1,
        coalesce=True,
    )
    scheduler.start()
    _scheduler = scheduler
    logger.info("Stale-run cleanup scheduler started (every %d min).", SCAN_INTERVAL_MINUTES)


def stop_stale_run_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
