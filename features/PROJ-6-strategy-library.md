# PROJ-6: Strategy Library (Plugin System)

## Status: Planned
**Created:** 2026-03-09
**Last Updated:** 2026-03-09

## Dependencies
- Requires: PROJ-2 (Backtesting Engine) — new strategies plug into the engine
- Requires: PROJ-3 (Time-Range Breakout Strategy) — serves as reference implementation
- Requires: PROJ-5 (Backtest UI) — UI must support dynamic strategy parameter forms

## User Stories
- As a trader, I want to select from a list of available strategy templates in the UI so that I can test different approaches without writing code.
- As a trader, I want each strategy to have its own parameter form so that I only see relevant fields for the selected strategy.
- As a developer, I want to add a new strategy by implementing a standard interface so that the UI and engine pick it up automatically.
- As a trader, I want a Moving Average Crossover strategy so that I can test trend-following approaches.
- As a trader, I want an RSI Threshold strategy so that I can test mean-reversion approaches.

## Acceptance Criteria
- [ ] Each strategy is defined by a standard Python interface: `name`, `description`, `parameters_schema`, `generate_signals(data, params)`
- [ ] Strategy registry: a single config file lists all available strategies; adding a new file auto-registers it
- [ ] UI reads the strategy registry and renders the correct parameter form for each strategy
- [ ] Time-Range Breakout (PROJ-3) is refactored to implement the standard interface as the reference
- [ ] Moving Average Crossover strategy implemented with parameters: fast_period, slow_period, direction
- [ ] RSI Threshold strategy implemented with parameters: rsi_period, oversold_level, overbought_level, direction
- [ ] Strategy selector in UI shows strategy name and short description
- [ ] Switching strategy in UI replaces the parameter form with the new strategy's fields
- [ ] All new strategies pass the same engine edge-case scenarios as PROJ-3

## Edge Cases
- Strategy generates 0 signals for the selected period → handled gracefully (empty trade log)
- Strategy produces conflicting signals on the same bar → engine takes first signal, ignores rest
- New strategy added with invalid schema → validation error at load time, not at runtime

## Technical Requirements
- Strategy plugin directory: `/python/strategies/`
- Each strategy is a single Python file implementing the `BaseStrategy` interface
- Parameter schema defined as Pydantic model (doubles as JSON Schema for UI form generation)
- No restart required to pick up new strategy files in development mode

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)
_To be added by /architecture_

## QA Test Results
_To be added by /qa_

## Deployment
_To be added by /deploy_
