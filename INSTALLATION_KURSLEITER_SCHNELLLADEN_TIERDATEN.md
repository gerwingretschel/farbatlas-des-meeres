# Kursleiter: Schnellladen, Datensatz speichern und feldgenaue Tierdatenrechte

## Inhalt

Dieses Umsetzungspaket erweitert den Kursleiter-Modus um:

- die vorhandene V11-Schnellladefunktion (Struktur und Vorschaubilder zuerst; Unterrichtsbilder erst bei Bedarf),
- einen klar bezeichneten Button **„Datensatz speichern“**,
- das Bearbeiten-Symbol auf Tierkarten,
- das einheitliche Formular **„Tierdaten bearbeiten“** für Administrator und Kursleiter,
- sichtbare, aber gesperrte Felder ohne Freigabe,
- einzeln zuweisbare Rechte für Familie, Gattung, Art, deutschen Namen, englischen Namen, Fundort, Beschreiber, Tiergruppe und Wissenstext,
- serverseitige Durchsetzung aller Feldrechte,
- Konflikterkennung, Änderungsprotokoll und Wiederherstellung auch für Tierdatenfelder.

Kursleiter können weiterhin ausschließlich Datensätze öffnen und speichern, die ihnen durch den Administrator zugewiesen wurden.

## Enthaltene Dateien

- `course-leader-client.js`
- `v10-client.js`
- `netlify/functions/farbatlas.mjs`
- `netlify/functions/lib/course-utils.mjs`
- `test/course-utils.test.mjs`
- `test/course-leader-ui-integration.test.mjs`
- `VERIFICATION_KURSLEITER_SCHNELLLADEN_TIERDATEN.txt`

## Installation

1. ZIP-Datei entpacken.
2. Den gesamten Inhalt des entpackten Ordners in das Root-Verzeichnis des aktuellen Farbatlas-Branches kopieren.
3. Vorhandene Dateien mit denselben Namen ersetzen; die Ordnerstruktur beibehalten.
4. Im Projektordner ausführen:

   ```bash
   npm install
   npm run check
   npm test
   ```

5. Erwartetes Ergebnis: Syntaxprüfung erfolgreich und **56 von 56 Tests bestanden**.
6. Änderungen committen und zum Feature-Branch pushen.
7. Den Netlify Deploy Preview abwarten und die Funktionsprüfung durchführen.

## Wichtiger Hinweis zu bestehenden Kursleiterkonten

Bestehende Konten behalten ihre bisherigen Rechte für Wissenstexte und akademische Links. Die neuen Tierdatenrechte werden aus Sicherheitsgründen nicht automatisch aktiviert. Der Administrator muss die gewünschten Felder beim jeweiligen Kursleiterkonto ausdrücklich anhaken und speichern.

## Funktionsprüfung im Deploy Preview

### Als Administrator

1. Administrator-Modus öffnen.
2. „Kursleiterkonten & Änderungsprotokoll“ öffnen.
3. Ein Kursleiterkonto bearbeiten.
4. Einen Datensatz zuweisen.
5. Nur ausgewählte Tierdatenfelder freigeben, zum Beispiel „Deutscher Name“, „Fundort“ und „Wissenstexte“.
6. Konto speichern.

### Als Kursleiter

1. Als Kursleiter anmelden.
2. Den zugewiesenen Datensatz öffnen.
3. Prüfen, dass die Karten schnell erscheinen und große Unterrichtsbilder nicht vollständig vorab geladen werden.
4. Auf einer Tierkarte das Bearbeiten-Symbol `✎` wählen.
5. Prüfen, dass alle Felder sichtbar sind.
6. Prüfen, dass nur die vom Administrator freigegebenen Felder bearbeitbar sind.
7. Wissenstext im selben Formular bearbeiten und „Lokal übernehmen“ wählen.
8. „Datensatz speichern“ wählen.
9. Datensatz neu öffnen und die gespeicherten Werte kontrollieren.
10. Einen nicht zugewiesenen Datensatz prüfen: Der Server muss den Zugriff weiterhin verweigern.

### Konfliktprüfung

1. Dasselbe freigegebene Feld in zwei Sitzungen öffnen.
2. In Sitzung A ändern und speichern.
3. In Sitzung B einen abweichenden Wert speichern.
4. Prüfen, dass die Konfliktauswahl erscheint und keine Fassung still überschrieben wird.

## Rücknahme

Zur Rücknahme die sechs ersetzten Quell- und Testdateien aus dem vorherigen Git-Commit wiederherstellen. Es werden keine neuen Netlify-Umgebungsvariablen und keine Datenmigration benötigt.
