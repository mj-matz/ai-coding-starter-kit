"""Tests for the Telegram delivery layer (PROJ-37).

httpx.AsyncClient.post is mocked so the tests never hit the real Telegram
API. Coverage focuses on the documented error shapes (401/403/400) and the
success path. Rate-limit + opt-in gating live in send_telegram and are
exercised separately.
"""

import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.notifications import _deliver_telegram_message  # noqa: E402


def _mk_response(status_code: int, json_body=None, text: str = "") -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.text = text
    if json_body is None:
        resp.json.side_effect = ValueError("no json")
    else:
        resp.json.return_value = json_body
    return resp


def _patch_post(fake_response=None, side_effect=None):
    cm = patch("services.notifications.httpx.AsyncClient")
    mock = cm.start()
    post = AsyncMock(return_value=fake_response, side_effect=side_effect)
    mock.return_value.__aenter__.return_value.post = post
    return cm


@pytest.mark.asyncio
async def test_success_returns_true_none():
    cm = _patch_post(_mk_response(200, {"ok": True, "result": {"message_id": 42}}))
    try:
        ok, err = await _deliver_telegram_message("tok", "123", "hi")
    finally:
        cm.stop()
    assert ok is True
    assert err is None


@pytest.mark.asyncio
async def test_invalid_token_401():
    cm = _patch_post(_mk_response(401, {"ok": False, "error_code": 401, "description": "Unauthorized"}))
    try:
        ok, err = await _deliver_telegram_message("bad", "123", "hi")
    finally:
        cm.stop()
    assert ok is False
    assert err == "Invalid Telegram bot token (401)"


@pytest.mark.asyncio
async def test_chat_blocked_403():
    cm = _patch_post(_mk_response(403, {"ok": False, "error_code": 403, "description": "Forbidden: bot was blocked by the user"}))
    try:
        ok, err = await _deliver_telegram_message("tok", "123", "hi")
    finally:
        cm.stop()
    assert ok is False
    assert err == "Bot blocked or chat not found (403)"


@pytest.mark.asyncio
async def test_chat_not_found_403():
    """Second 403 shape: bot can't start the chat (user never /start'd the bot)."""
    cm = _patch_post(_mk_response(403, {
        "ok": False,
        "error_code": 403,
        "description": "Forbidden: bot can't initiate conversation with a user",
    }))
    try:
        ok, err = await _deliver_telegram_message("tok", "123", "hi")
    finally:
        cm.stop()
    assert ok is False
    # 403 is mapped to a single, fixed user-facing string regardless of the
    # specific Telegram description.
    assert err == "Bot blocked or chat not found (403)"


@pytest.mark.asyncio
async def test_bad_chat_id_400():
    cm = _patch_post(_mk_response(400, {"ok": False, "error_code": 400, "description": "Bad Request: chat not found"}))
    try:
        ok, err = await _deliver_telegram_message("tok", "nope", "hi")
    finally:
        cm.stop()
    assert ok is False
    # 400 must relay the Telegram description verbatim so the user can
    # diagnose (e.g. "message is too long", "wrong chat_id format", etc.).
    assert "400" in err
    assert "Bad Request: chat not found" in err


@pytest.mark.asyncio
async def test_400_without_description_falls_back():
    cm = _patch_post(_mk_response(400, {"ok": False}))
    try:
        ok, err = await _deliver_telegram_message("tok", "123", "hi")
    finally:
        cm.stop()
    assert ok is False
    assert err == "Telegram rejected request (400)"


@pytest.mark.asyncio
async def test_200_with_ok_false_returns_failure():
    """Telegram occasionally returns 200 with ok=false (e.g. retry_after)."""
    cm = _patch_post(_mk_response(200, {
        "ok": False,
        "description": "Too Many Requests: retry after 30",
        "parameters": {"retry_after": 30},
    }))
    try:
        ok, err = await _deliver_telegram_message("tok", "123", "hi")
    finally:
        cm.stop()
    assert ok is False
    assert "Too Many Requests" in err


@pytest.mark.asyncio
async def test_network_error_returns_false():
    cm = _patch_post(side_effect=httpx.ConnectError("dns fail"))
    try:
        ok, err = await _deliver_telegram_message("tok", "123", "hi")
    finally:
        cm.stop()
    assert ok is False
    assert "Network error" in err


@pytest.mark.asyncio
async def test_request_payload_shape():
    """Verify we POST to the documented Telegram URL with the expected JSON."""
    captured: dict = {}

    async def _capture_post(url, *, json):
        captured["url"] = url
        captured["json"] = json
        return _mk_response(200, {"ok": True, "result": {"message_id": 1}})

    cm = patch("services.notifications.httpx.AsyncClient")
    mock = cm.start()
    mock.return_value.__aenter__.return_value.post = AsyncMock(side_effect=_capture_post)
    try:
        ok, err = await _deliver_telegram_message("MY-TOKEN", "12345", "hello")
    finally:
        cm.stop()

    assert ok is True
    assert err is None
    assert captured["url"] == "https://api.telegram.org/botMY-TOKEN/sendMessage"
    assert captured["json"]["chat_id"] == "12345"
    assert captured["json"]["text"] == "hello"
    assert captured["json"]["disable_web_page_preview"] is True


@pytest.mark.asyncio
async def test_unexpected_status_code_returns_failure():
    """5xx / unknown statuses surface a generic but informative error."""
    cm = _patch_post(_mk_response(502, {"ok": False, "description": "Bad Gateway"}))
    try:
        ok, err = await _deliver_telegram_message("tok", "123", "hi")
    finally:
        cm.stop()
    assert ok is False
    assert "502" in err
