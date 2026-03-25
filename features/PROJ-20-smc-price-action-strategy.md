# PROJ-20: SMC Price Action Strategy

## Status: Planned
**Created:** 2026-03-25
**Last Updated:** 2026-03-25

## Dependencies
- Requires: PROJ-2 (Backtesting Engine) — strategy runs inside the existing engine loop
- Requires: PROJ-3 (Time-Range Breakout Strategy) — reference implementation for strategy plugin interface
- Requires: PROJ-6 (Strategy Library / Plugin System) — this strategy registers as a plugin
- Requires: PROJ-5 (Backtest UI) — new strategy must be selectable in the configuration panel

## Overview
A rule-based trading strategy based on Smart Money Concepts (SMC) and Price Action principles. The strategy identifies trend direction through Market Structure analysis and Break of Structure signals, then enters trades on pullbacks to Supply & Demand zones. It uses a swing-based trailing stop and supports configurable timeframes via resampling of 1-minute base data.

## Concepts Implemented

### 1. Market Structure (HH / HL / LL / LH)
- Identify swing highs and swing lows using a configurable lookback window (N candles each side)
- **Bullish structure:** sequence of Higher Highs (HH) and Higher Lows (HL)
- **Bearish structure:** sequence of Lower Lows (LL) and Lower Highs (LH)

### 2. Break of Structure (BoS)
- **Bullish BoS:** price closes above the most recent confirmed swing high → trend is bullish
- **Bearish BoS:** price closes below the most recent confirmed swing low → trend is bearish
- BoS resets the active trend direction

### 3. Supply & Demand Zones
- **Demand zone:** price range around a swing low that preceded a strong bullish move (identified by a strong impulse candle originating from the zone)
- **Supply zone:** price range around a swing high that preceded a strong bearish move
- Zone width = high–low of the base candle (or candle cluster) at the origin of the impulse
- Zones are invalidated when price closes beyond them

### 4. Fair Value Gap (FVG)
- **Bullish FVG:** candle[i-1].high < candle[i+1].low — a gap that price may fill on retracement
- **Bearish FVG:** candle[i-1].low > candle[i+1].high
- FVGs are tracked as additional confluence with S&D zones

### 5. Equal Highs / Equal Lows (Liquidity Pools)
- Two swing highs within a configurable tolerance (e.g., 0.05% of price) = Equal High (EQH) → liquidity above
- Two swing lows within tolerance = Equal Low (EQL) → liquidity below
- Used for: (a) identifying likely sweep targets, (b) avoiding entries directly below EQH / above EQL

## Entry Logic

### Long Entry
1. Bullish BoS confirmed (price closed above last swing high)
2. Price retraces into an active Demand zone (or overlapping Bullish FVG)
3. A bullish confirmation candle closes inside or above the zone
4. No open position exists
5. Price is not within X% of an identified Equal High (liquidity above would risk sweep)

### Short Entry
1. Bearish BoS confirmed (price closed below last swing low)
2. Price retraces into an active Supply zone (or overlapping Bearish FVG)
3. A bearish confirmation candle closes inside or below the zone
4. No open position exists
5. Price is not within X% of an identified Equal Low (liquidity below would risk sweep)

## Exit Logic

### Trailing Stop (Swing-Based)
- Initial SL placed below the demand zone low (long) or above the supply zone high (short)
- After each newly confirmed swing low (long) or swing high (short) forms behind the trade, SL is moved to that swing point
- Trade closes when price hits the trailing SL
- No fixed TP — trade runs until SL is hit or time exit triggers

### Time Exit (Optional)
- If a configurable end-of-day time is set, all open positions are closed at that time

## Configurable Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `timeframe` | Candle size for strategy logic (1m, 5m, 15m, 1h) | 15m |
| `swing_lookback` | Candles on each side to confirm a swing high/low | 5 |
| `zone_tolerance_pct` | Tolerance for Equal High/Low detection (% of price) | 0.05% |
| `liquidity_buffer_pct` | Min distance from EQH/EQL to allow entry | 0.1% |
| `trailing_stop_offset_pips` | Additional buffer below swing low for SL placement | 10 |
| `time_exit` | Time to force-close all open positions (optional) | None |

## User Stories
- As a trader, I want to run a Price Action / SMC backtest on DAX, Gold, and Forex pairs so that I can evaluate the strategy's performance across asset classes.
- As a trader, I want to select the SMC strategy from the existing strategy dropdown so that I don't need a separate UI.
- As a trader, I want to configure the candle timeframe (1m to 1h) so that I can test the strategy on different resolutions.
- As a trader, I want the trailing stop to follow confirmed swing points so that winning trades capture the full trend move.
- As a trader, I want Supply & Demand zones and FVGs to be visible on the trade chart so that I can verify individual trade entries manually.
- As a trader, I want to see SMC-specific metrics in the results (avg bars in trade, % trades that hit a liquidity sweep before entry) so that I can assess strategy quality.

## Acceptance Criteria

### Strategy Registration
- [ ] SMC strategy is selectable in the Backtest configuration panel's strategy dropdown
- [ ] Strategy-specific parameters (timeframe, swing_lookback, etc.) appear dynamically when SMC is selected
- [ ] 1-minute Dukascopy data is automatically resampled to the selected timeframe before strategy logic runs

### Market Structure Detection
- [ ] Swing highs and lows are correctly identified using the configurable lookback window
- [ ] Market structure (HH/HL or LL/LH) is continuously updated as new candles close
- [ ] BoS is detected and logged with the candle index at which it occurred

### Zone Detection
- [ ] Active Supply and Demand zones are identified after each swing point
- [ ] Zones are invalidated (removed) when a candle closes beyond them
- [ ] Bullish and Bearish FVGs are identified and tracked
- [ ] Equal Highs and Equal Lows are detected within the configured tolerance

### Entry Execution
- [ ] Long entries are only taken after a bullish BoS and during a retracement to a Demand zone
- [ ] Short entries are only taken after a bearish BoS and during a retracement to a Supply zone
- [ ] Entries near Equal High/Low liquidity are filtered out based on `liquidity_buffer_pct`
- [ ] Only one position is open at a time

### Exit Execution
- [ ] Initial SL is placed at the zone boundary (+ trailing_stop_offset_pips buffer)
- [ ] SL is updated to each newly confirmed swing point behind the trade
- [ ] Trade closes when price touches the trailing SL
- [ ] Optional time exit closes all positions at the configured time

### Results & Visualization
- [ ] Trade list shows entry price, SL at entry, final SL at exit, and exit reason (trailing stop / time exit)
- [ ] Trade chart dialog shows Supply/Demand zones and FVGs as shaded regions
- [ ] Standard performance metrics apply (Profit Factor, Sharpe, Win Rate, Max Drawdown, CAGR)

## Edge Cases
- **No BoS on entire dataset:** Strategy produces 0 trades; results panel shows "No signals generated — try a longer date range or different timeframe."
- **Zone immediately invalidated:** If a zone is hit and then price closes through it in the same candle, the trade is not entered (zone must be valid at entry candle close).
- **Multiple overlapping zones:** If multiple Demand zones stack, entry uses the most recent (highest) valid zone.
- **Trailing stop moves against trade direction:** SL may only move in the direction favorable to the trade (never widen); a new swing behind the trade must be lower (long) than the current SL.
- **Resampling produces gaps:** If resampling from 1m to higher timeframe produces incomplete candles at session boundaries, incomplete candles are dropped.
- **Asset with no 1m data cached:** Strategy triggers the same "data not available" error as the Breakout strategy — prompts user to fetch data first.
- **Timeframe larger than available history:** If the user selects 1h but only 2 days of 1m data exist, the resampled dataset may be too short to form meaningful structure — show a warning (< 100 candles after resampling).

## Technical Requirements
- Security: Authentication required
- Resampling of 1m → higher timeframes must be performed in the Python backend (not frontend)
- Strategy must implement the same plugin interface as PROJ-3 (Breakout Strategy)
- Zone and FVG data must be included in the trade result payload for chart visualization
- All detections must be strictly bar-by-bar (no look-ahead): decisions at candle[i] may only use data up to candle[i]

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)
_To be added by /architecture_

## QA Test Results
_To be added by /qa_

## Deployment
_To be added by /deploy_
