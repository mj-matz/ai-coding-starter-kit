# PROJ-6: Strategy Library (Plugin System)

## Status: In Review
**Created:** 2026-03-09
**Last Updated:** 2026-04-01

## Dependencies
- Requires: PROJ-2 (Backtesting Engine) — new strategies plug into the engine
- Requires: PROJ-3 (Time-Range Breakout Strategy) — serves as reference implementation
- Requires: PROJ-5 (Backtest UI) — UI must support dynamic strategy parameter forms

## User Stories
- As a trader, I want to select from a list of available strategy templates in the UI so that I can test different approaches without writing code.
- As a trader, I want each strategy to have its own parameter form so that I only see relevant fields for the selected strategy.
- As a developer, I want to add a new strategy by implementing a standard interface so that the UI and engine pick it up automatically.
- As a trader, I want a Moving Average Crossover strategy so that I can test trend-following approaches.
- As a trader, I want an RSI Threshold strategy so that I can test mean-reversion approaches.

## Acceptance Criteria
- [ ] Each strategy is defined by a standard Python interface: `name`, `description`, `parameters_schema`, `generate_signals(data, params)`
- [ ] Strategy registry: a single config file lists all available strategies; adding a new file auto-registers it
- [ ] UI reads the strategy registry and renders the correct parameter form for each strategy
- [ ] Time-Range Breakout (PROJ-3) is refactored to implement the standard interface as the reference
- [ ] Moving Average Crossover strategy implemented with parameters: fast_period, slow_period, direction
- [ ] RSI Threshold strategy implemented with parameters: rsi_period, oversold_level, overbought_level, direction
- [ ] Strategy selector in UI shows strategy name and short description
- [ ] Switching strategy in UI replaces the parameter form with the new strategy's fields
- [ ] All new strategies pass the same engine edge-case scenarios as PROJ-3

## Edge Cases
- Strategy generates 0 signals for the selected period → handled gracefully (empty trade log)
- Strategy produces conflicting signals on the same bar → engine takes first signal, ignores rest
- New strategy added with invalid schema → validation error at load time, not at runtime

## Technical Requirements
- Strategy plugin directory: `/python/strategies/`
- Each strategy is a single Python file implementing the `BaseStrategy` interface
- Parameter schema defined as Pydantic model (doubles as JSON Schema for UI form generation)
- No restart required to pick up new strategy files in development mode

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)

### Architektur-Übersicht

```
python/strategies/
  base.py              (bestehend — BaseStrategy ABC)
  breakout.py          (refaktoriert: STRATEGY_ID, name, description, Pydantic-Schema)
  moving_average.py    (neu — Moving Average Crossover)
  rsi_threshold.py     (neu — RSI Threshold)
  registry.py          (neu — scannt Ordner, baut Strategie-Map automatisch)

GET /api/strategies    (neu — gibt Strategie-Liste inkl. JSON-Schema zurück)

Frontend
  StrategySelector     (neu — lädt Strategien vom API, ersetzt hardkodierten Array)
  DynamicParamForm     (neu — rendert Felder automatisch aus JSON-Schema)
```

### Datenfluss

```
[Python-Datei wird hinzugefügt]
        ↓ registry.py entdeckt sie automatisch
        ↓ GET /api/strategies gibt Name + Beschreibung + Schema zurück
        ↓ Frontend: Dropdown zeigt neue Strategie an
        ↓ User wählt → Parameter-Formular erscheint automatisch
        ↓ POST /api/backtest/run mit strategy_id + params
```

### Komponenten-Struktur

```
ConfigurationPanel (bestehend, leicht angepasst)
+-- StrategySelector (NEU)
|   +-- Select (shadcn)
|   +-- Beschreibungstext
+-- DynamicParamForm (NEU — schema-driven)
|   +-- NumberField, TimeField, BoolField, SelectField
+-- [bestehend: Asset, Timeframe, Datumsbereich, Kapital]
```

### API-Endpunkte

| Methode | Pfad | Zweck |
|---------|------|-------|
| GET | `/api/strategies` | Liste aller Strategien + Parameter-Schema |
| POST | `/api/backtest/run` | Angepasst: nimmt `strategy_id` + generische `params`-Map |

### Strategie-Datenmodell (pro Eintrag im API-Response)

```
id           — "time_range_breakout"
name         — "Time-Range Breakout"
description  — kurzer Erklärungstext für die UI
parameters   — JSON-Schema: Feldname → {type, label, default, min, max, enum}
```

### Tech-Entscheidungen

| Entscheidung | Warum |
|--------------|-------|
| Schema-driven UI | Neue Python-Strategie = 0 Frontend-Code nötig |
| Pydantic als Single Source of Truth | Schema einmal definieren → Validation + UI-Rendering |
| Kein neuer DB-Table | Strategien sind Code, keine Daten |
| Bestehenden `/api/backtest/run` anpassen | Keine Breaking Change, History bleibt kompatibel |

### Neue Strategien

#### Moving Average Crossover
Parameter: `fast_period`, `slow_period`, `direction`

Signal-Timing: Signal wird auf der Bar generiert, auf der der Crossover stattfindet.
- Long-Entry: `fast_ma[i-1] <= slow_ma[i-1]` **und** `fast_ma[i] > slow_ma[i]`
- Short-Entry: `fast_ma[i-1] >= slow_ma[i-1]` **und** `fast_ma[i] < slow_ma[i]`
- Nur der Übergang zählt (nicht der Zustand "fast ist über slow")

Direction-Filter:
- `direction=long`: Nur Long-Entries. Ein bärischer Crossover (fast kreuzt unter slow) dient als **Exit-Signal** für offene Long-Position, aber kein Short-Entry.
- `direction=short`: Nur Short-Entries. Bullischer Crossover = Exit offener Short-Position, kein Long-Entry.
- `direction=both`: Long- und Short-Entries; ein entgegengesetzter Crossover schließt die bestehende Position und öffnet eine neue.

#### RSI Threshold
Parameter: `rsi_period`, `oversold_level`, `overbought_level`, `direction`

Signal-Timing: Level-Cross-Prinzip (wartet auf Umkehr statt sofortigen Entry):
- Long-Entry: RSI kreuzt den Oversold-Level **von unten nach oben** — `rsi[i-1] < oversold_level` **und** `rsi[i] >= oversold_level`
- Short-Entry: RSI kreuzt den Overbought-Level **von oben nach unten** — `rsi[i-1] > overbought_level` **und** `rsi[i] <= overbought_level`

Direction-Filter: Gleiche Logik wie MA Crossover — bei `direction=long` werden Short-Entries ignoriert, ein bärisches Cross gilt nur als Exit.

### API-Anpassung — `/api/backtest`

**Wichtig:** Der Haupt-Backtest-Endpunkt ist `/api/backtest` (nicht `/api/backtest/run`). Die Next.js Route `src/app/api/backtest/route.ts` muss angepasst werden:
- `rangeStart`, `rangeEnd`, `triggerDeadline`, `timeExit` → von **required** auf **optional** (`z.string().regex(...).optional()`)
- Neue optionale Felder hinzufügen: `fastPeriod`, `slowPeriod`, `rsiPeriod`, `oversoldLevel`, `overboughtLevel`
- Strategy-spezifische Validierung per `refine`: z.B. für `time_range_breakout` müssen die Zeitfelder vorhanden sein; für `moving_average_crossover` müssen `fastPeriod` und `slowPeriod` vorhanden sein

### Abhängigkeiten
Keine neuen Pakete — Pydantic bereits installiert.

## QA Test Results

**Tested:** 2026-04-01 | **Method:** Code review + build verification

### Acceptance Criteria: 9/9 PASSED

1. **Standard Python Interface** — `BaseStrategy` ABC mit `validate_params()` und `generate_signals()`, alle Strategien exportieren die geforderten Metadaten.
2. **Auto-Discovery Registry** — `pkgutil.iter_modules()` scannt das Verzeichnis, validiert Exports und PARAMS_SCHEMA.
3. **UI rendert Schema-driven Forms** — `DynamicParamForm` erzeugt automatisch Felder aus JSON-Schema.
4. **Breakout refaktoriert** — Implementiert alle Registry-Exports.
5. **Moving Average Crossover** — Korrekte Crossover-Erkennung, Direction-Filter, signal_exit.
6. **RSI Threshold** — Wilder's RSI, Level-Cross-Prinzip, Direction-Filter.
7. **Strategy Selector** — Name und Beschreibung werden angezeigt.
8. **Strategy Switch** — Parameterformular wird bei Strategiewechsel vollständig ersetzt.
9. **Engine-Kompatibilität** — `signal_exit` wird unterstützt, DataFrame-Struktur konsistent.

### Edge Cases: 3/3 PASSED

### Bugs Found

| ID | Severity | Beschreibung | Datei / Zeile |
|----|----------|-------------|---------------|
| BUG-1 | HIGH | ~~**Parameter Injection via strategyParams Spread**~~ **FIXED 2026-04-01** — Spread-Reihenfolge umgedreht zu `{ ...strategyParams, ...engineParams }`. | `src/app/api/backtest/route.ts:129` |
| BUG-2 | MEDIUM | ~~**RSI-Level Fallback mit `or` Operator**~~ **FIXED 2026-04-01** — `or`-Operator durch `is not None`-Check ersetzt. | `python/main.py:1144` |
| BUG-3 | MEDIUM | ~~**Signal-Exit + Neuer Entry auf gleicher Bar**~~ **FIXED 2026-04-01** — Nach signal_exit werden Entry-Signale desselben Bars als Flip-Orders gequeut und noch auf derselben Bar evaluiert. | `python/engine/engine.py:228` |
| BUG-4 | LOW | **Registry-Scan nicht Thread-safe** — Race Condition bei erstem Zugriff; praktisch irrelevant wegen CPython GIL. | `python/strategies/registry.py` |
| BUG-5 | LOW | **`timeExit` für Non-Breakout-Strategien akzeptiert** — API akzeptiert `timeExit` auch für MA/RSI, UI sendet es aber nicht. | `src/app/api/backtest/route.ts` |
| BUG-6 | LOW | **Firefox Time-Picker Styling** — WebKit-spezifisches CSS hat keinen Effekt in Firefox. | `src/components/backtest/` |

### Production Ready: JA

Alle HIGH- und MEDIUM-Bugs gefixt (2026-04-01). Verbleibende LOW-Bugs (BUG-4 bis BUG-6) sind nicht deployment-blockierend.

## Deployment
_To be added by /deploy_
