# PROJ-19: Strategy Optimizer

## Status: In Review
**Created:** 2026-03-25
**Last Updated:** 2026-03-27

## Dependencies
- Requires: PROJ-2 (Backtesting Engine) — optimizer runs the engine in a loop
- Requires: PROJ-3 (Time-Range Breakout Strategy) — parameters are specific to this strategy
- Requires: PROJ-8 (Authentication) — optimizer page requires login
- Requires: PROJ-5 (Backtest UI) — inherits asset/strategy configuration

## User Stories
- As a trader, I want to find the optimal SL/TP values for my strategy so that I maximize my risk-reward ratio based on real trade data.
- As a trader, I want to optimize one parameter group at a time (step-by-step) so that I avoid over-fitting and understand the effect of each parameter in isolation.
- As a trader, I want to see the number of backtest combinations before starting so that I can adjust the parameter range if it's too large.
- As a trader, I want to see results as a heatmap and sortable table so that I can visually identify the best parameter region.
- As a trader, I want to apply the best parameters directly to my backtest configuration with one click so that I can immediately run a full backtest with the optimized values.
- As a trader, I want my optimization runs to be saved so that I can compare results across different assets and time periods.
- As a trader, I want to choose the optimization target metric (Profit Factor, Sharpe Ratio, Win Rate, Net Profit) so that I can optimize for what matters most to my strategy.

## Acceptance Criteria

### Configuration
- [ ] New "Optimizer" menu item in sidebar navigation (separate from Backtest and Data)
- [ ] Optimizer page inherits asset, date range, and strategy settings from the current backtest configuration
- [ ] User can select which parameter group to optimize (one at a time):
  - **CRV (SL/TP):** Define SL range (min, max, step) and TP range (min, max, step) in pips
  - **Time Exit:** Define exit time range (start time, end time, step in minutes)
  - **Trigger Deadline:** Define deadline range (start time, end time, step in minutes)
  - **Range Window:** Define range start/end time ranges with step in minutes
  - **Trailing Stop:** Define Trail Trigger range (min, max, step in pips) and Trail Lock range (min, max, step in pips)
- [ ] User can select the optimization target metric: Profit Factor, Sharpe Ratio, Win Rate, Net Profit
- [ ] UI displays the total number of backtest combinations before the user starts (e.g., "This will run 240 backtests")
- [ ] If combinations exceed 500, a warning is shown and user must explicitly confirm to proceed
- [ ] "Start Optimization" button is disabled until a parameter group and target metric are selected

### Execution
- [ ] Optimizer runs all parameter combinations sequentially via the existing Python backtesting engine
- [ ] A progress bar shows current progress (e.g., "Running 47 / 240...")
- [ ] User can cancel an in-progress optimization run
- [ ] Each individual backtest result is aggregated; individual trade lists are not stored per combination (only summary metrics)

### Results
- [ ] Results are displayed as a **2D heatmap** when two continuous parameters are varied (e.g., SL on X-axis, TP on Y-axis), color-coded by target metric
- [ ] A **sortable table** below the heatmap shows all combinations with columns: parameters, Profit Factor, Sharpe Ratio, Win Rate, Total Trades, Net Profit
- [ ] The best result (highest target metric) is highlighted in the table
- [ ] User can click "Apply Best Params" to copy the best parameter values back to the backtest configuration panel
- [ ] User can click any table row to preview that combination's key metrics in a detail panel

### Persistence
- [ ] Each optimization run is saved to Supabase with: asset, date range, strategy, parameter group, target metric, timestamp, and all result rows
- [ ] Optimization history page shows past runs (date, asset, parameter group, best result achieved)
- [ ] User can reload a past optimization run to view its results again

## Edge Cases
- **No trades generated:** If a parameter combination produces 0 trades, it is shown in the table with N/A metrics and excluded from heatmap coloring.
- **All combinations fail:** If the backtesting engine returns errors for all combinations, show a clear error message with the last known error.
- **Single parameter varies:** If only one parameter varies (e.g., only TP with fixed SL), show a line chart instead of a heatmap.
- **Optimization cancelled mid-run:** Partial results up to the cancellation point are shown and can be saved.
- **Same parameters already tested:** If the exact same configuration was optimized before, show a warning and offer to load the previous result instead of re-running.
- **Very large step size:** If step size is larger than the range (e.g., range 500–600, step 200), the UI shows a validation error before starting.
- **Data not cached:** If the required market data is not yet in the cache, the optimizer triggers a data fetch first and shows a loading state.

## Technical Requirements
- Security: Authentication required (redirect to login if not authenticated)
- Performance: Each individual backtest in the loop must complete within the same time constraints as a regular backtest
- The optimizer must not block the UI — progress updates must be streamed (can reuse PROJ-10 SSE streaming pattern)
- Heatmap rendering must handle up to 1,000 cells without performance issues
- Optimization results stored in Supabase must be associated with the authenticated user (RLS)

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)

### Überblick

Der Optimizer ist eine neue Seite, die die bestehende Backtest-Engine für alle Parameterkombinationen in einer Schleife aufruft. Fortschritt wird via Polling übermittelt, Ergebnisse als Heatmap + Tabelle dargestellt.

**Wichtiger Workflow-Hinweis:** Der Optimizer liest immer die aktuell aktive Backtest-Konfiguration (Asset, Datum, Strategie-Params). Kein separater "Optimize"-Button in der Backtest-UI nötig — der Nutzer navigiert per Sidebar zum Optimizer. Der bestehende "Config laden"-Flow aus der History funktioniert damit automatisch: History → Config laden → Backtest → Optimizer öffnen → Config ist vorausgefüllt.

---

### A) Komponentenstruktur

```
/optimizer (neue Seite, Auth-geschützt)
├── OptimizerPage
│   ├── ConfigInheritancePanel
│   │   └── Zeigt: aktuelles Asset, Datum, Strategie (aus Backtest-Config übernommen, read-only)
│   │
│   ├── ParameterGroupSelector
│   │   └── Radio: CRV (SL/TP) | Time Exit | Trigger Deadline | Range Window | Trailing Stop
│   │
│   ├── ParameterRangeForm (dynamisch je nach gewählter Gruppe)
│   │   └── Felder: Min, Max, Step (pro Parameter) — mit Validierung (Step > Range → Fehler)
│   │
│   ├── MetricSelector
│   │   └── Radio: Profit Factor | Sharpe Ratio | Win Rate | Net Profit
│   │
│   ├── CombinationCounter
│   │   └── Badge: "240 Kombinationen" (live berechnet) — Warnung bei > 500 + Bestätigung nötig
│   │
│   └── StartButton / CancelButton (zustandsabhängig, disabled bis Gruppe + Metrik gewählt)
│
├── ProgressSection (während der Ausführung)
│   ├── ProgressBar ("Running 47 / 240...")
│   └── CancelButton
│
├── ResultsSection (nach Abschluss oder Abbruch)
│   ├── HeatmapChart
│   │   ├── 2D-Heatmap wenn 2 Parameter variieren (z.B. SL × TP), Recharts custom rendering
│   │   └── Liniendiagramm wenn nur 1 Parameter variiert
│   │
│   ├── BestResultHighlight ("Bestes Ergebnis: SL=30, TP=90 → PF=2.4")
│   ├── ApplyBestParamsButton (kopiert beste Werte in aktive Backtest-Konfiguration)
│   │
│   └── ResultsTable (sortierbar)
│       ├── Spalten: Parameter | PF | Sharpe | Win Rate | Trades | Net Profit
│       └── RowDetailPanel (Klick auf Zeile zeigt Metriken-Detail)
│
└── OptimizationHistorySection (Tab oder unterer Bereich)
    ├── HistoryTable (vergangene Optimizer-Runs: Datum, Asset, Gruppe, bestes Ergebnis)
    ├── LoadRunButton (lädt gespeicherte Ergebnisse neu — kein erneuter Backtest)
    └── DeleteRunButton
```

---

### B) Datenmodell (Supabase)

**Tabelle: `optimization_runs`**
- `id`, `user_id` (RLS-Besitzer)
- `asset`, `date_from`, `date_to`, `strategy`
- `parameter_group` (z.B. `"crv"`)
- `target_metric` (z.B. `"profit_factor"`)
- `status`: `running` | `completed` | `cancelled` | `failed`
- `created_at`

**Tabelle: `optimization_results`**
- `id`, `run_id` (Fremdschlüssel → `optimization_runs`, ON DELETE CASCADE)
- `params` als JSON (z.B. `{ "sl": 30, "tp": 90 }`)
- `profit_factor`, `sharpe_ratio`, `win_rate`, `total_trades`, `net_profit`
- Keine einzelnen Trade-Listen — nur Aggregate pro Kombination

Beide Tabellen mit Row Level Security: jeder User sieht nur seine eigenen Daten.

---

### C) Ausführungs-Architektur (Polling)

**Warum Polling statt SSE?** SSE ist in PROJ-10 gescheitert. Polling ist einfacher und zuverlässiger.

**Ablauf:**
```
1. Browser → POST /api/optimizer/run       → gibt { jobId } zurück
2. Browser → alle 2s: GET /api/optimizer/status/{jobId}
                      ← gibt zurück: { progress, total, results[] }
3. Bei Abschluss: Ergebnisse werden in Supabase gespeichert
4. Abbruch: POST /api/optimizer/cancel/{jobId}
```

**Neue Python-Endpunkte (FastAPI):**
- `POST /optimize/start` — nimmt Parameter-Grid entgegen, startet Hintergrund-Job, gibt Job-ID zurück
- `GET /optimize/status/{job_id}` — gibt Fortschritt + bisherige Ergebnisse zurück
- `POST /optimize/cancel/{job_id}` — setzt Abbruch-Flag für laufenden Job

**Neue Next.js-API-Routen:**
- `POST /api/optimizer/run` — Proxy zu FastAPI + legt Run-Eintrag in Supabase an
- `GET /api/optimizer/status/[jobId]` — Proxy zu FastAPI-Status
- `POST /api/optimizer/cancel/[jobId]` — Proxy zu FastAPI-Cancel
- `GET /api/optimizer/runs` — lädt Optimizer-History aus Supabase
- `GET /api/optimizer/runs/[id]` — lädt gespeicherte Ergebnisse eines vergangenen Runs
- `DELETE /api/optimizer/runs/[id]` — löscht Run + Ergebnisse

---

### D) Heatmap-Rendering

**Lösung: Recharts (bereits installiert) mit benutzerdefiniertem Zell-Rendering**

Keine neuen npm-Pakete nötig. Farbskala: Grün (hoher Wert) → Rot (niedriger Wert) basierend auf Zielmetrik. Zellen ohne Trades werden grau dargestellt (N/A). Bis 1.000 Zellen performant via DOM-Rendering.

---

### E) Sidebar-Integration

Neuer Menüpunkt "Optimizer" in `src/components/auth/app-sidebar.tsx`, Route `/optimizer`, mit Auth-Schutz (Redirect zu Login wenn nicht eingeloggt).

---

### F) Abhängigkeiten

Keine neuen npm-Pakete — Recharts und alle shadcn/ui-Komponenten sind bereits installiert.

---

### G) Entscheidungsübersicht

| Entscheidung | Gewählt | Grund |
|---|---|---|
| Progress-Updates | Polling (2s Intervall) | SSE ist in PROJ-10 gescheitert; Polling ist stabiler |
| Heatmap | Custom mit Recharts | Bereits installiert, kein neues Paket nötig |
| Job-Verwaltung | In-Memory im FastAPI-Prozess | Einfach, kein Redis nötig für Single-User-Tool |
| Parameter-Speicherung | JSONB in Supabase | Flexibel für verschiedene Parameter-Gruppen |
| Config-Übergabe | Shared State via React Context | Optimizer liest aktive Backtest-Config; kein Extra-Button in Backtest-UI |
| Optimizer starten | Immer aus Optimizer-Seite | Klarer Einstiegspunkt; History → Config laden → Optimizer ist natürlicher Flow |

## QA Test Results
**Datum:** 2026-03-27
**Ergebnis:** NICHT deployment-bereit — 3 kritische Bugs müssen behoben werden

### Übersicht
- **Acceptance Criteria:** 16/18 bestanden (2 durchgefallen)
- **Edge Cases:** 5/7 abgedeckt
- **Bugs gesamt:** 8 (1 Critical, 1 High, 1 Medium, 5 Low)
- **TypeScript:** PASS
- **ESLint:** PASS

### Bugs — Must Fix vor Deployment

**BUG-1 (CRITICAL): Parameter-Key-Mismatch Frontend ↔ Backend**
- Frontend (`parameter-range-form.tsx`) sendet Keys: `stopLoss`, `takeProfit`, `timeExit`, `triggerDeadline`, `rangeStart`, `rangeEnd`, `trailTriggerPips`, `trailLockPips`
- Backend (`python/main.py`, `_apply_params_to_request()` ab Zeile ~1659) erwartet: `sl`, `tp`, `time_exit`, `trigger_deadline`, `range_start`, `range_end`, `trail_trigger`, `trail_lock`
- **Auswirkung:** Optimizer ist komplett nicht funktionsfähig — alle Kombinationen laufen mit identischen Basis-Parametern
- **Fix:** Backend-Funktion auf camelCase-Keys anpassen (sauberere Lösung, konsistent mit restlichem Frontend-Schema)

**BUG-2 (HIGH): Save-Endpoint wird nie aufgerufen**
- `POST /api/optimizer/runs/[id]/save` existiert, wird aber in `use-optimizer.ts` nie aufgerufen
- **Auswirkung:** `optimization_results`-Tabelle bleibt immer leer; History-Loads liefern keine Ergebnisse
- **Fix:** In `use-optimizer.ts` nach Abschluss (status `completed` oder `cancelled`) den Save-Endpoint mit allen Results aufrufen

**BUG-3 (MEDIUM): History-Load stellt Parameter-State nicht wieder her**
- `loadRun()` setzt `results` und `status`, aber nicht `parameterGroup`, `targetMetric` oder `parameterRanges`
- **Auswirkung:** Heatmap wird nicht gerendert, Tabelle zeigt keine Parameter-Spalten nach History-Load
- **Fix:** `loadRun()` muss auch `parameterGroup`, `targetMetric` und Parameter-Keys aus `optimization_runs.parameter_ranges` / `optimization_runs.parameter_group` restaurieren

### Bugs — Nice to Fix (Low Priority)

- **BUG-4:** Admin-Bypass in `GET /api/optimizer/runs` nutzt `user_metadata.role` statt server-seitige Claims
- **BUG-5:** Kein Rate-Limiting auf Optimizer-Endpoints (nur 1-Job-per-User als einziger Schutz)
- **BUG-6:** Duplizierte Bedingungen in `page.tsx` Zeile 180 und 227 (kein funktionaler Impact)
- **BUG-7:** Keine Erkennung/Warnung bei erneuter Optimierung mit gleichen Parametern (Spec-Anforderung)
- **BUG-8:** Python `_optimizer_jobs` Dict wird nie bereinigt (Memory-Leak bei vielen Runs)

### Security-Audit
Solide: Alle Endpoints prüfen Auth, RLS auf beiden Tabellen aktiviert, Input-Validierung via Zod + Pydantic, keine exponierten Secrets, kein XSS-Risiko.

## Deployment
_To be added by /deploy_
