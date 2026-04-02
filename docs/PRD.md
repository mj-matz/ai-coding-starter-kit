# Product Requirements Document

## Vision
A personal web-based backtesting platform for systematic trading strategies. The tool allows a solo trader to test rule-based strategies on historical market data with high accuracy and reliability, and to understand results through clear analytics and visualizations.

## Target Users
**Primary User: Solo Trader / Quant Enthusiast**
- Develops and validates trading strategies before risking real capital
- Needs confidence that the backtesting engine executes rules exactly as defined (no look-ahead bias, correct order simulation)
- Wants to understand performance deeply, not just see a final return number
- Tests across multiple asset classes: DAX (GER30), Gold (XAUUSD), Forex pairs, and stocks

## Core Features (Roadmap)

| Priority | Feature | Status |
|----------|---------|--------|
| P0 (MVP) | Data Fetcher (Dukascopy + yfinance) | Planned |
| P0 (MVP) | Backtesting Engine | Planned |
| P0 (MVP) | Breakout Strategy | Planned |
| P0 (MVP) | Performance Analytics | Planned |
| P0 (MVP) | Backtest UI (Configuration + Results) | Planned |
| P0 (MVP) | Authentication (Admin Login) | Planned |
| P0 (MVP) | Backtest History (per User) | Planned |
| P1 | Strategy Library (Plugin System) | Planned |
| P1 | Trade Journal (Manual) | Planned |
| P1 | GAP Fill Toggle | Deployed |
| P1 | Dukascopy Download Reliability (Retry + Adaptive Concurrency) | Planned |
| P1 | Cache Warming (Background Prefetch) | Planned |
| P1 | Intra-Bar Accuracy (Entry-Bar SL/TP + 1-Second Hybrid) | Planned |
| P2 | Chart Screenshot Share | Planned |
| P1 | Strategy Optimizer (Step-by-Step Parameter Optimization) | Planned |
| P1 | SMC Price Action Strategy (Market Structure, BoS, S&D, FVG) | Planned |
| P2 | AI Strategy Generator (Text + Screenshot → Backtest) | Planned |
| P2 | MQL Converter (MQL4/MQL5 EA → Python Backtest) | Planned |
| P1 | User-Defined Strategies (MQL → Strategy Library) | Planned |
| P1 | Export Backtest Results (Excel / CSV) | Planned |
| P1 | Strategy Export to MT5 EA | Planned |

## Success Metrics
- Backtesting engine produces identical results on repeated runs (deterministic)
- Breakout strategy results are manually verifiable on a sample of trades
- Performance metrics match industry-standard calculations (Sharpe, CAGR, Max Drawdown)
- A full backtest on 1 year of 1-minute data completes in under 60 seconds

## Constraints
- Authentication required: Admin login from day one (Supabase Auth); extensible for additional users later
- Python backend (strategy logic, data fetching, calculations)
- Next.js frontend (configuration UI, results display)
- Data sources: Dukascopy (intraday tick data) + yfinance (daily stock/ETF data)
- Quality over speed — correctness is more important than feature count

## Non-Goals
- Live trading / order execution (no broker API integration in MVP)
- Real-time data streaming
- Portfolio optimization / position sizing algorithms
- Billing / subscription management
- Mobile app
