"""Moving Average Crossover Strategy (PROJ-6).

Generates entry/exit signals when a fast MA crosses a slow MA.

Signal-Timing:
    Long-Entry:  fast_ma[i-1] <= slow_ma[i-1]  AND  fast_ma[i] > slow_ma[i]
    Short-Entry: fast_ma[i-1] >= slow_ma[i-1]  AND  fast_ma[i] < slow_ma[i]

Exit via opposite signal: when a position is open and the opposite crossover
occurs, a ``signal_exit`` flag is set so the engine closes at bar open.

Direction-Filter:
    - ``long``:  only long entries; bearish cross = exit signal only
    - ``short``: only short entries; bullish cross = exit signal only
    - ``both``:  long + short entries; opposite cross = close + open

No hour filter: all bars of the day are used (full-day data required).

Registry exports:
    STRATEGY_ID, STRATEGY_NAME, STRATEGY_DESC, PARAMS_SCHEMA, StrategyClass
"""

from dataclasses import dataclass
from typing import Literal, Optional

import numpy as np
import pandas as pd
from pydantic import BaseModel, Field

from .base import BaseStrategy

# ── Registry metadata ───────────────────────────────────────────────────────
STRATEGY_ID = "moving_average_crossover"
STRATEGY_NAME = "Moving Average Crossover"
STRATEGY_DESC = (
    "Generiert Signale, wenn ein schneller gleitender Durchschnitt "
    "einen langsamen kreuzt (Trend-Following)."
)


class MAParamsSchema(BaseModel):
    """Pydantic schema — doubles as JSON-Schema for UI form generation."""

    fastPeriod: int = Field(
        default=10, ge=2, le=500,
        json_schema_extra={"label": "Fast MA Period"},
    )
    slowPeriod: int = Field(
        default=50, ge=2, le=500,
        json_schema_extra={"label": "Slow MA Period"},
    )
    stopLoss: float = Field(
        default=50, gt=0,
        json_schema_extra={"label": "Stop Loss (Pips)"},
    )
    takeProfit: Optional[float] = Field(
        default=None, gt=0,
        json_schema_extra={"label": "Take Profit (Pips) — leer = nur Signal-Exit"},
    )
    direction: Literal["long", "short", "both"] = Field(
        default="both",
        json_schema_extra={"label": "Direction"},
    )


PARAMS_SCHEMA = MAParamsSchema


@dataclass
class SkippedDay:
    date: str
    reason: str


@dataclass
class MAParams:
    """Internal params object consumed by generate_signals."""

    asset: str
    fast_period: int
    slow_period: int
    stop_loss_pips: float
    take_profit_pips: Optional[float]
    pip_size: float
    direction_filter: Literal["long_only", "short_only", "both"]


class MovingAverageCrossoverStrategy(BaseStrategy):
    """Moving Average Crossover: trend-following via fast/slow MA cross."""

    def validate_params(self, params: MAParams) -> None:
        if params.fast_period >= params.slow_period:
            raise ValueError(
                f"fast_period ({params.fast_period}) must be < slow_period ({params.slow_period})"
            )
        if params.stop_loss_pips <= 0:
            raise ValueError(f"stop_loss_pips must be > 0, got {params.stop_loss_pips}")
        if params.take_profit_pips is not None and params.take_profit_pips <= 0:
            raise ValueError(f"take_profit_pips must be > 0, got {params.take_profit_pips}")
        if params.pip_size <= 0:
            raise ValueError(f"pip_size must be > 0, got {params.pip_size}")

    def generate_signals(
        self, df: pd.DataFrame, params: MAParams
    ) -> tuple[pd.DataFrame, list[SkippedDay]]:
        self.validate_params(params)

        # Prepare output
        sig_cols = [
            "long_entry", "long_sl", "long_tp",
            "short_entry", "short_sl", "short_tp",
            "signal_exit",
        ]
        signals = pd.DataFrame(np.nan, index=df.index, columns=sig_cols, dtype=float)
        signals["signal_expiry"] = pd.Series(
            pd.NaT, index=df.index, dtype="datetime64[ns, UTC]"
        )

        skipped_days: list[SkippedDay] = []

        if len(df) < params.slow_period + 1:
            return signals, skipped_days

        # Compute MAs
        close = df["close"].to_numpy(dtype=float)
        fast_ma = pd.Series(close).rolling(params.fast_period).mean().to_numpy()
        slow_ma = pd.Series(close).rolling(params.slow_period).mean().to_numpy()

        sl_offset = params.stop_loss_pips * params.pip_size
        tp_offset = (params.take_profit_pips * params.pip_size) if params.take_profit_pips else None

        for i in range(params.slow_period, len(df)):
            if np.isnan(fast_ma[i]) or np.isnan(slow_ma[i]):
                continue
            if np.isnan(fast_ma[i - 1]) or np.isnan(slow_ma[i - 1]):
                continue

            prev_fast_above = fast_ma[i - 1] > slow_ma[i - 1]
            prev_fast_below = fast_ma[i - 1] < slow_ma[i - 1]
            prev_equal = fast_ma[i - 1] == slow_ma[i - 1]
            curr_fast_above = fast_ma[i] > slow_ma[i]
            curr_fast_below = fast_ma[i] < slow_ma[i]

            # Bullish crossover: fast crosses above slow
            bullish_cross = (prev_fast_below or prev_equal) and curr_fast_above
            # Bearish crossover: fast crosses below slow
            bearish_cross = (prev_fast_above or prev_equal) and curr_fast_below

            entry_price = close[i]  # market-order entry at current close
            idx = df.index[i]

            if bullish_cross:
                if params.direction_filter != "short_only":
                    # Long entry signal
                    signals.at[idx, "long_entry"] = entry_price
                    signals.at[idx, "long_sl"] = entry_price - sl_offset
                    if tp_offset is not None:
                        signals.at[idx, "long_tp"] = entry_price + tp_offset
                if params.direction_filter != "long_only":
                    # Exit signal for open short positions
                    signals.at[idx, "signal_exit"] = 1.0

            if bearish_cross:
                if params.direction_filter != "long_only":
                    # Short entry signal
                    signals.at[idx, "short_entry"] = entry_price
                    signals.at[idx, "short_sl"] = entry_price + sl_offset
                    if tp_offset is not None:
                        signals.at[idx, "short_tp"] = entry_price - tp_offset
                if params.direction_filter != "short_only":
                    # Exit signal for open long positions
                    signals.at[idx, "signal_exit"] = 1.0

        return signals, skipped_days


# Registry alias
StrategyClass = MovingAverageCrossoverStrategy
