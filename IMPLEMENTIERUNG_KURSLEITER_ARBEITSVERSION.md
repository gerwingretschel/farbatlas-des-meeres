# Kursleiter-Arbeitsversion – Umsetzungs- und Einführungsleitfaden

Stand: 25.11.2026  
Basis: V10-Audit vom 24.11.2026

## 1. Bereits umgesetzt

- vorhandene Audit-Snapshots als separate Arbeitskopie rekonstruiert
- bestehende V10-Datensatz- und Bildspeicher unverändert übernommen
- sichere Rollen `admin` und `courseLeader` serverseitig getrennt
- Kursleiterkonten mit Name, Benutzername, Passwort-Hash, Aktivstatus und Ablaufdatum
- Zuweisung einzelner bestehender Datensätze
- Einzelrechte für Wissenstexte und akademische Links
- Kursleiter-Login ohne Kenntnis des Datensatzpassworts
- Administratoroberfläche für Anlegen, Bearbeiten, Sperren, Löschen und Passwort-Reset
- Bearbeitung nur der freigeschalteten Inhaltsfelder
- atomare Schreibsicherung über ETag und `onlyIfMatch`
- Konfliktanzeige mit Serverfassung und eigener Fassung; keine stille Überschreibung
- Vorher-/Nachher-Protokoll je Speichervorgang
- Anzeige der eigenen letzten Änderungen
- Wiederherstellung einer früheren eigenen Fassung als neue protokollierte Version
- sofortige Sitzungswiderrufung nach Kontosperre, Rechteänderung oder Passwort-Reset
- Anmelde-Drosselung, serverseitige HTML-Bereinigung und URL-Prüfung
- automatisierte Tests für Passwortschutz, Rechte, Bereinigung und Konflikte

## 2. Dateien dieses Pakets

Folgende Dateien werden im vorhandenen Projekt ersetzt:

- `index.html`
- `inject-v10.mjs`
- `v10-client.js`
- `netlify/functions/farbatlas.mjs`
- `package.json`
- `README.md`

Folgende Dateien kommen neu hinzu:

- `course-leader-client.js`
- `netlify/functions/lib/course-utils.mjs`
- `test/course-utils.test.mjs`
- `IMPLEMENTIERUNG_KURSLEITER_ARBEITSVERSION.md`

Die vorhandenen Ordner `Artenlisten`, Bilder und sonstige Projektdateien nicht löschen oder überschreiben.

---

# 3. Schritte, die du selbst durchführen musst

## Schritt A – Produktionsbestand vor jeder Änderung sichern

1. In der aktuellen produktiven App als Administrator anmelden.
2. Jeden wichtigen Datensatz einzeln öffnen.
3. Unter **Import & Export** die korrigierten Bilder exportieren. Dadurch werden auch `_Farbatlas_Aenderungen.json` und die Kartenbilder ausgegeben.
4. Zusätzlich die Artenliste exportieren.
5. Den gesamten lokalen Projektordner duplizieren, zum Beispiel als:

   `farbatlas-des-meeres_backup_2026-11-25`

6. In GitHub Desktop den aktuellen produktiven Stand committen und den Commit eindeutig markieren, zum Beispiel:

   `backup-before-course-leader-phase1`

**Nicht fortfahren, bevor mindestens ein wichtiger Datensatz testweise aus dem Export geöffnet werden konnte und der Git-Stand gesichert ist.**

## Schritt B – Eigene Entwicklungs- oder Staging-Branch anlegen

In GitHub Desktop:

1. **Current Branch** öffnen.
2. **New Branch** wählen.
3. Branchname: `feature/course-leader-phase1`
4. Branch erstellen und veröffentlichen.

Die Kursleiter-Version zuerst nur über einen Netlify-Deploy-Preview oder eine getrennte Staging-Site testen. Noch nicht direkt auf den produktiven Hauptbranch mergen.

## Schritt C – Upgrade-Dateien in das echte Projekt übernehmen

1. Den Inhalt dieses Upgrade-Pakets in den vorhandenen Projektordner kopieren.
2. Beim Kopieren die oben genannten sechs Dateien ersetzen.
3. Die vier neuen Dateien beziehungsweise Ordner ergänzen.
4. Vorhandene Artenlisten und andere, nicht im Paket enthaltene Dateien beibehalten.
5. In GitHub Desktop kontrollieren, dass keine Artenlisten, Bilder oder Sicherungsdateien als gelöscht angezeigt werden.

## Schritt D – neue geheime Sitzungsvariable in Netlify setzen

Auf dem Mac im Terminal einmal einen Zufallswert erzeugen:

```bash
openssl rand -base64 48
```

Den ausgegebenen Wert nicht in GitHub, Dokumente oder E-Mails kopieren. In Netlify:

1. Site öffnen.
2. **Site configuration** → **Environment variables**.
3. Neue Variable anlegen:
   - Name: `SESSION_SECRET`
   - Wert: die eben erzeugte Zufallszeichenfolge
   - Gültigkeit: Functions/Runtime beziehungsweise alle Deploy-Kontexte, die getestet werden
4. Prüfen, dass `ADMIN_PASSWORD` weiterhin vorhanden ist.
5. Deploy neu starten, damit die Function beide Variablen erhält.

`SESSION_SECRET` muss mindestens 32 Zeichen lang sein. Ohne diese Variable verweigert die neue Anmeldung absichtlich den Betrieb.

## Schritt E – lokale technische Prüfung

Im echten Projektordner im Terminal:

```bash
npm install
npm run check
npm test
npm run build
```

Erwartetes Ergebnis:

- JavaScript-Syntaxprüfung ohne Fehler
- alle Tests erfolgreich
- `index.html` enthält danach genau einmal:
  - `/v10-client.js`
  - `/course-leader-client.js`

`npm run build` ist wiederholbar; die Script-Tags werden nicht doppelt eingefügt.

## Schritt F – kontrollierter Staging-Test

1. Deploy-Preview öffnen.
2. Als Administrator anmelden.
3. Bereich **Kursleiterkonten & Änderungsprotokoll** öffnen.
4. Einen Testdatensatz anlegen oder einen ungefährlichen Testdatensatz verwenden.
5. Testkonto anlegen:
   - realistischen Anzeigenamen eintragen
   - neuen Benutzernamen vergeben
   - temporäres Passwort mit mindestens 12 Zeichen
   - nur den Testdatensatz zuweisen
   - zunächst nur **Wissenstexte bearbeiten** aktivieren
6. In einem privaten Browserfenster als Kursleiter anmelden.
7. Prüfen:
   - nur der zugewiesene Datensatz wird angeboten
   - Wissenstext kann lokal vorbereitet und serverseitig gespeichert werden
   - akademischer Link ist ohne Recht nicht bearbeitbar
   - Löschen, Export, Bildbearbeitung und Datensatzverwaltung bleiben verborgen und serverseitig gesperrt
   - Änderung bleibt nach Abmeldung und erneuter Anmeldung erhalten
   - Eintrag erscheint unter **Meine Änderungen** und im Administrator-Protokoll
   - frühere Fassung kann wiederhergestellt werden
8. Danach das Recht **Akademische Links bearbeiten** ergänzen und erneut testen.
9. Konto sperren und prüfen, dass die bestehende Kursleitersitzung beim nächsten Serverzugriff ungültig wird.
10. Passwort zurücksetzen und prüfen, dass die alte Sitzung und das alte Passwort nicht mehr funktionieren.

## Schritt G – Konflikttest mit zwei Browserfenstern

1. Dasselbe Kursleiterkonto oder zwei Konten mit demselben Testdatensatz in zwei getrennten Browserprofilen öffnen.
2. In beiden Fenstern denselben Wissenstext öffnen.
3. In Fenster A ändern und speichern.
4. In Fenster B eine andere Fassung speichern.
5. Erwartung:
   - Fenster B zeigt Serverfassung und eigene Fassung nebeneinander.
   - Es muss ausdrücklich eine Fassung gewählt werden.
   - Keine Fassung wird still überschrieben.
   - die gewählte Entscheidung erscheint als neuer Protokolleintrag.

## Schritt H – Freigabe für die ersten echten Kursleiter

Erst nach bestandenem Staging-Test:

1. Branch in den Hauptbranch mergen.
2. Produktiven Netlify-Deploy kontrollieren.
3. Zunächst nur ein bis zwei Kursleiterkonten anlegen.
4. Rechte standardmäßig auf Wissenstexte und akademische Links begrenzen.
5. Nur benötigte Datensätze zuweisen.
6. Temporäre Passwörter getrennt vom Benutzernamen übermitteln.
7. In der Pilotphase täglich das Änderungsprotokoll kontrollieren.

---

# 4. Rechte-Matrix des ersten Stands

| Funktion | Administrator | Kursleiter mit Recht | Kursleiter ohne Recht |
|---|---:|---:|---:|
| zugewiesenen Datensatz lesen | ja | ja | ja |
| Wissenstext bearbeiten | ja | ja, wenn freigeschaltet | nein |
| akademischen Link bearbeiten | ja | ja, wenn freigeschaltet | nein |
| Taxonomie ändern | ja | nein | nein |
| Organismengruppe umbenennen | ja | nein | nein |
| Bilder hochladen/ersetzen | ja | nein | nein |
| Datensatz exportieren | ja | nein | nein |
| Datensatz löschen | ja | nein | nein |
| Kursleiterkonten verwalten | ja | nein | nein |
| globale Einstellungen ändern | ja | nein | nein |

# 5. Neue Netlify-Blob-Stores

Das Upgrade legt bei Benutzung automatisch drei getrennte Stores an:

- `farbatlas-course-leaders-v1`
- `farbatlas-course-audit-v1`
- `farbatlas-auth-throttle-v1`

Die bestehenden Stores bleiben unverändert benannt:

- `farbatlas-datasets-v10`
- `farbatlas-images-v10`

Es gibt deshalb keine automatische Datenmigration und keinen Löschvorgang beim Deploy.

# 6. Rückfallplan

Wenn der Deploy fehlschlägt:

1. In Netlify den letzten funktionierenden Deploy erneut veröffentlichen oder in GitHub den markierten Backup-Commit auschecken.
2. `SESSION_SECRET` kann bestehen bleiben; es stört die alte Version nicht.
3. Die drei neuen Stores nicht vorschnell löschen, da dort Konten und Protokolle liegen.
4. Bereits gespeicherte Inhaltsänderungen befinden sich im bestehenden V10-Datensatz. Vor einem vollständigen Rücksetzen zuerst das Änderungsprotokoll beziehungsweise den gesicherten Export verwenden.
5. Erst nach dokumentierter Entscheidung und erneuter Sicherung Datenstores löschen.

# 7. Bewusste Begrenzung dieser Phase

Noch nicht enthalten sind Students-Logins, Exkursionsräume, Teams, Schüleruploads, Offline-Warteschlange, Freigabeprozess und Auswertungen. Diese Funktionen gehören zu den folgenden Ausbaustufen und werden nicht vorweggenommen.
