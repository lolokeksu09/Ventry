#!/usr/bin/env bash
# Executed only by PostgreSQL entrypoint on a new cluster.
(
set -euo pipefail
password="$(cat /run/delivery/db-runtime)"
[[ "$password" =~ ^[0-9a-f]{64}$ ]]
printf "CREATE ROLE delivery_runtime LOGIN PASSWORD '%s' IN ROLE delivery_api;\n" "$password" |
  psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1
)
