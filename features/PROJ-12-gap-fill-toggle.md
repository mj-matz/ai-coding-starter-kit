# PROJ-12: GAP Fill Toggle

## Status: In Review
**Created:** 2026-03-20
**Last Updated:** 2026-03-20

## Dependencies
- Requires: PROJ-2 (Backtesting Engine) — Gap-Fill-Logik sitzt im Engine
- Requires: PROJ-3 (Time-Range Breakout Strategy) — primäre Strategie, für die das Feature relevant ist
- Requires: PROJ-5 (Backtest UI) — Toggle wird in der Configuration UI dargestellt

## Context

Der Backtesting-Engine simuliert aktuell **immer** Gap-Fill-Verhalten:
- **Entry-Gap**: Eröffnet eine Bar über dem Stop-Entry-Level, wird zum `bar_open` gefüllt (schlechterer Preis)
- **Exit-Gap (SL/TP)**: Eröffnet eine Bar über/unter SL oder TP, wird zum `bar_open` gefüllt statt am exakten Orderlevel

In TradingView (Standard-Backtesting) werden Gaps **ignoriert** — Stops und Take Profits werden immer exakt am SL/TP-Preis geschlossen. Nutzer wollen beide Modi vergleichen können, um Ergebnisse mit TradingView abzugleichen.

## User Stories

- Als Trader möchte ich den GAP-Fill-Modus per Toggle in der Backtest-Konfiguration an- und abschalten können, damit ich Ergebnisse mit TradingView-Backtests vergleichen kann.
- Als Trader möchte ich, dass „GAP aus" bedeutet, dass Entries und Exits immer exakt am gesetzten Orderlevel gefüllt werden (kein Slippage durch Gaps), damit meine Resultate mit TradingView übereinstimmen.
- Als Trader möchte ich, dass „GAP an" (Standard) das realistische Verhalten beibehält, bei dem Overnight-Gaps oder Sprünge beim Marktöffnen zu schlechteren Fills führen können.
- Als Trader möchte ich, dass die GAP-Einstellung wie alle anderen Konfigurationsfelder im localStorage gespeichert wird, damit sie beim Neuladen erhalten bleibt.

## Acceptance Criteria

### UI
- [ ] In der Backtest-Konfiguration gibt es einen Switch/Toggle „Gap Fill" mit Label und kurzer Erklärung
- [ ] Der Toggle ist standardmäßig **deaktiviert** (TradingView-kompatibler Modus)
- [ ] Die Einstellung wird im localStorage zusammen mit der übrigen Konfiguration gespeichert und wiederhergestellt

### Backend (Python Engine)
- [ ] `BacktestConfig` hat ein neues Boolean-Feld `gap_fill` (Default: `False`)
- [ ] Bei `gap_fill=True`: Bisheriges Verhalten — Entry und Exit nutzen `bar_open` wenn Preis über das Level hinaus geöffnet hat
- [ ] Bei `gap_fill=False` (TradingView-Modus): Entry wird immer exakt am `entry_price` gefüllt; SL/TP werden immer exakt am `sl_price`/`tp_price` gefüllt, unabhängig vom `bar_open`
- [ ] `entry_gap_pips` im `Trade`-Datensatz ist bei `gap_fill=False` immer `0.0`
- [ ] `exit_gap` im `Trade`-Datensatz ist bei `gap_fill=False` immer `False`

### API
- [ ] `BacktestOrchestrationRequest` (Python `main.py`) akzeptiert `gapFill: bool = False`
- [ ] Next.js API-Route `/api/backtest` leitet `gapFill` validiert an FastAPI weiter
- [ ] Zod-Schema in `backtest-types.ts` enthält `gapFill: z.boolean().default(false)`

## Edge Cases

- **GAP aus + Slippage > 0**: Slippage wird weiterhin angewendet (Slippage ≠ Gap). Bei `gap_fill=False` plus Slippage: Fill = `entry_price ± slippage_offset` (kein `max(bar_open, ...)` mehr)
- **Bestehende Backtests**: Da GAP standardmäßig `False` ist (TradingView-Modus), liefern alte Backtests ohne explizite Einstellung leicht abweichende Ergebnisse — bewusste Designentscheidung
- **localStorage mit altem Schema**: `loadConfigFromStorage` validiert via Zod — fehlendes `gapFill` im gespeicherten JSON führt zum Fallback auf Default (`false`), kein Fehler
- **`entry_gap_pips` im Trade-Log**: Bei `gap_fill=False` ist der Wert immer 0, auch wenn `bar_open` faktisch über dem Entry-Level lag — das ist korrektes Verhalten für den TradingView-Vergleichsmodus

## Technical Requirements

- Keine neuen API-Endpunkte nötig — das Feld wird an bestehenden Endpunkt angehängt
- Keine Datenbankänderungen nötig
- **Breaking Change**: Default wechselt von implizit `True` (bisheriges Verhalten) auf `False` (TradingView-Modus) — bestehende Backtests ohne explizite Einstellung liefern leicht abweichende Ergebnisse

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)

### Betroffene Komponenten (Datenpfad)

```
ConfigurationPanel (UI)
+-- Gap Fill Toggle (shadcn Switch, bereits installiert)
    |
    v
BacktestFormValues / backtestFormSchema (backtest-types.ts)
+-- Neues Feld: gapFill (boolean, Default: false)
+-- localStorage: automatisch gespeichert/wiederhergestellt (kein neuer Code)
    |
    v
Next.js API-Route: /api/backtest (route.ts)
+-- BacktestRequestSchema bekommt gapFill: z.boolean().default(false)
+-- Validiert und 1:1 an FastAPI weitergeleitet
    |
    v
Python FastAPI / Engine
+-- BacktestConfig: gap_fill: bool = False
+-- gap_fill=True  → bisheriges Verhalten (bar_open bei Gap-Überschreitung)
+-- gap_fill=False → exakte Fills am entry_price / sl_price / tp_price
```

### UI-Platzierung (ConfigurationPanel)

```
ConfigurationPanel
+-- Strategy & Asset
+-- Timeframe & Date Range
+-- Strategy Parameters
+-- Capital & Position Sizing
+-- [NEU] Simulation Options
    +-- Gap Fill Switch
        Label: "Gap Fill"
        Hint: "Gaps bei Marktöffnung führen zu schlechteren Fills.
               Aus = TradingView-kompatibler Modus (Standard)."
+-- Run Backtest Button
```

### Schichten-Übersicht

| Schicht | Änderung |
|---------|----------|
| UI | Switch in neuer Sektion „Simulation Options" in `configuration-panel.tsx` |
| Form-Schema | `gapFill: z.boolean().default(false)` in `backtestFormSchema` + `defaultFormValues` |
| localStorage | Kein eigener Code — bestehende Helpers greifen automatisch; fehlendes Feld → Zod-Default `false` |
| API-Route | `gapFill: z.boolean().default(false)` im `BacktestRequestSchema`, Weitergabe an FastAPI |
| Python Engine | `gap_fill: bool = False` in `BacktestConfig`; bedingte Fill-Logik in Engine und Breakout-Strategie |

### Breaking Change

Default wechselt von implizit `true` (bisheriges Verhalten) auf `false` (TradingView-Modus). Altes localStorage ohne `gapFill` → Zod-Fallback `false` → leicht veränderte Ergebnisse bis zur expliziten Nutzer-Einstellung.

### Dependencies

Keine neuen Packages. `src/components/ui/switch.tsx` ist bereits installiert.

## QA Test Results

**QA Date:** 2026-03-20
**Result:** PASSED (bedingt — 3 Low-Bugs in Spec-Text, kein Code-Problem)

### Ergebnis-Übersicht

| Kategorie | Ergebnis |
|-----------|----------|
| Acceptance Criteria | 11/11 bestanden |
| Edge Cases | 4/4 bestanden |
| Bugs gefunden | 3 Low (nur Spec-Text), 0 Code-Bugs |
| Security Audit | Bestanden |
| Regression (PROJ-2, PROJ-3, PROJ-5) | Keine Regressionen |

### Gefundene Bugs

**BUG-37 (Low — Spec-Text):** Zeile 42 (`BacktestOrchestrationRequest`) zeigt `gapFill: bool = True`, korrekt ist `False`. Nur ein Dokumentationsfehler, kein Code-Problem.

**BUG-38 (Low — Spec-Text):** Zeile 44 (`Zod-Schema`) zeigt `.default(true)`, korrekt ist `.default(false)`. Nur ein Dokumentationsfehler.

**BUG-39 (Low — Status):** Spec-Header zeigte „Planned" statt „In Review" — mit diesem QA-Durchlauf korrigiert.

### Hinweis: Breaking Change (kein Bug)

Der Default-Wechsel von implizit `True` auf `False` ist im Spec als bewusste Entscheidung dokumentiert (Technical Requirements). Da aktuell nur ein einziger Nutzer existiert, gibt es kein Migrations- oder Kommunikationsproblem — kein Handlungsbedarf.

## Deployment
_To be added by /deploy_
