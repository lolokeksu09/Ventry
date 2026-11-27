#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
[[ $# = 1 && "$1" = /* ]]
state="$1"
unset DELIVERY_STATE DELIVERY_BIND_IP COMPOSE_PROJECT_NAME COMPOSE_FILE
grep -Fxq "DELIVERY_STATE=$state" "$state/compose.env"
bind="$(sed -n 's/^DELIVERY_BIND_IP=//p' "$state/compose.env")"
python3 - "$bind" <<'PY'
import ipaddress,sys
a=ipaddress.IPv4Address(sys.argv[1])
assert a.is_loopback or any(a in ipaddress.ip_network(n) for n in ('10.0.0.0/8','172.16.0.0/12','192.168.0.0/16'))
PY
if [[ "$bind" != 127.0.0.1 ]]; then
  found=false
  for iface in $(wg show interfaces); do
    if ip -4 -o addr show dev "$iface" | awk '{print $4}' | cut -d/ -f1 | grep -Fxq "$bind"; then found=true; fi
  done
  [[ "$found" = true ]] || { echo "Private WireGuard address unavailable; refusing start" >&2;exit 1; }
fi
dc() { docker compose --env-file "$state/compose.env" -f compose.yaml "$@"; }
dc config --quiet
dc up -d --build
for i in $(seq 1 60); do
  if curl --cacert "$state/tls/ca.pem" -fsS --connect-timeout 2 --max-time 5 "https://$bind:18443/" >/dev/null &&
     curl --cacert "$state/tls/ca.pem" -fsS --connect-timeout 2 --max-time 5 "https://$bind:18444/download" >/dev/null; then break; fi
  sleep 2
done
test "$(curl --cacert "$state/tls/ca.pem" -sS -o /dev/null -w '%{http_code}' --max-time 10 "https://$bind:18443/api/v1/projects")" = 401
test "$(curl --cacert "$state/tls/ca.pem" -sS -o /dev/null -w '%{http_code}' --max-time 10 "https://$bind:18444/api/v1/projects")" = 404
python3 - "$state" "$bind" <<'PY'
import json,ssl,sys,urllib.request
from pathlib import Path
p=Path(sys.argv[1]);base="https://"+sys.argv[2]+":18443/api/v1"
ctx=ssl.create_default_context(cafile=str(p/"tls/ca.pem"))
def post(path,token):
    q=urllib.request.Request(base+path,data=b"{}",headers={"Authorization":"Bearer "+token,"Content-Type":"application/json"})
    with urllib.request.urlopen(q,context=ctx,timeout=10) as r:return json.load(r)
s=post("/session",(p/"secrets/admin-token").read_text().strip())["session_token"]
q=urllib.request.Request(base+"/projects",headers={"Authorization":"Bearer "+s})
with urllib.request.urlopen(q,context=ctx,timeout=10) as r:
    assert any(x["code"]=="raschet" for x in json.load(r))
assert post("/session/logout",s)["revoked"]
PY
echo "DELIVERY_PRIVATE_TLS_STAGING_OK"
