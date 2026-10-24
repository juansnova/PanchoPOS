#!/usr/bin/env bash
# Restaura una copia creada con scripts/backup.sh (en este PC o en uno nuevo).
#   ./scripts/restore.sh backups/pos_2026-10-23_1800.tar.gz
# Pasos previos en un PC nuevo: copiar la carpeta del proyecto y tener Docker encendido.
# ATENCIÓN: reemplaza la base de datos actual, back/uploads y config.env.
set -euo pipefail
cd "$(dirname "$0")/.."

FILE="${1:?Uso: ./scripts/restore.sh <archivo.tar.gz>}"
[ -f "$FILE" ] || { echo "No existe: $FILE" >&2; exit 1; }

read -r -p "Esto REEMPLAZA la base de datos, las imágenes y config.env. ¿Continuar? (escribe si): " OK
[ "$OK" = "si" ] || { echo "Cancelado."; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
tar -xzf "$FILE" -C "$WORK"

# 1. Configuración primero (el compose la necesita para arrancar)
cp "$WORK/pos/config.env" config.env
[ -f "$WORK/pos/agent.env" ] && cp "$WORK/pos/agent.env" scripts/print-agent/agent.env

COMPOSE=(docker compose --env-file config.env -f docker-compose.yml -f docker-compose.dev.yml)

# 2. Base de datos limpia y carga del volcado
"${COMPOSE[@]}" up -d db
until "${COMPOSE[@]}" exec -T db pg_isready -U pos -d pos >/dev/null 2>&1; do sleep 1; done
"${COMPOSE[@]}" stop back ws-bridge >/dev/null 2>&1 || true
"${COMPOSE[@]}" exec -T db psql -U pos -d postgres -c "DROP DATABASE IF EXISTS pos WITH (FORCE);"
"${COMPOSE[@]}" exec -T db psql -U pos -d postgres -c "CREATE DATABASE pos OWNER pos;"
"${COMPOSE[@]}" exec -T db psql -U pos -d pos -v ON_ERROR_STOP=1 < "$WORK/pos/pos.sql" > /dev/null

# 3. Imágenes
if [ -d "$WORK/pos/uploads" ]; then
  mkdir -p back/uploads
  cp -r "$WORK/pos/uploads/." back/uploads/
fi

# 4. Levantar todo
"${COMPOSE[@]}" up -d
echo "Restauración completa. Revisa: ${COMPOSE[*]} logs --tail=50 back"
