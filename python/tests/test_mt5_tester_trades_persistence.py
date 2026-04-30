"""Tests for `_replace_run_trades` and the MT5 timestamp/direction helpers (PROJ-37).

The bridge's XML parser is the source of truth for trade extraction (see
`mt5-bridge/bridge/xml_parser.py` + `mt5-bridge/tests/fixtures/sample_report.xml`).
These tests verify that the bridge's parser output maps 1:1 to the
`mt5_tester_trades` columns when Railway persists a completed run.

The Supabase client is stubbed so the tests run without DB credentials.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import main as backend_main  # noqa: E402


SAMPLE_XML = (
    Path(__file__).resolve().parents[2]
    / ".."
    / "mt5-bridge"
    / "tests"
    / "fixtures"
    / "sample_report.xml"
)


# ── Stub Supabase client ─────────────────────────────────────────────────────


class _Recorder:
    """Captures every chained Supabase-style call so assertions can replay them."""

    def __init__(self) -> None:
        self.deletes: list[dict] = []
        self.inserts: list[list[dict]] = []
        self._pending: dict | None = None

    def table(self, name: str) -> "_Recorder":
        self._table = name
        return self

    def delete(self) -> "_Recorder":
        self._pending = {"op": "delete", "table": self._table}
        return self

    def insert(self, rows) -> "_Recorder":
        self.inserts.append(list(rows))
        self._pending = {"op": "insert", "table": self._table}
        return self

    def eq(self, column: str, value) -> "_Recorder":
        if self._pending and self._pending["op"] == "delete":
            self._pending.update(column=column, value=value)
        return self

    def execute(self):
        if self._pending and self._pending["op"] == "delete":
            self.deletes.append(self._pending)
        self._pending = None
        return self


# ── Helper-level tests ───────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("2026.01.05 09:30:00", "2026-01-05T09:30:00"),
        ("2026.01.05 09:30", "2026-01-05T09:30:00"),
        ("2026-01-05T09:30:00", "2026-01-05T09:30:00"),
        ("", None),
        (None, None),
        ("not a date", None),
    ],
)
def test_normalise_mt5_timestamp(raw, expected):
    assert backend_main._normalise_mt5_timestamp(raw) == expected


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("buy", "buy"),
        ("sell", "sell"),
        ("Buy", "buy"),
        ("SELL", "sell"),
        ("buy stop", "buy"),
        ("sell_limit", "sell"),
        ("balance", None),
        (None, None),
    ],
)
def test_normalise_direction(raw, expected):
    assert backend_main._normalise_direction(raw) == expected


# ── _replace_run_trades — fixture-driven 1:1 mapping ─────────────────────────


def _bridge_trades_from_fixture() -> list[dict]:
    """Run the same parser the bridge uses, return its trade list.

    Imported lazily so this test file doesn't hard-require the mt5-bridge
    package on `sys.path` for unrelated test runs.
    """
    bridge_root = Path(__file__).resolve().parents[2] / ".." / "mt5-bridge"
    sys.path.insert(0, str(bridge_root))
    try:
        from bridge.xml_parser import parse_report_file  # type: ignore
    except ImportError:
        pytest.skip("mt5-bridge repo not checked out next to test-project")
    parsed = parse_report_file(SAMPLE_XML)
    return parsed.trades


def test_replace_run_trades_maps_bridge_fixture_one_to_one():
    trades = _bridge_trades_from_fixture()
    assert len(trades) == 3, "fixture invariant — see mt5-bridge sample_report.xml"

    client = _Recorder()
    run_id = "11111111-1111-1111-1111-111111111111"
    backend_main._replace_run_trades(client, run_id, trades)

    # delete-then-insert idempotency
    assert len(client.deletes) == 1
    assert client.deletes[0] == {
        "op": "delete",
        "table": "mt5_tester_trades",
        "column": "run_id",
        "value": run_id,
    }

    assert len(client.inserts) == 1
    inserted = client.inserts[0]
    assert len(inserted) == 3

    # Row 1 — the winning buy trade in the fixture.
    assert inserted[0] == {
        "run_id": run_id,
        "open_time": "2026-01-05T09:30:00",
        "close_time": "2026-01-05T14:15:00",
        "direction": "buy",
        "volume": 0.10,
        "open_price": 1.0850,
        "close_price": 1.0890,
        "profit": 40.00,
        "comment": "tp",
    }

    # Row 3 — the losing buy trade with sl comment.
    assert inserted[2]["direction"] == "buy"
    assert inserted[2]["profit"] == pytest.approx(-15.00)
    assert inserted[2]["comment"] == "sl"
    assert inserted[2]["open_time"] == "2026-01-07T08:45:00"


def test_replace_run_trades_skips_rows_without_open_time():
    client = _Recorder()
    backend_main._replace_run_trades(
        client,
        "00000000-0000-0000-0000-000000000000",
        [
            {"open_time": None, "direction": "buy", "profit": 10.0},
            {"open_time": "", "direction": "buy", "profit": 20.0},
            {"direction": "buy", "profit": 30.0},
        ],
    )
    # Nothing valid → no DB call at all.
    assert client.deletes == []
    assert client.inserts == []


def test_replace_run_trades_no_op_for_empty_list():
    client = _Recorder()
    backend_main._replace_run_trades(client, "id", [])
    backend_main._replace_run_trades(client, "id", None)
    assert client.deletes == []
    assert client.inserts == []
