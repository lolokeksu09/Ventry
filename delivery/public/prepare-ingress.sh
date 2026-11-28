#!/usr/bin/env bash
# Owner-run, non-migrating preparation before site deploy. No DB/API recreation.
set -euo pipefail
cd "$(dirname "$0")/../deploy"
[[ $# -ge 1 && $# -le 2 && "$1" = /* && ( $# = 1 || "$2" = --cloud ) ]]
state="$1"
unset DELIVERY_STATE DELIVERY_BIND_IP COMPOSE_PROJECT_NAME COMPOSE_FILE
grep -Fxq "DELIVERY_STATE=$state" "$state/compose.env"
umask 077
exec 9>"$state/upgrade-006.lock"
flock -n 9 || { echo "Delivery maintenance lock busy" >&2; exit 1; }
[[ ! -e "$state/upgrade-006.incomplete" && ! -e "$state/upgrade-007.incomplete" ]]
args=(-f compose.yaml -f ../public/delivery.override.yaml)
dc() { docker compose --env-file "$state/compose.env" "${args[@]}" "$@"; }
[[ "$(dc exec -T -u postgres db psql -X -qAt -U postgres -d delivery -v ON_ERROR_STOP=1 < schema-006-state.sql)" = ready ]]
if [[ ${2:-} = --cloud || -e "$state/cloud-public.enabled" ]]; then
  test -f "$state/cloud-007.enabled"
  test "$(dc exec -T -u postgres db psql -X -qAt -U postgres -d delivery -v ON_ERROR_STOP=1 < schema-007-state.sql)" = ready
  test "$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$(dc ps -q api)" | grep -Fx DELIVERY_BACKUP_ENABLED=true)" = DELIVERY_BACKUP_ENABLED=true
  args+=(-f ../public/cloud.override.yaml)
fi
bind="$(sed -n 's/^DELIVERY_BIND_IP=//p' "$state/compose.env")"
openssl verify -CAfile "$state/tls/ca.pem" -verify_ip "$bind" "$state/tls/server.pem"
# Public CA only. Private TLS key and signing seed remain unchanged.
if [[ -e "$state/tls/gateway-ca.pem" ]]; then
    cmp "$state/tls/ca.pem" "$state/tls/gateway-ca.pem"
else
    install -m 0444 "$state/tls/ca.pem" "$state/tls/gateway-ca.pem"
fi
network=ventry-delivery-public
if ! docker network inspect "$network" >/dev/null 2>&1; then
    docker network create --driver bridge --label dev.ventry.purpose=license-ingress "$network" >/dev/null
fi
docker network inspect "$network" | python3 -c 'import json,sys; n=json.load(sys.stdin)[0]; assert n["Driver"]=="bridge" and n["Labels"].get("dev.ventry.purpose")=="license-ingress"; assert all(c["Name"] in ("ventry-web-1","ventry-delivery-public-gateway-1") for c in n["Containers"].values())'
before="$(dc ps -q db api edge | sort)"
test "$(printf '%s\n' "$before" | wc -l)" = 3
dc config --quiet
dc up -d --no-deps --build public-gateway
test "$before" = "$(dc ps -q db api edge | sort)"
# Probe from the actual public Docker network without publishing a host port.
# The pinned patched Caddy edge image already contains wget on Alpine.
edge="$(dc ps -q edge)"
image="$(docker inspect --format '{{.Image}}' "$edge")"
docker run --rm --network "$network" --entrypoint /bin/sh "$image" -ec '
  for i in $(seq 1 30); do
    if wget -q -O /dev/null --header="X-Ventry-Client-IP: 192.0.2.1" http://ventry-public-gateway:18090/download; then
      exit 0
    fi
    sleep 2
  done
  exit 1
'
if [[ ${2:-} = --cloud || -e "$state/cloud-public.enabled" ]]; then
  printf 'true\n' > "$state/cloud-public.enabled"
  echo DELIVERY_PUBLIC_CLOUD_GATEWAY_READY
fi
echo DELIVERY_PUBLIC_GATEWAY_READY
