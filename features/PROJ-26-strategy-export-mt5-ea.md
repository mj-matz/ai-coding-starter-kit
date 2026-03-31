# PROJ-26: Strategy Export to MT5 EA

## Status: In Progress
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
Results Panel (results-panel.tsx — bereits vorhanden)
+-- Metrics Summary Card
+-- Equity Curve / Drawdown Charts
+-- Trade List Table
+-- Export Actions Bar (bereits vorhanden für PROJ-25 CSV-Export)
    +-- "Export as CSV/Excel" Button (PROJ-25, vorhanden)
    +-- "Export as MT5 EA" Button  ← NEU
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
| `src/components/backtest/results-panel.tsx` | Änderung — Export-Button hinzufügen |

### Abhängigkeiten
Keine neuen npm-Pakete erforderlich.

## QA Test Results
_To be added by /qa_

## Deployment
_To be added by /deploy_
