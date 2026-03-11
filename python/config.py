"""Application configuration loaded from environment variables."""

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL: str = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY: str = os.environ.get("SUPABASE_SERVICE_KEY", "")
SUPABASE_JWT_SECRET: str = os.environ.get("SUPABASE_JWT_SECRET", "")
DATA_DIR: Path = Path(os.environ.get("DATA_DIR", "./data"))
FETCH_TIMEOUT_SECONDS: int = int(os.environ.get("FETCH_TIMEOUT_SECONDS", "60"))

# Ensure the data directory exists
DATA_DIR.mkdir(parents=True, exist_ok=True)
