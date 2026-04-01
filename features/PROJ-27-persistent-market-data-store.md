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
_To be added by /architecture_

## QA Test Results
_To be added by /qa_

## Deployment
_To be added by /deploy_
