"""
Tests for the params-injection helper used by the /sandbox/run endpoint
(PROJ-22 MQL Converter).

The MQL→Python converter generates strategies that read pip_size via
params.get("pip_size", 0.0001). Before this fix, pip_size was passed only
inside config.instrument and never injected into the strategy's params dict,
so generated strategies fell back to the forex default (0.0001) and produced
100× too small SL/TP distances on XAUUSD (pip_size=0.01).

These tests pin down the merge contract so the regression cannot recur.
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from main import _merge_strategy_params, InstrumentConfigRequest


GOLD = InstrumentConfigRequest(pip_size=0.01, pip_value_per_lot=1.0)
EURUSD = InstrumentConfigRequest(pip_size=0.0001, pip_value_per_lot=10.0)


def test_pip_size_injected_when_params_empty():
    merged = _merge_strategy_params({}, GOLD)
    assert merged["pip_size"] == 0.01
    assert merged["pip_value_per_lot"] == 1.0


def test_user_strategy_inputs_preserved():
    user_params = {"stop_loss_pips": 500, "take_profit_pips": 750, "risk_percent": 1.0}
    merged = _merge_strategy_params(user_params, GOLD)

    assert merged["stop_loss_pips"] == 500
    assert merged["take_profit_pips"] == 750
    assert merged["risk_percent"] == 1.0
    assert merged["pip_size"] == 0.01
    assert merged["pip_value_per_lot"] == 1.0


def test_server_side_keys_override_user_collisions():
    """User cannot override pip_size/pip_value_per_lot from the client side —
    these are derived from the instruments DB and must not be tampered with."""
    user_params = {"pip_size": 0.0001, "pip_value_per_lot": 99.0, "stop_loss_pips": 50}
    merged = _merge_strategy_params(user_params, GOLD)

    assert merged["pip_size"] == 0.01
    assert merged["pip_value_per_lot"] == 1.0
    assert merged["stop_loss_pips"] == 50


def test_forex_instrument_passes_through():
    merged = _merge_strategy_params({"stop_loss_pips": 20}, EURUSD)
    assert merged["pip_size"] == 0.0001
    assert merged["pip_value_per_lot"] == 10.0
    assert merged["stop_loss_pips"] == 20


def test_input_dict_not_mutated():
    user_params = {"stop_loss_pips": 500}
    _merge_strategy_params(user_params, GOLD)
    assert user_params == {"stop_loss_pips": 500}, "merge must not mutate input"
