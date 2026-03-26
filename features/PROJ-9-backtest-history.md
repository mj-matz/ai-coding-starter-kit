# PROJ-9: Backtest History

## Status: In Progress
**Created:** 2026-03-10
**Last Updated:** 2026-03-10

## Dependencies
- Requires: PROJ-5 (Backtest UI) — history is saved from the backtest run
- Requires: PROJ-8 (Authentication) — results are scoped to the authenticated user in Supabase

## User Stories
- As a trader, I want to save a backtest run with a custom name (e.g. "XAUUSD 3.5R TP") so that I can retrieve it later without re-running it.
- As a trader, I want to see a list of all my saved backtest runs so that I can review past experiments at any time.
- As a trader, I want to open a saved run and see its full results (metrics, equity curve, trade list) so that I can analyse it without re-running.
- As a trader, I want to load a saved run's configuration back into the backtest form so that I can use it as a starting point and tweak a parameter (e.g. change TP from 3.5R to 2R).
- As a trader, I want to delete saved runs I no longer need so that my history stays tidy.
- As a trader, I want to see key stats (Win Rate, Total R, Total Trades, asset, date range) in the history list so that I can compare runs at a glance without opening each one.

## Acceptance Criteria
- [ ] "Save Run" button appears after a backtest completes; clicking it opens a dialog to enter a name (default: `{asset} {strategy} {date}`)
- [ ] Saved run stored in Supabase (table: `backtest_runs`) with: user_id, name, created_at, config (JSON), results summary (JSON), full trade log (JSON)
- [ ] RLS policy: user can only read/write/delete own runs
- [ ] History page (or sidebar panel) lists all saved runs in reverse chronological order
- [ ] Each row in the list shows: name, asset, strategy, date range, Total Trades, Win Rate, Total R, Avg R/Month, created_at
- [ ] Clicking a row opens the full results view (same layout as PROJ-5 dashboard) populated with saved data
- [ ] "Load Config" button on a saved run loads its configuration back into the backtest form (does not overwrite without confirmation if form has unsaved data)
- [ ] Delete button on each row, requires confirmation; deleted runs are permanently removed
- [ ] Runs can be renamed inline

## Edge Cases
- User saves two runs with the same name → allowed, names are not unique; created_at differentiates them
- Saved run references a strategy or asset that no longer exists in the system → display stored results as-is with a warning "strategy/asset may be outdated"
- Trade log is very large (1000+ trades) → stored as compressed JSON; loading is still fast (< 2s)
- User has no saved runs → empty state with "Run a backtest and save it to start your history"

## Technical Requirements
- Requires: PROJ-8 (Authentication) — runs are scoped per user via RLS
- Supabase table: `backtest_runs` with columns: `id`, `user_id`, `name`, `asset`, `strategy`, `config` (jsonb), `summary` (jsonb), `trade_log` (jsonb), `created_at`
- API routes: `GET /api/backtest/runs`, `POST /api/backtest/runs`, `GET /api/backtest/runs/[id]`, `DELETE /api/backtest/runs/[id]`, `PATCH /api/backtest/runs/[id]` (rename)
- Config and results stored as JSONB — no separate columns for individual metrics (keeps schema stable as metrics evolve)
- All shadcn/ui components used (Table, Dialog, Button, Input, Badge)

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)

### Ausgangslage

Bestehende Bausteine, auf denen aufgebaut wird:
- **PROJ-5 (Backtest UI):** `results-panel`, `metrics-summary-card`, `equity-curve-chart`, `trade-list-table` – werden wiederverwendet, nicht neu gebaut.
- **PROJ-8 (Auth):** Benutzer ist eingeloggt, `user_id` ist bekannt.
- **API:** `/api/backtest/run` gibt bereits Ergebnisse zurück – das Speichern wird daran angehängt.

### Komponenten-Struktur

```
App (Sidebar bereits vorhanden)
│
├── /backtest            (bestehende Seite – PROJ-5)
│   ├── ConfigurationPanel   (bestehend)
│   └── ResultsPanel         (bestehend)
│       └── [NEU] "Run speichern"-Button
│           └── SaveRunDialog
│               ├── Eingabefeld: Name
│               └── Buttons: Speichern / Abbrechen
│
└── /history             [NEU – Seite]
    ├── HistoryHeader
    │   └── Titel + Beschreibung
    ├── HistoryTable         [NEU]
    │   ├── Zeilen: Name, Asset, Strategie, Zeitraum,
    │   │          Trades, Win Rate, Total R, erstellt am
    │   ├── InlineRenameInput (pro Zeile)
    │   ├── DeleteButton + Bestätigungs-Dialog
    │   └── "Config laden"-Button
    ├── RunDetailView        [NEU]  ← öffnet sich bei Klick auf Zeile
    │   ├── MetricsSummaryCard   (wiederverwendet von PROJ-5)
    │   ├── EquityCurveChart     (wiederverwendet von PROJ-5)
    │   ├── DrawdownChart        (wiederverwendet von PROJ-5)
    │   └── TradeListTable       (wiederverwendet von PROJ-5)
    └── EmptyState           (keine gespeicherten Runs)
```

### Datenmodell

Datenbank-Tabelle `backtest_runs` in Supabase:

| Feld | Inhalt |
|------|--------|
| `id` | Eindeutige ID (automatisch) |
| `user_id` | Welcher Benutzer hat diesen Run gespeichert |
| `name` | Frei wählbarer Name, z.B. "XAUUSD 3.5R TP" |
| `asset` | Das gehandelte Asset (z.B. "XAUUSD") — für schnelle Listenansicht denormalisiert |
| `strategy` | Strategie-Name (z.B. "TimeRangeBreakout") — für schnelle Listenansicht denormalisiert |
| `config` | Komplettes `BacktestFormValues`-Objekt als JSONB (inkl. aller Strategie-Parameter, Filter, Sizing) |
| `summary` | `BacktestMetrics` + `monthly_r` + `skipped_days` als JSONB |
| `trade_log` | `TradeRecord[]` als JSONB |
| `charts` | `equity_curve` + `drawdown_curve` als JSONB |
| `created_at` | Zeitstempel der Speicherung |

> **Zukunftssicherheit:** Alle Ergebnisfelder werden als JSONB gespeichert. Neue Felder in `BacktestResult`, `TradeRecord` oder `BacktestMetrics` werden automatisch mitgespeichert — **kein Schemaupdate und keine Anpassung dieser Spec nötig**, solange sich nur Inhalte, nicht die Struktur der Objekte ändern.

**Sicherheit:** RLS stellt sicher, dass jeder Benutzer ausschließlich seine eigenen Runs lesen, schreiben und löschen kann.

### API-Endpunkte (neue Routen)

| Endpunkt | Zweck |
|----------|-------|
| `GET /api/backtest/runs` | Liste aller eigenen Runs (neueste zuerst) |
| `POST /api/backtest/runs` | Neuen Run speichern |
| `GET /api/backtest/runs/[id]` | Einen Run vollständig laden |
| `DELETE /api/backtest/runs/[id]` | Run permanent löschen |
| `PATCH /api/backtest/runs/[id]` | Run umbenennen |

### Tech-Entscheidungen

| Entscheidung | Warum |
|---|---|
| **Supabase JSONB für alle Ergebnisdaten** | Schema bleibt stabil wenn neue Felder hinzukommen – keine Migration und keine Spec-Anpassung nötig. Nur bei strukturellen Umbenennungen ist Handlungsbedarf. |
| **Bestehende Chart-/Tabellen-Komponenten wiederverwenden** | Kein Doppel-Code; Ergebnisansicht sieht identisch aus wie nach einem Live-Run |
| **Inline-Umbenennung statt separatem Dialog** | Weniger Klicks für häufige Aktion |
| **Bestätigungs-Dialog vor Löschen** | Löschen ist irreversibel |
| **"Config laden" mit Bestätigung** | Schützt vor versehentlichem Überschreiben eines laufenden Konfigurations-Entwurfs |

### Neue Abhängigkeiten

Keine neuen Pakete nötig – alle benötigten shadcn/ui-Komponenten (`Table`, `Dialog`, `Button`, `Input`, `Badge`) sind bereits installiert.

## QA Test Results

**Datum:** 2026-03-26
**Tester:** /qa Agent

### Zusammenfassung

| Kategorie | Ergebnis |
|-----------|----------|
| Acceptance Criteria | 7/9 bestanden (AC-5 teilweise, AC-7 fehlgeschlagen) |
| Edge Cases | 3/4 bestanden (EC-2 nicht implementiert) |
| Bugs gefunden | 8 gesamt (0 Critical, 1 High, 2 Medium, 5 Low) |
| Security | Rate-Limit-Bypass-Risiko (Medium), kleinere API-Korrektheitsfehler |
| Build | PASS (keine Type-Errors) |
| Production Ready | **NEIN** |

### Bugs

| ID | Severity | Beschreibung | Datei / Ort |
|----|----------|-------------|-------------|
| BUG-1 | Low | Date-Range-Spalte fehlt in der History-Tabelle (AC-5 teilweise nicht erfüllt) | `src/components/backtest/results-panel.tsx` |
| BUG-2 | **High** | "Load Config" lädt Config nicht in das Backtest-Formular — `page.tsx` liest keine URL-Suchparameter (`useSearchParams` fehlt) | `src/app/(dashboard)/backtest/page.tsx` |
| BUG-3 | Medium | Keine Bestätigung vor Überschreiben ungespeicherter Formulardaten (AC-7 nicht erfüllt) | History-Komponente |
| BUG-4 | Low | Keine Warnung für veraltete Strategien/Assets (EC-2 nicht implementiert) | History-Tabelle |
| BUG-5 | Medium | Rate-Limit-Fehler erlaubt stillen Save — bei RPC-Fehler wird trotzdem gespeichert | `src/app/api/backtest/runs/route.ts:105-107` |
| BUG-6 | Low | DELETE gibt Erfolg zurück für nicht-existente IDs (count ist immer null) | `src/app/api/backtest/runs/[id]/route.ts` |
| BUG-7 | Low | Admin kann alle Runs lesen — widerspricht strikter AC-3-Formulierung (ggf. intentional) | RLS-Policy |
| BUG-8 | Medium | History-Tabelle nicht responsiv auf Mobile (375px) — kein `overflow-x-auto` Wrapper | History-Tabelle |

### Vor Deployment zu beheben

- **BUG-2 (High):** "Load Config" komplett nicht funktional — `useSearchParams` in `backtest/page.tsx` nachrüsten
- **BUG-3 (Medium):** Bestätigungsdialog vor "Config laden" implementieren (AC-7)
- **BUG-5 (Medium):** Rate-Limit-Fehlerbehandlung in `POST /api/backtest/runs` korrigieren
- **BUG-8 (Medium):** `overflow-x-auto` Wrapper für History-Tabelle hinzufügen

### Nächster Sprint

- BUG-1: Date-Range-Spalte in History-Tabelle ergänzen
- BUG-4: Warnung für veraltete Strategien/Assets implementieren
- BUG-6: DELETE-Response bei nicht-existenten IDs korrigieren
- BUG-7: RLS-Policy für Admin-Zugriff klären (intentional vs. Bug)

## Deployment

**Datum:** 2026-03-26
**Production URL:** https://quanti-backtester.vercel.app
**Status:** Deployed

### Pre-Deployment Checks
- [x] `npm run build` erfolgreich
- [x] `npm run lint` — 0 Errors
- [x] Supabase-Tabelle `backtest_runs` mit RLS angelegt und aktiv
- [x] BUG-2 (High): `useSearchParams` in `backtest/page.tsx` implementiert ✓
- [x] BUG-3 (Medium): Bestätigungsdialog vor "Config laden" implementiert ✓
- [x] BUG-5 (Medium): Rate-Limit-Fehlerbehandlung korrigiert (503 bei RPC-Fehler) ✓
- [x] BUG-8 (Medium): `overflow-x-auto` Wrapper für History-Tabelle vorhanden ✓
