"""RSI Threshold Strategy (PROJ-6).

Generates entry signals when RSI crosses oversold/overbought levels,
using a level-cross principle (waits for reversal instead of immediate entry).

Signal-Timing:
    Long-Entry:  RSI[i-1] < oversold   AND  RSI[i] >= oversold  (crosses UP from below)
    Short-Entry: RSI[i-1] > overbought AND  RSI[i] <= overbought (crosses DOWN from above)

Exit via opposite signal: when a position is open and the opposite cross occurs,
a ``signal_exit`` flag is set so the engine closes at bar open.

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
STRATEGY_ID = "rsi_threshold"
STRATEGY_NAME = "RSI Threshold"
STRATEGY_DESC = (
    "Generiert Signale bei RSI-Level-Kreuzungen "
    "(Mean-Reversion: Einstieg nach Oversold/Overbought-Umkehr)."
)


class RSIParamsSchema(BaseModel):
    """Pydantic schema — doubles as JSON-Schema for UI form generation."""

    rsiPeriod: int = Field(
        default=14, ge=2, le=200,
        json_schema_extra={"label": "RSI Period"},
    )
    oversoldLevel: float = Field(
        default=30, ge=1, le=99,
        json_schema_extra={"label": "Oversold Level"},
    )
    overboughtLevel: float = Field(
        default=70, ge=1, le=99,
        json_schema_extra={"label": "Overbought Level"},
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


PARAMS_SCHEMA = RSIParamsSchema


@dataclass
class SkippedDay:
    date: str
    reason: str


@dataclass
class RSIParams:
    """Internal params object consumed by generate_signals."""

    asset: str
    rsi_period: int
    oversold_level: float
    overbought_level: float
    stop_loss_pips: float
    take_profit_pips: Optional[float]
    pip_size: float
    direction_filter: Literal["long_only", "short_only", "both"]


def _compute_rsi(close: np.ndarray, period: int) -> np.ndarray:
    """Compute Wilder's RSI using exponential moving average of gains/losses."""
    deltas = np.diff(close)
    gains = np.where(deltas > 0, deltas, 0.0)
    losses = np.where(deltas < 0, -deltas, 0.0)

    rsi = np.full(len(close), np.nan)

    if len(deltas) < period:
        return rsi

    # Seed with simple average
    avg_gain = np.mean(gains[:period])
    avg_loss = np.mean(losses[:period])

    if avg_loss == 0:
        rsi[period] = 100.0
    else:
        rs = avg_gain / avg_loss
        rsi[period] = 100.0 - (100.0 / (1.0 + rs))

    # Wilder's smoothing
    for i in range(period, len(deltas)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period

        if avg_loss == 0:
            rsi[i + 1] = 100.0
        else:
            rs = avg_gain / avg_loss
            rsi[i + 1] = 100.0 - (100.0 / (1.0 + rs))

    return rsi


class RSIThresholdStrategy(BaseStrategy):
    """RSI Threshold: mean-reversion via oversold/overbought level crossings."""

    def validate_params(self, params: RSIParams) -> None:
        if params.oversold_level >= params.overbought_level:
            raise ValueError(
                f"oversold_level ({params.oversold_level}) must be < "
                f"overbought_level ({params.overbought_level})"
            )
        if params.stop_loss_pips <= 0:
            raise ValueError(f"stop_loss_pips must be > 0, got {params.stop_loss_pips}")
        if params.take_profit_pips is not None and params.take_profit_pips <= 0:
            raise ValueError(f"take_profit_pips must be > 0, got {params.take_profit_pips}")
        if params.pip_size <= 0:
            raise ValueError(f"pip_size must be > 0, got {params.pip_size}")

    def generate_signals(
        self, df: pd.DataFrame, params: RSIParams
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

        if len(df) < params.rsi_period + 2:
            return signals, skipped_days

        # Compute RSI
        close = df["close"].to_numpy(dtype=float)
        rsi = _compute_rsi(close, params.rsi_period)

        sl_offset = params.stop_loss_pips * params.pip_size
        tp_offset = (params.take_profit_pips * params.pip_size) if params.take_profit_pips else None

        for i in range(params.rsi_period + 1, len(df)):
            if np.isnan(rsi[i]) or np.isnan(rsi[i - 1]):
                continue

            prev_rsi = rsi[i - 1]
            curr_rsi = rsi[i]

            entry_price = close[i]
            idx = df.index[i]

            # Long signal: RSI crosses oversold level upward
            long_cross = prev_rsi < params.oversold_level and curr_rsi >= params.oversold_level
            # Short signal: RSI crosses overbought level downward
            short_cross = prev_rsi > params.overbought_level and curr_rsi <= params.overbought_level

            if long_cross:
                if params.direction_filter != "short_only":
                    signals.at[idx, "long_entry"] = entry_price
                    signals.at[idx, "long_sl"] = entry_price - sl_offset
                    if tp_offset is not None:
                        signals.at[idx, "long_tp"] = entry_price + tp_offset
                if params.direction_filter != "long_only":
                    # Exit signal for open short positions
                    signals.at[idx, "signal_exit"] = 1.0

            if short_cross:
                if params.direction_filter != "long_only":
                    signals.at[idx, "short_entry"] = entry_price
                    signals.at[idx, "short_sl"] = entry_price + sl_offset
                    if tp_offset is not None:
                        signals.at[idx, "short_tp"] = entry_price - tp_offset
                if params.direction_filter != "short_only":
                    # Exit signal for open long positions
                    signals.at[idx, "signal_exit"] = 1.0

        return signals, skipped_days


# Registry alias
StrategyClass = RSIThresholdStrategy
