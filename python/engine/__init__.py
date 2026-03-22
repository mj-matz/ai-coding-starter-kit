"""Backtesting Engine (PROJ-2 + PROJ-15).

Public entry point: run_backtest() in engine.py
"""
from .engine import run_backtest
from .models import BacktestConfig, InstrumentConfig, Trade, BacktestResult
from .position_tracker import is_sl_tp_ambiguous, resolve_exit_with_1s_data

__all__ = [
    "run_backtest",
    "BacktestConfig",
    "InstrumentConfig",
    "Trade",
    "BacktestResult",
    "is_sl_tp_ambiguous",
    "resolve_exit_with_1s_data",
]
