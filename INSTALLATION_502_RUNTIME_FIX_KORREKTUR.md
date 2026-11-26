# Korrigierter HTTP-502-Fix

## Tatsächliche Ursache

Der erste Fix griff zu spät. Die Netlify Function scheiterte bereits beim Laden des Moduls, bevor der Request-Handler und dessen Fehlerbehandlung ausgeführt wurden.

Im letzten funktionierenden Stand enthielt die Root-`package.json`:

```json
"dependencies": {
  "@netlify/blobs": "^10.7.11"
}
```

Im PDF-Viewer-Stand wurde die Root-`package.json` unbeabsichtigt durch eine reine Viewer-Testkonfiguration ersetzt. Dabei gingen die produktive Abhängigkeit `@netlify/blobs`, die Node-Engine und die regulären Build-/Prüfskripte verloren. `netlify/functions/farbatlas.mjs` importiert `@netlify/blobs` jedoch beim Modulstart. Kann Netlify dieses Paket nicht auflösen, endet jeder Function-Aufruf mit HTTP 502 - also Admin-Login, Kursleiter-Login und Datensatzöffnung gleichermaßen.

## Installation

Dieses Paket ist die Korrektur für den bereits installierten ersten 502-Fix.

1. Den Inhalt des entpackten Ordners in das Root-Verzeichnis des aktuellen Farbatlas-Projekts kopieren.
2. Die vorhandene Root-Datei `package.json` ersetzen.
3. `package-lock.json` **nicht löschen und nicht ersetzen**. Sie war laut beiden Audits unverändert und stammt aus dem funktionierenden Stand.
4. Die neue Testdatei unter `test/` mitkopieren.
5. Commit-Summary:

```text
Restore Netlify runtime dependency for login
```

6. Pushen.
7. In Netlify keinen gewöhnlichen Retry verwenden, sondern einen neuen Deploy **mit geleertem Build-Cache** auslösen (`Clear cache and deploy site` beziehungsweise `Retry with cleared cache`). Dadurch wird `@netlify/blobs` sicher neu aus `package.json` und `package-lock.json` installiert und in die Function gebündelt.

## Prüfung nach dem Deploy

1. Deploy muss `Published` sein.
2. Hard Reload im Browser.
3. Kursleiter-Login prüfen.
4. Abmelden und Admin-Login prüfen.
5. Datensatz `Rotes Meer` öffnen.
6. Erst danach den PDF-Viewer weiter testen.

## Optional lokal

Nach `npm ci` oder `npm install`:

```bash
npm run build
npm run check
node --test test/function-startup.test.mjs test/lazy-stores.test.mjs
```

## Scope

Geändert werden ausschließlich:

- Root-`package.json`
- neuer Deployment-Starttest `test/function-startup.test.mjs`

Nicht geändert werden PDF-Viewer, Viewport-CSS, Lernmaterial-Client, Datensatzdaten, KL-Rechte, Bildlogik oder sonstige Farbatlas-Funktionen.
