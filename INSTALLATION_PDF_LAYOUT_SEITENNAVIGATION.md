# Installation: PDF-Layout und fortlaufende Seitennavigation

Stand: 26.11.2026

## Zweck

Dieses Paket behebt zwei gezielte Fehler im PDF-Viewer:

1. Wird die Miniaturseitenleiste ausgeblendet, belegt der PDF-Anzeigebereich jetzt die komplette Viewerbreite. Die rechte, ungenutzte dunkle Spalte entfällt. **Breite**, **Ganze Seite** und **Fenster füllen** werden nach dem Ein- oder Ausblenden der Miniaturen anhand der tatsächlich verfügbaren Fläche neu berechnet.
2. Am vertikalen Seitenrand wird mit **Pfeil unten**, **Pfeil oben** und einer vertikalen Touch-Wischgeste in die angrenzende Seite weitergeblättert. Beim Wechsel nach unten beginnt die neue Seite oben; beim Wechsel nach oben erscheint die vorherige Seite an ihrem unteren Ende.

Unverändert bleiben PDF-Upload, Uploadfortschritt, Offline-Speicherung, Server-Routing, KL-Rechte und KL-Speicherpfad.

## Installation

1. ZIP entpacken.
2. Den Inhalt des entpackten Ordners in das Root-Verzeichnis des aktuellen Farbatlas-Projekts kopieren.
3. Vorhandene Dateien ersetzen. Geändert werden nur:
   - `learning-materials-viewer.js`
   - `learning-materials.css`
   - `test/pdf-viewer-fix.test.mjs`
   - `test/pdf-upload-progress-page-head.test.mjs`
   - neu: `test/pdf-layout-edge-navigation.test.mjs`
4. Optional lokal prüfen:

```bash
node --check learning-materials-viewer.js
node --test test/pdf-viewer-fix.test.mjs test/pdf-upload-progress-page-head.test.mjs test/pdf-layout-edge-navigation.test.mjs test/learning-materials-integration.test.mjs
```

5. In GitHub Desktop committen, zum Beispiel mit:

```text
Fix PDF layout and edge page navigation
```

6. **Push origin** ausführen und den Netlify-Deploy bis **Published** abwarten.
7. Die Farbatlas-Seite mit `⌘ + Shift + R` hart neu laden.

## Manueller Kurztest

1. Mehrseitige PDF öffnen; Miniaturen zunächst ausgeblendet lassen.
2. **Breite**, **Ganze Seite** und **Fenster füllen** nacheinander aktivieren. Die Seite muss die komplette verfügbare Viewerfläche nutzen und korrekt zentriert sein; rechts darf keine reservierte schwarze Spalte bleiben.
3. Miniaturen einblenden und wieder ausblenden. Der aktive Ansichtsmodus muss sich nach jedem Wechsel automatisch neu an die geänderte Breite anpassen.
4. In einer vergrößerten Seite mit **Pfeil unten** bis zum Seitenende scrollen und die Taste dort erneut drücken. Die nächste Seite muss oben beginnen.
5. Auf der nächsten Seite mit **Pfeil oben** bis zum Seitenanfang scrollen und die Taste dort erneut drücken. Die vorherige Seite muss an ihrem unteren Ende erscheinen.
6. Dieselben Übergänge am Touchscreen prüfen: am Seitenende nach oben wischen, am Seitenanfang nach unten wischen.
7. Abschließend Miniaturen, Seitennummer, Links-/Rechtspfeil, freien Zoom, Pinch-Zoom, Einzel-/Doppelseite und Vollbild kurz gegenprüfen.
