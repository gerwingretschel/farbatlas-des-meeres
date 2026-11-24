# Farbatlas des Meeres – Audit Exporter 3.0

Diese Version benötigt **kein Python, kein Homebrew und keine Apple Command Line Developer Tools**.

## Installation

Beide Dateien direkt in die Projektwurzel legen, z. B.:

`/Volumes/Extreme SSD/farbatlas-des-meeres/`

Dann im Terminal:

```bash
cd "/Volumes/Extreme SSD/farbatlas-des-meeres"
chmod +x audit-export.sh
./audit-export.sh
```

Der Audit wird unter `audit/Farbatlas_des_Meeres_Audit_YYYY-MM-DD_HHMMSS.txt` erzeugt.

Empfohlene `.gitignore`:

```text
.DS_Store
._*
audit/*.txt
```

Der Exporter selbst und diese README können normal nach GitHub committed werden; die erzeugten Audit-TXT-Dateien bleiben lokal.
