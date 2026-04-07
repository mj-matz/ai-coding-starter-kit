"""
Pytest tests for PROJ-30: Continuous Trailing Stop & Partial Close.

Uses the same synthetic OHLCV conventions as test_engine.py:
  Instrument: GOLD-like
    pip_size           = 0.01
    pip_value_per_lot  = 1.00   (1 pip with 1.0 lot = $1.00)
  Default config: 10 000 USD, 1.0 fixed lot, no commission/slippage.
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import numpy as np
import pandas as pd
import pytest

from engine.engine import run_backtest
from engine.models import BacktestConfig, InstrumentConfig

# ── Shared helpers (mirrors test_engine.py) ──────────────────────────────────

GOLD = InstrumentConfig(pip_size=0.01, pip_value_per_lot=1.0)


def cfg(**kwargs) -> BacktestConfig:
    defaults = dict(
        initial_balance=10_000.0,
        sizing_mode="fixed_lot",
        fixed_lot=1.0,
        instrument=GOLD,
    )
    defaults.update(kwargs)
    return BacktestConfig(**defaults)


def make_ohlcv(rows: list) -> pd.DataFrame:
    idx = pd.to_datetime([r[0] for r in rows], utc=True)
    return pd.DataFrame(
        {
            "open":   [r[1] for r in rows],
            "high":   [r[2] for r in rows],
            "low":    [r[3] for r in rows],
            "close":  [r[4] for r in rows],
            "volume": [1000] * len(rows),
        },
        index=idx,
    )


def make_signals(ohlcv: pd.DataFrame, signals: dict) -> pd.DataFrame:
    cols = ["long_entry", "long_sl", "long_tp", "short_entry", "short_sl", "short_tp"]
    df = pd.DataFrame(np.nan, index=ohlcv.index, columns=cols, dtype=float)
    for ts_str, vals in signals.items():
        ts = pd.Timestamp(ts_str, tz="UTC")
        for col, val in vals.items():
            df.at[ts, col] = val
    return df


# ── PROJ-30: Continuous Trailing Stop ────────────────────────────────────────

class TestContinuousTrailingStop:
    """Continuous trail: SL permanently follows bar extreme at fixed pip distance."""

    def test_long_trail_moves_sl_and_exits_sl_trailed(self):
        """
        Long, trail_distance=20 pips, no trigger threshold (active from bar 1).
        Bar 1 (entry): high=100.10 -> SL moves to 100.10-0.20=99.90 (>99.00 original)
        Bar 2: high=100.50 -> SL moves to 100.30; low=100.20 < 100.30 -> SL_TRAILED
        pnl_pips = (100.30-100.00)/0.01 = 30 pips
        """
        ohlcv = make_ohlcv([
            ("2024-01-02T09:00:00Z", 100.00, 100.00, 99.50, 100.00),  # signal
            ("2024-01-02T09:01:00Z", 100.00, 100.10, 99.95, 100.05),  # entry; SL->99.90
            ("2024-01-02T09:02:00Z", 100.25, 100.50, 100.20, 100.40), # SL->100.30; low<100.30->exit
        ])
        signals = make_signals(ohlcv, {
            "2024-01-02T09:00:00Z": {"long_entry": 100.00, "long_sl": 99.00},
        })
        signals["trail_type"] = "continuous"
        signals["trail_distance_pips"] = 20.0

        result = run_backtest(ohlcv, signals, cfg())

        assert len(result.trades) == 1
        t = result.trades[0]
        assert t.exit_reason == "SL_TRAILED"
        assert t.pnl_pips == pytest.approx(30.0, abs=0.1)
        assert t.exit_price == pytest.approx(100.30, abs=0.001)

    def test_ratchet_never_moves_sl_backward(self):
        """
        After SL reaches 100.30 (from high=100.50), a bar with lower high must NOT pull SL back.
        Bar 3: high=100.40 -> candidate=100.20 < current SL 100.30 -> no change
        Bar 4: low=100.25 < 100.30 -> SL_TRAILED at 100.30 (unchanged from bar 2)
        """
        ohlcv = make_ohlcv([
            ("2024-01-02T09:00:00Z", 100.00, 100.00, 99.50, 100.00),  # signal
            ("2024-01-02T09:01:00Z", 100.00, 100.10, 99.95, 100.05),  # entry; SL->99.90
            ("2024-01-02T09:02:00Z", 100.25, 100.50, 100.35, 100.40), # SL->100.30; low>100.30 -> no exit
            ("2024-01-02T09:03:00Z", 100.35, 100.40, 100.25, 100.30), # high=100.40->candidate=100.20<100.30->no change; low=100.25<100.30->SL_TRAILED
        ])
        signals = make_signals(ohlcv, {
            "2024-01-02T09:00:00Z": {"long_entry": 100.00, "long_sl": 99.00},
        })
        signals["trail_type"] = "continuous"
        signals["trail_distance_pips"] = 20.0

        result = run_backtest(ohlcv, signals, cfg())

        assert len(result.trades) == 1
        t = result.trades[0]
        assert t.exit_reason == "SL_TRAILED"
        assert t.exit_price == pytest.approx(100.30, abs=0.001)  # ratcheted from bar 2, not bar 3

    def test_trail_trigger_threshold_delays_activation(self):
        """
        trail_trigger_pips=30: trail only starts once profit >= 30 pips.
        Bar 1 (entry): profit=20 pips < 30 -> no trail
        Bar 2: profit=40 pips >= 30 -> trail activates; SL=100.40-0.30=100.10; low=100.05<100.10->SL_TRAILED
        """
        ohlcv = make_ohlcv([
            ("2024-01-02T09:00:00Z", 100.00, 100.00, 99.50, 100.00),  # signal
            ("2024-01-02T09:01:00Z", 100.00, 100.20, 99.95, 100.15),  # entry; profit=20<30 -> no trail
            ("2024-01-02T09:02:00Z", 100.20, 100.40, 100.05, 100.30), # profit=40>=30 -> trail; SL=100.10; low<100.10->exit
        ])
        signals = make_signals(ohlcv, {
            "2024-01-02T09:00:00Z": {"long_entry": 100.00, "long_sl": 99.00},
        })
        signals["trail_type"] = "continuous"
        signals["trail_distance_pips"] = 30.0
        signals["trail_trigger_pips"] = 30.0

        result = run_backtest(ohlcv, signals, cfg())

        assert len(result.trades) == 1
        t = result.trades[0]
        assert t.exit_reason == "SL_TRAILED"
        assert t.exit_price == pytest.approx(100.10, abs=0.001)

    def test_trail_dont_cross_entry_caps_sl_at_entry(self):
        """
        trail_dont_cross_entry=True: caps candidate SL so it never exceeds entry price (long).
        Entry=100.00, distance=50 pips. Cap activates when high > entry + 50 pips.
        Bar 1: high=100.60 -> candidate=100.60-0.50=100.10 > entry=100.00 -> capped to 100.00; SL->100.00; low=100.05>100.00 -> no exit
        Bar 2: high=100.65 -> candidate=100.15 -> capped to 100.00; ratchet: 100.00==100.00 -> no change; low=99.95 < 100.00 -> SL_TRAILED (pnl=0)
        """
        ohlcv = make_ohlcv([
            ("2024-01-02T09:00:00Z", 100.00, 100.00, 99.50, 100.00),  # signal
            ("2024-01-02T09:01:00Z", 100.00, 100.60, 100.05, 100.50), # entry; candidate=100.10 > entry -> capped 100.00; low=100.05>100.00 -> no exit
            ("2024-01-02T09:02:00Z", 100.50, 100.65, 99.95, 100.10),  # candidate=100.15->capped 100.00; low=99.95<100.00->SL_TRAILED
        ])
        signals = make_signals(ohlcv, {
            "2024-01-02T09:00:00Z": {"long_entry": 100.00, "long_sl": 99.00},
        })
        signals["trail_type"] = "continuous"
        signals["trail_distance_pips"] = 50.0
        signals["trail_dont_cross_entry"] = 1.0

        result = run_backtest(ohlcv, signals, cfg())

        assert len(result.trades) == 1
        t = result.trades[0]
        assert t.exit_reason == "SL_TRAILED"
        # SL is capped at entry price 100.00, not at uncapped 100.10
        assert t.exit_price == pytest.approx(100.00, abs=0.001)
        assert t.pnl_pips == pytest.approx(0.0, abs=0.1)

    def test_config_level_continuous_trail(self):
        """Global BacktestConfig trail_type='continuous' applies when no per-signal override."""
        ohlcv = make_ohlcv([
            ("2024-01-02T09:00:00Z", 100.00, 100.00, 99.50, 100.00),  # signal
            ("2024-01-02T09:01:00Z", 100.00, 100.10, 99.95, 100.05),  # entry; SL->99.90
            ("2024-01-02T09:02:00Z", 100.25, 100.50, 100.20, 100.40), # SL->100.30; low<100.30->exit
        ])
        signals = make_signals(ohlcv, {
            "2024-01-02T09:00:00Z": {"long_entry": 100.00, "long_sl": 99.00},
        })

        result = run_backtest(ohlcv, signals, cfg(trail_type="continuous", trail_distance_pips=20.0))

        assert len(result.trades) == 1
        assert result.trades[0].exit_reason == "SL_TRAILED"
        assert result.trades[0].exit_price == pytest.approx(100.30, abs=0.001)

    def test_missing_trail_distance_raises_value_error(self):
        """Config trail_type='continuous' without trail_distance_pips raises ValueError."""
        ohlcv = make_ohlcv([("2024-01-02T09:00:00Z", 100.00, 100.00, 99.50, 100.00)])
        signals = make_signals(ohlcv, {})

        with pytest.raises(ValueError, match="trail_distance_pips"):
            run_backtest(ohlcv, signals, cfg(trail_type="continuous"))

    def test_short_continuous_trail(self):
        """
        Short trade: trail distance=20 pips, SL ratchets downward.
        Entry=100.00, SL=101.00.
        Bar 1: low=99.80 -> candidate_sl=99.80+0.20=100.00 < 101.00 -> SL moves to 100.00;
               high=99.99 < 100.00 -> no exit (high must be BELOW new SL of 100.00)
        Bar 2: low=99.50 -> candidate_sl=99.70 < 100.00 -> SL moves to 99.70;
               high=99.80 > 99.70 -> SL_TRAILED; pnl = (100.00-99.70)/0.01 = 30 pips
        """
        ohlcv = make_ohlcv([
            ("2024-01-02T09:00:00Z", 100.00, 100.50, 100.00, 100.00),  # signal
            ("2024-01-02T09:01:00Z", 100.00, 99.99,  99.80, 99.90),    # entry (short, low<=100.00); SL->100.00; high=99.99<100.00->no exit
            ("2024-01-02T09:02:00Z", 99.90,  99.80,  99.50, 99.60),    # SL->99.70; high=99.80>99.70->SL_TRAILED
        ])
        signals = make_signals(ohlcv, {
            "2024-01-02T09:00:00Z": {"short_entry": 100.00, "short_sl": 101.00},
        })
        signals["trail_type"] = "continuous"
        signals["trail_distance_pips"] = 20.0

        result = run_backtest(ohlcv, signals, cfg())

        assert len(result.trades) == 1
        t = result.trades[0]
        assert t.direction == "short"
        assert t.exit_reason == "SL_TRAILED"
        assert t.exit_price == pytest.approx(99.70, abs=0.001)
        assert t.pnl_pips == pytest.approx(30.0, abs=0.1)


# ── PROJ-30: Partial Close ────────────────────────────────────────────────────

class TestPartialClose:
    """Partial close: percentage of position closed at profit target."""

    def test_partial_at_pips_creates_partial_trade_then_sl(self):
        """
        Long: partial_close_pct=40, partial_at_pips=50.
        Bar 2: high=100.50 (+50 pips) -> PARTIAL fires (0.40 lots @ 100.50)
        Bar 3: low=98.90 < SL=99.00 -> SL on remaining 0.60 lots
        Balance: +20 (partial) + (-60) (SL) = -40 -> final = 9960
        """
        ohlcv = make_ohlcv([
            ("2024-01-02T09:00:00Z", 100.00, 100.00, 99.50, 100.00),  # signal
            ("2024-01-02T09:01:00Z", 100.00, 100.10, 99.95, 100.05),  # entry
            ("2024-01-02T09:02:00Z", 100.05, 100.50, 100.00, 100.40), # PARTIAL fires
            ("2024-01-02T09:03:00Z", 100.40, 100.45, 98.90, 99.10),   # SL on remaining
        ])
        signals = make_signals(ohlcv, {
            "2024-01-02T09:00:00Z": {"long_entry": 100.00, "long_sl": 99.00},
        })
        signals["partial_close_pct"] = 40.0
        signals["partial_at_pips"] = 50.0

        result = run_backtest(ohlcv, signals, cfg())

        assert len(result.trades) == 2

        partial = result.trades[0]
        assert partial.exit_reason == "PARTIAL"
        assert partial.lot_size == pytest.approx(0.40, abs=0.001)
        assert partial.exit_price == pytest.approx(100.50, abs=0.001)
        assert partial.pnl_pips == pytest.approx(50.0, abs=0.1)
        assert partial.pnl_currency == pytest.approx(20.0, abs=0.01)

        final = result.trades[1]
        assert final.exit_reason == "SL"
        assert final.lot_size == pytest.approx(0.60, abs=0.001)
        assert final.pnl_pips == pytest.approx(-100.0, abs=0.1)
        assert final.pnl_currency == pytest.approx(-60.0, abs=0.01)

        assert result.final_balance == pytest.approx(9960.0, abs=0.01)

    def test_partial_at_r_trigger(self):
        """
        partial_at_r=2.0: trigger at 2R.
        Entry=100.00, SL=99.00 -> initial_risk=100 pips.
        Trigger at 200 pips = price 102.00.
        Bar 2: high=102.05 -> PARTIAL fires (50% of 1.0 lot = 0.50)
        """
        ohlcv = make_ohlcv([
            ("2024-01-02T09:00:00Z", 100.00, 100.00, 99.50, 100.00),  # signal
            ("2024-01-02T09:01:00Z", 100.00, 100.10, 99.95, 100.05),  # entry
            ("2024-01-02T09:02:00Z", 100.05, 102.05, 100.00, 102.00), # 205 pips >= 200 -> partial
            ("2024-01-02T09:03:00Z", 102.00, 102.10, 98.90, 99.10),   # SL on remaining
        ])
        signals = make_signals(ohlcv, {
            "2024-01-02T09:00:00Z": {"long_entry": 100.00, "long_sl": 99.00},
        })
        signals["partial_close_pct"] = 50.0
        signals["partial_at_r"] = 2.0

        result = run_backtest(ohlcv, signals, cfg())

        assert len(result.trades) == 2
        partial = result.trades[0]
        assert partial.exit_reason == "PARTIAL"
        assert partial.lot_size == pytest.approx(0.50, abs=0.001)
        assert partial.pnl_pips == pytest.approx(205.0, abs=0.1)

    def test_partial_fires_at_most_once(self):
        """
        Partial trigger level reached again on bar 3 -> must NOT re-fire.
        Expected: exactly 1 PARTIAL trade + 1 SL trade.
        """
        ohlcv = make_ohlcv([
            ("2024-01-02T09:00:00Z", 100.00, 100.00, 99.50, 100.00),  # signal
            ("2024-01-02T09:01:00Z", 100.00, 100.10, 99.95, 100.05),  # entry
            ("2024-01-02T09:02:00Z", 100.05, 100.50, 100.00, 100.40), # PARTIAL fires
            ("2024-01-02T09:03:00Z", 100.40, 100.55, 100.35, 100.50), # trigger again -> no second partial
            ("2024-01-02T09:04:00Z", 100.50, 100.60, 98.90, 99.00),   # SL hit
        ])
        signals = make_signals(ohlcv, {
            "2024-01-02T09:00:00Z": {"long_entry": 100.00, "long_sl": 99.00},
        })
        signals["partial_close_pct"] = 40.0
        signals["partial_at_pips"] = 50.0

        result = run_backtest(ohlcv, signals, cfg())

        assert len(result.trades) == 2
        assert result.trades[0].exit_reason == "PARTIAL"
        assert result.trades[1].exit_reason == "SL"
        assert result.trades[1].lot_size == pytest.approx(0.60, abs=0.001)

    def test_sl_takes_priority_over_partial_same_bar(self):
        """
        SL and partial trigger on same bar -> SL wins; no PARTIAL trade created.
        Bar 2: high=100.50 (50 pips -> partial trigger) AND low=98.90 (SL hit).
        """
        ohlcv = make_ohlcv([
            ("2024-01-02T09:00:00Z", 100.00, 100.00, 99.50, 100.00),  # signal
            ("2024-01-02T09:01:00Z", 100.00, 100.10, 99.95, 100.05),  # entry
            ("2024-01-02T09:02:00Z", 100.05, 100.50, 98.90, 99.50),   # both triggers on same bar
        ])
        signals = make_signals(ohlcv, {
            "2024-01-02T09:00:00Z": {"long_entry": 100.00, "long_sl": 99.00},
        })
        signals["partial_close_pct"] = 40.0
        signals["partial_at_pips"] = 50.0

        result = run_backtest(ohlcv, signals, cfg())

        assert len(result.trades) == 1
        assert result.trades[0].exit_reason == "SL"
        assert result.trades[0].lot_size == pytest.approx(1.0, abs=0.001)

    def test_tp_takes_priority_over_partial_same_bar(self):
        """
        TP and partial trigger on same bar -> TP wins; no PARTIAL trade created.
        Bar 2: high=101.00 (TP) and 50-pip partial trigger both hit.
        """
        ohlcv = make_ohlcv([
            ("2024-01-02T09:00:00Z", 100.00, 100.00, 99.50, 100.00),  # signal
            ("2024-01-02T09:01:00Z", 100.00, 100.10, 99.95, 100.05),  # entry
            ("2024-01-02T09:02:00Z", 100.05, 101.00, 99.95, 100.90),  # TP=101 AND partial@50pips
        ])
        signals = make_signals(ohlcv, {
            "2024-01-02T09:00:00Z": {"long_entry": 100.00, "long_sl": 99.00, "long_tp": 101.00},
        })
        signals["partial_close_pct"] = 40.0
        signals["partial_at_pips"] = 50.0

        result = run_backtest(ohlcv, signals, cfg())

        assert len(result.trades) == 1
        assert result.trades[0].exit_reason == "TP"
        assert result.trades[0].lot_size == pytest.approx(1.0, abs=0.001)

    def test_partial_at_pips_wins_over_partial_at_r_when_both_set(self):
        """
        Both partial_at_pips and partial_at_r set -> partial_at_pips takes priority.
        partial_at_pips=50 -> triggers at 100.50.
        partial_at_r=0.3 -> 30 pips threshold (lower), but must be ignored.
        """
        ohlcv = make_ohlcv([
            ("2024-01-02T09:00:00Z", 100.00, 100.00, 99.50, 100.00),  # signal
            ("2024-01-02T09:01:00Z", 100.00, 100.10, 99.95, 100.05),  # entry
            ("2024-01-02T09:02:00Z", 100.05, 100.50, 100.00, 100.40), # partial@50pips fires
            ("2024-01-02T09:03:00Z", 100.40, 100.45, 98.90, 99.10),   # SL
        ])
        signals = make_signals(ohlcv, {
            "2024-01-02T09:00:00Z": {"long_entry": 100.00, "long_sl": 99.00},
        })
        signals["partial_close_pct"] = 40.0
        signals["partial_at_pips"] = 50.0
        signals["partial_at_r"] = 0.3  # 30 pips threshold; must be ignored

        result = run_backtest(ohlcv, signals, cfg())

        assert len(result.trades) == 2
        partial = result.trades[0]
        # Must fire at partial_at_pips level (100.50), not at partial_at_r level (~100.30)
        assert partial.exit_price == pytest.approx(100.50, abs=0.001)

    def test_partial_at_r_with_zero_initial_risk_is_disabled(self):
        """
        partial_at_r with entry==SL (initial_risk_pips=0) must not fire (zero-division guard).
        """
        ohlcv = make_ohlcv([
            ("2024-01-02T09:00:00Z", 100.00, 100.00, 99.50, 100.00),  # signal
            ("2024-01-02T09:01:00Z", 100.00, 100.50, 99.90, 100.30),  # entry (SL=entry)
            ("2024-01-02T09:02:00Z", 100.30, 100.60, 99.85, 99.90),   # SL hit (low<SL=100.00)
        ])
        signals = make_signals(ohlcv, {
            "2024-01-02T09:00:00Z": {"long_entry": 100.00, "long_sl": 100.00},  # entry == SL -> risk=0
        })
        signals["partial_close_pct"] = 40.0
        signals["partial_at_r"] = 2.0

        result = run_backtest(ohlcv, signals, cfg())

        partial_trades = [t for t in result.trades if t.exit_reason == "PARTIAL"]
        assert len(partial_trades) == 0

    def test_partial_disabled_when_pct_is_zero(self):
        """partial_close_pct=0 must disable partial close entirely."""
        ohlcv = make_ohlcv([
            ("2024-01-02T09:00:00Z", 100.00, 100.00, 99.50, 100.00),
            ("2024-01-02T09:01:00Z", 100.00, 100.10, 99.95, 100.05),  # entry
            ("2024-01-02T09:02:00Z", 100.05, 100.50, 100.00, 100.40), # high=50 pips -> would trigger if enabled
            ("2024-01-02T09:03:00Z", 100.40, 100.45, 98.90, 99.10),   # SL
        ])
        signals = make_signals(ohlcv, {
            "2024-01-02T09:00:00Z": {"long_entry": 100.00, "long_sl": 99.00},
        })
        signals["partial_close_pct"] = 0.0
        signals["partial_at_pips"] = 50.0

        result = run_backtest(ohlcv, signals, cfg())

        assert len(result.trades) == 1
        assert result.trades[0].exit_reason == "SL"

    def test_continuous_trail_and_partial_work_together(self):
        """
        PROJ-30 combo: partial close fires first; continuous trail continues on reduced lot.

        Engine order per bar: trail -> check SL/TP -> if no exit: check partial.
        Bar 2: high=100.50 -> trail: SL->100.30; low=100.40>100.30 -> no SL exit; partial fires (50pips)
               PARTIAL (0.40 lots); remaining=0.60
        Bar 3: high=101.00 -> trail: SL->100.80; low=100.75<100.80 -> SL_TRAILED (0.60 lots)
        Key: bar 2 low (100.40) must be > trail-moved SL (100.30) so position survives to partial check.
        """
        ohlcv = make_ohlcv([
            ("2024-01-02T09:00:00Z", 100.00, 100.00, 99.50, 100.00),  # signal
            ("2024-01-02T09:01:00Z", 100.00, 100.10, 99.95, 100.05),  # entry; trail: SL->99.90
            ("2024-01-02T09:02:00Z", 100.05, 100.50, 100.40, 100.45), # trail: SL->100.30; low=100.40>100.30->no exit; partial fires
            ("2024-01-02T09:03:00Z", 100.45, 101.00, 100.75, 100.90), # trail: SL->100.80; low=100.75<100.80->SL_TRAILED
        ])
        signals = make_signals(ohlcv, {
            "2024-01-02T09:00:00Z": {"long_entry": 100.00, "long_sl": 99.00},
        })
        signals["trail_type"] = "continuous"
        signals["trail_distance_pips"] = 20.0
        signals["partial_close_pct"] = 40.0
        signals["partial_at_pips"] = 50.0

        result = run_backtest(ohlcv, signals, cfg())

        assert len(result.trades) == 2
        assert result.trades[0].exit_reason == "PARTIAL"
        assert result.trades[0].lot_size == pytest.approx(0.40, abs=0.001)
        assert result.trades[1].exit_reason == "SL_TRAILED"
        assert result.trades[1].lot_size == pytest.approx(0.60, abs=0.001)
        assert result.trades[1].exit_price == pytest.approx(100.80, abs=0.001)


# ── PROJ-30: Backwards Compatibility ─────────────────────────────────────────

class TestPROJ30BackwardsCompatibility:
    """Regression: existing step-trail and no-trail behaviour must be unchanged."""

    def test_default_step_trail_unchanged(self):
        """
        trail_type defaults to 'step'; no new fields -> behaviour identical to pre-PROJ-30.
        """
        ohlcv = make_ohlcv([
            ("2024-01-02T09:00:00Z", 1950, 1956, 1948, 1954),
            ("2024-01-02T09:01:00Z", 1954, 1962, 1953, 1960),  # entry
            ("2024-01-02T09:02:00Z", 1960, 1980, 1959, 1978),  # TP at 1970
        ])
        signals = make_signals(ohlcv, {
            "2024-01-02T09:00:00Z": {
                "long_entry": 1955.0, "long_sl": 1940.0, "long_tp": 1970.0
            },
        })

        result = run_backtest(ohlcv, signals, cfg())

        assert len(result.trades) == 1
        t = result.trades[0]
        assert t.exit_reason == "TP"
        assert t.pnl_currency == pytest.approx(1500.0, abs=0.01)
        assert result.final_balance == pytest.approx(11_500.0, abs=0.01)

    def test_determinism_with_no_proj30_fields(self):
        """Two identical runs produce identical results."""
        ohlcv = make_ohlcv([
            ("2024-01-02T09:00:00Z", 100.00, 100.00, 99.50, 100.00),
            ("2024-01-02T09:01:00Z", 100.00, 100.10, 99.95, 100.05),
            ("2024-01-02T09:02:00Z", 100.25, 100.50, 100.20, 100.40),
        ])
        signals = make_signals(ohlcv, {
            "2024-01-02T09:00:00Z": {"long_entry": 100.00, "long_sl": 99.00},
        })

        r1 = run_backtest(ohlcv, signals, cfg())
        r2 = run_backtest(ohlcv, signals, cfg())

        assert r1.final_balance == r2.final_balance
        assert len(r1.trades) == len(r2.trades)
