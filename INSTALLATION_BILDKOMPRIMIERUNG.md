# Farbatlas – administrative Bildprüfung mit reversibler Komprimierung

Version 1.0 · 25. November 2026

## Zweck

Die Erweiterung ergänzt den Administrator-Modus um den Bereich:

> **🗜️ Bilder prüfen, komprimieren & wiederherstellen**

Sie prüft **alle Bilder des aktuell geladenen Datensatzes** und verarbeitet nur Bilder, die mindestens eine Regel nicht erfüllen:

- Ausgabeformat JPEG
- höchstens 400 KB je Bild
- bevorzugt 300–400 KB, soweit das Motiv dies bei hoher Qualität benötigt
- längste Kante höchstens 1.600 Pixel
- keine künstliche Vergrößerung
- bereits passende JPEGs bleiben unverändert

## Enthaltene Dateien

Diese Dateien werden in das Root-Verzeichnis des bestehenden Projekts kopiert:

```text
image-compression-client.js
inject-v10.mjs
package.json
netlify/functions/farbatlas.mjs
netlify/functions/lib/image-compression-utils.mjs
test/image-compression-utils.test.mjs
```

Die Erweiterung setzt die bereits produktive V10-Bildspeicherung und die Kursleiter-Arbeitsversion voraus.

## Sichere Installation

1. Aktuellen Projektordner zusätzlich sichern.
2. In GitHub Desktop vom aktuellen `main` einen neuen Branch anlegen, zum Beispiel:

   ```text
   feature/admin-image-compression
   ```

3. Den **Inhalt** dieses Upgrade-Ordners in das Root-Verzeichnis von `farbatlas-des-meeres` kopieren. Gleichnamige Dateien ersetzen, andere Dateien nicht löschen.
4. Im Projektordner ausführen:

   ```bash
   npm run check
   npm test
   npm run build
   ```

   Falls `node_modules` noch nicht vorhanden ist, vorher einmal `npm install` ausführen.
5. Änderungen kontrollieren. Erwartet werden genau die oben genannten neuen oder geänderten Dateien; durch `npm run build` wird `index.html` einmalig um den Script-Verweis auf `image-compression-client.js` ergänzt.
6. Zunächst als Netlify Branch Deploy oder Deploy Preview veröffentlichen. `ADMIN_PASSWORD` und `SESSION_SECRET` bleiben unverändert erforderlich.

## Empfohlener Abnahmetest

1. Einen kleinen Testdatensatz öffnen.
2. Als Administrator anmelden.
3. **Bilder prüfen, komprimieren & wiederherstellen** öffnen.
4. **Alle Bilder prüfen & Vorschau** wählen.
5. Prüfergebnis und bis zu drei Vorher-/Nachher-Vorschauen kontrollieren.
6. **Alle vorgeschlagenen Bilder sicher komprimieren** wählen und zur Bestätigung den Datensatznamen exakt eingeben.
7. Mehrere Bilder im Atlas in Normalansicht und Vergrößerung prüfen.
8. Beim erzeugten Sicherungsstand **Sicherungsstand wiederherstellen** wählen und exakt `WIEDERHERSTELLEN` eingeben.
9. Datensatz neu öffnen und kontrollieren, dass die Ausgangsbilder wieder vorhanden sind.

Erst danach den großen produktiven Datensatz verarbeiten.

## Rückgängig- und Schutzkonzept

Vor jedem Austausch wird das aktuelle Serverbild bytegenau im Netlify-Blob-Speicher

```text
farbatlas-image-backups-v1
```

gesichert. Erst nach erfolgreicher Sicherung wird das Bild unter **demselben Bildschlüssel** ersetzt. Dadurch bleiben Taxonomie, Wissenstexte, Titelbilder und Bildzuordnungen unberührt.

Jeder Lauf besitzt einen eigenen Sicherungsstand. Beim Wiederherstellen gelten folgende Regeln:

- Die Prüfsumme der Originalsicherung muss stimmen.
- Nur das durch genau diesen Lauf erzeugte komprimierte Bild wird überschrieben.
- Ein später anderweitig geändertes Bild wird konfliktgeschützt übersprungen.
- Bereits wiederhergestellte Bilder werden idempotent erkannt.
- Sicherungen werden nach der Wiederherstellung nicht automatisch gelöscht.
- Ein Lauf kann nach dem aktuellen Bild angehalten und später fortgesetzt werden.

## Bedienung des produktiven Datensatzes

- Stabile Internetverbindung und Stromversorgung sicherstellen.
- Den gewünschten Datensatz zuerst normal öffnen; erst danach als Administrator anmelden.
- Die Prüfung verändert noch keine Dateien.
- Bei nicht lesbaren Bildern startet die Sammelkomprimierung nicht.
- Während eines Laufs das Browserfenster geöffnet lassen oder über **Nach aktuellem Bild anhalten** sicher pausieren.
- Nach Abschluss mindestens zehn unterschiedliche Bilder auf einem typischen Tablet oder Netbook vergrößert prüfen.
- Wenn feine Bestimmungsmerkmale nicht ausreichen, den Sicherungsstand vollständig wiederherstellen.

## Technische Verifikation

Der Lieferstand wurde geprüft mit:

- Syntaxprüfung aller neuen und geänderten JavaScript-/MJS-Dateien
- 14 von 14 Unit-Tests bestanden
- wiederholbare Build-Injektion ohne doppelte Script-Verweise
- vollständiger Server-Rundlauf mit Testbild: 800.000 Byte → 350.000 Byte → Wiederherstellung
- bytegenaue Gleichheit des wiederhergestellten Testbilds
