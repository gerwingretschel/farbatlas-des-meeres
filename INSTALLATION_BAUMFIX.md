# Farbatlas – Baumdarstellung der PDF-Lernmaterialien korrigieren

Stand: 26. November 2026

## Zweck

Dieser gezielte Fix korrigiert ausschließlich die Darstellung des Ordnerbaums im Bereich **Lernmaterialien**.

Vorher wurden rekursive `<li>`-Elemente ohne umschließende Unterliste ausgegeben. Der Browser normalisierte dieses ungültige HTML und zeigte deshalb `Test`, `Test1` und `Test2` optisch auf derselben Ebene, obwohl die gespeicherten `parentId`-Beziehungen korrekt waren.

Nach dem Fix:

- werden Unterordner als echte verschachtelte `<ul>`-Listen dargestellt,
- zeigen Einrückung und Verbindungslinie die Hierarchie,
- lassen sich Ordner über `▸` und `▾` ein- und ausklappen,
- wird der Pfad zum ausgewählten Ordner automatisch sichtbar gehalten,
- bleibt ein neu angelegter Unterordner im geöffneten Elternordner sofort sichtbar,
- sind die Schalter mit `aria-expanded` und verständlichen Beschriftungen zugänglich.

Nicht verändert werden Server-Routing, PDF-Upload, Download, Viewer, Datensparmodus, Offline-Speicherung oder der KL-Tierdaten-Speicherpfad.

## Installation über GitHub Desktop

1. ZIP entpacken.
2. Den **Inhalt des entpackten Ordners** in das Root-Verzeichnis des aktuellen Farbatlas-Projekts kopieren.
3. Vorhandene Dateien ersetzen.
4. In GitHub Desktop prüfen: geändert werden nur:
   - `learning-materials-client.js`
   - `learning-materials.css`
   - `test/learning-materials-integration.test.mjs`
   - zusätzlich kommen Patch, Anleitung, Verifikation und Prüfsummen hinzu.
5. Commit-Summary:

```text
Fix learning materials folder tree
```

6. Committen und **Push origin** ausführen.
7. Den Netlify-Deploy bis **Published** abwarten.

## Alternative: Patch anwenden

In der Projektwurzel:

```bash
git apply --check FARBATLAS_PDF_LERNMATERIALIEN_BAUMFIX_2026-11-26.patch
git apply FARBATLAS_PDF_LERNMATERIALIEN_BAUMFIX_2026-11-26.patch
node --test test/learning-materials-integration.test.mjs test/material-utils.test.mjs
npm run check
```

Nicht gleichzeitig Dateien kopieren und den Patch anwenden.

## Anschließender Browser-Test

1. Netlify-Stand **Published** abwarten.
2. Farbatlas mit Hard Reload neu laden (`⌘ + Shift + R`).
3. Als Admin anmelden und **Rotes Meer → Lernmaterialien** öffnen.
4. `Test` auswählen.
5. Links muss sichtbar sein:

```text
📚 Lernmaterialien
└─ ▾ 📁 Test
   ├─ 📁 Test1
   └─ 📁 Test2
```

6. Mit `▾` den Ordner `Test` einklappen und mit `▸` wieder ausklappen.
7. Erst danach mit dem PDF-Viewer-Test fortfahren.
