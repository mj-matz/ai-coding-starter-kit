"""JWT authentication dependency for FastAPI endpoints.

Validates Supabase JWTs from the Authorization: Bearer header.
Supports both:
  - HS256 (legacy JWT secret, configured via SUPABASE_JWT_SECRET)
  - RS256 / other algorithms (new Supabase JWT Signing Keys, verified via JWKS)
"""

import urllib.request
import urllib.error
import json
import logging

from fastapi import HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from config import SUPABASE_JWT_SECRET, SUPABASE_URL

logger = logging.getLogger(__name__)

_bearer = HTTPBearer()

# In-memory JWKS cache (refreshed once per process start)
_jwks_cache: list = []


def _fetch_jwks() -> list:
    """Fetch public keys from Supabase JWKS endpoint. Cached in memory."""
    global _jwks_cache
    if _jwks_cache:
        return _jwks_cache
    if not SUPABASE_URL:
        return []
    url = f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json"
    try:
        with urllib.request.urlopen(url, timeout=5) as resp:
            data = json.loads(resp.read().decode())
            _jwks_cache = data.get("keys", [])
            logger.info("JWKS keys loaded (%d keys)", len(_jwks_cache))
            return _jwks_cache
    except Exception as exc:
        logger.warning("Failed to fetch JWKS from %s: %s", url, exc)
        return []


def verify_jwt(credentials: HTTPAuthorizationCredentials = Security(_bearer)) -> dict:
    """
    FastAPI dependency. Validates the Supabase JWT from the Authorization header.

    Returns the decoded token payload, which includes:
      - sub:           user UUID (use this as the verified user ID)
      - email:         user email
      - role:          "authenticated" for regular users
      - app_metadata:  server-side metadata (e.g. is_admin)

    Raises HTTP 401 if the token is missing or invalid.
    Raises HTTP 403 if the token role is not "authenticated" or "service_role".
    """
    token = credentials.credentials

    # Read the algorithm from the token header (unverified, safe to inspect)
    try:
        header = jwt.get_unverified_header(token)
    except JWTError as exc:
        raise HTTPException(status_code=401, detail=f"Invalid token header: {exc}")

    alg = header.get("alg", "HS256")

    try:
        if alg == "HS256":
            # Legacy HS256 path — verify with shared secret
            if not SUPABASE_JWT_SECRET:
                raise HTTPException(
                    status_code=500,
                    detail="SUPABASE_JWT_SECRET is not configured on the server",
                )
            payload = jwt.decode(
                token,
                SUPABASE_JWT_SECRET,
                algorithms=["HS256"],
                options={"verify_aud": False},
            )
        else:
            # New Supabase JWT Signing Keys (RS256, EdDSA, …) — verify via JWKS
            kid = header.get("kid")
            keys = _fetch_jwks()
            if not keys:
                raise HTTPException(
                    status_code=500,
                    detail="JWKS keys unavailable — check SUPABASE_URL configuration",
                )
            # Match by key ID if present, otherwise fall back to first key
            key = (
                next((k for k in keys if k.get("kid") == kid), None)
                if kid
                else keys[0]
            )
            if not key:
                raise HTTPException(
                    status_code=401,
                    detail=f"No matching signing key found (kid={kid})",
                )
            payload = jwt.decode(
                token,
                key,
                algorithms=[alg],
                options={"verify_aud": False},
            )
    except JWTError as exc:
        raise HTTPException(status_code=401, detail=f"Invalid or expired token: {exc}")

    if payload.get("role") not in ("authenticated", "service_role"):
        raise HTTPException(status_code=403, detail="Token has insufficient role")

    return payload
