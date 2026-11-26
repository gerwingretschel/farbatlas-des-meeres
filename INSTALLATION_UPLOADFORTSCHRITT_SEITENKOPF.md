# Installation: PDF-Uploadfortschritt und Seitenkopf beim Seitenwechsel

Grundlage: `Farbatlas_des_Meeres_Audit_2026-11-26_200254.txt`.

## Enthaltene Änderungen

### 1. Sichtbarer PDF-Uploadverlauf

Beim Auswählen einer oder mehrerer PDF-Dateien erscheint im Bereich **Lernmaterialien** ein eigener Uploadverlauf mit:

- Gesamtfortschritt in Prozent,
- einer Fortschrittszeile pro PDF,
- Dateiname und Dateigröße,
- aktuellem Arbeitsschritt,
- übertragenen Bytes und Upload-Abschnitt,
- eindeutigem Status für erfolgreich, übersprungen oder fehlgeschlagen,
- abschließender Zusammenfassung.

Während eines laufenden Uploads ist die Dateiauswahl gesperrt. Dadurch kann nicht versehentlich ein zweiter paralleler Upload gestartet werden. Der Verlauf bleibt nach Abschluss sichtbar und kann mit **„Verlauf ausblenden“** geschlossen werden.

### 2. Gewählte PDF-Seite beginnt immer am Seitenkopf

Beim Öffnen sowie bei jedem Seitenwechsel wird die vertikale Scrollposition auf den Kopf der gewählten Seite gesetzt. Das gilt für:

- Vorherige-/Nächste-Seite-Schaltflächen,
- direkte Eingabe einer Seitennummer,
- Klick auf eine Miniaturansicht,
- Tastaturnavigation,
- Wischgesten.

Die horizontale Zentrierung bleibt erhalten. **Breite**, **Ganze Seite**, **Fenster füllen**, freier Zoom, Vollbild und Einzel-/Doppelseitenansicht verwenden weiterhin ihre bestehenden Berechnungen.

## Installation

1. Den Inhalt dieses Ordners in das Root-Verzeichnis des Farbatlas-Projekts kopieren.
2. Die vorhandenen Dateien ersetzen:
   - `learning-materials-client.js`
   - `learning-materials-viewer.js`
3. Die übrigen Dateien dürfen als Dokumentation und Regressionstest mitkopiert werden.
4. In GitHub Desktop committen, empfohlen mit:

   `Add PDF upload progress and reset page scroll`

5. **Push origin** ausführen und den Netlify-Deploy bis **Published** abwarten.
6. Die App mit `⌘ + Shift + R` beziehungsweise einem vollständigen Hard Reload neu laden.

Alternativ kann die enthaltene Patchdatei auf den Audit-Stand `2026-11-26_200254` angewendet werden.

## Manueller Funktionstest

1. Als Admin oder zugewiesener KL anmelden und einen Datensatz öffnen.
2. **Lernmaterialien** öffnen und eine PDF hochladen.
3. Prüfen, ob Gesamtfortschritt, Dateifortschritt, Prozent, Bytes und Upload-Abschnitte sichtbar fortschreiten.
4. Die veröffentlichte PDF öffnen.
5. Im Modus **Fenster füllen** innerhalb einer Seite nach unten scrollen.
6. Auf **Nächste Seite** klicken: Die neue Seite muss am Seitenkopf beginnen.
7. Danach eine Seite über die Seitennummer und eine Miniatur direkt anwählen: Beide müssen ebenfalls am Seitenkopf beginnen.
8. **Breite**, **Ganze Seite**, **Fenster füllen**, freier Zoom, Vollbild und Einzel-/Doppelseite kurz gegenprüfen.

## Scope

Nicht verändert wurden:

- Server-Routing und Netlify-Functions,
- PDF-Uploadprotokoll und Chunk-Größe,
- 5-MB-Warnung und 50-MB-Obergrenze,
- Offline-Speicherung und Datensparmodus,
- KL-Tierdatenrechte und KL-Speicherpfad,
- Berechnungsformeln der vorhandenen PDF-Ansichtsmodi.
