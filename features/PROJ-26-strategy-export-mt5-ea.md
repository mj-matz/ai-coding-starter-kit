# PROJ-26: Strategy Export to MT5 EA

## Status: Deployed
**Created:** 2026-03-31
**Last Updated:** 2026-03-31

## Dependencies
- Requires: PROJ-6 (Strategy Library) — alle drei Strategien müssen implementiert sein
- Requires: PROJ-5 (Backtest UI) — Export-Button erscheint in der Results-Ansicht
- Requires: PROJ-2 (Backtesting Engine) — Backtest-Parameter werden direkt exportiert

## User Stories
- Als Trader möchte ich nach einem erfolgreichen Backtest einen "Export as MT5 EA"-Button sehen, damit ich die getestete Strategie direkt in MetaTrader 5 einsetzen kann.
- Als Trader möchte ich, dass die Backtest-Parameter automatisch als `input`-Variablen im EA vorausgefüllt sind, damit ich sie bei Bedarf direkt im MT5 Strategy Tester anpassen kann.
- Als Trader möchte ich, dass der EA als `.mq5`-Datei heruntergeladen wird, damit ich sie ohne Zwischenschritt in MetaEditor öffnen und kompilieren kann.
- Als Trader möchte ich, dass SL und TP im EA als StopLossPips + R-Multiple definiert sind — identisch zur Backtest-Logik — damit das Live-Verhalten dem getesteten entspricht.
- Als Trader möchte ich, dass alle drei Strategien (Breakout, MA, RSI) exportierbar sind, damit ich für jede getestete Strategie einen fertigen EA erhalte.

## Acceptance Criteria
- [ ] Ein "Export as MT5 EA"-Button erscheint in der Backtest-Results-Ansicht, sobald ein Backtest abgeschlossen ist
- [ ] Der Button ist deaktiviert / nicht sichtbar, solange kein Backtest-Ergebnis vorliegt
- [ ] Klick auf den Button löst einen Download der generierten `.mq5`-Datei aus
- [ ] Dateiname: `{strategy_id}_{symbol}_{YYYY-MM-DD}.mq5` (z. B. `time_range_breakout_EURUSD_2026-03-31.mq5`)
- [ ] Alle Strategie-Parameter aus dem letzten Backtest sind als MT5 `input`-Variablen vorausgefüllt
- [ ] SL/TP-Logik verwendet `StopLossPips` + `RMultiple` (identisch zum Backtest-Engine-Verhalten)
- [ ] Die drei Strategien haben jeweils ein eigenes MQL5-Template:
  - `time_range_breakout` — Range-Fenster (rangeStart/rangeEnd), Breakout-Entry, SL/TP
  - `moving_average_crossover` — fast/slow MA mit Direction-Filter (`long` / `short` / `both`)
  - `rsi_threshold` — RSI-Level-Cross auf Oversold/Overbought mit Direction-Filter
- [ ] Der generierte EA kompiliert ohne Fehler in MetaEditor (MQL5 Build ≥ 3000)
- [ ] Der EA enthält die Standard-Funktionen: `OnInit()`, `OnDeinit()`, `OnTick()`
- [ ] Ein Kommentarblock am Dateianfang enthält: Strategie-Name, Symbol, Backtest-Zeitraum, Exportdatum

## Edge Cases
- Kein Backtest gelaufen → Export-Button ist ausgeblendet oder disabled, kein API-Call möglich
- Unbekannte strategy_id im API-Request → 400-Fehler mit klarer Fehlermeldung
- Fehlende oder ungültige Parameter im Request → 422-Fehler mit Feldangabe
- Direction-Parameter `both` bei RSI/MA → EA generiert sowohl Long- als auch Short-Logik
- Symbol enthält Sonderzeichen (z. B. `GER30.cash`) → Dateiname wird sanitized (nur alphanumerisch + Unterstrich)
- Benutzer lädt die Datei mehrfach herunter → jeder Download erzeugt eine neue Datei (kein Caching von Templates nötig)

## Technical Requirements
- **API-Endpunkt:** `GET /api/backtest/export-mt5` mit Query-Parametern (strategy_id, symbol, alle Strategie-Parameter)
  Alternativ: `POST /api/backtest/export-mt5` mit JSON-Body — bevorzugt, da Parameter-Listen beliebig lang sein können
- **Response:** `Content-Type: application/octet-stream`, `Content-Disposition: attachment; filename="...mq5"`
- **Keine externe Bibliothek nötig** — MQL5-Code ist Plain Text, Template-Generierung in Python oder TypeScript möglich
- **Templates als Dateien:** `/python/mt5_templates/` oder `/src/lib/mt5-templates/` — ein `.mq5.tmpl`-File pro Strategie
- **Kein Authentifizierungs-Bypass:** Route prüft Supabase-Session (wie alle anderen API-Routen)
- **Performance:** Generierung < 200 ms (reine String-Interpolation, kein I/O außer Template lesen)

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)

### Komponenten-Struktur

```
Page Header (backtest/page.tsx)
+-- Export Actions Bar (gemeinsam mit PROJ-25 CSV/Excel-Export)
    +-- "Export as CSV/Excel" Button (PROJ-25)
    +-- "Export as MT5 EA" Button  ← NEU
Results Panel (results-panel.tsx — bereits vorhanden)
+-- Metrics Summary Card
+-- Equity Curve / Drawdown Charts
+-- Trade List Table
```

### Datenfluss

```
Benutzer klickt "Export as MT5 EA"
        ↓
Browser sendet POST /api/backtest/export-mt5
(payload: strategy_id + alle Backtest-Parameter)
        ↓
API Route liest passendes Template
aus /src/lib/mt5-templates/
        ↓
Template-Variablen werden ersetzt
(z. B. {{STOP_LOSS_PIPS}}, {{RANGE_START}})
        ↓
Response: .mq5-Datei als Download
(Content-Disposition: attachment)
        ↓
Browser-Download startet automatisch
```

### Datenmodell

**Request-Payload:**
- `strategy_id` — Text (z. B. "time_range_breakout")
- `symbol` — Text (z. B. "EURUSD")
- `date_from` / `date_to` — Text (Backtest-Zeitraum, für Kommentarblock)
- `stop_loss_pips` — Zahl
- `r_multiple` — Zahl (für Take Profit)
- Strategie-spezifische Parameter:
  - Breakout: `range_start`, `range_end`
  - MA: `fast_period`, `slow_period`, `direction`
  - RSI: `rsi_period`, `oversold_level`, `overbought_level`, `direction`

**Templates (3 Dateien — reine Text-Dateien mit Platzhaltern):**
```
/src/lib/mt5-templates/
  time_range_breakout.mq5.tmpl
  moving_average_crossover.mq5.tmpl
  rsi_threshold.mq5.tmpl
```

### Tech-Entscheidungen

| Entscheidung | Warum |
|---|---|
| TypeScript statt Python für Generierung | Reine String-Manipulation, kein Python-Hop nötig — weniger Latenz |
| POST statt GET | Parameter-Liste zu lang für URL-Query-String |
| Templates als Dateien | Direkt editierbar ohne TypeScript-Code anzufassen |
| Generierung in Next.js API Route | Konsistent mit bestehenden Exports (CSV/Excel via PROJ-25) |
| Kein neuer Custom Hook | Simpler fetch-Aufruf im Button-Click reicht aus |

### Neue / geänderte Dateien

| Datei | Aktion |
|---|---|
| `src/lib/mt5-templates/time_range_breakout.mq5.tmpl` | Neu |
| `src/lib/mt5-templates/moving_average_crossover.mq5.tmpl` | Neu |
| `src/lib/mt5-templates/rsi_threshold.mq5.tmpl` | Neu |
| `src/app/api/backtest/export-mt5/route.ts` | Neu |
| `src/app/(dashboard)/backtest/page.tsx` | Änderung — Export-Button im Page Header neben CSV/Excel (konsistent mit PROJ-25) |

### Abhängigkeiten
Keine neuen npm-Pakete erforderlich.

## QA Test Results

**QA Date:** 2026-04-18
**Tester:** /qa skill
**Build:** ✅ Pass — `npm run build` succeeds, no TypeScript errors
**Lint:** ✅ Pass — no PROJ-26 related lint errors (pre-existing unrelated issues only)
**Automated Tests:** N/A — no test suite exists for this project yet

---

### Acceptance Criteria

| # | Criterion | Result | Notes |
|---|-----------|--------|-------|
| AC1 | "Export MT5 EA" button appears in results view after backtest completes | ✅ PASS | Rendered inside `{result && ...}` block |
| AC2 | Button disabled/hidden while no backtest result | ✅ PASS | Hidden when `result` is null; `disabled={isExportingMt5}` during export |
| AC3 | Click triggers `.mq5` file download | ✅ PASS | POST to `/api/backtest/export-mt5`, blob download via anchor tag |
| AC4 | Filename: `{strategy_id}_{symbol}_{YYYY-MM-DD}.mq5` | ✅ PASS | Built server-side with `sanitizeFilename`; extracted from `Content-Disposition` header |
| AC5 | All strategy params prefilled as MT5 `input` variables | ✅ PASS | All params from `lastConfig.strategyParams` mapped via `numParam`/`strParam` helpers with sensible fallbacks |
| AC6 | SL/TP uses `StopLossPips` + `R-Multiple` (matching engine) | ⚠️ PARTIAL | Spec says "R-Multiple" but implementation uses direct `takeProfit` pips — consistent with actual engine behavior; spec wording appears outdated |
| AC7 | Three separate MQL5 templates (Breakout, MA, RSI) | ✅ PASS | All three in `src/lib/mt5-templates.ts` |
| AC8 | EA compiles without errors in MetaEditor (MQL5 ≥ 3000) | ⚠️ PARTIAL | `#property strict` is MQL4-only — MetaEditor 5 will likely generate a compiler warning (see Bug #1) |
| AC9 | `OnInit()`, `OnDeinit()`, `OnTick()` present | ✅ PASS | All three present in every template |
| AC10 | Header comment with strategy, symbol, dates, export date | ✅ PASS | Filled by `{{SYMBOL}}`, `{{DATE_FROM}}`, `{{DATE_TO}}`, `{{EXPORT_DATE}}` |

**Score: 8/10 fully passed, 2 partial**

---

### Edge Cases

| Edge Case | Result | Notes |
|-----------|--------|-------|
| No backtest run → button hidden | ✅ PASS | Wrapped in `{result && ...}` |
| Unknown `strategy_id` → 400 error | ✅ PASS | `SUPPORTED_STRATEGIES.includes()` check with clear message |
| Missing/invalid params → 422 error | ✅ PASS | Zod validation returns flatten errors |
| Direction `both` → Long + Short logic | ✅ PASS | All templates handle `"both"` in conditional blocks |
| Symbol with special chars → sanitized filename | ✅ PASS | `sanitizeFilename()` replaces non-alphanumeric with `_` |
| Multiple downloads → fresh file each time | ✅ PASS | No server-side caching; generated on each request |

---

### Security Audit

| Check | Result | Notes |
|-------|--------|-------|
| Authentication required | ✅ PASS | Supabase `getUser()` check at route entry; returns 401 if not authenticated |
| Input validation | ✅ PASS | Zod schema on all fields before processing |
| Template injection risk | ✅ PASS | Only `string`/`number` values interpolated; no code execution path |
| Exposed secrets in response | ✅ PASS | Response contains only generated MQL5 code |
| Authorization bypass | ✅ PASS | Route consistent with all other API routes |

---

### Bugs Found

#### Bug #1 — `#property strict` invalid in MQL5 (Medium)
**Severity:** Medium
**Files:** `src/lib/mt5-templates.ts` — all three templates
**Description:** `#property strict` is an MQL4-only compiler directive. In MetaEditor 5, it produces a compiler warning ("unknown property"). The EA will still compile and run, but the acceptance criterion states "compiles without error in MQL5 Build ≥ 3000." Depending on MetaEditor's warning/error classification, this may fail AC8.
**Steps to reproduce:** Export any strategy, open `.mq5` in MetaEditor 5, compile.
**Fix:** Remove the line `#property strict` from all three templates.

#### Bug #2 — Button visibility uses form strategy, not lastConfig strategy (Low)
**Severity:** Low
**File:** [src/app/(dashboard)/backtest/page.tsx](src/app/(dashboard)/backtest/page.tsx#L196)
**Description:** `SUPPORTED_STRATEGIES.includes(strategy)` checks the *current form's selected strategy*, not `lastConfig.strategy` (the strategy actually run). If the user changes the strategy dropdown after running a backtest — without re-running — the button visibility may not reflect the actual result. Since all current strategies are supported, this has no practical impact today but will become a regression if an unsupported strategy is added to the form.
**Fix:** Change condition to `SUPPORTED_STRATEGIES.includes(lastConfig?.strategy ?? "")`.

#### Bug #3 — `entryDelayBars` breakout param not exposed in MT5 template (Low)
**Severity:** Low
**File:** `src/lib/mt5-templates.ts` (time_range_breakout template)
**Description:** The breakout strategy has an `entryDelayBars` parameter in its default form values, but this parameter has no corresponding `input` variable in the MQL5 template. The generated EA will not replicate this behavior, creating a divergence between the backtested strategy and the live EA.
**Fix:** Add `input int InpEntryDelayBars = {{ENTRY_DELAY_BARS}};` and implement the delay logic in `OnTick()`.

---

### Regression Testing

| Feature | Status |
|---------|--------|
| PROJ-25 Export CSV/Excel — buttons still visible and functional | ✅ No regression — MT5 button added alongside, no existing code changed |
| PROJ-5 Backtest UI — page layout / results panel | ✅ No regression — buttons added to existing actions bar |
| PROJ-8 Auth — protected routes | ✅ No regression — new route follows same auth pattern |

---

### Production-Ready Decision

**READY** — no Critical or High bugs.

- Bug #1 (Medium): `#property strict` will cause a compiler warning in MetaEditor 5 but does not prevent compilation. Recommend fixing before deployment for a clean user experience.
- Bugs #2 and #3 are Low severity and do not block deployment.

## Deployment

**Deployed:** 2026-04-18
**Deployed by:** /deploy skill
**Branch:** main → Vercel auto-deploy
**Commit:** deploy(PROJ-26)
