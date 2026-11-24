#!/bin/bash
set -u
VERSION="3.0.0-macos-no-python"
ROOT="$(pwd)"
STAMP="$(date '+%Y-%m-%d_%H%M%S')"
OUT=""
INCLUDE_SOURCE=1

usage(){
  cat <<'EOF'
Farbatlas des Meeres - Audit Exporter 3.0 (macOS, ohne Python)

Verwendung:
  ./audit-export.sh [--root VERZEICHNIS] [--output DATEI] [--no-source]
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --root) ROOT="$2"; shift 2;;
    --output) OUT="$2"; shift 2;;
    --no-source) INCLUDE_SOURCE=0; shift;;
    -h|--help) usage; exit 0;;
    *) echo "Unbekannte Option: $1" >&2; exit 2;;
  esac
done

ROOT="$(cd "$ROOT" 2>/dev/null && pwd)" || { echo "Projektordner nicht gefunden." >&2; exit 2; }
[ -z "$OUT" ] && OUT="$ROOT/audit/Farbatlas_des_Meeres_Audit_${STAMP}.txt"
case "$OUT" in /*) ;; *) OUT="$ROOT/$OUT";; esac
mkdir -p "$(dirname "$OUT")"
TMP="${OUT}.tmp"
: > "$TMP"

add(){ printf '%s\n' "$*" >> "$TMP"; }
heading(){ add ""; add "================================================================================"; add "$1"; add "================================================================================"; }
rel(){ printf '%s' "${1#$ROOT/}"; }
size(){ stat -f '%z' "$1" 2>/dev/null || echo 0; }
sha(){ if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" 2>/dev/null | awk '{print $1}'; else echo "nicht verfuegbar"; fi; }
is_secret(){ case "$(basename "$1")" in .env|.env.*|*.pem|*.key|*.p12|*.pfx|id_rsa|id_ed25519|credentials*.json|secrets*.json) return 0;; *) return 1;; esac; }
is_text(){ case "$1" in *.html|*.htm|*.js|*.mjs|*.cjs|*.ts|*.tsx|*.jsx|*.css|*.scss|*.json|*.toml|*.md|*.txt|*.yml|*.yaml|*.sh|*.csv) return 0;; *) return 1;; esac; }
redact(){ sed -E \
  -e 's/((ADMIN_PASSWORD|password|passwd|secret|api[_-]?key|access[_-]?token)[[:space:]]*[:=][[:space:]]*)[^,;[:space:]]+/\\1[MASKIERT]/Ig' \
  -e 's/(Bearer[[:space:]]+)[A-Za-z0-9._~+\/-]{12,}/\\1[MASKIERT]/Ig' \
  -e 's#(https?://)[^/@[:space:]]+@#\\1[MASKIERT]@#g'; }

# Dateiliste ohne Git-Interna, Dependencies, Build-Caches und alte Audits.
FILES="$TMP.files"
find "$ROOT" \
  \( -type d \( -name .git -o -name node_modules -o -name .netlify -o -name .cache -o -name dist -o -name build -o -name coverage \) -prune \) -o \
  \( -type f -print \) 2>/dev/null | \
  grep -v '/audit/Farbatlas_des_Meeres_Audit_.*\.txt$' | \
  grep -v '/\.DS_Store$' | grep -v '/\._' | sort > "$FILES"

COUNT=0; TOTAL=0
while IFS= read -r f; do
  is_secret "$f" && continue
  COUNT=$((COUNT+1)); TOTAL=$((TOTAL+$(size "$f")))
done < "$FILES"

add "FARBATLAS DES MEERES - PROJEKT-AUDIT"
add "Exporter-Version: $VERSION"
add "Erstellt: $(date '+%Y-%m-%d %H:%M:%S %z')"
add "Projektwurzel: $ROOT"
add "Hinweis: Dieser Exporter benoetigt weder Python noch Apple Command Line Developer Tools."

heading "1. KURZSTATUS"
add "Beruecksichtigte Dateien: $COUNT"
add "Gesamtgroesse (Bytes): $TOTAL"
add "Quellcode-Snapshots: $([ "$INCLUDE_SOURCE" -eq 1 ] && echo aktiviert || echo deaktiviert)"

heading "2. ORDNERSTRUKTUR / DATEIINVENTAR"
while IFS= read -r f; do
  is_secret "$f" && { add "- [AUS SICHERHEITSGRUENDEN AUSGELASSEN] $(rel "$f")"; continue; }
  add "- $(rel "$f") | $(size "$f") Bytes"
done < "$FILES"

heading "3. GIT-/GITHUB-STATUS"
# Das System-Git kann auf frischem macOS die Developer Tools verlangen. Deshalb nur nutzen, wenn es wirklich funktioniert.
if command -v git >/dev/null 2>&1 && git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  add "Branch: $(git -C "$ROOT" branch --show-current 2>/dev/null || true)"
  add "Commit: $(git -C "$ROOT" rev-parse HEAD 2>/dev/null || true)"
  add "Status:"
  git -C "$ROOT" status --short --branch 2>/dev/null | redact >> "$TMP" || true
  add "Remotes:"
  git -C "$ROOT" remote -v 2>/dev/null | redact >> "$TMP" || true
else
  add "System-Git nicht verfuegbar. Das ist auf diesem Mac unkritisch; GitHub Desktop kann weiterhin sein eingebettetes Git verwenden."
fi

heading "4. NETLIFY UND SERVERFUNKTIONEN"
[ -f "$ROOT/netlify.toml" ] && add "netlify.toml: vorhanden" || add "netlify.toml: FEHLT"
if [ -d "$ROOT/netlify/functions" ]; then
  find "$ROOT/netlify/functions" -type f ! -name '.DS_Store' ! -name '._*' -print 2>/dev/null | while IFS= read -r f; do
    add "- $(rel "$f") | $(size "$f") Bytes | SHA-256 $(sha "$f")"
  done
else
  add "Netlify Functions: Ordner fehlt"
fi

heading "5. FUNKTIONSMATRIX (statische Code-Erkennung)"
SCAN="$TMP.scan"; : > "$SCAN"
while IFS= read -r f; do
  is_secret "$f" && continue
  is_text "$f" && cat "$f" >> "$SCAN" 2>/dev/null || true
done < "$FILES"
check(){ if grep -Eiq "$2" "$SCAN"; then add "OK | $1"; else add "NICHT ERKANNT | $1"; fi; }
check "Datensaetze laden/speichern" 'loadDataset|saveDataset|/api/farbatlas'
check "Datensatz umbenennen" 'rename-dataset|renameDataset'
check "Adminmodus" 'admin-login|adminToken|Administrator'
check "Organismengruppen" 'GROUPS|savedGroups|Organismengrupp'
check "Bildimport" 'folderInput|filesInput|importFiles|webkitdirectory'
check "Netlify Blobs / getrennte Bildspeicherung" '@netlify/blobs|getStore|blob'
check "Artenwissen" 'knowledge|Wissen zur Spezies'
check "Akademische Links" 'academic|akadem'
check "Suche" 'id="search"|Such'
check "Lernmodus" 'Lernmodus|showLearn|startLearn'
check "Anleitung" 'HELP_CHAPTERS|helpModal|Anleitung'
check "Browser-Cache" 'indexedDB|CACHE_DB|cacheWrite|cacheRead'
check "Export" 'exportCorrected|Export'
check "Rueckgaengig" 'undoLast|undoStack|Rueckg'

heading "6. ARTENLISTEN"
if [ -d "$ROOT/Artenlisten" ]; then
  find "$ROOT/Artenlisten" -type f ! -name '.DS_Store' ! -name '._*' -print 2>/dev/null | while IFS= read -r f; do
    add "- $(rel "$f") | $(size "$f") Bytes | SHA-256 $(sha "$f")"
  done
else
  add "Ordner Artenlisten fehlt."
fi

heading "7. WARNUNGEN / TODO / FIXME"
FOUND=0
while IFS= read -r f; do
  is_secret "$f" && continue
  if is_text "$f"; then
    M="$(grep -Ein 'TODO|FIXME|HACK|XXX' "$f" 2>/dev/null | head -20 || true)"
    if [ -n "$M" ]; then FOUND=1; add "Datei: $(rel "$f")"; printf '%s\n' "$M" | redact >> "$TMP"; fi
  fi
done < "$FILES"
[ "$FOUND" -eq 0 ] && add "Keine TODO/FIXME-Fundstellen erkannt."
add ""
add "Manuell zu pruefen: produktiver Netlify-Deploy, Environment Variables, remote Datensaetze/Blobs, Browser-End-to-End-Tests."

heading "8. QUELLCODE-SNAPSHOTS"
if [ "$INCLUDE_SOURCE" -eq 0 ]; then
  add "Deaktiviert durch --no-source."
else
  while IFS= read -r f; do
    is_secret "$f" && continue
    case "$(rel "$f")" in
      index.html|*.js|*.mjs|*.toml|package.json|README*.md|netlify/functions/*|audit-export.sh)
        is_text "$f" || continue
        add ""; add "--------------------------------------------------------------------------------"; add "DATEI: $(rel "$f")"; add "GROESSE: $(size "$f") Bytes"; add "SHA-256: $(sha "$f")"; add "--------------------------------------------------------------------------------"
        redact < "$f" >> "$TMP" 2>/dev/null || add "[NICHT LESBAR]"
      ;;
    esac
  done < "$FILES"
fi

heading "9. INTEGRITAET"
if command -v shasum >/dev/null 2>&1; then add "SHA-256 des Audit-Inhalts bis hierher: $(sha "$TMP")"; else add "SHA-256 nicht verfuegbar."; fi
add "ENDE DES AUDITS"

mv "$TMP" "$OUT"
rm -f "$FILES" "$SCAN" 2>/dev/null || true
printf '\nAudit erfolgreich erstellt:\n%s\n' "$OUT"
printf 'Dateien: %s | Audit-Groesse: %s Bytes\n' "$COUNT" "$(size "$OUT")"
