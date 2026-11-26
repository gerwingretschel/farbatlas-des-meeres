# Farbatlas – gezielter KL-Editierfix

## Zweck

Dieser Patch repariert ausschließlich den Klick auf das orange Bearbeiten-Symbol (`.move`) im Kursleiter-Modus.

Der bereits eingebaute KL-Speicherfix (`datasetRecordKeys` und `collectCourseChanges()`) wird nicht verändert.

## Ursache

Die Bildkarten erhalten ihren ursprünglichen Klick-Handler bei jedem `rebuild()`/`bindPhotos()` neu. Die bisherige KL-Lösung überschreibt dafür die globale Editorfunktion indirekt. Diese Kopplung ist im aktuellen Lade- und Neuaufbaupfad nicht zuverlässig; der sichtbare KL-Bearbeiten-Button kann deshalb ohne Wirkung bleiben.

## Änderung

- Ein eigener KL-Klick-Handler wird einmalig in der Capture-Phase registriert.
- Er reagiert ausschließlich auf das orange Bearbeiten-Symbol (`.move`).
- Er greift nur bei aktiver Kursleiter-Sitzung und nicht im Administrator-Modus.
- Er ermittelt den aktuell gerenderten Datensatz-Eintrag und öffnet direkt den bereits vorhandenen, rechtegeprüften `openCourseRecordEditor(record)`.
- Fehlt der KL-Datensatzkontext oder der Eintrag, erscheint eine verständliche Fehlermeldung statt eines wirkungslosen Klicks.
- Die Speicher-, Sammel- und Serverlogik bleibt unangetastet.

## Anwendung

ZIP in die Projektwurzel entpacken und dort ausführen:

```bash
git apply --check FARBATLAS_KL_EDITIERFIX_2026-11-26.patch
git apply FARBATLAS_KL_EDITIERFIX_2026-11-26.patch
npm test
npm run check
```

Danach committen, pushen und die Deploy Preview abwarten.

## Gezielter Browsertest

1. Als Kursleiter anmelden.
2. Den zugewiesenen Datensatz ausdrücklich über den Kursleiter-Bereich öffnen.
3. Zu einer Bildkarte navigieren.
4. Das orange Bearbeiten-Symbol anklicken.
5. Erwartung: Der Dialog „Tierdaten bearbeiten“ öffnet sich sofort.
6. Ein freigegebenes Feld ändern und „Lokal übernehmen“ wählen.
7. „Datensatz speichern“ wählen.
8. Erwartung: Bei genau einer Änderung wird genau eine Änderung geprüft und gespeichert.
9. Abmelden, erneut als derselbe Kursleiter anmelden und den Datensatz neu öffnen.
10. Erwartung: Die Änderung bleibt erhalten.
