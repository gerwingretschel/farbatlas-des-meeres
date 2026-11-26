# Installation: PDF-Viewportfix (26.11.2026)

## Zweck

Dieser gezielte Fix entfernt ausschließlich die unbeabsichtigte globale Breitenbegrenzung des PDF-Anzeigebereichs.

Der Viewer verwendet für **Breite**, **Ganze Seite** und **Fenster füllen** weiterhin `clientWidth` und `clientHeight` des tatsächlichen PDF-Viewport-Containers. Der Container ist nun nicht mehr von der allgemeinen Projektregel `main { max-width: 1280px; margin: auto; }` begrenzt.

Dadurch gilt:

- **Breite** nutzt die komplette tatsächlich verfügbare Viewerbreite.
- **Ganze Seite** passt die vollständige Seite in die reale Breite und Höhe ein.
- **Fenster füllen** füllt die reale Viewerfläche; überstehende Teile bleiben verschiebbar.
- Nach Vollbild-, Fenstergrößen- oder Orientierungswechseln wird weiterhin neu berechnet.

Die JavaScript-Datei des bisherigen Viewerfixes ist bytegleich übernommen. Zoom, Verschieben, Pinch-Zoom, Einzel-/Doppelseite, Miniaturen, Vollbild, Upload, Offline-Speicherung, Server-Routing und Verzeichnisbaum bleiben unverändert.

## Installation

1. ZIP entpacken.
2. Den Inhalt des entpackten Ordners in das Root-Verzeichnis des aktuellen Farbatlas-Projekts kopieren.
3. Vorhandene Dateien ersetzen.
4. Optional lokal prüfen:

   ```bash
   npm test
   ```

5. In GitHub Desktop committen, zum Beispiel mit:

   ```text
   Fix PDF viewer viewport sizing
   ```

6. **Push origin** ausführen und den Netlify-Deploy bis **Published** abwarten.
7. Die Farbatlas-Seite mit `⌘ + Shift + R` hart neu laden.

## Manueller Kurztest

1. PDF öffnen und **Breite** anklicken: Die Seite muss bis an die nutzbaren Seitenränder des PDF-Viewers reichen.
2. **Ganze Seite** anklicken: Die komplette Seite muss zentriert sichtbar sein.
3. **Fenster füllen** anklicken: Die reale Viewerfläche muss ausgefüllt werden; abgeschnittene Bereiche sind durch Ziehen/Scrollen erreichbar.
4. **Vollbild** aktivieren: Die drei Modi müssen auf Basis der nun größeren Fullscreen-Fläche neu berechnet werden.
5. Freien Zoom, Verschieben, Einzelseite/Doppelseite und Seitenwechsel kurz gegenprüfen.
