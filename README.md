# Farbatlas des Meeres – Kursleiter-Arbeitsversion (Phase 1)

Dieses Upgrade baut auf V10 auf und lässt die bestehenden V10-Datensätze und Bildspeicher unverändert.

## Neu

- Rolle `courseLeader` mit eigenem Login und achtstündiger Sitzung
- Administratorverwaltung für Kursleiterkonten
- Datensatzzuweisungen und getrennte Einzelrechte
- Bearbeitung von Wissenstexten und akademischen Links
- serverseitige Rechteprüfung für jede Änderung
- atomare Versionskontrolle mit Netlify-Blob-ETags
- Konfliktdialog mit Server- und eigener Fassung
- Änderungsprotokoll mit Vorher-/Nachher-Version
- Wiederherstellung einer früheren eigenen Fassung
- Sperren, Ablaufdatum, Passwort-Reset und sofortiger Sitzungsentzug
- Anmelde-Drosselung und HTML-/URL-Validierung

## Unverändert

- bestehende Stores `farbatlas-datasets-v10` und `farbatlas-images-v10`
- Atlas, Suche, Lernmodus und Administratorfunktionen
- getrennte V10-Bildspeicherung

## Vor dem Deploy

Die Schritte in `IMPLEMENTIERUNG_KURSLEITER_ARBEITSVERSION.md` durchführen. Insbesondere müssen eine Sicherung, `SESSION_SECRET` und ein kontrollierter Staging-Test erfolgen.

## Lokale Prüfung

```bash
npm install
npm run check
npm test
npm run build
```
