#!/usr/bin/env bash
# Synthetic CI only. No production hostname resolution, no real customer data.
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" = true && "$1" = "$RUNNER_TEMP/ventry-private-state" ]]
state="$1"
cd "$(dirname "$0")"
dc() { docker compose --env-file "$state/compose.env" -f compose.yaml -f ../public/delivery.override.yaml "$@"; }
bash ../public/prepare-ingress.sh "$state"
tmp="$(mktemp -d)"
trap 'docker rm -f ventry-cloud-ci-front >/dev/null 2>&1 || true; rm -rf "$tmp"' EXIT
sed 's/^license[.]ventrylab[.]top {/http:\/\/license.ventrylab.top:18089 {/' ../public/license.Caddyfile > "$tmp/Caddyfile"
chmod 755 "$tmp"; chmod 644 "$tmp/Caddyfile"
edge="$(docker inspect --format '{{.Image}}' "$(dc ps -q edge)")"
docker run -d --name ventry-cloud-ci-front --network ventry-delivery-public -p 127.0.0.1:18089:18089 \
 --user 0:0 -v "$tmp/Caddyfile:/etc/caddy/Caddyfile:ro" "$edge" >/dev/null
for i in $(seq 1 30); do
  if code="$(curl -sS --max-time 3 -H 'Host: license.ventrylab.top:18089' -X POST -o "$tmp/denied" -w '%{http_code}' http://127.0.0.1:18089/api/v1/backups/list)" && [[ "$code" = 404 ]]; then break; fi
  sleep 1
done
test "$code" = 404
grep -Fq '"not_found"' "$tmp/denied"
# This temporary frontend is the only extra member; remove it before the production
# network membership check in prepare-ingress.sh, then recreate it for CI traffic.
docker rm -f ventry-cloud-ci-front >/dev/null
bash ../public/prepare-ingress.sh "$state" --cloud
docker run -d --name ventry-cloud-ci-front --network ventry-delivery-public -p 127.0.0.1:18089:18089 \
 --user 0:0 -v "$tmp/Caddyfile:/etc/caddy/Caddyfile:ro" "$edge" >/dev/null
for i in $(seq 1 30); do
  if code="$(curl -sS --max-time 3 -H 'Host: license.ventrylab.top:18089' -X POST -o "$tmp/denied" -w '%{http_code}' http://127.0.0.1:18089/api/v1/backups/list)" && [[ "$code" = 404 ]]; then break; fi
  sleep 1
done
test "$code" = 404
grep -Fq '"backup_unavailable"' "$tmp/denied"
python3 ../tests/cloud_ingress.py "$state"
echo DELIVERY_CLOUD_INGRESS_E2E_PASS
