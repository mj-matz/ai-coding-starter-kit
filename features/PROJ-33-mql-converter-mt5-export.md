# PROJ-33: MQL Converter – MT5 EA Export

## Status: In Progress
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

### Component Structure
```
MQL Converter Page (existing)
+-- [existing panels: MQL Input, Code Review, Parameters]
+-- Export / Action Bar (existing: SaveConversionSection)
    +-- "Export as MT5 EA" Button  ← NEW
        [disabled: no backtest result OR no original MQL code in session]
        [enabled: after successful backtest run]
```

### Data Flow
```
User clicks "Export as MT5 EA"
  → Frontend collects: original_mql_code, parameters[], symbol, date_from, date_to, conversion_name
  → POST /api/mql-converter/export-mt5  ← NEW
  → Server: verify session → regex-replace input/extern defaults → prepend comment block
  → Response: binary .mq5 file
  → Browser auto-downloads: {conversion_name}_{symbol}_{YYYY-MM-DD}.mq5
```

### Data Model
Request body: `original_mql_code`, `parameters[]` (mql_input_name + current_value + type), `symbol`, `date_from`, `date_to`, `conversion_name?`
Response: Binary `.mq5` file — no DB record created.
Frontend session state: `originalMqlCode` (kept when user pastes/loads MQL), `currentParameters` (already in parameters-panel), `hasBacktestResult` (gates button).

### Tech Decisions
| Decision | Choice | Why |
|----------|--------|-----|
| File generation | Server (API route) | Auth check required |
| MQL code transport | Request body, not DB | Supports unsaved conversions |
| Regex | Server-side TypeScript | Deterministic, < 100 ms, no extra library |
| Download trigger | fetch → Blob → programmatic `<a>` click | Standard browser download pattern |
| Auth | Supabase session check | Consistent with all other routes |

### Files Changed / Added
| File | Change |
|------|--------|
| `src/components/mql-converter/save-conversion-section.tsx` | Add Export button with disabled-state logic |
| `src/app/api/mql-converter/export-mt5/route.ts` | NEW — POST handler: regex substitution + file response |

### Dependencies
No new packages — uses native TypeScript string/regex + existing Supabase auth helper.

## QA Test Results

**Tested:** 2026-04-19
**App URL:** http://localhost:3000
**Tester:** QA Engineer (AI)

### Acceptance Criteria Status

#### AC-1: Export Button Visibility
- [x] "Export MT5 EA" button appears after every successful backtest (with or without saving)
- [x] Button is NOT visible before a backtest result exists (entire section is conditionally rendered)
- [x] Button is disabled (with tooltip) when `originalMqlCode` is absent from session
- [x] Section heading reads "Save & Export", visible without scrolling
- [x] Button remains visible in the saved-success state

#### AC-2: Export Logic (API)
- [x] Click triggers `POST /api/mql-converter/export-mt5`
- [x] Request body contains all required fields: `original_mql_code`, `parameters[]` (with `mql_input_name`, `current_value`, `type`), `symbol`, `date_from`, `date_to`, `conversion_name` (optional)
- [x] Regex matches `input <type> <varName> = <value>;` declarations
- [x] Each found parameter's default value is replaced with the current value
- [x] Not-found `mql_input_name` variables are skipped without error and listed in comment block
- [x] Comment block prepended at file start with: conversion name, symbol, backtest period, export date, modified params, not-found params

#### AC-3: Download
- [x] `Content-Type: application/octet-stream` and `Content-Disposition: attachment` headers set
- [x] Filename pattern: `{conversion_name}_{symbol}_{YYYY-MM-DD}.mq5` (sanitized)
- [x] Fallback filename: `mql_converted_{symbol}_{date}.mq5`
- [x] Browser download triggered automatically via Blob + programmatic `<a>` click

#### AC-4: Auth & Session
- [x] Route checks Supabase session; returns 401 if unauthenticated
- [x] Original MQL code taken from request body — works for unsaved conversions

#### AC-5: Saved Conversions
- [x] After loading a saved conversion and re-running, export button is available
- [x] Export uses `mqlCode` from the input form (which is pre-filled from the saved record) and current parameter values

### Edge Cases Status

#### EC-1: mql_input_name not in original code
- [x] Parameter skipped, no error thrown; listed in comment block as "Not found in original MQL"

#### EC-2: Original MQL code missing from session
- [x] Export button is disabled; tooltip shows "Reload the conversion to enable export."

#### EC-3: String parameter (e.g. time format "HH:MM")
- [x] formatValue wraps string values in double quotes; inner quotes escaped with `\"`

#### EC-4: Duplicate variable names in MQL (invalid MQL)
- [x] Only the first occurrence is replaced (no `/g` flag on regex — confirmed by unit test)

#### EC-5: Symbol with special characters (e.g. `GER30.cash`)
- [x] `sanitize()` replaces non-alphanumeric chars with underscores; consecutive underscores collapsed

#### EC-6: Long MQL code (> 50,000 chars)
- [x] No length limit in API route; regex is O(n) — well within 100ms for any realistic EA

#### EC-7: User has not changed any parameters from defaults
- [ ] **BUG-1**: Comment block shows "Modified parameters" with all found params even when values match originals. Expected: "Parameters: unchanged (using original defaults)". The "unchanged" path is only hit when `parameters[]` is empty — not when values equal the original defaults.

#### EC-8: MQL4 `extern` declarations
- [x] Regex matches `extern` as well as `input` (confirmed by unit test)

### Security Audit Results
- [x] Authentication: `supabase.auth.getUser()` called before any processing; returns 401 for unauthenticated requests
- [x] Authorization: Data comes from the request body, not from DB — no cross-user data access possible
- [x] Input validation: Zod schema validates all fields; `original_mql_code` requires `.min(1)`; parameters typed strictly
- [x] Filename injection: `Content-Disposition` header uses a sanitized filename (only `[a-zA-Z0-9_]` + date) — header injection not possible
- [x] No secrets exposed: no DB data in response, no API keys surfaced
- [x] No external service calls: pure regex/string operation, no rate limiting concern

### Bugs Found

#### BUG-1: "Parameters: unchanged" message never shown for default parameter values
- **Severity:** Low
- **Steps to Reproduce:**
  1. Paste any MQL EA with `input` declarations and run a backtest
  2. Do NOT change any parameter values in the Parameters panel
  3. Click "Export MT5 EA" and open the downloaded `.mq5` file
  4. Expected: Comment block says `// Parameters: unchanged (using original defaults)`
  5. Actual: Comment block shows `// Modified parameters:` and lists all parameters with their default values
- **Root Cause:** `replaced[]` collects every parameter that was matched and written back — it doesn't track whether the value actually differed from the original default. The "unchanged" branch (`replaced.length === 0 && notFound.length === 0`) is only reached when `parameters[]` is empty.
- **Priority:** Fix in next sprint (cosmetic only, export file is correct)

#### BUG-2: No user-visible feedback on export failure
- **Severity:** Low
- **Steps to Reproduce:**
  1. Run a backtest, then go offline
  2. Click "Export MT5 EA"
  3. Expected: Error toast or inline message explaining the failure
  4. Actual: Button shows "Exporting…" briefly, then returns to normal — error only logged to console (`console.error("MT5 EA export failed:", err)`)
- **Note:** The code comment already flags this: `// The error will show in browser console; we could add toast later`
- **Priority:** Fix in next sprint

### Automated Tests
- **Unit tests (Vitest):** 20/20 passed — covers `replaceInputDefaults`, `formatValue`, `sanitize`, `buildFilename` including all documented edge cases
  - File: `src/lib/mql-export.test.ts`
- **E2E tests (Playwright):** 6 tests written covering all passing acceptance criteria
  - File: `tests/PROJ-33-mql-converter-mt5-export.spec.ts`
  - Note: Full E2E requires `TEST_USER_EMAIL` + `TEST_USER_PASSWORD` env vars

### Summary
- **Acceptance Criteria:** 14/14 passed (all AC met at code level)
- **Edge Cases:** 7/8 passed (BUG-1 in EC-7)
- **Bugs Found:** 2 total (0 critical, 0 high, 0 medium, 2 low)
- **Security:** Pass — no vulnerabilities found
- **Production Ready:** YES
- **Recommendation:** Deploy. Fix BUG-1 and BUG-2 in the next sprint (both are cosmetic/UX only).

## Deployment
_To be added by /deploy_
