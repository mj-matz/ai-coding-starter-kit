# PROJ-3: Time-Range Breakout Strategy

## Status: Planned
**Created:** 2026-03-09
**Last Updated:** 2026-03-09

## Dependencies
- Requires: PROJ-2 (Backtesting Engine) — strategy produces signals consumed by the engine

## User Stories
- As a trader, I want to define a time window (e.g. 14:30–15:30) from which the strategy derives a Range High and Range Low so that I can model opening range breakout setups.
- As a trader, I want to set a trigger deadline (e.g. 17:00) so that days where no breakout occurs before that time are automatically skipped.
- As a trader, I want to configure Stop Loss in pips/points so that my risk per trade is fixed and predictable.
- As a trader, I want to configure Take Profit in pips/points so that I can test different CRV ratios (e.g. 1R, 2R, 3.5R).
- As a trader, I want to configure a time-based exit (e.g. 21:00) so that open positions don't carry over to the next session.
- As a trader, I want to choose direction (Long only / Short only / Both) so that I can test asymmetric market behaviour.
- As a trader, I want to apply this strategy to any supported asset (XAUUSD, GER30, Forex pairs) so that I can compare its performance across instruments.
- As a trader, I want to configure an optional profit-lock rule (e.g. when +2R is reached, move SL to +1R) so that I can test strategies that protect partial profits without a full trailing stop.

## Acceptance Criteria
- [ ] Strategy reads all configurable parameters (see parameter list below) without hardcoded values
- [ ] Range is calculated from bars whose datetime falls within [range_start, range_end) — inclusive start, exclusive end
- [ ] If no bars exist in the range window for a given day, that day is skipped (no trade)
- [ ] Buy Stop is placed 1 pip/point above Range High; Sell Stop 1 pip/point below Range Low
- [ ] Only the first triggered order per day is taken; the opposing order is cancelled immediately (OCO)
- [ ] If no trigger occurs before trigger_deadline, all pending orders for that day are cancelled
- [ ] Stop Loss is placed as a fixed pip/point offset from entry price
- [ ] Take Profit is placed as a fixed pip/point offset from entry price
- [ ] Time exit closes any open position at time_exit (delegated to engine)
- [ ] Maximum 1 trade per day is enforced
- [ ] Direction filter: "Long only" suppresses Sell Stop; "Short only" suppresses Buy Stop; "Both" places both
- [ ] Strategy parameters are validated on input (e.g. range_end must be after range_start, SL > 0, TP > 0)
- [ ] Optional profit-lock parameters passed to engine: `trail_trigger_pips` (profit level that activates the SL step) and `trail_lock_pips` (new SL offset from entry after activation)
- [ ] Validation: if trail is configured, `trail_trigger_pips` > `trail_lock_pips` > 0, and `trail_trigger_pips` < `take_profit_pips`
- [ ] If trail parameters are left empty/null, strategy runs with fixed SL (default behaviour)

## Strategy Parameters

| Parameter | Type | Example (XAUUSD) | Example (DAX) |
|-----------|------|-----------------|--------------|
| `asset` | string | XAUUSD | GER40 |
| `range_start` | time (HH:MM) | 14:30 | 09:00 |
| `range_end` | time (HH:MM) | 15:30 | 10:00 |
| `trigger_deadline` | time (HH:MM) | 17:00 | 11:30 |
| `time_exit` | time (HH:MM) | 21:00 | 17:30 |
| `stop_loss_pips` | float | 50 | 30 |
| `take_profit_pips` | float | 175 | 90 |
| `direction` | enum | Both | Both |
| `position_sizing_mode` | enum | risk_percent | risk_percent |
| `risk_percent` | float (if mode=risk_percent) | 1.0 | 1.0 |
| `lot_size` | float (if mode=fixed_lot) | — | — |
| `commission_pips` | float | 0.5 | 1.0 |
| `slippage_pips` | float | 0.2 | 0.5 |
| `trail_trigger_pips` | float (optional) | 100 (= 2R) | 60 (= 2R) |
| `trail_lock_pips` | float (optional) | 50 (= 1R) | 30 (= 1R) |
| `start_date` | date | 2022-01-01 | 2022-01-01 |
| `end_date` | date | 2024-12-31 | 2024-12-31 |

## Edge Cases
- Range window contains only 1 bar → still valid, use that bar's H/L as the range
- Range High equals Range Low (flat range) → skip that day, no trade
- Price gaps over the SL or TP level at open → fill at open price (gap fill), not at the theoretical level
- Trigger occurs exactly at trigger_deadline timestamp → treat as valid (inclusive)
- Daylight saving time transitions → all times are in local exchange timezone; UTC conversion must be handled per instrument
- Multiple bars hit both SL and TP in the same bar → engine handles this (worst-case SL rule)

## Technical Requirements
- Strategy implemented as a Python class/function that accepts parameters and OHLCV DataFrame, returns a list of signals/orders
- All times stored and compared in UTC internally; timezone conversion applied per instrument
- Instrument timezone mapping: XAUUSD → UTC+1/UTC+2 (CET/CEST); GER30 → UTC+1/UTC+2 (CET/CEST)
- Strategy must be independently unit-testable without running a full backtest

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)
_To be added by /architecture_

## QA Test Results
_To be added by /qa_

## Deployment
_To be added by /deploy_
