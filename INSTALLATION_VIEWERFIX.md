# Installation: PDF-Viewerfix (26.11.2026)

## Zweck

Dieser gezielte Fix korrigiert ausschließlich Darstellung und Bedienung des PDF-Viewers:

- PDF wird beim Öffnen als ganze Seite zentriert angezeigt.
- **Breite**, **Ganze Seite** und **Fenster füllen** berechnen jeweils eine echte neue Zoomstufe.
- **Vollbild** ist eindeutig beschriftet und nutzt die Browser-Vollbildfunktion.
- Der freie Zoom reicht von 15 % bis 600 %.
- Vergrößerte Seiten können mit Maus oder Finger verschoben werden.
- Die Einzel-/Doppelseitenansicht ist eindeutig als aktueller Ansichtsmodus beschriftet.
- Die Hierarchie-Korrektur des Lernmaterial-Verzeichnisbaums bleibt in `learning-materials.css` erhalten.

Server-Routing, Upload, Offline-Speicherung und der KL-Tierdaten-Speicherpfad werden nicht verändert.

## Installation

1. ZIP entpacken.
2. Den Inhalt des entpackten Ordners in das Root-Verzeichnis des aktuellen Farbatlas-Projekts kopieren.
3. Die vorhandenen Dateien ersetzen:
   - `learning-materials-viewer.js`
   - `learning-materials.css`
4. Optional lokal prüfen:

   ```bash
   npm test
   ```

5. In GitHub Desktop committen, zum Beispiel mit:

   ```text
   Fix PDF viewer centering and fit controls
   ```

6. **Push origin** ausführen und den Netlify-Deploy bis **Published** abwarten.
7. Die Farbatlas-Seite mit `⌘ + Shift + R` hart neu laden.

## Manueller Kurztest

1. Eine PDF öffnen: Standard ist **Ganze Seite**, horizontal und vertikal zentriert.
2. **Breite** klicken: Die Seite nutzt die verfügbare Breite.
3. **Ganze Seite** klicken: Die komplette Seite wird wieder sichtbar.
4. **Fenster füllen** klicken: Der PDF-Inhalt füllt die Viewerfläche; Randbereiche sind durch Ziehen/Scrollen erreichbar.
5. Zoomregler bzw. `+` bis über 100 % verwenden: Nur ein Ausschnitt ist sichtbar und lässt sich verschieben.
6. **Vollbild** aktivieren und wieder beenden.
7. Auf Smartphone/Tablet im Hoch- und Querformat Pinch-Zoom und Verschieben prüfen.
8. **Ansicht: Einzelseite/Doppelseite** umschalten.
