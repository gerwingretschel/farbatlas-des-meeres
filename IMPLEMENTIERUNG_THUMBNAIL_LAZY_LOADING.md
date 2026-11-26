# Umsetzungspaket: Thumbnail, Lazy Loading, Unterrichtsbild und Offline-Bibliothek

Stand: 26. November 2026

## Korrektur des Erstladefehlers

Die fehlerhafte Fassung entfernte ein sichtbares Bild bereits beim ersten Sichtbarkeitsereignis aus der Beobachtung, noch bevor der asynchrone Abruf erfolgreich abgeschlossen war. Gleichzeitig verwendete der Prefetch einen anderen Ladeweg als die sichtbare Bildkarte. Ein vorübergehender oder konkurrierender Fehler ließ dadurch den Platzhalter dauerhaft stehen. Bereits lokal gespeicherte Thumbnails waren nicht betroffen.

Die korrigierte Fassung:

- führt sichtbares Laden und Prefetch über denselben deduplizierten `assetUrl`-/In-flight-Abruf,
- priorisiert den normalen sichtbaren Abruf unabhängig von der Hintergrundwarteschlange,
- beendet die Sichtbarkeitsbeobachtung erst nach erfolgreichem Einsetzen des Thumbnails,
- versucht einen vorübergehend fehlgeschlagenen sichtbaren Abruf begrenzt erneut,
- behandelt die Browseranzeige „online/offline“ nicht mehr als verlässliche Sperre für einen möglichen Netzwerkabruf,
- verwendet weder beim sichtbaren Thumbnail-Laden noch beim Prefetch Unterrichtsbilder als Ersatz.

## Korrektur der Importintegration

Der Offline-/Mehrfachimport hatte drei miteinander verbundene Integrationsfehler:

1. Die ursprüngliche Importanzeige beschrieb nur die zuletzt ausgewählte Browser-Dateigruppe, während die nachgeschaltete Bildvorbereitung alle noch nicht übertragenen Bilder verarbeitete. Dadurch konnten gleichzeitig „4 vorbereitet“ und „1 von 1“ erscheinen.
2. Ein lokal vorbereitetes Bild ohne Server-Schlüssel fiel in der Großansicht auf den alten Darstellungsweg zurück. Damit war nicht zuverlässig garantiert, dass dort die neu erzeugte Unterrichtsversion verwendet wurde.
3. Die Zuordnung wurde nach dem Upload nicht ausdrücklich auf zwei unterschiedliche Server-Schlüssel geprüft.

Die korrigierte Fassung:

- zählt im Fortschrittsmodul den vollständigen Satz noch nicht übertragener Importbilder,
- zeigt Gesamtzahl, erfolgreich vorbereitete, ungültige und nicht lesbare Bilder konsistent an,
- verarbeitet auch während eines laufenden Vorbereitungsvorgangs hinzugekommene Importbilder,
- validiert nach der Erzeugung nochmals Unterrichtsversion und Thumbnail,
- verwendet bei lokalen Importen auf Karten ausschließlich `thumbnailBlob`/`thumbnailSrc`,
- verwendet in der Großansicht ausschließlich `teachingBlob` beziehungsweise nach dem Upload `imageKey`,
- verlangt nach dem Serverupload zwei vorhandene und unterschiedliche Schlüssel (`imageKey` und `thumbnailKey`),
- speichert beide Schlüssel anschließend gemeinsam in derselben Bildreferenz des Datensatzes.

## Robuster Offline-Speicher- und Synchronisationsablauf

Eine Netlify-Edge-Access-Seite kann bei einem nicht erreichbaren beziehungsweise erneut geschützten Deploy eine HTML-Seite statt der erwarteten JSON-Antwort liefern. Diese HTML-Antwort wurde bisher als normaler Fehlertext in den Farbatlas übernommen.

Die korrigierte Fassung:

- erkennt HTML, Login-Redirects, ungültige Serverantworten und echte Netzwerkfehler,
- zeigt niemals HTML/JavaScript der Zugangsseite im Farbatlas an,
- ersetzt dies durch eine verständliche Meldung, dass die Änderungen noch nicht synchronisiert sind,
- speichert ausstehende Änderungen dauerhaft in IndexedDB (`pending-sync`),
- bewahrt dabei neue vorbereitete Bildpaare, bereits hochgeladene aber noch nicht abschließend gespeicherte Bildpaare, Bearbeitungsdaten und offline vorgenommene Löschungen gemeinsam auf,
- lädt einen solchen lokalen Arbeitsstand nach erneutem Öffnen wieder,
- zeigt nach Rückkehr der Verbindung die Schaltfläche **„Ausstehende Änderungen synchronisieren“**,
- prüft vor der Übertragung den aktuellen Serverstand,
- sendet beim abschließenden Speichern den beim ursprünglichen Laden erhaltenen Versionsstand mit,
- lässt den Server das Speichern mit HTTP 409 ablehnen, falls der Datensatz zwischenzeitlich verändert wurde,
- überschreibt bei einem Konflikt weder den Serverstand noch den lokalen Arbeitsstand,
- lädt lokal bereits wieder gelöschte, noch nicht synchronisierte Importbilder nicht unnötig hoch.

Ein aus Unterrichtsbild und Thumbnail bestehendes Paar, das bereits hochgeladen wurde, dessen abschließende Datensatzspeicherung aber scheiterte, bleibt lokal mit beiden Schlüsseln vorgemerkt. Bei der späteren Synchronisierung wird es nicht doppelt hochgeladen.

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

3. **Vorausschauendes Laden beim Blättern**
   - Sobald ein Referenzbild in der Galerie angezeigt wird, wird ein eng begrenztes Thumbnail-Fenster im Hintergrund vorbereitet.
   - Reihenfolge und Umfang: aktuelles Vorschaubild, die nächsten fünf und die vorherigen zwei Vorschaubilder.
   - An Anfang und Ende einer Bildserie wird das Fenster automatisch gekürzt; es gibt keine doppelten Abrufe.
   - Der Vorgang beginnt erst beim Anzeigen eines Referenzbilds und verändert daher das schnelle Öffnen des Datensatzes nicht.
   - Dieser Hintergrundpfad darf ausschließlich Vorschaubilder abrufen. Fehlende Vorschaubilder lösen insbesondere keinen Abruf eines Unterrichtsbilds aus.
   - Sichtbares Lazy Loading und Hintergrund-Prefetch verwenden denselben laufenden Thumbnail-Abruf. Ein Hintergrundabruf kann das erstmalige Laden eines sichtbaren Bilds daher weder blockieren noch durch einen konkurrierenden zweiten Abruf ersetzen.
   - Erst nach erfolgreichem Laden wird ein sichtbares Bild aus der Sichtbarkeitsbeobachtung entfernt. Vorübergehende Fehler lassen den Platzhalter nicht dauerhaft stehen, sondern werden begrenzt erneut versucht.

4. **Unterrichtsbild auf Anforderung**
   - Im Normalmodus wird das Unterrichtsbild beim Öffnen der Detail-/Vollbildansicht geladen.
   - Im Datensparmodus erscheint vorher eine bewusste Schaltfläche mit der ungefähren Datenmenge.

5. **Admin-Verwaltung der Vorschaubilder**
   - Bibliothek prüfen.
   - Fehlende, veraltete und beschädigte Vorschaubilder erkennen.
   - Vorschaubilder stapelweise erzeugen oder erneuern.
   - Komprimierung bzw. Wiederherstellung eines Unterrichtsbilds markiert das zugehörige Vorschaubild als veraltet.

6. **Offline-Vorbereitung**
   - Datensparend: Texte und alle Vorschaubilder.
   - Komplett: zusätzlich alle Unterrichtsbilder.
   - Fortschritt, Abschlussmeldung und leicht verständliche Hinweise ohne technischen Fachbegriff „Browsercache“.
   - Die App-Grunddateien werden durch einen Service Worker für einen späteren Offline-Start vorbereitet.

7. **Eigene Fotos ohne Internet**
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
- `test/thumbnail-prefetch.test.mjs` – exakte Fenstergröße, Randfälle und Ausschluss von Unterrichtsbildern beim Vorladen.
- `test/thumbnail-first-load.test.mjs` – Regressionstest: ein zuvor nicht gespeichertes sichtbares Thumbnail wird erstmals vom Server geladen und ersetzt den Platzhalter.
- `test/import-pipeline.test.mjs` – Mehrfachimport, konsistente Zählung, Grenzwerte und getrennte Speicherung/Zuordnung beider Bildvarianten.
- `test/offline-sync.test.mjs` – Login-HTML-Abwehr, Offline-Import plus Offline-Löschung, fehlgeschlagener Abschluss, spätere Synchronisierung und Versionskonflikt.

## Aktualisierung auf dem bestehenden Branch

Der aktive Branch muss `feature/thumbnail-lazy-loading` sein. Bereits umgesetzte Dateien des ersten Thumbnail-Pakets bleiben die Grundlage dieser Aktualisierung.

1. ZIP-Datei entpacken.
2. Den Inhalt des Ordners `farbatlas-thumbnail-lazy-loading` in die Projektwurzel `farbatlas-des-meeres` kopieren.
3. Vorhandene Dateien ersetzen; neue Dateien und Unterordner übernehmen.
4. In GitHub Desktop kontrollieren. Für diese Erweiterung müssen insbesondere `v10-client.js`, diese Dokumentation, die Verifikationsdatei und der neue Test `test/thumbnail-prefetch.test.mjs` erscheinen.
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
- 44 Tests bestanden, 0 fehlgeschlagen.
- Build erfolgreich.

Danach in GitHub Desktop committen:

```text
Vorausschauendes Laden der Vorschaubilder
```

Anschließend `Push origin` ausführen. Erst den separaten Netlify-Branch-Deploy prüfen.

## Abnahmetest im Netlify-Branch-Deploy

1. **Rotes Meer öffnen:** Der Atlas muss nach Laden der Struktur schnell nutzbar sein; es darf keine Startschleife mit 201 Unterrichtsbildern mehr erscheinen.
2. **Admin → Vorschaubilder:** Bibliothek prüfen und anschließend alle fehlenden/veralteten Vorschaubilder erzeugen. Abschlusserwartung: alle vorhandenen Unterrichtsbilder haben ein aktuelles Vorschaubild.
3. **Neu öffnen:** Nur sichtbare Vorschaubilder sollen beim Blättern/Scrollen nachgeladen werden.
4. **Galerie-Vorladen:** Ein mittleres Referenzbild öffnen und im Netzwerkprotokoll prüfen: aktuelles Thumbnail sowie höchstens fünf folgende und zwei vorherige Thumbnails werden vorbereitet. Am Anfang und Ende der Serie muss sich das Fenster entsprechend verkürzen.
5. **Keine Unterrichtsbilder vorladen:** Während desselben Tests dürfen durch die Vorladefunktion keine benachbarten Unterrichtsbilder übertragen werden.
6. **Erstmaliges Laden:** Browserdaten für den Deploy Preview löschen oder einen neuen Browser verwenden. Eine Art mit bisher nie geladenen Vorschaubildern öffnen. Sichtbare Platzhalter müssen durch die neuen Thumbnails ersetzt werden; ein Neuladen oder vorheriges Öffnen darf nicht nötig sein.
7. **Normalmodus:** Detailansicht öffnen; genau das aktuell gewählte Unterrichtsbild soll geladen werden.
8. **Datensparmodus:** Detailansicht öffnen; das aktuelle Unterrichtsbild darf erst nach Klick auf „Großes Unterrichtsbild laden“ übertragen werden. Die vorausschauenden Thumbnail-Abrufe dürfen weiterarbeiten.
9. **Importtest:** Ein großes Smartphonefoto importieren und speichern. Danach müssen Unterrichtsbild und Vorschaubild vorhanden sein; das Original darf nicht als dritte Serverdatei gespeichert werden.
10. **Offline datensparend:** Vorbereitung bis zur Abschlussmeldung laufen lassen, Verbindung trennen, Atlas/Thumbnails/Texte prüfen.
11. **Offline komplett:** Mit einer kleinen Testbibliothek zusätzlich Detailbilder vorbereiten und offline öffnen.
12. **Offline-Foto:** Verbindung trennen, Foto importieren, Hinweis „nur auf diesem Gerät“ prüfen, Verbindung wiederherstellen und Datensatz bis zur Erfolgsmeldung speichern.
13. **Bestehende Unterrichtsbilder:** Stichproben in der Detailansicht prüfen. Die Thumbnail-Erzeugung darf sie nicht verändert haben.
14. **Mehrfachimport:** Vier neue Fotos gemeinsam auswählen. Erwartung nach der Vorbereitung: `100 % · 4 von 4 Bildern vorbereitet`, `4 ausgewählt`, `4 importiert`, sofern keine Datei ungültig oder unlesbar war.
15. **Unterrichtsversion:** Ein Smartphonefoto mit deutlich mehr als 1.600 Pixeln und mehr als 400 KB importieren. In der Großansicht und nach erneutem Öffnen des gespeicherten Datensatzes muss die Unterrichtsversion höchstens 1.600 Pixel und höchstens 400 KB haben.
16. **Getrennte Varianten:** In der Kartenansicht muss das Thumbnail verwendet werden; erst die Großansicht darf die zugehörige Unterrichtsversion laden. Im Netzwerkprotokoll müssen dafür unterschiedliche Bildschlüssel erscheinen.
17. **Offline-Import und Löschung:** Verbindung trennen, ein neues Bild importieren und mindestens ein vorhandenes Testbild löschen. „Datensatz speichern“ wählen. Erwartung: keine HTML-Ausgabe; stattdessen Hinweis, dass neues Bild und Löschung lokal erhalten und noch nicht synchronisiert sind.
18. **Wiederverbinden:** Verbindung herstellen. Erwartung: verständlicher Hinweis und Schaltfläche „Ausstehende Änderungen synchronisieren“. Nach erfolgreicher Synchronisierung den Datensatz neu öffnen: neues Bild vorhanden, offline gelöschtes Testbild nicht mehr vorhanden.
19. **Nicht erreichbarer/geschützter Deploy:** Eine HTML-Login-Antwort simulieren beziehungsweise mit aktivem Edge-Zugangsschutz testen. Im Statusbereich darf kein `<DOCTYPE>`, `<script>`, „Login Redirect“ oder Seitenquelltext erscheinen.
20. **Konfliktschutz:** Zwischen Offline-Beginn und Synchronisierung denselben Serverdatensatz in einer zweiten Sitzung verändern. Die Synchronisierung muss mit einem Konflikthinweis stoppen; weder lokaler noch neuer Serverstand darf still überschrieben werden.

Erst nach erfolgreicher Abnahme: Pull Request erstellen, Netlify Deploy Preview prüfen und anschließend nach `main` mergen.
