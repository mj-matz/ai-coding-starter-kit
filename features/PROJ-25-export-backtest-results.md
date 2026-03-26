# PROJ-25: Export Backtest Results (Excel / CSV)

## Status: Deployed
**Created:** 2026-03-26
**Last Updated:** 2026-03-26

## Dependencies
- Requires: PROJ-5 (Backtest UI) — Results Panel muss geladen sein
- Requires: PROJ-4 (Performance Analytics) — Metriken, Monthly Summary, Trade-Daten

## User Stories
- Als Trader möchte ich meine Backtest-Ergebnisse als Excel exportieren, damit ich sie offline analysieren und mit anderen Backtests vergleichen kann.
- Als Trader möchte ich die Trade-Liste als CSV herunterladen, damit ich sie in externe Tools (Python, R, Excel) importieren kann.
- Als Trader möchte ich alle relevanten Daten in einer Datei (Trades, Metriken, Monthly Summary, Skipped Days), damit ich nichts manuell zusammenkopieren muss.
- Als Trader möchte ich den Export-Button direkt im Results Panel sehen, damit ich ihn nach jedem Backtest schnell finden kann.
- Als Trader möchte ich den Dateinamen mit Symbol und Zeitraum versehen, damit ich mehrere Exports unterscheiden kann.

## Acceptance Criteria

### Excel-Export (.xlsx)
- [ ] Button "Export Excel" erscheint im Results Panel Header, sobald Ergebnisse vorliegen
- [ ] Excel-Datei enthält 3 Tabs: **Trades & Skipped Days**, **Metriken**, **Monthly Summary**
- [ ] Tab "Trades & Skipped Days": chronologisch gemischte Liste aus Trades (`TradeRecord`) und übersprungenen Tagen (`SkippedDay`). Trades enthalten alle Felder (entry_time, exit_time, direction, entry_price, exit_price, lot_size, pnl_pips, pnl_currency, r_multiple, exit_reason, duration_minutes, mae_pips, range_high, range_low, stop_loss, take_profit, entry_gap_pips, exit_gap, used_1s_resolution); Skipped-Day-Zeilen füllen nur die Spalten date und reason, alle anderen Spalten bleiben leer
- [ ] Tab "Metriken": alle Felder aus `BacktestMetrics` als Key-Value-Tabelle (Kennzahl | Wert)
- [ ] Tab "Monthly Summary": Monat, Trade-Anzahl, Winrate %, R, Avg Loss Pips, Avg MAE Pips
- [ ] Dateiname: `backtest_{SYMBOL}_{startDate}_{endDate}.xlsx` (z.B. `backtest_XAUUSD_2024-01-01_2024-12-31.xlsx`)
- [ ] Download startet direkt im Browser (kein neues Tab, kein Server-Roundtrip)

### CSV-Export (.csv)
- [ ] Button "Export CSV" erscheint im Results Panel Header neben dem Excel-Button
- [ ] CSV enthält die Trade-Liste (identische Spalten wie Excel-Tab "Trades")
- [ ] Spalten-Trennzeichen: Komma, Dezimaltrennzeichen: Punkt
- [ ] Erste Zeile: Spalten-Header
- [ ] Dateiname: `trades_{SYMBOL}_{startDate}_{endDate}.csv`
- [ ] Download startet direkt im Browser

### Allgemein
- [ ] Beide Buttons nur sichtbar wenn `BacktestResult` vorhanden (kein Ergebnis = kein Button)
- [ ] Während des laufenden Backtests sind die Buttons deaktiviert oder ausgeblendet
- [ ] Export funktioniert rein clientseitig — kein neuer API-Endpunkt nötig

## Edge Cases
- Kein Trade vorhanden (alle Tage übersprungen): Excel/CSV wird trotzdem erstellt, Tab "Trades & Skipped Days" zeigt nur die Skipped Days
- Sehr viele Trades (1000+): Export muss auch bei großen Datensätzen innerhalb von 3 Sekunden abgeschlossen sein
- Sonderzeichen im Symbol (z.B. `GER30`): Dateiname wird korrekt gebildet
- Nutzer klickt mehrfach schnell: Kein doppelter Download (Button kurz deaktivieren nach Klick)
- `monthly_r` enthält `null`-Werte für `r_earned` oder `avg_mae_pips`: Zellen bleiben leer (kein "null"-String)

## Technical Requirements
- Rein clientseitig (kein Backend-Endpunkt)
- Excel: `xlsx`-npm-Paket (SheetJS Community Edition) — Standard in der Branche, keine Lizenzkosten
- CSV: Native JS, kein zusätzliches Paket
- Performance: Export < 3s auch bei 1000 Trades
- Kein iframe, kein Popup-Blocker-Problem (Blob-URL + `<a>`-Click-Trick)

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)
_To be added by /architecture_

## QA Test Results

**Tested:** 2026-03-26 | **Method:** Static Code Analysis + Build Verification

| Kategorie | Ergebnis |
|-----------|----------|
| Acceptance Criteria | 16/16 bestanden |
| Bugs gefunden | 0 (nach Fixes) |
| Security Audit | Bestanden |
| Build + Lint | Bestanden (0 Errors) |
| **Production Ready** | **JA** |

### Behobene Bugs

- **BUG-1 (High, behoben):** Export-Buttons wurden nicht angezeigt wenn 0 Trades aber Skipped Days vorhanden — `results-panel.tsx` früher Return berücksichtigt jetzt `skipped_days.length`
- **BUG-2 (Low, kein Bug):** CSV enthält Trades + Skipped Days — PO-Entscheid: Skipped Days gehören dazu (insb. Trigger Deadline)
- **BUG-3 (Low, behoben):** `TradeRecord.id` fehlte im Excel- und CSV-Export — in beiden Exportformaten ergänzt

## Deployment
_To be added by /deploy_
