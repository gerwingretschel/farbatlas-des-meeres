# Umsetzungspaket: Thumbnail, Lazy Loading, Unterrichtsbild und Offline-Bibliothek

Stand: 26. November 2026

## Verbindliche Bildarchitektur

- **Unterrichtsbild:** JPEG, längste Kante höchstens 1.600 px, höchstens 400 KB, keine Hochskalierung.
- **Vorschaubild:** JPEG, längste Kante 480 px (serverseitig bis höchstens 500 px akzeptiert), Ziel 30–80 KB, harte Obergrenze 90 KB.
- **Originalfoto:** wird nicht an den Server übertragen. Es verbleibt auf dem Gerät.
- Beim neuen Import werden Unterrichtsbild und Vorschaubild vor der Übertragung automatisch erzeugt.
- Bestehende Unterrichtsbilder werden bei der Thumbnail-Erzeugung nur gelesen. Sie werden dabei weder ersetzt noch gelöscht.

## Enthaltene Funktionen

1. **Metadaten-Start statt Vollbild-Start**
   - Beim Öffnen eines Datensatzes werden nur Struktur, Texte und Bildschlüssel geladen.
   - Unterrichtsbilder werden nicht mehr in einer Startschleife heruntergeladen.

2. **Lazy Loading**
   - Vorschaubilder werden erst geladen, wenn eine Bildkarte sichtbar wird oder kurz davor ist.
   - Suche, Atlas und Lernmodus verwenden Vorschaubilder.

3. **Unterrichtsbild auf Anforderung**
   - Im Normalmodus wird das Unterrichtsbild beim Öffnen der Detail-/Vollbildansicht geladen.
   - Im Datensparmodus erscheint vorher eine bewusste Schaltfläche mit der ungefähren Datenmenge.

4. **Admin-Verwaltung der Vorschaubilder**
   - Bibliothek prüfen.
   - Fehlende, veraltete und beschädigte Vorschaubilder erkennen.
   - Vorschaubilder stapelweise erzeugen oder erneuern.
   - Komprimierung bzw. Wiederherstellung eines Unterrichtsbilds markiert das zugehörige Vorschaubild als veraltet.

5. **Offline-Vorbereitung**
   - Datensparend: Texte und alle Vorschaubilder.
   - Komplett: zusätzlich alle Unterrichtsbilder.
   - Fortschritt, Abschlussmeldung und leicht verständliche Hinweise ohne technischen Fachbegriff „Browsercache“.
   - Die App-Grunddateien werden durch einen Service Worker für einen späteren Offline-Start vorbereitet.

6. **Eigene Fotos ohne Internet**
   - Neue Fotos werden lokal als Unterrichtsbild und Vorschaubild vorbereitet.
   - Sie werden deutlich als „noch nicht übertragen“ angezeigt.
   - Nach Wiederherstellung der Verbindung muss derselbe Datensatz gespeichert und die Erfolgsmeldung abgewartet werden.

## Dateien des Pakets

- `v10-client.js` – ersetzt den bisherigen V10-Client durch die V11-Bildarchitektur.
- `farbatlas-sw.js` – neue Offline-Grunddatei.
- `image-compression-client.js` – lädt für die administrative Prüfung ausdrücklich Unterrichtsbilder und markiert Vorschaubilder nach Änderungen als veraltet.
- `netlify/functions/farbatlas.mjs` – neue Endpunkte und serverseitige Schutzregeln.
- `netlify/functions/lib/thumbnail-utils.mjs` – gemeinsame Validierung und Statuslogik.
- `package.json` – erweiterte Syntaxprüfung.
- `test/image-compression-integration.test.mjs` – Regressionstest: Öffnen lädt nur Metadaten.
- `test/thumbnail-utils.test.mjs` – Grenzwert- und Statusprüfungen.
- `test/thumbnail-integration.test.mjs` – Integrations- und Sicherheitsprüfungen.

## Installation auf dem vorbereiteten Branch

Der aktive Branch muss `feature/thumbnail-lazy-loading` sein und vor dem Kopieren **0 changed files** anzeigen.

1. ZIP-Datei entpacken.
2. Den Inhalt des Ordners `farbatlas-thumbnail-lazy-loading` in die Projektwurzel `farbatlas-des-meeres` kopieren.
3. Vorhandene Dateien ersetzen; neue Dateien und Unterordner übernehmen.
4. In GitHub Desktop kontrollieren, dass ausschließlich die oben genannten Projektdateien sowie diese Dokumentation/Testdateien geändert oder neu sind.
5. Noch nicht nach `main` mergen.

## Lokale Prüfung

Im Terminal der Projektwurzel:

```bash
npm install
npm run check
npm test
npm run build
```

Erwartung:

- Syntaxprüfung ohne Fehler.
- 27 Tests bestanden, 0 fehlgeschlagen.
- Build erfolgreich.

Danach in GitHub Desktop committen:

```text
Thumbnail, Lazy Loading und Offline-Bibliothek
```

Anschließend `Push origin` ausführen. Erst den separaten Netlify-Branch-Deploy prüfen.

## Abnahmetest im Netlify-Branch-Deploy

1. **Rotes Meer öffnen:** Der Atlas muss nach Laden der Struktur schnell nutzbar sein; es darf keine Startschleife mit 201 Unterrichtsbildern mehr erscheinen.
2. **Admin → Vorschaubilder:** Bibliothek prüfen und anschließend alle fehlenden/veralteten Vorschaubilder erzeugen. Abschlusserwartung: alle vorhandenen Unterrichtsbilder haben ein aktuelles Vorschaubild.
3. **Neu öffnen:** Nur sichtbare Vorschaubilder sollen beim Blättern/Scrollen nachgeladen werden.
4. **Normalmodus:** Detailansicht öffnen; genau das gewählte Unterrichtsbild soll geladen werden.
5. **Datensparmodus:** Detailansicht öffnen; das Unterrichtsbild darf erst nach Klick auf „Großes Unterrichtsbild laden“ übertragen werden.
6. **Importtest:** Ein großes Smartphonefoto importieren und speichern. Danach müssen Unterrichtsbild und Vorschaubild vorhanden sein; das Original darf nicht als dritte Serverdatei gespeichert werden.
7. **Offline datensparend:** Vorbereitung bis zur Abschlussmeldung laufen lassen, Verbindung trennen, Atlas/Thumbnails/Texte prüfen.
8. **Offline komplett:** Mit einer kleinen Testbibliothek zusätzlich Detailbilder vorbereiten und offline öffnen.
9. **Offline-Foto:** Verbindung trennen, Foto importieren, Hinweis „nur auf diesem Gerät“ prüfen, Verbindung wiederherstellen und Datensatz bis zur Erfolgsmeldung speichern.
10. **Bestehende Unterrichtsbilder:** Stichproben in der Detailansicht prüfen. Die Thumbnail-Erzeugung darf sie nicht verändert haben.

Erst nach erfolgreicher Abnahme: Pull Request erstellen, Netlify Deploy Preview prüfen und anschließend nach `main` mergen.
