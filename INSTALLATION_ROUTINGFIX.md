# Farbatlas – Routingfix für Lernmaterialien

Stand: 26. November 2026

## Behobener Fehler

Beim Öffnen des Bereichs **Lernmaterialien** meldete die veröffentlichte Version **„Unbekannte Aktion.“**. Die Leseaktionen `material-list` und `material-download-chunk` waren versehentlich innerhalb der Hilfsfunktion zur Datensatz-Authentifizierung platziert. Der zentrale Request-Handler konnte diese Aktionen deshalb nicht erreichen.

Der Fix verschiebt ausschließlich diese beiden Lese-Routen in den zentralen Request-Handler – vor die Anmeldungspflicht für schreibende Verwaltungsaktionen. Damit funktionieren:

- Administratoren mit Admin-Sitzung,
- zugewiesene Kursleiter mit KL-Sitzung und
- Teilnehmer mit geöffnetem Datensatz und Datensatzpasswort.

Nicht verändert werden der KL-Tierdaten-Speicherpfad (`captureBaseline`, `datasetRecordKeys`, `collectCourseChanges`), der PDF-Upload, die Materialverwaltung, der Viewer und die Offline-Speicherung.

## Installation über GitHub Desktop

1. ZIP entpacken.
2. Den **Inhalt** des Ordners `Farbatlas_PDF_Lernmaterialien_Routingfix_2026-11-26` in das Root-Verzeichnis des Farbatlas-Projekts kopieren.
3. Die beiden vorhandenen Projektdateien ersetzen lassen:
   - `netlify/functions/farbatlas.mjs`
   - `test/learning-materials-integration.test.mjs`
4. In GitHub Desktop prüfen, dass nur diese beiden Projektdateien sowie die beigefügte Dokumentation neu/geändert sind.
5. Commit-Vorschlag:

```text
Fix learning materials API routing
```

6. Committen und **Push origin** ausführen.
7. Den Netlify-Deploy bis **Published** abwarten.

## Alternative: Patch anwenden

In der Projektwurzel:

```bash
git apply --check FARBATLAS_PDF_LERNMATERIALIEN_ROUTINGFIX_2026-11-26.patch
git apply FARBATLAS_PDF_LERNMATERIALIEN_ROUTINGFIX_2026-11-26.patch
```

Nicht gleichzeitig Dateien kopieren und den Patch anwenden.

## Direkter Abnahmetest

1. Farbatlas nach dem veröffentlichten Deploy hart neu laden.
2. Als Administrator anmelden.
3. **Rotes Meer** öffnen.
4. **Lernmaterialien** öffnen.
5. Erwartung: keine Meldung „Unbekannte Aktion.“; stattdessen wird ein leeres oder vorhandenes Materialverzeichnis angezeigt.
6. Danach einen Ordner anlegen und erst anschließend eine kleine PDF hochladen.
