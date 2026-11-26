# Installation: Login- und Datensatz-502-Fix

## Behobener Fehler

Admin-Login und Datensatzöffnung konnten gemeinsam mit HTTP 502 abbrechen, weil die Serverfunktion vor der Aktionsauswahl alle Netlify-Blob-Stores sofort initialisierte. Damit konnte ein Problem eines nicht benötigten Stores auch unabhängige Aktionen wie `admin-login` oder `load` beenden, bevor die vorhandene Fehlerbehandlung aktiv war.

Der Fix verschiebt die Store-Erzeugung in den geschützten Request-Pfad und initialisiert jeden Store erst bei seiner ersten tatsächlichen Verwendung. Nicht benötigte Lernmaterial-, Bild-, Audit- oder Upload-Stores werden für Login und Datensatzöffnung nicht mehr geöffnet.

## Installation über Kopieren

1. Den Inhalt dieses Ordners in das Root-Verzeichnis des aktuellen Farbatlas-Projekts kopieren.
2. Vorhandene Datei `netlify/functions/farbatlas.mjs` ersetzen.
3. Die neuen Dateien unter `netlify/functions/lib/` und `test/` mitkopieren.
4. Optional lokal prüfen:

```bash
node --check netlify/functions/farbatlas.mjs
node --check netlify/functions/lib/lazy-stores.mjs
node --test test/lazy-stores.test.mjs
```

## Alternative Installation als Patch

```bash
git apply --check FARBATLAS_LOGIN_DATENSATZ_502_FIX_2026-11-26.patch
git apply FARBATLAS_LOGIN_DATENSATZ_502_FIX_2026-11-26.patch
```

## Commit

```text
Fix login and dataset loading 502
```

Danach pushen und den Netlify-Deploy bis `Published` abwarten.

## Browserprüfung

1. Hard Reload ausführen.
2. Als Administrator anmelden.
3. Abmelden.
4. Datensatz `Rotes Meer` mit dem Datensatzpasswort öffnen.
5. Optional als Kursleiter anmelden und den zugewiesenen Datensatz öffnen.
6. Prüfen, dass keine Meldung `HTTP 502` beziehungsweise `Serverfehler 502` mehr erscheint.

## Nicht verändert

- PDF-Viewer und Viewport-CSS
- PDF-Upload, Lernmaterial-Routing und Offline-Speicherung
- Datensatzinhalte und Passwörter
- KL-Rechte, KL-Editierfunktion und KL-Speicherpfad
- Bild-, Thumbnail- und Komprimierungslogik
