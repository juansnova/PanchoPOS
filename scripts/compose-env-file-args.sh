#!/usr/bin/env bash
# Echo docker compose --env-file args for config.env and optional .secrets.
# Usage from repo root:
#   docker compose $(./scripts/compose-env-file-args.sh) -f docker-compose.yml …
# Requires config.env (same as ./run.sh). .secrets is optional and gitignored.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ ! -f "$ROOT/config.env" ]]; then
  echo "compose-env-file-args: config.env not found in $ROOT (copy from config.env.example)" >&2
  exit 1
fi
printf -- '--env-file %s' "$ROOT/config.env"
if [[ -f "$ROOT/.secrets" ]]; then
  printf -- ' --env-file %s' "$ROOT/.secrets"
fi
printf '\n'
