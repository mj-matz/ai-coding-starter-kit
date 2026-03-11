# PROJ-1: Data Fetcher

## Status: Planned
**Created:** 2026-03-09
**Last Updated:** 2026-03-09

## Dependencies
- None

## User Stories
- As a trader, I want to download historical OHLCV data for XAUUSD on 1-minute resolution so that I can backtest intraday strategies with sufficient history.
- As a trader, I want to download DAX (GER30) 1-minute data from Dukascopy so that I can apply the same strategy templates to index instruments.
- As a trader, I want to download daily stock/ETF data via yfinance so that I can backtest longer-term strategies on equities.
- As a trader, I want downloaded data to be cached locally so that repeated backtests don't re-download the same data.
- As a trader, I want to see the available date range for a given asset so that I know how far back my backtest can go.

## Acceptance Criteria
- [ ] Dukascopy data can be fetched for: XAUUSD, GER30 (DAX), major Forex pairs (EUR/USD, GBP/USD, USD/CHF, etc.)
- [ ] yfinance data can be fetched for any valid ticker symbol (stocks, ETFs, indices) at daily resolution
- [ ] Fetched data is stored as local cache (e.g. Parquet files) to avoid redundant downloads
- [ ] Data is returned as OHLCV DataFrame with columns: datetime (UTC), open, high, low, close, volume
- [ ] Datetime index is timezone-aware (UTC) and monotonically increasing (no duplicates, no gaps beyond market hours)
- [ ] Resampling from tick/1m to higher timeframes (5m, 15m, 1h, 1d) works correctly (OHLCV aggregation rules respected)
- [ ] API returns clear error if asset symbol is not supported or data is unavailable for the requested date range
- [ ] Cache invalidation: user can force a refresh to re-download data

## Edge Cases
- Dukascopy returns no data for a weekend or holiday → filter these rows, don't treat as error
- Requested start date is before available history → return available range and warn user
- Network timeout during download → return partial data with error message, do not corrupt cache
- yfinance returns adjusted vs. unadjusted prices → always use adjusted close for daily data
- Timezone handling: Dukascopy data is in UTC; local market hours (e.g. 14:30 Frankfurt time) must be correctly mapped to UTC

## Technical Requirements
- Python script/module callable from Next.js API route via subprocess or FastAPI endpoint
- Cache stored in `/data/cache/` as Parquet files, named `{source}_{symbol}_{timeframe}_{start}_{end}.parquet`
- Dukascopy access via `duka` Python library or direct HTTP download
- yfinance access via `yfinance` Python library
- All datetimes stored and returned in UTC

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)
_To be added by /architecture_

## QA Test Results
_To be added by /qa_

## Deployment
_To be added by /deploy_
