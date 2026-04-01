"""Strategy Registry — auto-discovers all strategy files in this directory.

Scans the ``python/strategies/`` package for modules that expose a
``STRATEGY_ID`` string.  Each qualifying module must also expose:

    STRATEGY_ID   : str                — unique slug, e.g. "moving_average_crossover"
    STRATEGY_NAME : str                — human-readable label
    STRATEGY_DESC : str                — one-line description for the UI
    PARAMS_SCHEMA : Type[BaseModel]    — Pydantic model for parameter validation
    StrategyClass : Type[BaseStrategy] — concrete strategy implementation

The registry builds a dict  ``strategy_id -> StrategyInfo``  that is consumed by
the ``GET /api/strategies`` endpoint and the backtest orchestration endpoint.
"""

import importlib
import logging
import pkgutil
from dataclasses import dataclass
from typing import Any, Dict, Type

from pydantic import BaseModel

from .base import BaseStrategy

logger = logging.getLogger(__name__)


@dataclass
class StrategyInfo:
    """Metadata + factory for one registered strategy."""

    id: str
    name: str
    description: str
    params_schema: Type[BaseModel]  # Pydantic model — used for validation + JSON Schema
    strategy_class: Type[BaseStrategy]


# Module-level cache so we only scan once (populated lazily on first access).
_registry: Dict[str, StrategyInfo] | None = None


def _scan_strategies() -> Dict[str, StrategyInfo]:
    """Import every sibling module and collect those that declare a STRATEGY_ID."""
    import strategies as _pkg  # noqa: E402 — the package we live in

    result: Dict[str, StrategyInfo] = {}

    for importer, mod_name, is_pkg in pkgutil.iter_modules(_pkg.__path__):
        if mod_name.startswith("_") or mod_name in ("base", "registry"):
            continue
        try:
            mod = importlib.import_module(f"strategies.{mod_name}")
        except Exception:
            logger.exception("Failed to import strategy module '%s'", mod_name)
            continue

        strategy_id = getattr(mod, "STRATEGY_ID", None)
        if strategy_id is None:
            continue

        # Validate required exports
        missing = [
            attr
            for attr in ("STRATEGY_NAME", "STRATEGY_DESC", "PARAMS_SCHEMA", "StrategyClass")
            if not hasattr(mod, attr)
        ]
        if missing:
            logger.warning(
                "Strategy module '%s' declares STRATEGY_ID but is missing: %s — skipped",
                mod_name,
                ", ".join(missing),
            )
            continue

        params_schema = getattr(mod, "PARAMS_SCHEMA")
        # Validate that PARAMS_SCHEMA is a Pydantic model
        if not (isinstance(params_schema, type) and issubclass(params_schema, BaseModel)):
            logger.warning(
                "Strategy '%s': PARAMS_SCHEMA is not a Pydantic BaseModel — skipped",
                strategy_id,
            )
            continue

        result[strategy_id] = StrategyInfo(
            id=strategy_id,
            name=getattr(mod, "STRATEGY_NAME"),
            description=getattr(mod, "STRATEGY_DESC"),
            params_schema=params_schema,
            strategy_class=getattr(mod, "StrategyClass"),
        )
        logger.info("Registered strategy: %s (%s)", strategy_id, mod_name)

    return result


def get_registry() -> Dict[str, StrategyInfo]:
    """Return the strategy registry, scanning on first call."""
    global _registry
    if _registry is None:
        _registry = _scan_strategies()
    return _registry


def get_strategy(strategy_id: str) -> StrategyInfo:
    """Look up a strategy by ID.  Raises ``KeyError`` if unknown."""
    reg = get_registry()
    if strategy_id not in reg:
        known = ", ".join(sorted(reg.keys()))
        raise KeyError(
            f"Unknown strategy '{strategy_id}'. Available: {known}"
        )
    return reg[strategy_id]


def list_strategies() -> list[dict]:
    """Return a JSON-serialisable list of all strategies with their schemas."""
    result = []
    for info in get_registry().values():
        result.append({
            "id": info.id,
            "name": info.name,
            "description": info.description,
            "parameters_schema": info.params_schema.model_json_schema(),
        })
    return result
