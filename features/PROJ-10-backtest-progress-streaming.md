# PROJ-10: Backtest Progress Streaming

## Status: Deployed
**Created:** 2026-03-20
**Last Updated:** 2026-03-22
**Deployed:** 2026-03-22

## Dependencies
- Requires: PROJ-2 (Backtesting Engine) — engine muss Fortschritts-Events emittieren
- Requires: PROJ-5 (Backtest UI) — Loading State wird durch Progress Bar ersetzt
- Extends: PROJ-5 — kein neuer Page-Route, nur Änderung an bestehendem Loading State

## Motivation

Der aktuelle Backtest-Flow ist ein einzelner synchroner HTTP-Request, der erst nach vollständiger Berechnung antwortet. Bei größeren Zeiträumen (z.B. 3 Monate auf 1m) wartet der Nutzer 30–120 Sekunden vor einem reglosen Spinner ohne Feedback über den tatsächlichen Fortschritt.

PROJ-5 hat diese Erweiterung explizit vorgesehen:
> „If FastAPI processing regularly exceeds 30 seconds, replace the simple HTTP request + timeout with SSE [...]. The UI component boundary for this is already isolated in `LoadingState`, making the upgrade straightforward."

## User Stories

- Als Trader möchte ich nach dem Klick auf „Run Backtest" eine Fortschrittsanzeige sehen, die mir zeigt, wie viele Tage bereits verarbeitet wurden, damit ich weiß, dass das System arbeitet und wie lange es noch dauert.
- Als Trader möchte ich in der Mitte des Fortschrittsbalkens den Stand sehen (z.B. „15 / 30 Tage"), damit ich einschätzen kann, ob der Backtest noch lange dauert.
- Als Trader möchte ich den laufenden Backtest jederzeit abbrechen können, damit ich bei falsch konfigurierten Parametern nicht warten muss.

## Acceptance Criteria

### Loading State (UI)
- [ ] Nach dem Klick auf „Run Backtest" erscheint ein Fortschrittsbalken (shadcn `Progress`) anstelle des bisherigen Spinners (`Loader2`)
- [ ] In der Mitte des Balkens steht `X / Y Tage`, wobei `X` die verarbeiteten Tage und `Y` die Gesamtzahl der Handelstage im gewählten Zeitraum sind
- [ ] Der Balken füllt sich mit jedem verarbeiteten Tag automatisch auf
- [ ] Darunter steht ein dezenter Text „Berechnung läuft..." (oder optional der gerade verarbeitete Datumsstring)
- [ ] Der bestehende Cancel-Button bleibt erhalten und bricht den Backtest sofort ab
- [ ] Das 60-Sekunden-Timeout-Warning bleibt erhalten (unverändert aus PROJ-5)
- [ ] Schlägt das Streaming fehl (z.B. Netzwerk-Unterbruch), erscheint der bisherige Error State — kein stiller Fehler

### Backend — FastAPI Streaming Endpoint
- [ ] Der bestehende `POST /backtest` Endpunkt in `python/main.py` wird durch einen SSE-Streaming-Endpunkt ersetzt (oder ein separater `POST /backtest/stream` Endpunkt wird hinzugefügt — Entscheidung: separater Endpunkt, da `POST /backtest` von bestehenden Tests abhängt)
- [ ] Der Endpunkt streamt zunächst ein `init`-Event mit der Gesamtzahl der Tage: `{"type": "init", "total_days": 30}`
- [ ] Pro verarbeitetem Handelstag wird ein `progress`-Event gestreamt: `{"type": "progress", "days_done": 15, "total_days": 30, "current_date": "2025-10-15"}`
- [ ] Nach Abschluss wird ein `result`-Event gestreamt: `{"type": "result", "data": { ...bisheriges BacktestResult JSON... }}`
- [ ] Bei einem Fehler wird ein `error`-Event gestreamt: `{"type": "error", "message": "..."}`
- [ ] Die Engine-Schleife (`engine.py`) erhält einen optionalen `progress_callback`-Parameter, der pro Handelstag aufgerufen wird (nicht pro Bar — nur einmal, wenn der Tag wechselt)
- [ ] Der Callback ist optional — bestehende `run_backtest()`-Aufrufe ohne Callback bleiben unverändert (Rückwärtskompatibilität)

### Backend — Next.js API Route
- [ ] Die bestehende Route `POST /api/backtest` bleibt unverändert (wird weiter von Tests und ggf. PROJ-9 verwendet)
- [ ] Eine neue Route `POST /api/backtest/stream` wird erstellt, die den SSE-Stream von FastAPI durchleitet (`TransformStream` oder direktes `pipe`)
- [ ] Die neue Route setzt den `Content-Type: text/event-stream` Header korrekt
- [ ] Auth-Check und Rate-Limiting werden identisch zu `POST /api/backtest` implementiert
- [ ] `export const maxDuration = 300` ist gesetzt

### Frontend — Hook
- [ ] `useBacktest` erhält neue State-Felder: `daysDone: number`, `totalDays: number`, `currentDate: string | null`
- [ ] Der Hook liest den SSE-Stream mit der Fetch-API (`response.body` als `ReadableStream`) und parst die JSON-Events zeilenweise
- [ ] Bei `init`: `totalDays` wird gesetzt
- [ ] Bei `progress`: `daysDone` und `currentDate` werden aktualisiert
- [ ] Bei `result`: Ergebnis wird in `result` gesetzt, Status wechselt auf `success`
- [ ] Bei `error`: Fehlermeldung wird gesetzt, Status wechselt auf `error`
- [ ] Die `cancel()`-Funktion bricht den Stream via `AbortController` ab (bereits vorhanden)
- [ ] Fallback: Falls `totalDays === 0`, wird kein Fortschrittsbalken gezeigt (defensiv)

### Frontend — UI-Komponente
- [ ] `LoadingState` in `results-panel.tsx` (oder einer neuen `backtest-progress.tsx`) wird angepasst
- [ ] Zeigt shadcn `Progress` mit `value={(daysDone / totalDays) * 100}`
- [ ] Zeigt zentrierten Text `{daysDone} / {totalDays} Tage` in der Mitte des Balkens (relativ positioniert über dem Balken)
- [ ] Optionaler zweiter Textzeile: aktuelles Datum (`currentDate`), falls verfügbar
- [ ] Beim Abbrechen durch den Nutzer: Status springt auf `idle`, Progress-State wird zurückgesetzt

## Edge Cases

- Zeitraum enthält nur Wochenenden / Feiertage → `total_days = 0` → Fortschrittsbalken wird nicht gezeigt, stattdessen Spinner wie bisher
- Netzwerk-Verbindung bricht während des Streams ab → `AbortError` oder unvollständiger Stream → Error State mit "Verbindung unterbrochen"-Meldung
- FastAPI antwortet mit HTTP 4xx/5xx direkt (z.B. Validierungsfehler, kein Daten-Cache) → kein Stream kommt zustande → Error State wie bisher
- Nutzer bricht ab (Cancel) → `AbortController.abort()` → FastAPI Verbindung wird geschlossen → kein Zombie-Prozess auf dem Server (FastAPI's `StreamingResponse` beendet sich bei Connection-Close)
- Backtest mit sehr vielen Tagen (z.B. 365 Tage) → 365 SSE-Events → kein Performance-Problem (kleine JSON-Objekte, Netzwerk-Overhead vernachlässigbar)
- Browser-Tab wird geschlossen während Backtest läuft → `beforeunload` bricht die Verbindung ab → FastAPI beendet den Stream

## Technical Requirements

### Python — `engine.py`
```python
# Neuer optionaler Parameter
def run_backtest(
    ohlcv: pd.DataFrame,
    signals: pd.DataFrame,
    config: BacktestConfig,
    progress_callback: Optional[Callable[[int, int, str], None]] = None,
) -> BacktestResult:
    ...
    current_day = None
    day_count = 0
    total_trading_days = ohlcv.index.normalize().nunique()

    for i in range(len(ohlcv)):
        bar_date = ohlcv.index[i].date()
        if bar_date != current_day:
            current_day = bar_date
            day_count += 1
            if progress_callback:
                progress_callback(day_count, total_trading_days, bar_date.isoformat())
        ...
```

### Python — `main.py` (neuer SSE-Endpunkt)
```python
from fastapi.responses import StreamingResponse

@app.post("/backtest/stream")
async def backtest_stream(request: BacktestRequest, ...):
    async def event_stream():
        # 1. Validierung, Auth, Daten laden (wie /backtest)
        ...
        total_days = ohlcv.index.normalize().nunique()
        yield f"data: {json.dumps({'type': 'init', 'total_days': total_days})}\n\n"

        # 2. Engine mit Callback aufrufen
        def on_progress(done, total, date_str):
            # asyncio.Queue oder direkter Yield via Generator-Pattern
            ...

        result = run_backtest(ohlcv, signals, config, progress_callback=on_progress)
        yield f"data: {json.dumps({'type': 'result', 'data': result_json})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
```

> **Implementierungshinweis:** Da `run_backtest()` synchron ist, muss der Progress-Callback via `asyncio.Queue` + Hintergrund-Thread oder via synchronem Generator mit `yield` in FastAPI umgesetzt werden. Empfohlen: `asyncio.run_in_executor` + `queue.Queue` (Thread-safe). Alternativ: Die Engine direkt als synchroner Generator refactoren (einfacher, aber Breaking Change).

### Next.js — neue Route `src/app/api/backtest/stream/route.ts`
```typescript
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  // Auth + Rate-Limit (identisch zu /api/backtest)
  ...

  const upstream = await fetch(`${FASTAPI_URL}/backtest/stream`, {
    method: "POST",
    headers,
    body: JSON.stringify(parsed.data),
    signal: AbortSignal.timeout(300_000),
  });

  // Stream direkt durchleiten
  return new NextResponse(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
```

### Frontend — `src/hooks/use-backtest.ts`
```typescript
export type BacktestStatus = "idle" | "loading" | "success" | "error";

interface UseBacktestReturn {
  status: BacktestStatus;
  result: BacktestResult | null;
  error: string | null;
  isTimedOut: boolean;
  daysDone: number;        // NEU
  totalDays: number;       // NEU
  currentDate: string | null; // NEU
  runBacktest: (config: BacktestFormValues) => Promise<void>;
  cancel: () => void;
}
```

### Frontend — `src/components/backtest/results-panel.tsx` (Loading State)
Bestehender `LoadingState` mit `Loader2`-Spinner wird ersetzt durch `BacktestProgress`-Komponente:

```tsx
// Konzept — Platzierung über dem Progress-Balken
<div className="relative">
  <Progress value={(daysDone / totalDays) * 100} className="h-3" />
  {totalDays > 0 && (
    <span className="absolute inset-0 flex items-center justify-center text-xs font-medium text-white">
      {daysDone} / {totalDays} Tage
    </span>
  )}
</div>
{currentDate && (
  <p className="mt-1 text-center text-xs text-gray-500">{currentDate}</p>
)}
```

## Files Changed

| Datei | Art | Beschreibung |
|-------|-----|-------------|
| `python/engine/engine.py` | Edit | `progress_callback` Parameter hinzufügen |
| `python/main.py` | Edit | Neuer `POST /backtest/stream` Endpunkt |
| `src/app/api/backtest/stream/route.ts` | New | SSE-Proxy-Route |
| `src/hooks/use-backtest.ts` | Edit | Stream lesen, Progress-State verwalten |
| `src/components/backtest/results-panel.tsx` | Edit | Loading State → Progress Bar |

## Out of Scope

- WebSocket (SSE ist ausreichend für unidirektionalen Fortschritt)
- Stage-Labels wie „Fetching data..." / „Computing signals..." — nur Tagesfortschritt
- Persistenz des Fortschritts (kein Resume nach Abbruch)
- Änderung der bestehenden `POST /api/backtest` Route (bleibt für PROJ-9 und Tests unverändert)

## Open Questions

1. **Synchroner Engine vs. Thread:** Soll `run_backtest()` via `asyncio.run_in_executor` in einem Thread laufen, oder wird die Engine-Schleife zu einem synchronen Generator refactored? → Empfehlung: `run_in_executor` mit `queue.Queue` — minimale Änderung an der Engine.
2. **Granularität:** Ein Event pro Tag oder pro N Tagen (z.B. alle 5 Tage)? → Ein Event pro Tag ist sauber und erzeugt bei 365 Tagen nur ~15 KB Extra-Overhead.

---

## QA Report — Re-Test (2026-03-22)

**Datum:** 2026-03-22
**Ergebnis:** DEPLOYMENT-BEREIT
**Acceptance Criteria:** 26 / 26 bestanden
**Bugs gefunden:** 0
**Security:** Bestanden

### Alle vorherigen Bugs behoben

| Bug | Schwere | Status | Nachweis |
|-----|---------|--------|----------|
| BUG-1: Cancel-Button nur nach 60s sichtbar | Medium | GEFIXT | `results-panel.tsx:110-118` — Button jetzt außerhalb des `isTimedOut`-Blocks |
| BUG-2: Kein `init`-Event im Backend | Medium | GEFIXT | `main.py:1413-1414` — `init`-Event mit `total_days` wird gesendet |
| BUG-3: Kein `init`-Handler im Frontend | Low | GEFIXT | `use-backtest.ts:178-179` — Handler für `event.type === "init"` vorhanden |
| BUG-4: Endloser Spinner bei Stream-Abbruch | High | GEFIXT | `use-backtest.ts:205-208` — `gotResult`-Flag prüft auf unerwartetes Stream-Ende |
| BUG-5: `asyncio.get_event_loop()` deprecated | Low | GEFIXT | `main.py:1410` — `asyncio.get_running_loop()` wird verwendet |

### Security Audit: Bestanden

- Doppelte Authentifizierung (Next.js Supabase + FastAPI JWT)
- Rate-Limiting auf beiden Ebenen
- Zod-Validierung vor Weiterleitung an FastAPI
- SSE-Events via `json.dumps()` serialisiert (kein Injection-Risiko)
- Kein Secret-Leak (`FASTAPI_URL` ist server-side only)

### Regressionen: Keine

- PROJ-2, PROJ-5, PROJ-8 weiterhin funktional

---

## QA Report — Initial (2026-03-22)

**Datum:** 2026-03-22
**Ergebnis:** NICHT DEPLOYMENT-BEREIT
**Acceptance Criteria:** 22 / 26 bestanden
**Bugs gefunden:** 5 (0 Critical, 1 High, 2 Medium, 2 Low)
**Security:** Bestanden

### Fehlgeschlagene Acceptance Criteria

| # | Criterion | Grund |
|---|-----------|-------|
| AC-1 | Cancel-Button jederzeit sichtbar | Nur nach 60s Timeout sichtbar (BUG-1) |
| AC-2 | Streaming-Fehler → Error State | Kein Handler für unerwartetes Stream-Ende (BUG-4) |
| AC-3 | `init`-Event wird gesendet | Backend sendet kein `init`-Event (BUG-2) |
| AC-4 | `init`-Event wird verarbeitet | Hook hat keinen `init`-Handler (BUG-3) |

### Bug-Liste

#### BUG-1 (Medium) — Cancel-Button nur nach 60s Timeout sichtbar
- **Datei:** `src/components/backtest/results-panel.tsx:101`
- **Fix:** Cancel-Button außerhalb des `isTimedOut`-Blocks platzieren.

#### BUG-4 (High) — Status bleibt auf „loading" bei unerwartetem Stream-Ende
- **Datei:** `src/hooks/use-backtest.ts` nach der while-Schleife (~Zeile 199)
- **Fix:** Nach der while-Schleife prüfen: Falls `done && status === 'loading'`, Status auf `error` setzen.

#### BUG-2 (Medium) — Fehlendes `init`-Event im Backend
- **Datei:** `python/main.py`
- **Fix:** Vor der Engine-Schleife ein `init`-Event senden: `{"type": "init", "total_days": total_days}`

#### BUG-3 (Low) — Kein `init`-Event Handler im Frontend-Hook
- **Datei:** `src/hooks/use-backtest.ts`
- **Fix:** `case "init": setTotalDays(event.total_days); break;` im Event-Dispatcher ergänzen.

#### BUG-5 (Low) — `asyncio.get_event_loop()` deprecated
- **Datei:** `python/main.py:1410`
- **Fix:** `asyncio.get_event_loop()` durch `asyncio.get_running_loop()` ersetzen.
