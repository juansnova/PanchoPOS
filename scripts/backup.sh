#!/usr/bin/env bash
# Copia de seguridad: base de datos + back/uploads + config.env en un solo archivo.
#   ./scripts/backup.sh            -> backups/pos_YYYY-MM-DD_HHMM.tar.gz
# El archivo incluye config.env (claves): guárdalo en un lugar privado.
# Se conservan las últimas KEEP copias (por defecto 14).
set -euo pipefail
cd "$(dirname "$0")/.."

KEEP="${KEEP:-14}"
COMPOSE=(docker compose --env-file config.env -f docker-compose.yml -f docker-compose.dev.yml)
STAMP="$(date +%Y-%m-%d_%H%M)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p backups "$WORK/pos"
"${COMPOSE[@]}" exec -T db pg_dump -U pos -d pos > "$WORK/pos/pos.sql"
[ -s "$WORK/pos/pos.sql" ] || { echo "Error: el volcado de la base está vacío" >&2; exit 1; }

[ -d back/uploads ] && cp -r back/uploads "$WORK/pos/uploads"
cp config.env "$WORK/pos/config.env"
[ -f scripts/print-agent/agent.env ] && cp scripts/print-agent/agent.env "$WORK/pos/agent.env"

OUT="backups/pos_${STAMP}.tar.gz"
tar -czf "$OUT" -C "$WORK" pos
echo "Copia creada: $OUT ($(du -h "$OUT" | cut -f1))"

# Borra las copias más antiguas
ls -1t backups/pos_*.tar.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f
