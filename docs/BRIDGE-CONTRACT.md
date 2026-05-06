# MT5 Bridge Worker — HTTP Contract

This document is the source of truth for the HTTP contract between the
Backtesting Platform's Python backend and the MT5 Bridge Worker
(separate FastAPI service running on the Windows host that has MT5 + MetaEditor
installed).

The Python client lives in [python/services/mt5_bridge.py](../python/services/mt5_bridge.py).
The bridge implementation lives in the **separate `mt5-bridge` repository** —
keep this file and the bridge's route handlers in lock-step.

## Authentication

All endpoints require the header `X-Bridge-Token: <shared-secret>`. Token is
configured on both sides via the env var `MT5_BRIDGE_TOKEN`. Missing / wrong
token → `401 Unauthorized`.

## Endpoints

### Existing (PROJ-37)

- `GET  /mt5/health`            — liveness + MT5 terminal state.
- `POST /mt5/tester/run`        — submit a Strategy Tester run.
- `GET  /mt5/tester/status/{job_id}` — poll a submitted run.

These are documented in the PROJ-37 spec and are not repeated here.

---

### `POST /mt5/ea/deploy` (PROJ-40)

Write a `.mq5` file into `<MT5_DATA_PATH>/MQL5/Experts/<ea_name>.mq5` and
synchronously compile it with `metaeditor64.exe /compile:<path> /log`.

**This call is synchronous.** The bridge holds the request open until the
compile process exits or hits the 60-second compile timeout. The Python
backend's HTTP client times out at 120 seconds (compile + headroom).

#### Request

```http
POST /mt5/ea/deploy
Content-Type: application/json
X-Bridge-Token: <shared-secret>

{
  "ea_name":     "MyStrategy_BreakoutV2",
  "mq5_content": "<full MQL5 source as a string>"
}
```

| Field         | Type   | Constraints                                                 |
|---------------|--------|-------------------------------------------------------------|
| `ea_name`     | string | 1–64 chars; matches `^[A-Za-z0-9_\-]+$` (no whitespace, no path separators). The bridge MUST re-validate — never trust the upstream regex. |
| `mq5_content` | string | UTF-8 MQL5 source. Bridge upper bound: **5 MB**. The Python backend rejects > 2 MB before forwarding, so values above 2 MB should never reach the bridge in practice. |

#### Behavior

1. Validate `ea_name` against `^[A-Za-z0-9_\-]+$`. Reject (`400`) anything else.
   Defence in depth — Python validates, but a misbehaving caller cannot be
   allowed to write to arbitrary paths.
2. Resolve target path: `<MT5_DATA_PATH>/MQL5/Experts/<ea_name>.mq5`. The
   bridge MUST refuse if the resolved path escapes the `Experts/` directory
   (path-traversal guard).
3. Write `mq5_content` to the target path (UTF-8, overwrite if exists).
   Overwriting is intentional — the user has confirmed the EA name in the UI.
4. Spawn `metaeditor64.exe /compile:<full-path> /log:<log-path>` with a
   **60-second** timeout. The compile log file is the same path with `.log`.
5. On exit, read the compile log and parse it into:
   - `errors`   — array of `"<file>(<line>,<col>): error: <message>"` strings.
   - `warnings` — array of warning strings (same shape).
6. Return one of the response shapes below.

#### Responses

All responses use `Content-Type: application/json`. The HTTP status code is
**always `200`** for the three "expected" outcomes (compiled / compile_error /
timeout) — the body's `status` field carries the result. Reserve non-2xx for
genuine bridge-side failures (auth, validation, unexpected exception).

##### 200 — Compile succeeded

```json
{
  "status":      "compiled",
  "ea_name":     "MyStrategy_BreakoutV2",
  "warnings":    ["MyStrategy_BreakoutV2.mq5(42,5): warning: implicit conversion ..."],
  "log_excerpt": "<last ~50 lines of metaeditor log>"
}
```

`.ex5` artifact written next to the `.mq5`. The bridge does NOT attach the EA
to a chart — that's a manual step the user performs in MT5 after the deploy
is confirmed.

##### 200 — Compile failed

```json
{
  "status":      "compile_error",
  "ea_name":     "MyStrategy_BreakoutV2",
  "errors":      [
    "MyStrategy_BreakoutV2.mq5(17,3): error: 'foo' - undeclared identifier",
    "MyStrategy_BreakoutV2.mq5(20,1): error: too many parameters"
  ],
  "log_excerpt": "<last ~50 lines of metaeditor log>"
}
```

The `.mq5` was written, but no `.ex5` artifact was produced. Whether to
delete the `.mq5` on failure is the bridge's choice — leaving it makes
manual debugging in MetaEditor easier and matches the spec.

##### 200 — Compile timed out

```json
{
  "status":  "timeout",
  "ea_name": "MyStrategy_BreakoutV2",
  "error":   "MetaEditor did not complete within 60s"
}
```

The bridge MUST kill the `metaeditor64.exe` process if the timeout fires.

##### 4xx / 5xx — Bridge-side failure

Use standard HTTP semantics for these (the Python client unconditionally
treats non-200 as an error and surfaces the `error` field):

| Status | When                                                        |
|--------|-------------------------------------------------------------|
| `400`  | Invalid `ea_name`, missing fields, malformed JSON.          |
| `401`  | Missing / wrong `X-Bridge-Token`.                           |
| `413`  | `mq5_content` larger than the 5 MB bridge limit.            |
| `500`  | Disk write failed, MetaEditor binary missing, unexpected exception. |
| `503`  | MT5 data path not configured / not writable.                |

Body shape: `{ "error": "<short description>" }`.

**401 body-shape exception (acknowledged):** the bridge's 401 response uses
`{ "detail": "..." }` rather than `{ "error": "..." }` because the auth
dependency re-uses FastAPI's `HTTPException`, which serialises to `detail`.
The Python client in [python/services/mt5_bridge.py](../python/services/mt5_bridge.py)
checks only `status_code == 401` and never reads the 401 body, so the
divergence is invisible to upstream callers. If the bridge ever needs to be
brought into strict contract compliance, wrap the auth dependency to return a
`JSONResponse(401, {"error": "..."})` instead of raising `HTTPException`.

#### Idempotency / concurrency

- The bridge runs `metaeditor64.exe` **single-threaded**. Concurrent deploy
  requests SHOULD be serialised via a process-wide lock. The Python backend
  also rate-limits (10 deploys/min/user) but that's not a substitute.
- Overwriting an existing `.mq5` is intentional — the user's confirmation
  dialog explicitly warns about this.
- The bridge MUST NOT log `mq5_content` (it's not secret per se, but it can
  be large and noisy in production logs).

---

## Maintenance

When changing the contract:

1. Update this document **and** the bridge's route handlers **and**
   [python/services/mt5_bridge.py](../python/services/mt5_bridge.py) in the
   same change set (across the two repos).
2. Bump a `version` field in `GET /mt5/health` if the change is breaking, so
   the UI's bridge-status card can display a "incompatible bridge" warning.
3. Update the Python Pydantic models in
   [python/main.py](../python/main.py) under `# ── PROJ-40` if the response
   shape changes.
