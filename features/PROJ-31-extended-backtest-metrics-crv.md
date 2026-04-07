# PROJ-31: Extended Backtest Metrics & CRV Display

## Status: Planned
**Created:** 2026-04-07
**Last Updated:** 2026-04-07

## Dependencies
- Requires: PROJ-2 (Backtesting Engine) – metrics are computed there
- Requires: PROJ-4 (Performance Analytics) – existing metrics foundation
- Requires: PROJ-5 (Backtest UI) – results panel being extended

---

## Overview

Extend the backtest results page to achieve parity with MT5 Strategy Tester metrics, and add a prominent CRV (Chance-Risiko-Verhältnis) display inside the Overview card. The feature touches both the Python backend (new metric calculations) and the frontend (display of new fields).

---

## User Stories

- As a trader, I want to see the tested CRV (Risk/Reward Ratio) prominently at the top of the results, so I immediately know which CRV these statistics refer to.
- As a trader, I want to see the net profit in absolute dollars, so I can compare results across different initial capital settings.
- As a trader, I want to see the Recovery Factor (net profit / max drawdown $), so I can assess how efficiently the strategy recovers from losses.
- As a trader, I want to see Expected Payoff (net profit / total trades), so I can judge the average result per trade in dollar terms.
- As a trader, I want to see buy and sell positions broken down separately (count + win%), so I can detect directional bias in the strategy.
- As a trader, I want to see minimum and maximum trade duration alongside the average, so I know the full spread of holding times.
- As a trader, I want to see the max winning/losing streak including the total P&L of that streak, so I can understand the tail risks during drawdown phases.
- As a trader, I want to see average consecutive wins/losses counts, so I understand the typical streak pattern.
- As a trader, I want to see AHPR and GHPR, so I can evaluate the compounded growth quality of the strategy.
- As a trader, I want to see LR Correlation and LR Standard Error of the equity curve, so I can assess how smooth and consistent the growth curve is.
- As a trader, I want to see the Z-Score, so I can statistically test whether wins and losses are independent of each other.

---

## Acceptance Criteria

### CRV Display
- [ ] The CRV is displayed as the **first row** inside the Overview card, above "Total Return"
- [ ] CRV is formatted as "1 : X.XX" (e.g., "1 : 1.17" for SL=150, TP=175)
- [ ] CRV is derived from the strategy configuration (takeProfit / stopLoss); if the strategy has no fixed TP/SL parameters, the field is omitted
- [ ] CRV value is visually distinct (e.g., white/bold) so it stands out from other metric rows

### New Backend Metrics (added to `BacktestMetrics`)
- [ ] `net_profit` – absolute net profit in account currency ($)
- [ ] `recovery_factor` – net_profit / max_drawdown_abs (returns `null` if max_drawdown_abs = 0)
- [ ] `expected_payoff` – net_profit / total_trades (= Expected Payoff per trade in $)
- [ ] `max_drawdown_abs` – max drawdown in absolute $ (already available as % only)
- [ ] `buy_trades` – number of long trades
- [ ] `buy_win_rate_pct` – win rate of long trades in %
- [ ] `sell_trades` – number of short trades
- [ ] `sell_win_rate_pct` – win rate of short trades in %
- [ ] `min_trade_duration_minutes` – shortest trade duration in minutes
- [ ] `max_trade_duration_minutes` – longest trade duration in minutes
- [ ] `max_consec_wins_count` – max consecutive winning trades (count)
- [ ] `max_consec_wins_profit` – total profit of that winning streak ($)
- [ ] `max_consec_losses_count` – max consecutive losing trades (count)
- [ ] `max_consec_losses_loss` – total loss of that losing streak ($)
- [ ] `avg_consec_wins` – average number of consecutive winning trades
- [ ] `avg_consec_losses` – average number of consecutive losing trades
- [ ] `ahpr` – Average Holding Period Return (arithmetic mean of per-trade return on account balance)
- [ ] `ghpr` – Geometric Holding Period Return (geometric mean of per-trade balance multipliers)
- [ ] `lr_correlation` – Pearson correlation of equity curve vs. its linear regression line (0–1)
- [ ] `lr_std_error` – Standard error of the linear regression of the equity curve ($)
- [ ] `z_score` – Z-Score of trade sequence (wins/losses independence test); also report confidence level in %

### Frontend Display
- [ ] All new metrics are displayed in the `MetricsSummaryCard`
- [ ] **Overview card** gains: CRV (first row), Net Profit ($), Recovery Factor, Expected Payoff
- [ ] **Trade Stats card** gains: Buy trades (count + win%), Sell trades (count + win%), Min/Max trade duration
- [ ] **P&L card** gains: Max consecutive wins with $ value, Max consecutive losses with $ value, Avg consecutive wins/losses
- [ ] **Risk card** gains: Max Drawdown absolute ($), Recovery Factor (also visible here as secondary reference)
- [ ] **New "Advanced" card** (collapsible, collapsed by default): AHPR, GHPR, LR Correlation, LR Standard Error, Z-Score (with confidence %)
- [ ] All monetary values use the same locale-aware formatting as existing metrics
- [ ] All new metrics are included in Excel/CSV export (PROJ-25)

---

## CRV Calculation

```
CRV = takeProfit / stopLoss

Example:
  stopLoss  = 150 pips  →  risk  = 1 unit
  takeProfit = 175 pips  →  reward = 1.17 units
  CRV display: "1 : 1.17"
```

The CRV is a **configuration value**, not a backtest result. It must be passed from the form config (or read from `trades[0].stop_loss` / `trades[0].take_profit`) into the `ResultsPanel`. If multiple different TP/SL values occur across trades (e.g., partial closes), display the configured value from the form.

---

## Edge Cases

- **No trades**: CRV is still displayed (comes from config, not from trades)
- **Strategy without fixed TP/SL** (e.g., trailing stop only): CRV field is hidden / shows "n/a"
- **Recovery Factor with zero drawdown**: Show "∞" or "—" (no division by zero)
- **Z-Score with < 30 trades**: Display the value but add a "(low sample)" warning tooltip
- **All trades same direction** (all longs or all shorts): The other direction shows "0 (—%)" not an error
- **Single trade**: Min duration = Max duration = Avg duration; consecutive streak metrics = 1
- **GHPR with losses > 100%**: Clamp balance multiplier at 0.001 to avoid log(0) in calculation
- **LR Correlation for flat equity curve** (no growth): Returns 0, no error

---

## MT5 Metrics NOT in Scope for PROJ-31

The following MT5 fields are specific to the MT5 simulation model and are not applicable to our backtester:
- **Margin Stand** – requires margin/leverage simulation (not implemented)
- **OnTester Resultat** – MT5-specific custom metric hook
- **Qualität der Historie / Balken / Ticks / Symbole** – data quality metadata (different model)
- **Rückgang Equity** (separate from balance drawdown) – requires tick-level unrealized P&L tracking

---

## Technical Requirements

- All new metrics computed in the Python backend (`analytics.py` or equivalent)
- `BacktestMetrics` TypeScript interface extended with all new fields (backwards-compatible: new fields optional with `?` until backend is deployed)
- No API route signature changes required (metrics are part of the existing response body)
- Advanced card collapses by default to avoid UI clutter
- Performance: metric computation adds < 50ms to backtest runtime

---

## Tech Design (Solution Architect)

### Betroffene Schichten

```
Python Backend
└── analytics.py           ← 20+ neue Metriken berechnen

TypeScript (Shared Types)
└── lib/backtest-types.ts  ← BacktestMetrics Interface erweitern (neue Felder optional mit ?)

Frontend Components
├── results-panel.tsx      ← CRV-Wert (aus strategyParams) als Prop nach unten weiterreichen
└── metrics-summary-card.tsx ← 4 bestehende Cards erweitern + 1 neues "Advanced" Card
```

### Komponentenstruktur

```
ResultsPanel (bestehend)
├── übergibt: crv?: number | null  (aus strategyParams.takeProfit / stopLoss)
│
└── MetricsSummaryCard (erweitert)
    ├── Overview Card
    │   ├── [NEU] CRV  ← erste Zeile, visuell hervorgehoben (weiß/bold)
    │   ├── Total Return (vorhanden)
    │   ├── [NEU] Net Profit ($)
    │   ├── [NEU] Recovery Factor
    │   ├── [NEU] Expected Payoff
    │   ├── CAGR, Sharpe, Sortino, Final Balance (vorhanden)
    │
    ├── Trade Stats Card
    │   ├── Win Rate Donut (vorhanden)
    │   ├── Total Trades, Winning/Losing (vorhanden)
    │   ├── [NEU] Buy-Trades + Win%
    │   ├── [NEU] Sell-Trades + Win%
    │   ├── Avg Duration (vorhanden)
    │   └── [NEU] Min / Max Duration
    │
    ├── P&L Card
    │   ├── (alle vorhandenen Zeilen)
    │   ├── [NEU] Max Consec. Wins (Anzahl + $)
    │   ├── [NEU] Max Consec. Losses (Anzahl + $)
    │   └── [NEU] Avg Consec. Wins / Losses
    │
    ├── Risk Card
    │   ├── Max Drawdown % (vorhanden)
    │   ├── [NEU] Max Drawdown ($)
    │   ├── [NEU] Recovery Factor (Referenz)
    │   └── Calmar Ratio, Longest Drawdown (vorhanden)
    │
    ├── R-Multiple Card (unverändert)
    │
    └── [NEU] Advanced Card (collapsible, standardmäßig eingeklappt)
        ├── AHPR
        ├── GHPR
        ├── LR Correlation
        ├── LR Standard Error ($)
        └── Z-Score + Konfidenz % (Tooltip-Warnung bei < 30 Trades)
```

### Datenmodell

**Neue Felder in `BacktestMetrics`** (alle optional `?` bis Backend deployed):

| Feld | Bedeutung |
|---|---|
| `net_profit?` | Absoluter Gewinn/Verlust in $ |
| `max_drawdown_abs?` | Maximaler Drawdown in $ |
| `recovery_factor?` | Net Profit ÷ Max Drawdown $ (null bei DD=0) |
| `expected_payoff?` | Ø Gewinn pro Trade in $ |
| `buy_trades?` / `sell_trades?` | Anzahl Long- / Short-Trades |
| `buy_win_rate_pct?` / `sell_win_rate_pct?` | Trefferquote nach Richtung |
| `min_trade_duration_minutes?` / `max_trade_duration_minutes?` | Haltedauer-Spanne |
| `max_consec_wins_count?` + `max_consec_wins_profit?` | Längste Gewinnserie + P&L |
| `max_consec_losses_count?` + `max_consec_losses_loss?` | Längste Verlustserie + P&L |
| `avg_consec_wins?` / `avg_consec_losses?` | Ø Serienlänge |
| `ahpr?` / `ghpr?` | Arithmetische / geometrische Rendite pro Trade |
| `lr_correlation?` | Linearität der Equity-Kurve (0–1) |
| `lr_std_error?` | Standardfehler der Equity-Regression ($) |
| `z_score?` + `z_score_confidence_pct?` | Unabhängigkeitstest der Trade-Sequenz |

**CRV** ist kein Backtest-Ergebnis – wird als `crv?: number | null` Prop an `MetricsSummaryCard` übergeben, berechnet aus `strategyParams.takeProfit / strategyParams.stopLoss` im `ResultsPanel`.

### Tech-Entscheidungen

| Entscheidung | Begründung |
|---|---|
| CRV als separater Prop (nicht in BacktestMetrics) | CRV ist Konfigurations-Wert – bleibt bei 0 Trades sichtbar, gehört nicht ins Ergebnis |
| Neue Felder optional (`?`) im TypeScript-Interface | Rückwärtskompatibilität: ältere gespeicherte Runs laden ohne Fehler |
| Kein neuer API-Endpunkt | Neue Metriken werden in den bestehenden Response-Body von `/api/backtest/run` ergänzt |
| `shadcn/ui Collapsible` für Advanced Card | Bereits installiert (`src/components/ui/collapsible.tsx`) |
| `shadcn/ui Tooltip` für Z-Score Warnung | Bereits installiert |

### Abhängigkeiten

Keine neuen Packages erforderlich – alle benötigten shadcn-Komponenten sind bereits installiert.

### Export-Erweiterung (PROJ-25)

Die Excel/CSV-Export-Logik liest direkt aus `BacktestMetrics`. Neue Felder werden dort ergänzt – keine strukturellen Änderungen am Export-Mechanismus nötig.

## QA Test Results
_To be added by /qa_

## Deployment
_To be added by /deploy_
