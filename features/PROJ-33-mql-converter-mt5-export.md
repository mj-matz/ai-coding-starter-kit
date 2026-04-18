# PROJ-33: MQL Converter – MT5 EA Export

## Status: Planned
**Created:** 2026-04-09
**Last Updated:** 2026-04-09

## Dependencies
- Requires: PROJ-22 (MQL Converter) — Original-MQL-Code und Konvertierungs-Workflow
- Requires: PROJ-32 (Editable Parameters) — strukturierte Parameter für den Export; `mql_input_name`-Mapping

## Overview
Nach einer Konvertierung und optionaler Parameter-Optimierung soll der Nutzer den Original-EA direkt mit den neuen Parametern als `.mq5`-Datei herunterladen können. Die Parameter werden per Regex in die `input`-Variablen-Deklarationen des Original-MQL-Codes geschrieben – kein erneuter Claude-Call, kein Datenverlust am restlichen EA-Code.

## User Stories
- Als Trader möchte ich nach einer Konvertierung und Backtest auf der MQL-Converter-Seite auf „Export as MT5 EA" klicken und den Original-EA mit den aktuell eingestellten Parametern als `.mq5`-Datei herunterladen, damit ich ihn direkt in MetaTrader 5 einsetzen kann.
- Als Trader möchte ich, dass der exportierte EA exakt dem Original entspricht – nur die `input`-Defaultwerte werden durch meine optimierten Parameter ersetzt – damit ich keine unerwarteten Codeänderungen erhalte.
- Als Trader möchte ich den Export auch direkt nach der ersten Konvertierung nutzen können (ohne vorher zu speichern), damit ich nicht unnötig Zwischenschritte habe.
- Als Trader möchte ich gespeicherte Konvertierungen laden, die Parameter anpassen und dann exportieren, damit ich verschiedene optimierte Versionen des EAs herunterladen kann.
- Als Trader möchte ich, dass der Dateiname den Strategie-Namen, das Symbol und das Exportdatum enthält, damit ich verschiedene Exports leicht unterscheiden kann.

## Acceptance Criteria

### Export-Button
- [ ] Ein „Export as MT5 EA"-Button erscheint auf der MQL-Converter-Seite nach jedem erfolgreichen Backtest (auch ohne vorheriges Speichern)
- [ ] Der Button ist deaktiviert / nicht sichtbar, solange kein Backtest-Ergebnis vorliegt oder kein Original-MQL-Code in der Session vorhanden ist
- [ ] Der Button befindet sich in der Export-/Aktionsleiste, sichtbar ohne Scrollen

### Export-Logik (API)
- [ ] Klick löst `POST /api/mql-converter/export-mt5` aus
- [ ] Request-Body enthält: `original_mql_code`, `parameters` (Array mit `mql_input_name` + aktuellem Wert), `symbol`, `date_from`, `date_to`, `conversion_name` (optional, für Dateiname)
- [ ] Die API durchsucht den `original_mql_code` nach `input`-Deklarationen per Regex: `input\s+\w+\s+<mql_input_name>\s*=\s*[^;]+;`
- [ ] Für jeden Parameter mit bekanntem `mql_input_name` wird der Defaultwert in der Deklaration durch den neuen Wert ersetzt
- [ ] Nicht gefundene `mql_input_name`-Variablen werden übersprungen (kein Fehler)
- [ ] Ein Kommentarblock wird am Dateianfang eingefügt: Konvertierungsname / Symbol / Backtest-Zeitraum / Exportdatum / Liste der geänderten Parameter

### Download
- [ ] Response: `Content-Type: application/octet-stream`, `Content-Disposition: attachment; filename="...mq5"`
- [ ] Dateiname: `{conversion_name_sanitized}_{symbol_sanitized}_{YYYY-MM-DD}.mq5` (Sonderzeichen → Unterstrich)
- [ ] Falls kein `conversion_name` vorhanden: Fallback auf `mql_converted_{symbol}_{date}.mq5`
- [ ] Browser-Download startet automatisch

### Auth & Session
- [ ] Route prüft Supabase-Session (wie alle anderen API-Routen)
- [ ] Der Original-MQL-Code wird aus dem Request-Body übernommen (nicht aus DB geladen) — damit funktioniert der Export auch für ungespeicherte Konvertierungen

### Gespeicherte Konvertierungen
- [ ] Beim Laden einer gespeicherten Konvertierung und anschließendem Re-run ist der Export-Button ebenfalls verfügbar
- [ ] Export nutzt das `original_mql_code` der gespeicherten Konvertierung sowie die aktuell eingestellten Parameter

## Edge Cases
- **`mql_input_name` nicht im Original-Code gefunden (z.B. Parameter wurde nach der Konvertierung im Python-Code hinzugefügt):** Parameter wird übersprungen, kein Fehler; Kommentarblock listet diesen Parameter als „not found in original MQL"
- **Original-MQL-Code fehlt in der Session (zu alte Session, kein Reload):** Export-Button ist disabled; Hinweis: „Reload the conversion to enable export."
- **Parameter hat Typ `string` (z.B. Zeitformat „HH:MM"):** Regex ersetzt nur den Wert in Anführungszeichen: `input string InpTimeExit = "20:00";` → `"22:00"`
- **Mehrere `input`-Deklarationen mit demselben Variablennamen (ungültiges MQL):** Nur die erste Fundstelle wird ersetzt
- **Symbol enthält Sonderzeichen (z.B. `GER30.cash`):** Dateiname wird sanitized (nur alphanumerisch + Unterstrich)
- **Original-MQL-Code ist sehr lang (> 50.000 Zeichen):** Export funktioniert trotzdem; keine Längenbeschränkung im Export-Endpoint (Regex-Operation ist < 100 ms)
- **Nutzer hat keine Parameter geändert:** Export funktioniert; Kommentarblock zeigt „Parameters: unchanged (using original defaults)"
- **Konvertierung von MQL4 (kein `input`, sondern `extern`):** Regex matcht auch `extern`-Deklarationen: `extern\s+\w+\s+<name>\s*=\s*[^;]+;`

## Technical Requirements
- **Neue API-Route:** `POST /api/mql-converter/export-mt5`
- **Keine externe Bibliothek:** reine Regex-/String-Operation in TypeScript, < 100 ms
- **Keine DB-Abhängigkeit:** Original-MQL-Code kommt aus dem Request-Body (Session-State im Browser)
- **Kein Claude-API-Call:** Export ist deterministisch, kein KI-Einsatz
- **Auth:** Supabase-Session-Check wie alle anderen Routen
- **Kein Rate Limiting:** Export ist eine reine Datei-Generierung ohne externe Services

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)
_To be added by /architecture_

## QA Test Results
_To be added by /qa_

## Deployment
_To be added by /deploy_
