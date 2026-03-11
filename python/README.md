# Data Fetcher Service (PROJ-1)

Python FastAPI service that fetches and caches historical OHLCV data from Dukascopy and Yahoo Finance.

## Setup

1. Create a virtual environment:

```bash
cd python
python -m venv venv
source venv/bin/activate  # Linux/Mac
venv\Scripts\activate     # Windows
```

2. Install dependencies:

```bash
pip install -r requirements.txt
```

3. Configure environment variables:

```bash
cp .env.example .env
# Edit .env with your actual Supabase credentials
```

Required variables:
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_KEY` - Your Supabase service role key (NOT the anon key)
- `DATA_DIR` - Directory for Parquet file storage (default: `./data`)

## Running

From the project root directory (not from `python/`):

```bash
cd ..  # Go to project root
python -m uvicorn python.main:app --host 0.0.0.0 --port 8000 --reload
```

Or using the main module:

```bash
python -m python.main
```

The service will be available at `http://localhost:8000`.

## API Endpoints

### GET /health
Health check. Returns `{"status": "ok"}`.

### POST /fetch
Fetch OHLCV data for a symbol.

Request body:
```json
{
  "symbol": "XAUUSD",
  "source": "dukascopy",
  "timeframe": "1h",
  "date_from": "2025-01-01",
  "date_to": "2025-01-31",
  "force_refresh": false
}
```

Headers:
- `X-User-Id` (required): The authenticated user's UUID

### DELETE /cache/{cache_id}
Delete a cached data entry (Parquet file + database metadata).

## Supported Sources

### Dukascopy
- Instruments: XAUUSD, GER30 (DAX), EURUSD, GBPUSD, USDCHF, USDJPY, AUDUSD, NZDUSD, USDCAD, EURGBP, EURJPY, GBPJPY
- Timeframes: 1m, 5m, 15m, 30m, 1h, 4h, 1d

### Yahoo Finance (yfinance)
- Instruments: Any valid ticker (SPY, AAPL, MSFT, ^GSPC, etc.)
- Timeframes: 1d, 1wk, 1mo

## Architecture

```
python/
  main.py                    FastAPI application
  config.py                  Environment configuration
  models.py                  Pydantic request/response models
  fetchers/
    dukascopy_fetcher.py     Dukascopy tick data fetcher
    yfinance_fetcher.py      Yahoo Finance daily data fetcher
  services/
    cache_service.py         Parquet file + Supabase metadata caching
    resampler.py             OHLCV timeframe resampling
  data/
    parquet/                 Cached Parquet files (gitignored)
```
