Farbatlas des Meeres – KL-Speicherfix vom 26.11.2026

BEHOBEN
- Die KL-Baseline wird ausschließlich aus dem frisch geladenen Server-Payload aufgebaut.
- Verwaiste Einträge aus recordEdits werden nicht mehr als aktuelle Wissenstextänderungen gesammelt.
- Beim Fehlen eines lokalen Wertes wird auf den Server-Basiswert zurückgefallen.
- Die serverseitige Schutzprüfung für verwaiste Wissenstexte bleibt unverändert aktiv.

ANWENDEN – Variante A (Git)
1. Diese Datei in die Projektwurzel kopieren:
   FARBATLAS_KL_SPEICHERFIX_2026-11-26.patch
2. In der Projektwurzel ausführen:
   git apply --check FARBATLAS_KL_SPEICHERFIX_2026-11-26.patch
   git apply FARBATLAS_KL_SPEICHERFIX_2026-11-26.patch

ANWENDEN – Variante B (Dateien ersetzen)
Die enthaltenen Dateien in der Projektwurzel an dieselben Pfade kopieren:
- course-leader-client.js
- test/course-leader-ui-integration.test.mjs
- test/course-utils.test.mjs
- test/course-leader-change-collection.test.mjs (neu)

PRÜFEN
- npm test
- npm run check

ERWARTETER BROWSERTEST
1. Als Kursleiter anmelden und den Datensatz „Rotes Meer“ öffnen.
2. Genau ein freigegebenes Feld ändern und „Lokal übernehmen“ wählen.
3. „Datensatz speichern“ wählen.
4. Erwartung: „1 Änderung(en) werden geprüft und gespeichert …“ und anschließend Erfolg.
5. Abmelden, erneut als derselbe Kursleiter anmelden und den Datensatz öffnen.
6. Erwartung: Die Änderung ist weiterhin vorhanden.
