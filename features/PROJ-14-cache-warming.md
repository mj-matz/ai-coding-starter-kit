# PROJ-14: Cache Warming (Background Prefetch)

## Status: Planned
**Created:** 2026-03-21
**Last Updated:** 2026-03-21

## Dependencies
- Requires: PROJ-1 (Data Fetcher) — Prefetch ruft denselben Fetch-Stack auf
- Requires: PROJ-5 (Backtest UI) — Trigger kommt aus der Configuration UI
- Recommended: PROJ-13 (Download Reliability) — Prefetch profitiert direkt von schnelleren Downloads

## Context

Auch nach PROJ-13 dauert ein Cache-Miss-Download mehrere Sekunden. Der Nutzer konfiguriert nach Auswahl von Symbol und Datumsbereich noch weitere Parameter (Range-Zeit, SL, TP, Kapital). Diese Konfigurationszeit kann genutzt werden, um Dukascopy-Daten still im Hintergrund vorzuladen, sodass beim Klick auf "Run Backtest" der Cache bereits warm ist.

## User Stories

- Als Trader möchte ich, dass Marktdaten automatisch im Hintergrund geladen werden, sobald ich Symbol und Datumsbereich ausgewählt habe, damit der Backtest sofort startet wenn ich auf "Run" klicke.
- Als Trader möchte ich, dass das UI nicht blockiert oder langsamer wird während Daten im Hintergrund geladen werden, damit meine Konfiguration flüssig bleibt.
- Als Trader möchte ich einen diskreten Hinweis sehen, ob Daten gerade geladen werden oder bereits bereit sind, damit ich weiß wann ich auf Run klicken kann.

## Acceptance Criteria

- [ ] Sobald Symbol, Startdatum und Enddatum gesetzt sind (alle drei gültig), wird automatisch ein stiller Prefetch-Request an `/api/prefetch` gesendet
- [ ] Der Prefetch-Request läuft vollständig im Hintergrund — kein Blockieren der UI, kein Spinner auf dem Run-Button
- [ ] Ein kleines Status-Indikator-Element zeigt den Prefetch-Zustand an: "Daten werden geladen…" / "Daten bereit" / (kein Hinweis bei Cache-Hit)
- [ ] Wenn der Nutzer Symbol oder Datumsbereich ändert, wird ein laufender Prefetch abgebrochen und ein neuer gestartet
- [ ] Wenn der Nutzer auf "Run Backtest" klickt während der Prefetch noch läuft, wartet das UI auf den Abschluss des Prefetch (kein doppelter Download)
- [ ] Der `/api/prefetch`-Endpoint ist authentifiziert (gleiche Auth-Prüfung wie `/api/backtest`)
- [ ] Der Prefetch-Endpoint unterliegt demselben Rate-Limit wie der Backtest-Endpoint
- [ ] Bei Prefetch-Fehler (Netzwerk, Dukascopy nicht erreichbar) wird kein Fehler im UI angezeigt — der Nutzer merkt es erst beim Backtest-Start (graceful degradation)
- [ ] Ein Cache-Hit beim Prefetch (Daten bereits vorhanden) ist ein No-Op — kein erneuter Download

## Edge Cases

- **Nutzer klickt sofort Run:** Prefetch hat noch nicht gestartet → normaler Backtest-Flow, kein Unterschied zum bisherigen Verhalten
- **Symbol valide, Datum invalide (z.B. Enddatum vor Startdatum):** Prefetch wird nicht ausgelöst — erst bei vollständig gültigem Zustand
- **Mehrfache schnelle Symbol-Wechsel:** Vorheriger Prefetch-Request wird per `AbortController` gecancelt, nur der letzte startet
- **Prefetch erfolgreich, aber Backtest nutzt leicht andere Stunden** (z.B. wegen Range-Zeit-Konvertierung): Kein Problem — Cache-Lookup ist flexibel; im Worst Case wird ein partieller Download ergänzt
- **Gleichzeitige Prefetch + Backtest-Requests desselben Users:** Rate-Limit greift; Backtest hat Priorität (Prefetch-Fehler wird ignoriert)
- **Session läuft während Prefetch ab:** `/api/prefetch` gibt 401 zurück → wird still ignoriert

## Technical Requirements

- Neuer Next.js API-Route: `POST /api/prefetch` (authentifiziert, Rate-Limited)
- Neuer FastAPI-Endpoint: `POST /prefetch` — triggert nur den Fetch-/Cache-Stack, kein Engine-Run
- Frontend: `useEffect` auf Symbol + Startdatum + Enddatum mit `AbortController` für Cancellation
- Status-Indikator: kleines Text-Element oder Icon in der Configuration UI (kein Modal, kein Toast)
- Prefetch-Response muss schnell sein: FastAPI gibt sofort zurück sobald Daten im Cache sind (kein Warten auf vollständige Verarbeitung nötig)

---

## Tech Design (Solution Architect)
_To be added by /architecture_

## QA Test Results
_To be added by /qa_

## Deployment
_To be added by /deploy_
