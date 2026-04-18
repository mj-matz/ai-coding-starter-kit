# PROJ-27: Persistent Market Data Store (Monthly Chunks)

## Status: Planned
**Created:** 2026-03-31
**Last Updated:** 2026-03-31

## Dependencies
- Requires: PROJ-1 (Data Fetcher) — nutzt denselben Fetch-Stack
- Requires: PROJ-2 (Backtesting Engine) — Engine erhält Daten aus dem neuen Store
- Supersedes partially: PROJ-14 (Cache Warming) — PROJ-27 löst das zugrundeliegende Problem dauerhaft; PROJ-14 bleibt als UI-Trick komplementär nutzbar

## Context

Der bestehende `cache_service.py` speichert bereits Parquet-Dateien persistent auf dem Server und trackt Metadaten in Supabase (`data_cache`-Tabelle). Das Problem: Pro Backtest-Request wird **eine monolithische Datei** für den gesamten Datumsbereich gespeichert. Wird derselbe Asset mit einem abweichenden Zeitraum erneut getestet (z.B. Jan–Jun gecacht, dann Jan–Dez angefordert), gibt es keinen Cache-Hit und alles wird neu heruntergeladen — auch die bereits bekannten 6 Monate.

PROJ-27 löst dies durch **monatliche Chunks**: Ein Request für Jan–Dez lädt nur die Monate herunter, die noch nicht vorhanden sind.

## User Stories

- Als Trader möchte ich, dass ein Asset, das ich schon einmal getestet habe, beim nächsten Backtest sofort bereitsteht, ohne es erneut herunterladen zu müssen.
- Als Trader möchte ich, dass wenn ich einen längeren Zeitraum teste als bisher (z.B. +3 neue Monate), nur die neuen Monate heruntergeladen werden — nicht alles von vorne.
- Als Trader möchte ich, dass das Verhalten für mich unsichtbar ist: der Backtest verhält sich exakt gleich, nur schneller bei bereits bekannten Daten.
- Als Trader möchte ich sehen, welche Assets und Zeiträume bereits gecacht sind, damit ich weiß was sofort verfügbar ist.

## Acceptance Criteria

- [ ] Daten werden monatsweise als separate Parquet-Dateien gespeichert (z.B. `XAUUSD/1m/2025-01.parquet`)
- [ ] Vor jedem Dukascopy-Download wird geprüft, welche Monate des angeforderten Bereichs bereits vorhanden sind
- [ ] Nur fehlende Monate werden heruntergeladen; vorhandene Monate werden direkt geladen
- [ ] Die monatlichen Chunks werden für den Backtest zu einem zusammenhängenden DataFrame zusammengeführt
- [ ] Die bestehende `data_cache`-Tabelle in Supabase wird pro Chunk (= pro Monat) mit einem Eintrag befüllt (symbol, source, timeframe, year, month, file_path, row_count, file_size_bytes)
- [ ] Das bestehende Verhalten (ein File pro Request) wird durch die neue Chunk-Logik ersetzt — keine doppelte Cache-Schicht
- [ ] Bei fehlendem Parquet-File (Server-Reset, gelöschte Datei) wird der betroffene Monat transparent neu heruntergeladen (graceful fallback)
- [ ] Das Zusammenführen von N monatlichen Chunks zu einem DataFrame hat keinen messbaren Performance-Nachteil gegenüber dem bisherigen Single-File-Ansatz
- [ ] Die Cache-Verwaltungsseite im UI zeigt gespeicherte Assets mit Zeitraum und Gesamtgröße an
- [ ] Chunks für einen Asset/Timeframe können manuell aus dem UI gelöscht werden (z.B. um veraltete Daten zu erneuern)

## Edge Cases

- **Partieller Monat (erster/letzter Monat eines Zeitraums):** Ein Chunk für März 2025 enthält nur die Handelstage — kein Problem, da Dukascopy selbst nur Handelstage liefert
- **Monat komplett ohne Daten (z.B. Feiertage/Marktschließung):** Leerer Chunk wird als "bekannt leer" markiert, damit er nicht erneut abgefragt wird (Supabase-Eintrag mit `row_count = 0`)
- **Laufender Monat (z.B. März 2026 während des Monats):** Wird nach Download gecacht, aber als "unvollständig" markiert — bei erneutem Request für diesen Monat wird er neu abgerufen um fehlende Tage zu ergänzen
- **Alter Cache-Eintrag (altes Single-File-Format) vorhanden:** Migration: bestehende Cache-Einträge bleiben gültig und werden weiterhin als Hit erkannt; nur neue Fetches nutzen Chunk-Logik
- **Server-Neustart, Parquet-Dateien verloren:** Supabase-Eintrag zeigt auf nicht existierende Datei → stale Entry wird gelöscht, Monat wird neu heruntergeladen
- **Zeitzonengrenze Monatsende:** Alle Timestamps in UTC; Monatsgrenzen werden nach UTC-Datum geschnitten
- **Gleichzeitige Backtests desselben Assets:** Locking-Mechanismus oder idempotentes Schreiben sicherstellen, damit kein Chunk doppelt heruntergeladen wird

## Technical Requirements

- Neue Dateistruktur: `DATA_DIR/parquet/{source}/{SYMBOL}/{timeframe}/{YYYY-MM}.parquet`
- Supabase `data_cache`-Tabelle: neue Spalten `year` (int) und `month` (int) für Chunk-Lookup; `date_from`/`date_to` bleiben für Kompatibilität
- Python: neue Funktion `find_missing_months(symbol, source, timeframe, date_from, date_to) -> list[YearMonth]`
- Python: neue Funktion `load_and_merge_chunks(symbol, source, timeframe, date_from, date_to) -> DataFrame`
- Bestehende Funktionen `find_cached_entry` / `save_to_cache` werden refaktoriert oder wrapped — kein Breaking Change für andere Aufrufer
- UI: bestehende Cache-Seite (`/api/data/cache`) um Chunk-Übersicht erweitern (welche Monate sind pro Asset vorhanden)

---

## Tech Design (Solution Architect)

### Overview

This feature is primarily a **Python backend refactor** with a small Supabase schema change and a UI update on the Settings page. The user experience does not change — backtests simply become faster when data was previously fetched.

---

### Component Structure

```
Settings Page (/settings)
+-- Cache Management Section  [UPDATED]
    +-- Asset Cache Table
    |   +-- Asset row (e.g. XAUUSD / 1m)
    |   |   +-- Available months indicator (e.g. "Jan 2025 – Dec 2025")
    |   |   +-- Total size label
    |   |   +-- Delete all chunks button
    |   +-- Asset row (e.g. EURUSD / 1m)
    |       +-- ...
    +-- Empty state (no cache yet)
```

The existing Settings page already hosts the MT5 data table — the cache section lives alongside it. No new pages are needed.

---

### Data Model

**Supabase: `data_cache` table** (updated)

Each row represents one monthly chunk for one asset/timeframe combination:

```
data_cache:
- id            (UUID, primary key)
- symbol        (text)       e.g. "XAUUSD"
- source        (text)       e.g. "dukascopy"
- timeframe     (text)       e.g. "1m"
- year          (int)        NEW — e.g. 2025
- month         (int)        NEW — e.g. 3 (March)
- file_path     (text)       e.g. "parquet/dukascopy/XAUUSD/1m/2025-03.parquet"
- row_count     (int)        0 = known-empty month
- file_size_bytes (int)
- date_from     (timestamp)  kept for backwards compatibility
- date_to       (timestamp)  kept for backwards compatibility
- is_complete   (bool)       NEW — false for the current calendar month
- created_at    (timestamp)
```

**File system on Railway (Python server):**
```
DATA_DIR/
  parquet/
    dukascopy/
      XAUUSD/
        1m/
          2025-01.parquet
          2025-02.parquet
          2025-03.parquet
          ...
```

---

### Backend Changes (Python / FastAPI)

Three logical building blocks:

**1. Chunk Lookup** — Before any download, query Supabase to find which months in the requested range already have a valid, complete chunk. Only missing months are passed to the downloader.

**2. Download & Store** — The existing Dukascopy download logic runs per missing month, saves each result as a separate Parquet file, and writes one `data_cache` row per month.

**3. Merge & Return** — Monthly Parquet files are loaded and concatenated into a single DataFrame for the backtest engine. This replaces the current single-file load — performance impact is negligible (Parquet reads are fast even for 12 files).

**Graceful fallback:** If a Supabase row points to a missing file (server reset), that month is re-downloaded transparently.

**Current month handling:** Chunks for the current calendar month are stored with `is_complete = false`. Any request touching the current month will re-download it to pick up new trading days.

**Concurrency protection:** A lightweight file-level lock (or idempotent write) ensures two simultaneous backtest requests for the same asset don't download the same month twice.

**Backwards compatibility:** Existing monolithic cache entries (old format, no `year`/`month`) remain readable via the `date_from`/`date_to` columns. New fetches use the chunk path; old entries are gradually replaced as those assets are re-requested.

---

### API Changes (Next.js → FastAPI)

| Endpoint | Change |
|---|---|
| `DELETE /api/data/cache` | Unchanged — still deletes a single entry by ID |
| `GET /api/data/cache` | **New** — returns cache entries grouped by asset+timeframe with month list and total size |

The grouped GET endpoint powers the Settings UI. The existing DELETE endpoint works at the chunk level — deleting all months for an asset means calling it once per chunk.

---

### Tech Decisions

| Decision | Reason |
|---|---|
| Monthly granularity (not weekly/daily) | Matches how Dukascopy data is structured; simple to reason about; manageable number of files |
| One Supabase row per chunk | Enables precise "which months exist?" lookup without reading the filesystem |
| Keep `date_from`/`date_to` columns | Zero-downtime backwards compatibility with existing cache entries |
| `is_complete` flag for current month | Prevents stale partial-month data without special-casing the download logic |
| No migration of old files | Old monolithic files stay valid until the asset is re-requested; no risky bulk migration needed |

---

### Dependencies

No new npm packages needed. No new Python packages needed (Parquet/Pandas already in use).

---

### Migration Path

1. Add `year`, `month`, `is_complete` columns to `data_cache` (nullable for old rows)
2. Deploy new Python logic — old rows still work via `date_from`/`date_to` fallback
3. New backtest requests populate chunk rows going forward
4. Old monolithic entries are soft-replaced over time (no forced migration)

## QA Test Results
_To be added by /qa_

## Deployment
_To be added by /deploy_
