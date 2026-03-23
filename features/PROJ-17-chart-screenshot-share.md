# PROJ-17: Chart Screenshot Share

## Status: Planned
**Created:** 2026-03-22
**Last Updated:** 2026-03-22

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
_To be added by /qa_

## Deployment
_To be added by /deploy_
