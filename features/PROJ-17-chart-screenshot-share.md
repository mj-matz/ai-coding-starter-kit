# PROJ-17: Chart Screenshot Share

## Status: In Review
**Created:** 2026-03-22
**Last Updated:** 2026-03-23

## Dependencies
- Requires: PROJ-5 (Backtest UI) — Trade-Chart-Dialog, in dem der Button platziert wird
- Requires: PROJ-8 (Authentication) — Upload nur für eingeloggte User

## User Stories
- Als Trader möchte ich per Klick einen Screenshot des Trade-Charts erzeugen, damit ich ihn einfach mit anderen teilen kann.
- Als Trader möchte ich, dass die Screenshot-URL automatisch in meine Zwischenablage kopiert wird, damit ich sie direkt einfügen kann ohne weitere Schritte.
- Als Trader möchte ich, dass die URL dauerhaft abrufbar ist, damit ich Screenshots auch Wochen später noch verlinken kann.

## Acceptance Criteria
- [ ] Im Trade-Chart-Dialog (PROJ-5) gibt es einen "Share"-Button (Icon + Label)
- [ ] Klick auf den Button erzeugt einen Screenshot des Chart-Bereichs via `chart.takeScreenshot()`
- [ ] Der Screenshot wird als PNG zu Supabase Storage (öffentlicher Bucket `chart-screenshots`) hochgeladen
- [ ] Der Dateiname enthält Trade-ID und einen zufälligen Suffix (z.B. `trade-15-a3f9b2.png`)
- [ ] Die öffentliche URL wird in die Zwischenablage kopiert (`navigator.clipboard.writeText`)
- [ ] Eine Toast-Benachrichtigung bestätigt: "Link kopiert!" (inkl. Vorschau der URL)
- [ ] Während Upload läuft, ist der Button deaktiviert und zeigt einen Ladezustand
- [ ] Bei Fehler (Upload/Clipboard) wird eine verständliche Fehlermeldung angezeigt

## Edge Cases
- **Clipboard-API nicht verfügbar** (ältere Browser / HTTP): Fallback → URL in einem Dialog anzeigen, damit User sie manuell kopieren kann
- **Upload schlägt fehl** (Netzwerk, Storage-Fehler): Fehlermeldung anzeigen, Button wieder aktivieren, kein leerer State
- **Supabase Storage Bucket nicht konfiguriert**: Klarer Fehlerhinweis in der Console, Toast mit "Screenshot nicht verfügbar"
- **Sehr großes Chart-Canvas**: Screenshot-Auflösung auf max. 2x Device-Pixel-Ratio begrenzen, um Upload-Zeit kurz zu halten
- **Mehrfaches schnelles Klicken**: Button nach erstem Klick sofort deaktivieren bis Upload abgeschlossen

## Technical Requirements
- Screenshot-Methode: `chart.takeScreenshot()` von Lightweight Charts (gibt `HTMLCanvasElement` zurück) → `canvas.toBlob('image/png')`
- Storage: Supabase Storage, öffentlicher Bucket `chart-screenshots`, keine Auth für Lesezugriff nötig
- Dateinamen-Schema: `trade-{id}-{randomHex6}.png`
- Max. Dateigröße erwartet: < 1 MB (unkritisch für Free Tier mit 1 GB Limit)
- Browser-Support: Chrome, Firefox, Safari (Clipboard API mit Fallback)

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)

### Komponentenstruktur

```
TradeChartDialog (bestehend: trade-chart-dialog.tsx)
+-- Chart-Bereich (Lightweight Charts Instanz)
+-- [NEU] ShareButton (Button + Share-Icon)
|   +-- Ladezustand: Button deaktiviert + Spinner
|   +-- Normalzustand: "Share"-Label + Icon
+-- [NEU] ClipboardFallbackDialog (nur bei fehlender Clipboard-API)
    +-- URL-Anzeigefeld (read-only, manuell kopierbar)
    +-- Schließen-Button
```

### Dateinamen-Schema

Der Dateiname eines Screenshots enthält vier Teile – durch Bindestriche getrennt:

```
trade-{Trade-ID}-{YYYY-MM-DD}-{zufälliger 6-stelliger Hex}.png

Beispiel: trade-15-2026-01-07-a3f9b2.png
```

Das Datum entspricht dem **Tradetag** (Einstiegsdatum des Trades), nicht dem heutigen Datum.

Gespeichert in: **Supabase Storage** – öffentlicher Bucket `chart-screenshots`
- Lesezugriff: öffentlich (keine Authentifizierung für Abruf nötig)
- Schreibzugriff: nur eingeloggte User

### Datenfluss

```
1. Klick auf "Share"
       ↓
2. chart.takeScreenshot() → Canvas-Element
       ↓
3. canvas.toBlob() → PNG-Datei im Speicher
       ↓
4. Upload → Supabase Storage (Bucket: chart-screenshots)
       ↓
5. Öffentliche URL abrufen
       ↓
6a. Clipboard-API verfügbar → URL kopieren → Toast "Link kopiert!"
6b. Clipboard-API NICHT verfügbar → Fallback-Dialog mit URL anzeigen
       ↓
7. Button wieder aktivieren
```

### Tech-Entscheidungen

| Entscheidung | Begründung |
|---|---|
| **Kein API-Route nötig** | Supabase Storage unterstützt direkte Uploads vom Browser – kein Server-Umweg erforderlich |
| **Supabase Storage (public bucket)** | Links müssen dauerhaft ohne Login abrufbar sein → öffentlicher Bucket ist der einfachste Weg |
| **Tradetag im Dateinamen (YYYY-MM-DD)** | Dateiname beschreibt den Inhalt des Screenshots; erleichtert Zuordnung im Storage-Browser |
| **Sonner (Toast)** | Bereits installiert (`sonner.tsx`), passt perfekt für "Link kopiert!"-Bestätigung |
| **Alert-Dialog als Fallback** | Bereits installiert (`alert-dialog.tsx`), kein neues Paket nötig |
| **Button sofort deaktivieren** | Verhindert Doppelklick-Uploads bei langsamer Verbindung |

### Neue Dateien / Änderungen

| Datei | Art | Beschreibung |
|---|---|---|
| `src/components/backtest/trade-chart-dialog.tsx` | Änderung | Share-Button + Upload-Logik einbauen |
| `src/hooks/use-chart-share.ts` | Neu | Screenshot → Upload → Clipboard-Logik als wiederverwendbarer Hook |

### Abhängigkeiten

Keine neuen Pakete nötig – alles bereits vorhanden:
- `@supabase/supabase-js` (Supabase Client)
- `sonner` (Toast)
- `lucide-react` (Share-Icon)
- shadcn `alert-dialog` (Clipboard-Fallback)

## QA Test Results
**Datum:** 2026-03-23
**Ergebnis:** ✅ APPROVED — alle Critical/High Bugs gefixt (2026-03-23)

### Acceptance Criteria: 8/8 bestanden

| AC | Beschreibung | Status |
|----|-------------|--------|
| AC-1 | Share-Button im Dialog | PASS |
| AC-2 | Screenshot via takeScreenshot() | PASS |
| AC-3 | Upload zu Supabase Storage | PASS (Migration + RLS gefixt) |
| AC-4 | Dateiname mit Trade-ID + Hex | PASS |
| AC-5 | URL in Zwischenablage | PASS |
| AC-6 | Toast "Link kopiert!" | PASS |
| AC-7 | Ladezustand während Upload | PASS |
| AC-8 | Fehlermeldung bei Fehler | PASS |

### Bugs

| Bug | Severity | Beschreibung | Priorität |
|-----|----------|-------------|-----------|
| BUG-1 | **Critical** | ~~Kein Supabase Storage Bucket `chart-screenshots` als Migration definiert. Ohne Bucket schlägt jeder Upload fehl.~~ ✅ Gefixt: `20260323_chart_screenshots_bucket.sql` | Fix before deployment |
| BUG-2 | **Critical** | ~~Keine RLS-Policies für `storage.objects`. Weder INSERT (auth) noch SELECT (public) Policy existiert.~~ ✅ Gefixt: `20260323_chart_screenshots_bucket.sql` | Fix before deployment |
| BUG-3 | Low | Keine Screenshot-Auflösungs-Begrenzung auf max 2x DPR (Edge-Case aus Spec). | Nice to have |
| BUG-4 | **High** | ~~`useChartShare` Hook prüft nicht ob User eingeloggt ist. Spec verlangt Auth als Dependency (PROJ-8).~~ ✅ Gefixt: `use-chart-share.ts` | Fix before deployment |
| BUG-5 | Medium | ~~Keine serverseitige Content-Type-Validierung. Angreifer könnte HTML/JS statt PNG hochladen (Stored XSS via Storage-Domain).~~ ✅ Gefixt: `allowed_mime_types` im Bucket | Fix in next sprint |
| BUG-6 | Low | Kein Rate-Limiting auf Uploads. User könnte Storage-Quota ausschöpfen. | Nice to have |
| BUG-7 | Low | ESLint-Warning: `rangeStart` fehlt im useEffect-Dependency-Array (Zeile 140). Existierender Bug aus PROJ-5. | Fix in next sprint |

### Empfohlene Fix-Reihenfolge
1. BUG-1 + BUG-2 → `/backend` (Supabase Migration: Bucket + RLS-Policies)
2. BUG-4 → `/frontend` (Auth-Check im `useChartShare` Hook)

## Deployment
_To be added by /deploy_
