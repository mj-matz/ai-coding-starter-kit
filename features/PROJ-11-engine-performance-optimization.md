# PROJ-11: Engine Performance Optimization (NumPy + Breakout Vectorization)

## Status: Planned
**Created:** 2026-03-20
**Last Updated:** 2026-03-20

## Dependencies
- Requires: PROJ-2 (Backtesting Engine) — optimiert die bestehende `run_backtest()`-Implementierung
- Requires: PROJ-3 (Time-Range Breakout Strategy) — `generate_signals()` wird ebenfalls optimiert
- Compatible with: PROJ-10 (Backtest Progress Streaming) — `progress_callback`-Parameter bleibt unverändert erhalten

## Motivation

Die aktuelle Implementierung der Engine und der Signal-Generierung verwendet `pandas.DataFrame.iloc[i]` innerhalb einer Python-`for`-Schleife. Bei 1 Jahr 1-Minuten-Daten (≈ 250.000 Bars) erzeugt jeder `iloc`-Aufruf ein neues `Series`-Objekt — das ist ca. 10× langsamer als direkter NumPy-Array-Zugriff.

Zusätzlich wird bei jedem Bar mit offener Position `bar_time.tz_convert(tz).time()` aufgerufen, obwohl diese Werte für alle Bars im Voraus berechnet werden können.

Die Signal-Generierung in `breakout.py` iteriert mit einer Python-`for`-Schleife über jeden Handelstag und führt pro Tag mehrere Pandas-Operationen (Boolean-Masking, `.union()`, `.loc[]`) durch. Diese können mit `groupby` + vektorisierten `agg`-Operationen weitgehend ersetzt werden.

**Ziel:** 5–8× Speedup auf einem einzelnen Backtest-Lauf (Engine + Signal-Generierung kombiniert) ohne Architektur-Änderung, ohne neue Abhängigkeiten und mit vollständiger Rückwärtskompatibilität.

## User Stories

- Als Trader möchte ich, dass ein Backtest über 1 Jahr 1m-XAUUSD-Daten in unter 15 Sekunden abgeschlossen ist (statt 30–60 s), damit ich schneller zwischen Parametervariationen iterieren kann.
- Als Trader möchte ich, dass auch die Signal-Generierung nicht mehr der Flaschenhals ist, damit ich verschiedene Range-Zeiten und Parameter schnell vergleichen kann.
- Als Trader möchte ich, dass das Ergebnis des optimierten Backtests bitgenau identisch mit dem bisherigen Ergebnis ist, damit ich darauf vertrauen kann, dass keine Logik-Änderungen eingeführt wurden.

## Acceptance Criteria

### Option A — NumPy-Array-Extraktion in `engine.py`
- [ ] Vor der Hauptschleife werden `open`, `high`, `low`, `close` sowie alle benötigten Signal-Spalten einmalig mit `.to_numpy()` in NumPy-Arrays extrahiert
- [ ] Im Loop wird ausschließlich auf diese Arrays per Index `[i]` zugegriffen — kein `ohlcv.iloc[i]`, kein `signals.iloc[i]`, kein `sig_row.get(...)`
- [ ] Der `bar_time`-Zugriff (für Logging und Trade-Timestamps) verwendet weiterhin `ohlcv.index[i]` (unveränderter DatetimeIndex-Zugriff)
- [ ] Alle Ergebniswerte (PnL, Lot Size, Trade-Felder) sind bitgenau identisch mit der bisherigen Implementierung
- [ ] Bestehende Tests (`test_engine.py`, alle 30 Tests) bestehen ohne Änderung

### Option B — Timezone-Exit-Check vektorisieren in `engine.py`
- [ ] Vor der Hauptschleife wird ein Boolean-NumPy-Array `exit_flags` berechnet, das für jeden Bar angibt, ob `bar_time >= exit_time` in der konfigurierten Timezone gilt
- [ ] Im Loop wird `exit_flags[i]` abgefragt statt `bar_time.tz_convert(exit_tz).time() >= exit_time`
- [ ] Wenn `config.time_exit` nicht gesetzt ist (`None`), wird `exit_flags` nicht berechnet und der bestehende Guard-Check bleibt erhalten (kein unnötiger Overhead)
- [ ] Ergebnisse sind bitgenau identisch mit der bisherigen Implementierung
- [ ] Bestehende Tests bestehen ohne Änderung

### Option C — Signal-Generierung vektorisieren in `breakout.py`
- [ ] Die Range-Berechnung (High/Low pro Handelstag) verwendet `groupby` + `.agg()` statt einer Python-`for`-Schleife über Tage
- [ ] Tage ohne Range-Bars (kein Bar in `[range_start, range_end)`) werden über Boolean-Masking herausgefiltert, nicht per `if len(...) == 0`-Check im Loop
- [ ] Flat-Range-Tage (`range_high == range_low`) werden vektorisiert herausgefiltert
- [ ] Die Signal-Bar-Bestimmung (erster Bar nach `range_end + entry_delay_bars`) erfolgt pro Gruppe, nicht per Bar-by-Bar-Loop
- [ ] Overnight-Ranges (`range_start > range_end`) werden weiterhin korrekt behandelt — die vektorisierte Implementierung muss diesen Fall explizit abdecken
- [ ] `skipped_days`-Liste wird weiterhin korrekt befüllt (Reason Codes: `NO_RANGE_BARS`, `FLAT_RANGE`, `NO_SIGNAL_BAR`, `DEADLINE_MISSED`, `NO_BARS`)
- [ ] Das produzierte Signals-DataFrame ist index-kompatibel und inhaltlich identisch mit dem bisherigen Output
- [ ] Bestehende Tests für `BreakoutStrategy` (`test_breakout.py`) bestehen ohne Änderung

### Performance-Anforderung
- [ ] Ein Backtest über 1 Jahr 1m-XAUUSD-Daten (Referenz: 252 Handelstage, ≈ 250.000 Bars) schließt in unter 15 Sekunden ab — Engine + Signal-Generierung kombiniert (gemessen als Durchschnitt über 3 Läufe, warmup excluded)
- [ ] Die Signal-Generierung für 252 Handelstage schließt in unter 1 Sekunde ab
- [ ] Kein neues Paket wird als Dependency hinzugefügt (`numpy` und `pandas` sind bereits installiert)

## Edge Cases

- Leerer OHLCV-DataFrame → Early Return vor der Array-Extraktion (bestehende Guard-Logik unverändert)
- `time_exit = None` → `exit_flags`-Berechnung wird vollständig übersprungen
- DataFrame mit einer einzigen Zeile → Array-Extraktion produziert Shape `(1,)`, Loop-Logik unverändert
- Timezone-Konvertierung bei DST-Wechsel → vektorisierte Konvertierung über `ohlcv.index.tz_convert()` behandelt DST identisch zu bar-by-bar `tz_convert()`
- Overnight-Range in Option C → Tage, bei denen `range_start > range_end` gilt, spannen zwei Kalendertage; `groupby(date)` allein reicht nicht — Range-Bars müssen über ein Day-Offset-Schema (`range_day` = vorheriger Kalendertag für Bars vor Mitternacht) gruppiert werden
- Letzter Handelstag mit Overnight-Range → kein Folgetag vorhanden, Tag wird mit Reason `NO_BARS` übersprungen (identisch zum bisherigen Verhalten)
- Einzelner Handelstag im DataFrame → `groupby` liefert eine Gruppe, Logik unverändert
- `entry_delay_bars > 1` → vektorisierte Implementierung muss `.nth(entry_delay_bars - 1)` oder äquivalente Pandas-Gruppenoperation verwenden

## Technical Requirements

### `python/engine/engine.py` — Option A

```python
# Vor der Hauptschleife:
_opens   = ohlcv["open"].to_numpy(dtype=float)
_highs   = ohlcv["high"].to_numpy(dtype=float)
_lows    = ohlcv["low"].to_numpy(dtype=float)

# Signal-Arrays (NaN = kein Signal)
_long_entry  = signals["long_entry"].to_numpy(dtype=float)
_long_sl     = signals["long_sl"].to_numpy(dtype=float)
_long_tp     = signals["long_tp"].to_numpy(dtype=float)
_short_entry = signals["short_entry"].to_numpy(dtype=float)
_short_sl    = signals["short_sl"].to_numpy(dtype=float)
_short_tp    = signals["short_tp"].to_numpy(dtype=float)
# ... weitere Signal-Spalten analog

# Im Loop:
bar_open  = _opens[i]
bar_high  = _highs[i]
bar_low   = _lows[i]
bar_time  = ohlcv.index[i]   # unverändert (DatetimeIndex bleibt für Timestamps)
```

`_extract_pending_orders(signals.iloc[i])` wird durch direkte Array-Zugriffe auf `_long_entry[i]`, `_long_sl[i]` etc. ersetzt. Die Logik (NaN-Checks via `np.isnan()`) bleibt semantisch identisch.

### `python/engine/engine.py` — Option B

```python
# Vor der Hauptschleife (nur wenn exit_time gesetzt):
if exit_time is not None:
    local_index = ohlcv.index.tz_convert(exit_tz)
    exit_minutes = exit_time.hour * 60 + exit_time.minute
    bar_minutes  = local_index.hour * 60 + local_index.minute
    exit_flags   = (bar_minutes >= exit_minutes).to_numpy()
else:
    exit_flags = None

# Im Loop:
if position is not None and exit_flags is not None and exit_flags[i]:
    ...  # Time exit Logik unverändert
```

### `python/strategies/breakout.py` — Option C

Kernidee: Range High/Low pro Tag mit `groupby` berechnen, dann Signal-Bar per Gruppenoperation bestimmen.

```python
# 1. Lokale Zeiten einmalig berechnen
local_idx = df.index.tz_convert(tz)
minutes   = local_idx.hour * 60 + local_idx.minute  # NumPy int-Array

range_start_min = params.range_start.hour * 60 + params.range_start.minute
range_end_min   = params.range_end.hour   * 60 + params.range_end.minute

# 2. Range-Bars markieren (normaler intraday case)
range_mask = (minutes >= range_start_min) & (minutes < range_end_min)

# 3. Range-Key: Kalenderdatum in der lokalen Timezone (für overnight: day - 1 für Bars vor Mitternacht)
range_day = local_idx.normalize().date  # pd.DatetimeIndex → np.array of date

# 4. groupby → Range High/Low
range_bars  = df[range_mask].copy()
range_bars["_day"] = range_day[range_mask]
range_agg = range_bars.groupby("_day")[["high", "low"]].agg(
    range_high=("high", "max"),
    range_low=("low",  "min"),
)
# Flat ranges herausfiltern
range_agg = range_agg[range_agg["range_high"] != range_agg["range_low"]]

# 5. Signal-Bars: erster Bar nach range_end pro Tag
after_mask = minutes >= range_end_min
after_bars = df[after_mask].copy()
after_bars["_day"] = range_day[after_mask]
# entry_delay_bars = 1 → zweiter Bar (index 1) nach range_end; .nth() ist O(n)
signal_bars = after_bars.groupby("_day").nth(params.entry_delay_bars - 1)

# 6. Join: nur Tage, die in range_agg UND signal_bars vorhanden sind
joined = range_agg.join(signal_bars[[]].rename_axis("_day"), how="inner")
# → joined.index = Liste der gültigen Handelstage mit Signal-Bar
```

> Die vollständige Implementierung muss den Overnight-Case, `entry_delay_bars = 0`, Deadline-Check und `skipped_days`-Befüllung zusätzlich abdecken. Das Konzept oben zeigt nur den Normalfall.

## Files Changed

| Datei | Art | Beschreibung |
|-------|-----|-------------|
| `python/engine/engine.py` | Edit | NumPy-Array-Extraktion (Option A) + vektorisierter Exit-Check (Option B) |
| `python/strategies/breakout.py` | Edit | Vektorisierte Signal-Generierung via `groupby` (Option C) |

> Kein Eingriff in `order_manager.py`, `position_tracker.py`, `sizing.py`, `models.py`.

## Out of Scope

- Numba JIT-Kompilierung (separates Feature, erfordert Datenstruktur-Refactoring)
- Multiprocessing für parallele Parameter-Sweeps (separates Feature)
- Änderungen an der API-Route oder dem Frontend
- Änderungen an Tests (alle bestehenden Tests müssen ohne Modifikation bestehen)

---

## Tech Design (Solution Architect)

**Typ:** Reines Python-Backend-Refactoring — kein Frontend, keine neuen APIs, keine Datenbankänderungen.

### Komponentenstruktur

```
Python Backend (unverändertes Interface)
+-- python/engine/engine.py          ← ÄNDERUNG
|   +-- run_backtest()
|       +-- [NEU] NumPy-Array-Extraktion vor der Schleife (Option A)
|       +-- [NEU] Vektorisierter Exit-Time-Check (Option B)
|       +-- [UNVERÄNDERT] Bar-by-Bar Loop (nur Datenzugriff schneller)
|
+-- python/strategies/breakout.py   ← ÄNDERUNG
|   +-- generate_signals()
|       +-- [NEU] groupby-basierte Range-Berechnung (Option C)
|       +-- [UNVERÄNDERT] Output-Format (Signals-DataFrame identisch)
|
+-- python/engine/order_manager.py   ← KEINE ÄNDERUNG
+-- python/engine/position_tracker.py ← KEINE ÄNDERUNG
+-- python/engine/sizing.py          ← KEINE ÄNDERUNG
+-- python/engine/models.py          ← KEINE ÄNDERUNG

Frontend / API / Datenbank            ← KEINE ÄNDERUNG
```

### Datenstrategie

Kein neues Datenmodell. Alle Optimierungen arbeiten ausschließlich im Arbeitsspeicher:

| Was | Bisher | Neu |
|-----|--------|-----|
| OHLCV-Zugriff im Loop | `iloc[i]` → neues Series-Objekt pro Bar | Einmalig in NumPy-Arrays extrahiert, dann `array[i]` |
| Exit-Zeit-Check | `tz_convert()` + `.time()` pro Bar (250.000×) | Boolean-Array einmalig vorberechnet, dann `exit_flags[i]` |
| Range High/Low | Python-`for`-Loop über jeden Handelstag | `groupby().agg()` — eine vektorisierte C-Operation |

Alle Ergebnisse (Trades, PnL, Metriken) bleiben **bitgenau identisch**.

### Tech-Entscheidungen

| Entscheidung | Begründung |
|---|---|
| NumPy-Arrays statt Pandas `iloc` | `iloc` erzeugt pro Aufruf ein neues Python-Objekt — direkter Array-Index ist ca. 10× schneller |
| Vektorisierter Timezone-Check | DST-Konvertierung einmal für alle Bars statt 250.000× im Loop |
| `groupby + agg` statt Tag-by-Tag-Loop | Pandas `groupby` ist in C implementiert — verarbeitet alle Tage simultan statt sequenziell |
| Overnight-Range via Day-Offset-Schema | Bars vor Mitternacht werden dem Vortag zugeordnet — einziger Edge-Case der Gruppenbildung |
| Keine neuen Pakete | NumPy und Pandas bereits installiert — kein Dependency-Risiko |

### Schnittstellen-Garantien

- `progress_callback`-Parameter in `run_backtest()` → bleibt unverändert (PROJ-10-kompatibel)
- `generate_signals()` Output-DataFrame → index- und inhaltlich identisch
- Alle 30 Tests in `test_engine.py` + alle Tests in `test_breakout.py` → müssen ohne Modifikation bestehen

### Dependencies

```
numpy    ← bereits installiert
pandas   ← bereits installiert
```

Keine neuen Pakete erforderlich.
