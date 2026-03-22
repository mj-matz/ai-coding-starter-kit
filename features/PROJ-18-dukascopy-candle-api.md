# PROJ-18: Dukascopy Candle-API (OHLCV statt Tick-Daten)

## Status: Planned
**Created:** 2026-03-22
**Last Updated:** 2026-03-22

## Dependencies
- Replaces: PROJ-1 (Data Fetcher) — `fetch_dukascopy()` wird intern umgestellt, Schnittstelle bleibt identisch
- Related: PROJ-13 (Download Reliability) — löst das Performance-Problem, das PROJ-13 nicht lösen konnte

## Context

PROJ-13 hat gezeigt, dass die aktuelle Tick-Daten-Architektur ein strukturelles Performance-Ceiling hat: Dukascopy's `.bi5`-Endpoint liefert Rohdaten stundenweise (~0.6s/Request). Bei 504 Stunden pro Monat und maximal 6 parallelen Verbindungen ergibt sich ein unvermeidbares Minimum von ~50s/Monat.

Die Ursache ist das falsche API-Muster: wir machen **viele kleine Requests** (1 pro Stunde) und resampeln Tick-Daten clientseitig zu OHLCV. Dukascopy bietet einen zweiten, undokumentierten Endpoint, der vorberechnete OHLCV-Candles in Bulk liefert — 1.000 Minuten-Bars pro Request. Für 2 Monate wären das ~10 Requests statt ~1.000.

Geschätzte Verbesserung: **50× schneller** (~1–2s/Monat statt ~50s/Monat).

## User Stories

- Als Trader möchte ich, dass ein erster Backtest über 1–3 Monate in unter 5 Sekunden Daten lädt, damit die Wartezeit beim Erkunden neuer Zeiträume entfällt.
- Als Trader möchte ich, dass die geladenen OHLCV-Daten dieselbe Genauigkeit haben wie bisher, damit meine Backtest-Ergebnisse reproduzierbar bleiben.

## Acceptance Criteria

- [ ] Ein Download über 1 Monat 1m-Daten schließt in unter 5 Sekunden ab (frischer Cache, Durchschnitt 3 Läufe)
- [ ] Ein Download über 2 Monate schließt in unter 10 Sekunden ab
- [ ] Das produzierte DataFrame hat identische Spalten und Datentypen wie bisher (`datetime`, `open`, `high`, `low`, `close`, `volume`)
- [ ] Alle bestehenden Symbole (Forex, Indices, Metals) funktionieren mit dem neuen Endpoint
- [ ] Bei unbekanntem Endpoint-Format oder HTTP-Fehler fällt die Implementierung auf den bestehenden Tick-Endpoint zurück (Fallback)
- [ ] Die öffentliche Signatur von `fetch_dukascopy()` bleibt unverändert — kein Breaking Change
- [ ] Alle bestehenden Tests bestehen; neue Tests decken den Candle-Endpoint ab

## Edge Cases

- **Candle-Endpoint gibt 404 für Symbol:** Fallback auf Tick-Endpoint
- **Candle-Endpoint gibt unvollständige Daten** (weniger Bars als erwartet): WARNING loggen, Fallback auf Tick-Endpoint für fehlende Range
- **Dukascopy ändert den Endpoint still:** Fallback greift; Monitoring über WARNING-Logs
- **Wochenendstunden im Response:** filtern wie bisher (weekday < 5)
- **Volume-Daten fehlen im Candle-Response:** Volume auf 0 setzen, kein Fehler

## Technical Requirements

- Änderungen ausschließlich in `python/fetchers/dukascopy_fetcher.py`
- Kein Eingriff in `main.py`, `engine.py`, Frontend oder Tests (außer neue Tests)
- Keine neuen Python-Pakete
- Fallback auf bestehenden Tick-Endpoint bei Fehlern

---

## Tech Design (Solution Architect)

### Candle-Endpoint

Dukascopy's undokumentierter OHLCV-Endpoint (genutzt von Drittanbieter-Bibliotheken wie `python-dukascopy`):

```
GET https://datafeed.dukascopy.com/datafeed/{SYMBOL}/
    candles/BID/{TIMEFRAME}/{UNIX_TIMESTAMP_MS}/{COUNT}
```

| Parameter | Wert |
|-----------|------|
| SYMBOL | z.B. `EURUSD`, `DEUIDXEUR` |
| TIMEFRAME | `m1` (1 Minute), `h1`, `d1` |
| UNIX_TIMESTAMP_MS | Start-Zeitstempel in Millisekunden (UTC) |
| COUNT | Anzahl Candles pro Request (max. ~1.000) |

**Response:** JSON-Array mit Arrays `[timestamp_ms, open, high, low, close, volume]`

Beispiel-URL für Jan 2025, EURUSD, 1m, 1.000 Bars:
```
https://datafeed.dukascopy.com/datafeed/EURUSD/candles/BID/m1/1735689600000/1000
```

### Request-Strategie

Statt 504 Requests (1 pro Stunde) → Batches von 1.000 Minuten-Bars:
- 1 Monat = ~30.000 Minuten (Wochentage) → 30 Requests
- 2 Monate → 60 Requests
- Mit 6 Concurrent (bewährt, keine Throttles): 60 / 6 × 0.6s = **6s für 2 Monate**

### Komponentenstruktur

```
dukascopy_fetcher.py
└── fetch_dukascopy()  [Schnittstelle unverändert]
    └── _fetch_candles_async()  [NEU — Candle-API]
        ├── Berechne Batch-Timestamps für Range
        ├── asyncio.gather() für alle Batch-Requests
        ├── Dekodiere JSON → DataFrame
        └── Bei Fehler: raise → Fallback greift
    └── _fetch_ticks_async()  [bestehende Logik, umbenannt]
        └── [wie bisher, nur als Fallback]
```

### Fallback-Logik

```python
try:
    ohlcv = await _fetch_candles_async(duka_symbol, date_from, date_to, ...)
    if ohlcv is None or len(ohlcv) == 0:
        raise ValueError("empty candle response")
except Exception:
    logger.warning("Candle-API failed, falling back to tick endpoint")
    ohlcv = await _fetch_ticks_async(duka_symbol, date_from, date_to, ...)
```

### Offene Frage (vor Implementierung zu klären)

Der Candle-Endpoint ist undokumentiert. Vor Implementierung muss verifiziert werden:
1. Ist der Endpoint öffentlich erreichbar? (curl-Test)
2. Entspricht das Response-Format der erwarteten Struktur?
3. Unterstützt er alle benötigten Symbole (v.a. `DEUIDXEUR` für DAX)?

**Empfehlung:** Vor `/frontend` oder `/backend` einen manuellen curl-Test durchführen und das Response-Format dokumentieren.

## QA Test Results
_To be added by /qa_

## Deployment
_To be added by /deploy_
