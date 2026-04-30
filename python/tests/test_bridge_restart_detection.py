"""Tests for the bridge-restart auto-detection path (PROJ-37).

Covers:
  • `_maybe_handle_bridge_restart` — first-observation no-op, no-change no-op,
    change → cleanup task scheduled exactly once even under concurrent calls.
  • `cleanup_orphans_after_bridge_restart` — runs the bridge has no record of
    are transitioned to `failed`; runs the bridge still tracks are left alone;
    runs without a `bridge_job_id` are treated as orphans; bridge-side errors
    short-circuit per row instead of failing the whole sweep.
"""

from __future__ import annotations

import asyncio
import os
import sys
from unittest.mock import AsyncMock, patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import main as backend_main  # noqa: E402
from jobs import stale_run_cleanup  # noqa: E402


# ── Stub Supabase client (records mutations, returns canned SELECTs) ─────────


class _Recorder:
    """Captures Supabase-style chained calls so assertions can replay them."""

    def __init__(self, select_rows: list[dict] | None = None) -> None:
        self.select_rows = select_rows or []
        self.updates: list[dict] = []
        self._table: str | None = None
        self._update_payload: dict | None = None
        self._eq_filters: list[tuple[str, str]] = []
        self._in_filters: list[tuple[str, list]] = []

    # Chain entry
    def table(self, name: str) -> "_Recorder":
        self._table = name
        self._update_payload = None
        self._eq_filters = []
        self._in_filters = []
        return self

    # SELECT chain
    def select(self, *_args, **_kwargs) -> "_Recorder":
        return self

    def in_(self, col: str, vals: list) -> "_Recorder":
        self._in_filters.append((col, vals))
        return self

    def eq(self, col: str, val: str) -> "_Recorder":
        self._eq_filters.append((col, val))
        return self

    def lt(self, *_args, **_kwargs) -> "_Recorder":
        return self

    def order(self, *_args, **_kwargs) -> "_Recorder":
        return self

    def limit(self, *_args, **_kwargs) -> "_Recorder":
        return self

    # UPDATE chain
    def update(self, payload: dict) -> "_Recorder":
        self._update_payload = payload
        return self

    def execute(self):
        if self._update_payload is not None:
            row_id = next(
                (val for col, val in self._eq_filters if col == "id"),
                None,
            )
            self.updates.append({"id": row_id, **self._update_payload})
            self._update_payload = None

            class _Resp:
                data: list = []

            return _Resp()

        # SELECT branch
        class _Resp:
            pass

        resp = _Resp()
        resp.data = self.select_rows
        return resp


@pytest.fixture(autouse=True)
def _reset_restart_state():
    """Each test starts with an empty `_MT5_BRIDGE_LAST_STARTED_AT`."""
    backend_main._MT5_BRIDGE_LAST_STARTED_AT["value"] = None
    yield
    backend_main._MT5_BRIDGE_LAST_STARTED_AT["value"] = None


# ── _maybe_handle_bridge_restart ────────────────────────────────────────────


def test_first_observation_records_value_without_firing(event_loop=None):
    """First call seeds the cache; should NOT schedule cleanup."""
    fired = backend_main._maybe_handle_bridge_restart("2026-04-30T08:00:00+00:00")
    assert fired is False
    assert (
        backend_main._MT5_BRIDGE_LAST_STARTED_AT["value"]
        == "2026-04-30T08:00:00+00:00"
    )


def test_unchanged_value_no_op():
    """Same `last_started_at` across two calls → no cleanup fires."""
    backend_main._MT5_BRIDGE_LAST_STARTED_AT["value"] = "2026-04-30T08:00:00+00:00"
    fired = backend_main._maybe_handle_bridge_restart("2026-04-30T08:00:00+00:00")
    assert fired is False


def test_missing_value_no_op():
    """Bridge omits the field → no detection (don't poison the cache)."""
    backend_main._MT5_BRIDGE_LAST_STARTED_AT["value"] = "2026-04-30T08:00:00+00:00"
    fired = backend_main._maybe_handle_bridge_restart(None)
    assert fired is False
    # Cache must still hold the previous value.
    assert (
        backend_main._MT5_BRIDGE_LAST_STARTED_AT["value"]
        == "2026-04-30T08:00:00+00:00"
    )


@pytest.mark.asyncio
async def test_changed_value_schedules_cleanup_once():
    """Increase in `last_started_at` triggers exactly one cleanup task."""
    backend_main._MT5_BRIDGE_LAST_STARTED_AT["value"] = "2026-04-30T08:00:00+00:00"

    cleanup_mock = AsyncMock(return_value=2)
    with patch.object(backend_main, "cleanup_orphans_after_bridge_restart", cleanup_mock):
        fired = backend_main._maybe_handle_bridge_restart(
            "2026-04-30T09:15:00+00:00"
        )
        assert fired is True
        # The task is scheduled but not awaited inline — yield to the loop.
        await asyncio.sleep(0)
        # Allow the task to run if it was scheduled.
        await asyncio.sleep(0)
        cleanup_mock.assert_awaited_once()

    assert (
        backend_main._MT5_BRIDGE_LAST_STARTED_AT["value"]
        == "2026-04-30T09:15:00+00:00"
    )


@pytest.mark.asyncio
async def test_concurrent_changed_calls_only_fire_cleanup_once():
    """Two probes seeing the same new timestamp → one cleanup, not two."""
    backend_main._MT5_BRIDGE_LAST_STARTED_AT["value"] = "2026-04-30T08:00:00+00:00"

    cleanup_mock = AsyncMock(return_value=0)
    with patch.object(backend_main, "cleanup_orphans_after_bridge_restart", cleanup_mock):
        a = backend_main._maybe_handle_bridge_restart("2026-04-30T09:15:00+00:00")
        b = backend_main._maybe_handle_bridge_restart("2026-04-30T09:15:00+00:00")
        await asyncio.sleep(0)
        await asyncio.sleep(0)

    assert (a, b) == (True, False)
    cleanup_mock.assert_awaited_once()


# ── cleanup_orphans_after_bridge_restart ────────────────────────────────────


@pytest.mark.asyncio
async def test_orphan_cleanup_marks_unknown_runs_failed():
    """run_status returns `unknown` → row is transitioned to failed."""
    rec = _Recorder(
        select_rows=[
            {
                "id": "run-1",
                "user_id": "user-A",
                "expert_name": "MyEA",
                "symbol": "EURUSD",
                "timeframe": "M1",
                "status": "running",
                "bridge_job_id": "bridge-1",
            },
        ]
    )

    bridge_mock = AsyncMock(return_value={"status": "unknown"})

    with patch.object(stale_run_cleanup, "_get_supabase_client", return_value=rec), \
         patch("services.mt5_bridge.run_status", bridge_mock), \
         patch.object(stale_run_cleanup, "send_telegram", AsyncMock(return_value=False)):
        cleared = await stale_run_cleanup.cleanup_orphans_after_bridge_restart()

    assert cleared == 1
    assert len(rec.updates) == 1
    assert rec.updates[0]["id"] == "run-1"
    assert rec.updates[0]["status"] == "failed"
    assert "Bridge Worker restarted" in rec.updates[0]["error_message"]
    bridge_mock.assert_awaited_once_with("bridge-1")


@pytest.mark.asyncio
async def test_orphan_cleanup_skips_runs_bridge_still_tracks():
    """run_status returns a real status → row is left alone."""
    rec = _Recorder(
        select_rows=[
            {
                "id": "run-keep",
                "user_id": "user-A",
                "expert_name": "MyEA",
                "symbol": "EURUSD",
                "timeframe": "M1",
                "status": "running",
                "bridge_job_id": "bridge-keep",
            },
        ]
    )
    bridge_mock = AsyncMock(return_value={"status": "running"})

    with patch.object(stale_run_cleanup, "_get_supabase_client", return_value=rec), \
         patch("services.mt5_bridge.run_status", bridge_mock), \
         patch.object(stale_run_cleanup, "send_telegram", AsyncMock(return_value=False)):
        cleared = await stale_run_cleanup.cleanup_orphans_after_bridge_restart()

    assert cleared == 0
    assert rec.updates == []


@pytest.mark.asyncio
async def test_orphan_cleanup_treats_missing_bridge_job_id_as_orphan():
    """A run that never received a bridge_job_id can't be on the bridge."""
    rec = _Recorder(
        select_rows=[
            {
                "id": "run-noid",
                "user_id": "user-A",
                "expert_name": "MyEA",
                "symbol": "EURUSD",
                "timeframe": "M1",
                "status": "queued",
                "bridge_job_id": None,
            },
        ]
    )
    bridge_mock = AsyncMock()  # must not be called

    with patch.object(stale_run_cleanup, "_get_supabase_client", return_value=rec), \
         patch("services.mt5_bridge.run_status", bridge_mock), \
         patch.object(stale_run_cleanup, "send_telegram", AsyncMock(return_value=False)):
        cleared = await stale_run_cleanup.cleanup_orphans_after_bridge_restart()

    assert cleared == 1
    bridge_mock.assert_not_called()


@pytest.mark.asyncio
async def test_orphan_cleanup_skips_when_bridge_probe_errors():
    """Bridge unreachable for a single row → leave it for the 5-min sweeper."""
    rec = _Recorder(
        select_rows=[
            {
                "id": "run-skip",
                "user_id": "user-A",
                "expert_name": "MyEA",
                "symbol": "EURUSD",
                "timeframe": "M1",
                "status": "running",
                "bridge_job_id": "bridge-skip",
            },
        ]
    )
    from services.mt5_bridge import BridgeOfflineError

    bridge_mock = AsyncMock(side_effect=BridgeOfflineError("offline"))

    with patch.object(stale_run_cleanup, "_get_supabase_client", return_value=rec), \
         patch("services.mt5_bridge.run_status", bridge_mock), \
         patch.object(stale_run_cleanup, "send_telegram", AsyncMock(return_value=False)):
        cleared = await stale_run_cleanup.cleanup_orphans_after_bridge_restart()

    assert cleared == 0
    assert rec.updates == []


@pytest.mark.asyncio
async def test_orphan_cleanup_user_scoped():
    """`scope_user_id` filters the candidate query to that user's rows only."""
    rec = _Recorder(select_rows=[])
    bridge_mock = AsyncMock(return_value={"status": "unknown"})

    with patch.object(stale_run_cleanup, "_get_supabase_client", return_value=rec), \
         patch("services.mt5_bridge.run_status", bridge_mock), \
         patch.object(stale_run_cleanup, "send_telegram", AsyncMock(return_value=False)):
        cleared = await stale_run_cleanup.cleanup_orphans_after_bridge_restart(
            scope_user_id="user-X"
        )

    assert cleared == 0
    # Verify the query had a user_id eq filter applied.
    assert ("user_id", "user-X") in rec._eq_filters


@pytest.mark.asyncio
async def test_orphan_cleanup_mixed_rows_partial_clear():
    """Mixed batch: 1 alive on bridge, 1 unknown on bridge, 1 missing id."""
    rec = _Recorder(
        select_rows=[
            {
                "id": "run-alive",
                "user_id": "user-A",
                "expert_name": "EA",
                "symbol": "EURUSD",
                "timeframe": "M1",
                "status": "running",
                "bridge_job_id": "bridge-alive",
            },
            {
                "id": "run-unknown",
                "user_id": "user-A",
                "expert_name": "EA",
                "symbol": "EURUSD",
                "timeframe": "M1",
                "status": "running",
                "bridge_job_id": "bridge-unknown",
            },
            {
                "id": "run-noid",
                "user_id": "user-A",
                "expert_name": "EA",
                "symbol": "EURUSD",
                "timeframe": "M1",
                "status": "queued",
                "bridge_job_id": None,
            },
        ]
    )

    async def _status_side_effect(bridge_job_id: str) -> dict:
        if bridge_job_id == "bridge-alive":
            return {"status": "running"}
        return {"status": "unknown"}

    bridge_mock = AsyncMock(side_effect=_status_side_effect)

    with patch.object(stale_run_cleanup, "_get_supabase_client", return_value=rec), \
         patch("services.mt5_bridge.run_status", bridge_mock), \
         patch.object(stale_run_cleanup, "send_telegram", AsyncMock(return_value=False)):
        cleared = await stale_run_cleanup.cleanup_orphans_after_bridge_restart()

    assert cleared == 2
    cleared_ids = {u["id"] for u in rec.updates}
    assert cleared_ids == {"run-unknown", "run-noid"}
