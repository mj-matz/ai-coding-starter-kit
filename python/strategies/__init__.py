"""Trading strategies for the backtesting engine (PROJ-3 / PROJ-6)."""

from .base import BaseStrategy
from .breakout import BreakoutStrategy, BreakoutParams
from .registry import get_registry, get_strategy, list_strategies

__all__ = [
    "BaseStrategy",
    "BreakoutStrategy",
    "BreakoutParams",
    "get_registry",
    "get_strategy",
    "list_strategies",
]
