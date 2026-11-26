# Farbatlas Admin-Bildkomprimierung 1.1

## Behobener Integrationsfehler

Im ersten Paket konnte der neue Administrationsbereich einen bereits über V10 geöffneten Datensatz als „nicht geöffnet“ einstufen. Ursache war eine getrennte Zustandsführung:

- V10 speicherte den Namen nur in `v10Name`.
- Die übrige Anwendung erwartete `currentDatasetName`.
- Die Komprimierungsfunktion prüfte nur diesen leeren Wert.
- Die Admin-Erkennung griff direkt auf `adminToken` zu, statt auf die bereits gespeicherte Sitzung.

## Änderungen

- Gemeinsame Laufzeit-Schnittstelle `window.FarbatlasRuntime.getDataset()`
- Synchronisierung von Datensatzname, Ladezustand, Bildliste, Anzeige und Cache
- Ereignis `farbatlas:dataset-changed` nach Öffnen oder Speichern
- Kompatible Erkennung des bisherigen V10-Zustands
- Admin-Erkennung über `sessionStorage/farbatlasAdminTokenV09`
- Automatische Aktualisierung bei Datensatz- und Admin-Statuswechsel
- Drei zusätzliche Integrationstests

## Aktualisierung von Version 1.0

Den Inhalt dieses Pakets erneut in das Root-Verzeichnis kopieren und alle gleichnamigen Dateien ersetzen. Besonders wichtig sind:

```text
v10-client.js
image-compression-client.js
```

Danach erneut ausführen:

```bash
npm run check
npm test
npm run build
```

Anschließend committen und den Netlify Deploy Preview neu bauen lassen. Nach dem Neuladen zuerst den Datensatz öffnen, dann den Admin-Modus aktivieren und den Komprimierungsbereich aufklappen. Die Sicherungsstände müssen nun ohne den bisherigen Hinweis geladen werden; „Alle Bilder prüfen & Vorschau“ muss die geladene Bildanzahl verarbeiten.
