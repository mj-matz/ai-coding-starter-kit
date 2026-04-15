# PROJ-34: MT5 Broker Data Import

## Status: Deployed
**Created:** 2026-04-14
**Last Updated:** 2026-04-14

## Dependencies
- Requires: PROJ-8 (Authentication) — Admin-only Upload via Supabase Auth
- Requires: PROJ-22 (MQL Converter) — MQL Converter nutzt MT5-Daten als Standard-Datenquelle
- Requires: PROJ-29 (Backtest Realism) — MT5 Mode Toggle bereits vorhanden; wird um Datenquelle erweitert

## Overview

Trader können 1-Minuten- (und andere Timeframe-) OHLCV-Daten direkt aus dem MT5 History Center exportieren und in die Software importieren. Die importierten Daten werden in Supabase gespeichert und stehen als alternative Datenquelle zu Dukascopy zur Verfügung.

Der bestehende **MT5 Mode Toggle** in `/backtest` steuert ab sofort beides gemeinsam:
1. **Execution-Logik** (Bid-Standard, First-Breakout-Direction) — bereits vorhanden (PROJ-29)
2. **Datenquelle** (MT5 Broker-Daten statt Dukascopy) — neu

Der **MQL Converter** greift standardmäßig auf MT5-Daten zu, weil hier Broker-Parität besonders wichtig ist.

---

## User Stories

- Als Trader möchte ich eine MT5-History-CSV-Datei auf der Settings-Seite hochladen, damit die Software mit denselben Preisdaten arbeitet wie mein Live-Broker.
- Als Trader möchte ich im Settings-Bereich eine Übersicht aller importierten MT5-Datensätze sehen (Asset, Timeframe, Zeitraum, Größe), damit ich weiß, welche Daten verfügbar sind.
- Als Trader möchte ich einen importierten Datensatz löschen können, damit ich veraltete oder fehlerhafte Daten entfernen kann.
- Als Trader möchte ich, dass beim Backtest mit aktiviertem MT5 Mode die MT5-Daten automatisch verwendet werden, damit die Ergebnisse meiner echten Broker-Umgebung entsprechen.
- Als Trader möchte ich beim Backtest eine klare Fehlermeldung erhalten, wenn die MT5-Daten den angefragten Zeitraum nicht abdecken, damit ich nicht versehentlich mit falschen Daten teste.
- Als Trader möchte ich im Optimizer ebenfalls auf MT5-Daten optimieren können, damit die gefundenen Parameter auf meinem Live-Broker valide sind.
- Als Trader möchte ich im MQL Converter standardmäßig MT5-Daten verwenden, damit der Backtest-Vergleich mit dem Original-EA aussagekräftig ist.
- Als Trader möchte ich im MQL Converter einen direkten Upload-Link sehen, wenn für das aktuelle Asset keine MT5-Daten vorhanden sind, damit ich den Datensatz schnell hinzufügen kann.

---

## Acceptance Criteria

### Settings-Seite: MT5 Market Data

- [ ] Unter `/settings` gibt es einen neuen Bereich „Market Data (MT5)"
- [ ] Die Tabelle zeigt alle importierten Datensätze: Symbol, Timeframe, Zeitraum (Von–Bis), Anzahl Kerzen, Upload-Datum, Delete-Button
- [ ] Ein „+ Upload CSV"-Button öffnet einen Upload-Dialog
- [ ] Im Upload-Dialog kann der Nutzer:
  - Eine CSV-Datei auswählen (Drag & Drop oder File-Picker)
  - Das Asset aus einem Dropdown wählen (alle in der Software bekannten Instrumente)
  - Den Timeframe auswählen (M1, M5, M15, M30, H1, H4, D1)
- [ ] Das System erkennt automatisch das MT5-CSV-Format (Trennzeichen Semikolon oder Komma, Spalten: Date, Time, Open, High, Low, Close, TickVol / Volume / Spread optional)
- [ ] Vor dem Speichern wird eine Vorschau angezeigt: erkanntes Format, Anzahl Zeilen, erkannter Zeitraum
- [ ] Upload validiert: Mindestens 10 Kerzen, Datum-Parsing erfolgreich, OHLC numerisch
- [ ] Nach erfolgreichem Upload erscheint der neue Datensatz sofort in der Tabelle
- [ ] Löschen öffnet eine Bestätigungs-Confirmation, danach wird der Datensatz aus Supabase entfernt
- [ ] Beim Re-Upload eines bereits vorhandenen Datensatzes (gleiche Asset + Timeframe + überlappender Zeitraum) fragt das System: „Merge" (neue Kerzen hinzufügen) oder „Replace" (Zeitraum überschreiben)

### Backtest: MT5 Mode Toggle (Erweiterung)

- [ ] Wenn MT5 Mode aktiviert ist und MT5-Daten für Asset + Timeframe vorhanden sind, werden diese statt Dukascopy verwendet — sichtbar durch ein Label „Using MT5 data" in der Konfigurations-UI
- [ ] Wenn MT5 Mode aktiviert ist und MT5-Daten **nicht** vorhanden sind, wird Dukascopy weiterverwendet — sichtbar durch Label „Using Dukascopy data (no MT5 data available)"
- [ ] Wenn MT5 Mode aktiviert ist und die MT5-Daten den Backtest-Zeitraum **nicht vollständig abdecken**, wird der Backtest blockiert mit Fehlermeldung: „MT5 data for [Asset] only covers [Von] – [Bis]. Adjust the date range or upload additional data."
- [ ] Der bestehende Execution-Verhalten (Bid-Standard, First-Breakout-Direction) bleibt unverändert an den MT5 Mode Toggle gebunden

### Optimizer: MT5 Toggle

- [ ] Im Optimizer gibt es einen MT5 Mode Toggle (identisches Verhalten wie im Backtest)
- [ ] Wenn aktiviert: Optimierung läuft auf MT5-Daten statt Dukascopy
- [ ] Label zeigt aktuelle Datenquelle an (analog Backtest)
- [ ] Fehlermeldung bei fehlender Abdeckung (analog Backtest)

### MQL Converter: MT5-Daten als Standard

- [ ] Der MQL Converter verwendet standardmäßig MT5-Daten, sofern für das gewählte Asset vorhanden
- [ ] Wenn MT5-Daten verfügbar sind: kein besonderer Hinweis (Standardverhalten)
- [ ] Wenn MT5-Daten für das gewählte Asset **nicht** verfügbar sind, erscheint eine Warnung:
  - Icon: ⚠️
  - Text: „No MT5 data available for [Asset]. Results may differ from your MT5 broker. [Upload MT5 Data]"
  - Der Link „Upload MT5 Data" öffnet direkt den Upload-Dialog (ohne zur Settings-Seite navigieren zu müssen)
- [ ] Nach erfolgreichem Upload im Inline-Dialog wird die Warnung ausgeblendet und der Backtest nutzt die neuen MT5-Daten

### Datenformat-Unterstützung

- [ ] MT5 History Center CSV mit Semikolon-Trennzeichen wird erkannt und geparst
- [ ] MT5 History Center CSV mit Komma-Trennzeichen wird erkannt und geparst
- [ ] Datumsformat `2026.01.05` (Punkt-getrennt) wird korrekt geparst
- [ ] Datumsformat `2026-01-05` (ISO) wird ebenfalls akzeptiert
- [ ] Zeit-Spalte `00:00` oder kombiniert `2026.01.05 00:00` wird korrekt interpretiert
- [ ] Optionale Spalten (TickVol, Volume, Spread) werden importiert falls vorhanden, aber nicht benötigt
- [ ] Dateien bis 50 MB werden akzeptiert (entspricht ca. 3 Jahren M1-Daten)

---

## Edge Cases

- **CSV hat falsches Format (z.B. Excel-Export statt MT5-History-Center):** Parsing-Fehler mit konkretem Hinweis: „Column 'Open' not found. Please export from MT5 → History Center → right-click → Export."
- **MT5 Symbol-Name weicht ab (z.B. `GER40+` statt `GER40`):** Asset-Auswahl im Upload-Dialog ist manuell — der Nutzer wählt das korrekte Instrument in der Software, unabhängig vom MT5-Symbolnamen.
- **Lücken in den Daten (z.B. Wochenende, Feiertage):** Werden als normal akzeptiert — die Engine überspringt Bars ohne Daten wie bei Dukascopy.
- **Überlappende Uploads:** System fragt „Merge" oder „Replace" — kein stiller Datenverlust.
- **Backtest-Zeitraum liegt teilweise außerhalb der MT5-Daten:** Fehlermeldung mit exaktem verfügbaren Zeitraum, Backtest wird nicht gestartet.
- **MT5-Daten vorhanden, aber MT5 Mode deaktiviert:** Dukascopy wird verwendet — MT5-Daten werden ignoriert.
- **Sehr große CSV (> 50 MB):** Upload abgelehnt mit Hinweis: „File too large. Max 50 MB. Split into multiple files by year."
- **Gleicher Zeitraum doppelt hochgeladen (Replace gewählt):** Alte Kerzen werden vollständig ersetzt, kein Duplikat in der DB.
- **Optimizer läuft über sehr langen Zeitraum, MT5-Daten decken nur einen Teil ab:** Fehlermeldung vor Start der Optimierung — nicht erst nach dem ersten Iteration.

---

## Technical Requirements

- **Supabase Storage oder Tabelle:** MT5-Daten werden in Supabase gespeichert (Architektur-Entscheidung in `/architecture`)
- **Asset-Mapping:** MT5-Symbolname wird im Upload ignoriert; Nutzer wählt das interne Instrument manuell
- **Timeframe-Unterstützung:** M1, M5, M15, M30, H1, H4, D1
- **Max. Dateigröße:** 50 MB pro Upload
- **Auth:** Nur eingeloggter Admin-User kann Daten hochladen und löschen
- **RLS:** Supabase Row Level Security — Daten sind nur für den eigenen User lesbar
- **Keine externen Services:** Import ist reine CSV-Parse + DB-Insert-Operation
- **Performance:** Upload und Parsing von 1 Jahr M1-Daten (ca. 130.000 Zeilen) in < 30 Sekunden

---

## Tech Design (Solution Architect)

### Key Design Decisions

**1. Database rows, not file storage**
MT5 candles are stored as rows in Supabase tables — not as raw CSV files in Supabase Storage. The Python backend needs to query specific date ranges efficiently, which requires indexed DB rows.

**2. Two-table model: metadata + candles**
`mt5_datasets` holds one record per uploaded dataset (asset, timeframe, date range). `mt5_candles` holds actual OHLCV rows linked to a dataset. This lets the UI list datasets cheaply without loading millions of rows.

**3. CSV parsing happens in the browser (client-side)**
The browser reads and parses the CSV file locally before sending data to the API. This avoids streaming 50 MB files to the server and gives instant format feedback. Only the parsed JSON array is sent to the API for DB insertion.

**4. Settings page is a new route**
No existing `/settings` page — created as a new dashboard page reusing the existing layout. Sidebar gets a new "Settings" entry.

**5. Python backend queries Supabase for MT5 candles**
When MT5 Mode is enabled, the backend queries `mt5_candles` by asset+timeframe+date range instead of calling Dukascopy.

---

### Component Structure

**New: `/settings` page**
```
Settings Page (/settings)
+-- Section: "Market Data (MT5)"
    +-- MT5 Data Table
    |   +-- Columns: Symbol | Timeframe | Date Range | Candles | Uploaded | Actions
    |   +-- Row action: Delete (with confirmation dialog)
    |   +-- Empty state: "No MT5 data uploaded yet"
    +-- "+ Upload CSV" Button → MT5 Upload Dialog
        +-- Step 1: File Selection (Drag & Drop + file picker, max 50 MB)
        +-- Step 2: Configuration (Asset Dropdown, Timeframe Dropdown)
        +-- Step 3: Preview (detected format, row count, date range, validation errors)
        +-- Step 4 (conditional): Overlap Resolution → "Merge" or "Replace"
        +-- Submit / Cancel
```

**Existing: Configuration Panel (Backtest)**
```
MT5 Mode Section (existing PROJ-29)
+-- MT5 Mode Toggle (existing)
+-- NEW: Data source indicator label
    +-- "Using MT5 data" (green badge)
    +-- "Using Dukascopy (no MT5 data for this asset)" (gray badge)
    +-- "MT5 data does not cover the selected date range" (red alert)
```

**Existing: Optimizer page**
```
+-- NEW: MT5 Mode Toggle (mirrors backtest behavior)
+-- NEW: Data source indicator label (same logic)
```

**Existing: MQL Converter**
```
+-- NEW: MT5 Data Status Banner (below asset selector)
    +-- Hidden when MT5 data available
    +-- Warning when not available: ⚠️ "No MT5 data for [Asset]. [Upload MT5 Data]"
    +-- Inline Upload Dialog (same component as Settings page)
```

**Sidebar**
```
+-- NEW: Settings navigation entry
```

---

### Data Model

**`mt5_datasets`** — one row per uploaded dataset
- ID, User ID (RLS), Asset, Timeframe, Start date, End date, Candle count, Uploaded timestamp

**`mt5_candles`** — one row per OHLCV candle
- Dataset ID (FK → mt5_datasets, cascade delete), Timestamp (UTC), Open, High, Low, Close, Tick Volume (optional), Volume (optional), Spread (optional)
- Index on: dataset_id + timestamp for efficient date-range queries

RLS: Both tables locked to the authenticated user.

---

### API Routes (new)

| Route | Method | Purpose |
|---|---|---|
| `/api/mt5-data/datasets` | GET | List all datasets for logged-in user |
| `/api/mt5-data/upload` | POST | Validate + insert parsed candles + create/update dataset |
| `/api/mt5-data/datasets/[id]` | DELETE | Remove dataset and all candles (cascade) |
| `/api/mt5-data/check` | GET | Check availability for asset+timeframe+date range |

---

### New Components

| Component | Location | Purpose |
|---|---|---|
| `mt5-data-table` | `src/components/settings/` | Table of uploaded datasets with delete action |
| `mt5-upload-dialog` | `src/components/settings/` | Multi-step upload flow (reused in MQL Converter) |
| `mt5-data-status-badge` | `src/components/shared/` | Reusable data source indicator (Backtest + Optimizer) |

---

### Dependencies

No new npm packages required. CSV parsing uses the native browser File API. All UI uses existing shadcn/ui components.

---

### Integration Points

- **Backtest API** (`/api/backtest/run`): Pass `mt5Mode` + asset+timeframe to Python; Python fetches from `mt5_candles` instead of Dukascopy.
- **Optimizer API** (`/api/optimizer/run`): Same pattern.
- **Python backend**: New: query `mt5_candles` when MT5 mode enabled; return structured error if date range not fully covered.
- **MQL Converter**: Check `/api/mt5-data/check` when asset changes; show warning banner if no data.

## QA Test Results

**QA Date:** 2026-04-15
**Tester:** /qa skill
**Build:** ✅ Compiles clean (0 errors, 5 pre-existing warnings — none from PROJ-34)
**Lint:** ✅ 0 errors

---

### Acceptance Criteria Results

#### Settings Page: MT5 Market Data

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 1 | `/settings` page with "Market Data (MT5)" section | ✅ PASS | Page at `src/app/(dashboard)/settings/page.tsx` |
| 2 | Table shows Symbol, Timeframe, Date Range, Candles, Uploaded, Delete columns | ✅ PASS | `Mt5DataTable` component |
| 3 | "+ Upload CSV" button opens upload dialog | ✅ PASS | |
| 4a | File selection via drag & drop and file picker | ✅ PASS | `Mt5UploadDialog`, `handleDrop` / file input |
| 4b | Asset dropdown | ✅ PASS | Uses `AssetCombobox` |
| 4c | Timeframe dropdown (M1–D1) | ✅ PASS | |
| 5 | Auto-detects semicolon/comma delimiter | ✅ PASS | `detectDelimiter()` in `mt5-data-types.ts` |
| 6 | Preview: format, row count, date range | ✅ PASS | "configure" step shows format/delimiter/count; "preview" step shows full details |
| 7 | Validation: ≥10 candles, date parsing, OHLC numeric | ✅ PASS | `parseMt5Csv()` + server-side Zod + OHLC sanity check |
| 8 | New dataset appears immediately after upload | ✅ PASS | `useMt5Data.upload()` calls `refresh()` |
| 9 | Delete opens confirmation dialog then removes dataset | ✅ PASS | `AlertDialog` in `Mt5DataTable` |
| 10 | Re-upload same asset+timeframe shows Merge/Replace choice | ✅ PASS | "conflict" step in dialog |

#### Backtest: MT5 Mode Toggle

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 11 | MT5 data available → green "Using MT5 data" badge | ✅ PASS | `Mt5DataStatusBadge` |
| 12 | MT5 data absent → gray "Using Dukascopy (no MT5 data)" badge | ✅ PASS | |
| 13 | MT5 data present but range not covered → backtest **blocked** | ❌ FAIL | **BUG-1 (HIGH):** Red alert badge displays, but submit button remains enabled — backtest runs without blocking |
| 14 | Existing execution behaviour unchanged (Bid-Standard, First-Breakout) | ✅ PASS | mt5_mode forwarded to Python unchanged |

#### Optimizer: MT5 Toggle

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 15 | Optimizer has independent MT5 Mode toggle | ❌ FAIL | **BUG-2 (MEDIUM):** Optimizer only inherits MT5 mode from backtest config via `ConfigInheritancePanel` — no independent toggle |
| 16 | MT5 data source label shown in optimizer | ✅ PASS | `Mt5DataStatusBadge` rendered inside `ConfigInheritancePanel` |
| 17 | Coverage error shown before optimization start | ✅ PASS (partial) | Badge shows warning, but blocking depends on BUG-1 |

#### MQL Converter: MT5 Data as Default

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 18 | Uses MT5 data by default (no special indicator needed) | ✅ PASS | Banner hidden when data present |
| 19 | Warning banner when no MT5 data for asset | ✅ PASS | `Mt5DataBanner` component |
| 20 | "Upload MT5 Data" link opens inline dialog | ✅ PASS | `Mt5UploadDialog` inline at bottom of page |
| 21 | Banner disappears after upload | ✅ PASS | `useMt5Data.upload()` triggers `refresh()` → `findDataset()` updates → banner hides |

#### Data Format Support

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 22 | Semicolon-delimited MT5 CSV | ✅ PASS | |
| 23 | Comma-delimited MT5 CSV | ✅ PASS | |
| 24 | Date format `2026.01.05` (dot-separated) | ✅ PASS | `parseMt5DateTime()` |
| 25 | Date format `2026-01-05` (ISO) | ✅ PASS | |
| 26 | Time column `00:00` and combined `2026.01.05 00:00` | ✅ PASS | |
| 27 | Optional columns (TickVol, Volume, Spread) | ✅ PASS | Imported when present, not required |
| 28 | Files up to 50 MB accepted | ✅ PASS | `MT5_MAX_FILE_SIZE_BYTES` = 50 MB |

---

### Edge Cases Tested (Code Review)

| Edge Case | Status | Notes |
|-----------|--------|-------|
| Wrong CSV format → concrete error message | ✅ PASS | `CsvParseError` with hint pointing to MT5 History Center export path |
| MT5 symbol name differs from internal (e.g. `GER40+`) | ✅ PASS | Manual asset selection in dialog |
| Gaps in data (weekends, holidays) | ✅ PASS | Parser accepts any contiguous set of timestamps |
| Overlapping uploads → Merge or Replace | ✅ PASS | API returns 409 if no `conflict_resolution`; dialog prompts user |
| Backtest range partially outside MT5 data | ❌ FAIL | Warning shown but backtest NOT blocked (BUG-1) |
| MT5 Mode off → Dukascopy used | ✅ PASS | Badge hidden when mt5Mode=false |
| File > 50 MB | ✅ PASS | Rejected client-side with "File too large. Max 50 MB." |
| Replace → old candles fully replaced, no duplicates | ✅ PASS | `delete` + `upsert` with `onConflict: "dataset_id,ts"` |
| Optimizer over long range, MT5 partial coverage | ❌ FAIL | Badge shows warning, but no blocking before optimization start (BUG-2 / BUG-1) |

---

### Security Audit

| Check | Status | Notes |
|-------|--------|-------|
| Upload auth check (admin only) | ✅ PASS | API checks `app_metadata.role === "admin"` |
| Delete auth check (admin only) | ✅ PASS | Same role check + `user_id` filter |
| Rate limiting on upload | ✅ PASS | 10 requests/60s via `check_rate_limit` RPC |
| Input validation (Zod) | ✅ PASS | Full Zod schema on upload; asset max 32 chars |
| OHLC sanity check | ✅ PASS | Server rejects malformed OHLC rows |
| RLS enabled on both tables | ✅ PASS | Migration enables RLS on `mt5_datasets` + `mt5_candles` |
| Cross-user data read (datasets GET) | ⚠️ WARN | **BUG-3 (MEDIUM):** `/api/mt5-data/datasets` returns all users' datasets (RLS policy `USING (true)` + no `user_id` filter in query). Inconsistent: DELETE correctly filters by `user_id`. Single-admin in practice, but architecturally incorrect. |
| Cross-user data read (check GET) | ⚠️ WARN | **BUG-4 (LOW):** `/api/mt5-data/check` matches by asset+timeframe across all users, not scoped to requesting user. |
| No secrets exposed | ✅ PASS | |

---

### Bug Summary

| ID | Severity | Description | File | Steps to Reproduce |
|----|----------|-------------|------|--------------------|
| BUG-1 | **HIGH** | Backtest is not blocked when MT5 data doesn't cover the date range | `src/components/backtest/configuration-panel.tsx:676` | 1. Upload MT5 data for a limited date range. 2. Enable MT5 Mode. 3. Set backtest date range extending beyond the data. 4. Red badge appears. 5. Click "Run Backtest" — runs without error. |
| BUG-2 | **MEDIUM** | Optimizer has no independent MT5 Mode toggle | `src/app/(dashboard)/optimizer/page.tsx` | Open Optimizer. There is no MT5 Mode toggle — only the badge inherited from the backtest config is shown. |
| BUG-3 | **MEDIUM** | `/api/mt5-data/datasets` returns all users' datasets (missing `user_id` filter) | `src/app/api/mt5-data/datasets/route.ts:14` | Multi-user scenario: User B can see User A's uploaded datasets in the Settings table. |
| BUG-4 | **LOW** | `/api/mt5-data/check` matches datasets across all users | `src/app/api/mt5-data/check/route.ts:35` | Multi-user scenario: User B's MT5 check can match User A's uploaded dataset. |

---

### Automated Tests

```
npm run build   ✅  Clean build (0 errors)
npm run lint    ✅  0 errors, 5 pre-existing warnings (not from PROJ-34)
npm test        ⚠️  No unit tests added for PROJ-34 (parseMt5Csv is testable logic)
npm run test:e2e ⚠️  No E2E tests added for PROJ-34
```

> Note: `parseMt5Csv()` in `src/lib/mt5-data-types.ts` is pure, deterministic logic — a good candidate for unit tests.

---

### Production-Ready Decision

**NOT READY** — 2 bugs block production:

- **BUG-1 (HIGH):** Backtest runs despite MT5 data coverage gap — the spec explicitly requires blocking.
- **BUG-2 (MEDIUM):** Optimizer missing its own MT5 Mode toggle — a required acceptance criterion.

BUG-3 and BUG-4 are acceptable risk for a single-admin deployment but should be fixed for multi-user correctness.

## Deployment

**Deployed:** 2026-04-16
**Commit:** 667c63d
**Branch:** main → Vercel auto-deploy
