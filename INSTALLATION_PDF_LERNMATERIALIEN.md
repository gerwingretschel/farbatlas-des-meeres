# Farbatlas – PDF-Lernmaterialien installieren

Stand: 26. November 2026

## Enthalten

Dieses Paket ergänzt den Farbatlas um einen datensatzbezogenen Bereich **Lernmaterialien**:

- Verzeichnisbaum für PDF-Folien
- Lesen für Teilnehmer mit geöffnetem Datensatz
- Verwaltung durch Administratoren und zugewiesene Kursleiter
- Ordner anlegen, umbenennen, verschieben und rekursiv löschen
- PDF hochladen, umbenennen, verschieben und löschen
- Warnung bei mehr als 5 MB; technische Obergrenze 50 MB
- Upload und Download in 384-KB-Abschnitten mit SHA-256-Prüfung
- Lazy Loading: PDF-Daten werden beim bloßen Anzeigen des Verzeichnisses nicht geladen
- Datensparabfrage mit Dateigröße
- lokaler PDF.js-Viewer ohne CDN
- Zoomregler, Zoomtasten, Strg/Cmd + Mausrad und Zwei-Finger-Zoom
- Einseiten- und Zweiseitenansicht
- Seitenminiaturen, Seitensprung, Tastatursteuerung und Vollbild
- responsive Darstellung für Smartphone, Querformat, Tablet und Laptop
- separater Offline-Button **Lernmaterialien laden**
- PDF-Speicherung in IndexedDB mit Versions- und Prüfsummenbezug
- Bereinigung der Materialien beim Löschen eines Datensatzes
- getrenntes Material-Auditprotokoll

Der bestehende KL-Inhaltsspeicherpfad (`captureBaseline`, `datasetRecordKeys`, `collectCourseChanges`) wird nicht verändert.

## Installation über GitHub Desktop

1. ZIP entpacken.
2. Den Inhalt des Ordners `Farbatlas_PDF_Lernmaterialien_2026-11-26` in das Root-Verzeichnis des Farbatlas-Branches kopieren.
3. Vorhandene Dateien ersetzen lassen.
4. In GitHub Desktop prüfen, dass ausschließlich die im Abschnitt **Dateien** genannten Projektdateien sowie die Dokumentation hinzukommen beziehungsweise geändert werden.
5. Optional im Terminal in der Projektwurzel ausführen:

```bash
npm test
npm run check
npm run build
```

6. Commit-Vorschlag:

```text
Add offline PDF learning materials library
```

7. Pushen und die Netlify Deploy Preview abwarten.

## Alternative Installation als Patch

In der Projektwurzel:

```bash
git apply --check FARBATLAS_PDF_LERNMATERIALIEN_2026-11-26.patch
git apply FARBATLAS_PDF_LERNMATERIALIEN_2026-11-26.patch
npm test
npm run check
npm run build
```

Nicht gleichzeitig Dateien kopieren **und** den Patch anwenden.

## Netlify

Es sind keine neuen Environment Variables erforderlich. Die Funktion verwendet vier neue Netlify-Blob-Stores:

- `farbatlas-material-manifests-v1`
- `farbatlas-material-files-v1`
- `farbatlas-material-uploads-v1`
- `farbatlas-material-audit-v1`

PDF.js 5.4.296 liegt vollständig lokal in `vendor/pdfjs/`; zur Laufzeit wird kein CDN benötigt.

## Empfohlener Abnahmetest in der Deploy Preview

1. Als Administrator oder KL anmelden und einen Datensatz öffnen.
2. **Lernmaterialien** öffnen.
3. Ordner und Unterordner anlegen.
4. Eine PDF unter 5 MB und eine PDF über 5 MB auswählen; die zweite muss eine Warnung anzeigen.
5. PDF hochladen und anschließend als Teilnehmer öffnen.
6. Prüfen: Zoom, Touch-Zoom, Vollbild, Ein-/Zweiseitenansicht, Miniaturen und Seitensprung.
7. Datensparmodus aktivieren und eine noch nicht lokal gespeicherte PDF öffnen; Dateiname und Größe müssen vor dem Laden bestätigt werden.
8. **Lernmaterialien laden** ausführen.
9. Browser offline schalten und die vorbereitete PDF erneut öffnen.
10. Eine nicht vorbereitete PDF offline öffnen; es muss eine verständliche Meldung erscheinen.
11. Bestehenden KL-Test wiederholen: genau eine Tierdatenänderung speichern, neu anmelden und Persistenz prüfen.

## Dateien

Geändert:

- `farbatlas-sw.js`
- `inject-v10.mjs`
- `netlify/functions/farbatlas.mjs`
- `package.json`
- `test/import-offline-merged.test.mjs`

Neu:

- `learning-materials-client.js`
- `learning-materials-viewer.js`
- `learning-materials.css`
- `netlify/functions/lib/material-utils.mjs`
- `test/material-utils.test.mjs`
- `test/learning-materials-integration.test.mjs`
- `vendor/pdfjs/pdf.mjs`
- `vendor/pdfjs/pdf.worker.mjs`
- `vendor/pdfjs/LICENSE`
