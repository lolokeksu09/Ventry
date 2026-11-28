#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
[[ $# -ge 1 && "$1" = /* ]]
state="$1"
mode="${2:-}"
selection=legacy
worker=false
case "$mode" in
  ""|--cloud) [[ $# -le 2 ]];;
  --verify-worker|--release-worker|--stop-worker)
    [[ $# = 3 && "${DELIVERY_LOCK_FD:-}" =~ ^[0-9]+$ ]]
    [[ "/proc/$$/fd/$DELIVERY_LOCK_FD" -ef "$state/upgrade-006.lock" ]]
    flock -n "$DELIVERY_LOCK_FD"
    worker=true
    selection="$3"
    ;;
  *) echo "Invalid startup mode" >&2; exit 2;;
esac
unset DELIVERY_STATE DELIVERY_BIND_IP COMPOSE_PROJECT_NAME COMPOSE_FILE DELIVERY_BUNDLE_PATH DELIVERY_EXPECTED_RELEASE_SHA DELIVERY_RELEASE_DIR
grep -Fxq "DELIVERY_STATE=$state" "$state/compose.env"
bind="$(sed -n 's/^DELIVERY_BIND_IP=//p' "$state/compose.env")"
python3 - "$bind" <<'PY'
import ipaddress,sys
a=ipaddress.IPv4Address(sys.argv[1])
assert a.is_loopback or any(a in ipaddress.ip_network(n) for n in ('10.0.0.0/8','172.16.0.0/12','192.168.0.0/16'))
PY
if [[ "$mode" != --stop-worker && "$bind" != 127.0.0.1 ]]; then
  found=false
  for iface in $(wg show interfaces); do
    if ip -4 -o addr show dev "$iface" | awk '{print $4}' | cut -d/ -f1 | grep -Fxq "$bind"; then found=true; fi
  done
  [[ "$found" = true ]] || { echo "Private WireGuard address unavailable; refusing start" >&2;exit 1; }
fi
cloud=false
compose_args=(-f compose.yaml)
dc() { docker compose --env-file "$state/compose.env" "${compose_args[@]}" "$@"; }
umask 077
if [[ "$worker" = false ]]; then
  exec 9>"$state/upgrade-006.lock"
  flock -n 9 || { echo "Delivery upgrade or startup already holds the state lock" >&2; exit 1; }
  selection="$(python3 release-switch.py "$state" --active)"
fi
if [[ "$mode" = --stop-worker ]]; then
  dc stop edge api
  exit
fi
[[ ! -e "$state/upgrade-006.incomplete" && ! -e "$state/upgrade-007.incomplete" ]] || {
  echo "Delivery upgrade recovery marker exists; refusing startup" >&2; exit 1
}
expected="$(python3 release-switch.py "$state" --expected "$selection")"
if [[ "$selection" != legacy ]]; then
  export DELIVERY_BUNDLE_PATH="$state/releases/$selection"
  export DELIVERY_EXPECTED_RELEASE_SHA="$selection"
  compose_args+=(-f release.override.yaml)
fi
dc config --quiet
# Do not recreate an existing database or launch a new API against a stale schema.
if [[ -z "$(dc ps --all -q db)" ]]; then
  dc up -d --wait --wait-timeout 120 db
elif [[ -z "$(dc ps --status running -q db)" ]]; then
  dc start db
fi
ready=false
for i in $(seq 1 60); do
  if dc exec -T db pg_isready -h 127.0.0.1 -U postgres -d delivery >/dev/null 2>&1; then
    ready=true; break
  fi
  sleep 2
done
[[ "$ready" = true ]] || { echo "Delivery database not ready" >&2; exit 1; }
schema="$(dc exec -T -u postgres db psql -X -qAt -U postgres -d delivery -v ON_ERROR_STOP=1 < schema-006-state.sql)"
[[ "$schema" = ready ]] || {
  echo "Delivery schema not ready ($schema); use upgrade-006.sh --check before starting API/edge" >&2
  exit 1
}
if [[ "$mode" = --cloud || -e "$state/cloud-007.enabled" ]]; then
    [[ "$(dc exec -T -u postgres db psql -X -qAt -U postgres -d delivery -v ON_ERROR_STOP=1 < schema-007-state.sql)" = ready ]] ||
      { echo "Cloud schema 007 is not ready" >&2; exit 1; }
    cloud=true
    compose_args+=(-f cloud.override.yaml)
    dc config --quiet
    # Persistent owner opt-in, not stored in the secrets or database.
    printf 'true\n' > "$state/cloud-007.enabled"
fi
db_id="$(dc ps -q db)"
# Preflight uses the same image and mounts as startup, with no service listeners.
if [[ "$mode" = --verify-worker ]]; then
  dc build api edge
  dc run --no-deps --rm -T api --verify-release
  exit
fi
# Keep the existing DB/network namespace and volume; rebuild only the services.
if [[ "$mode" = --release-worker ]]; then
  dc up -d --no-deps --no-build --force-recreate api edge
else
  dc up -d --no-deps --build api edge
fi
test "$(dc ps -q db)" = "$db_id"
for i in $(seq 1 60); do
  if curl --cacert "$state/tls/ca.pem" -fsS --connect-timeout 2 --max-time 5 "https://$bind:18443/" >/dev/null &&
     curl --cacert "$state/tls/ca.pem" -fsS --connect-timeout 2 --max-time 5 "https://$bind:18444/download" >/dev/null; then break; fi
  sleep 2
done
test "$(curl --cacert "$state/tls/ca.pem" -sS -o /dev/null -w '%{http_code}' --max-time 10 "https://$bind:18443/api/v1/projects")" = 401
test "$(curl --cacert "$state/tls/ca.pem" -sS -o /dev/null -w '%{http_code}' --max-time 10 "https://$bind:18444/api/v1/projects")" = 404
python3 - "$state" "$bind" "$expected" <<'PY'
import json,ssl,sys,urllib.request
from pathlib import Path
p=Path(sys.argv[1]);base="https://"+sys.argv[2]+":18443/api/v1"
ctx=ssl.create_default_context(cafile=str(p/"tls/ca.pem"))
def post(path,token):
    q=urllib.request.Request(base+path,data=b"{}",headers={"Authorization":"Bearer "+token,"Content-Type":"application/json"})
    with urllib.request.urlopen(q,context=ctx,timeout=10) as r:return json.load(r)
s=post("/session",(p/"secrets/admin-token").read_text().strip())["session_token"]
try:
    q=urllib.request.Request(base+"/projects",headers={"Authorization":"Bearer "+s})
    with urllib.request.urlopen(q,context=ctx,timeout=10) as r:
        assert any(x["code"]=="raschet" for x in json.load(r))
    q=urllib.request.Request(base+"/release",headers={"Authorization":"Bearer "+s})
    with urllib.request.urlopen(q,context=ctx,timeout=10) as r:
        assert json.load(r)["sha256"] == sys.argv[3], "Unexpected running release"
finally:
    assert post("/session/logout",s)["revoked"]
PY
if [[ "$cloud" = true ]]; then
  test "$(curl --cacert "$state/tls/ca.pem" -sS -X POST -o /dev/null -w '%{http_code}' --max-time 10 "https://$bind:18444/api/v1/backups/list")" = 404
  echo DELIVERY_CLOUD_PRIVATE_READY
fi
echo "DELIVERY_PRIVATE_TLS_STAGING_OK"
