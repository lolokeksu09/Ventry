#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
umask 077
[[ $# = 1 && "$1" = /* ]]
state="$1";grep -Fxq "DELIVERY_STATE=$state" "$state/compose.env"
out="$state/backups/delivery-$(date -u +%Y%m%dT%H%M%SZ).dump"
tmp="$(mktemp "$state/backups/.dump.XXXXXXXX")"
trap 'rm -f "$tmp"' EXIT
docker compose --env-file "$state/compose.env" -f compose.yaml exec -T db pg_dump -U postgres -Fc delivery > "$tmp"
test -s "$tmp"
docker compose --env-file "$state/compose.env" -f compose.yaml exec -T db pg_restore -l < "$tmp" >/dev/null
test ! -e "$out"
mv "$tmp" "$out"
sha256sum "$out" > "$out.sha256"
echo "DELIVERY_BACKUP_CREATED $out"
