#!/usr/bin/env bash
set -euo pipefail
image="${VENTRY_CADDY_IMAGE:-ventry-caddy:patched-test}"
name="ventry-license-ci-${GITHUB_RUN_ID:-local}-$$"
tmp="$(mktemp -d)"
cleanup() {
  docker rm -f "$name-front" "$name-back" >/dev/null 2>&1 || true
  docker network rm "$name" >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT
# Test the production license site block with HTTP instead of ACME.
sed 's/^license[.]ventrylab[.]top {/http:\/\/license.ventrylab.top {/' delivery/public/license.Caddyfile > "$tmp/front"
# Test same block is shipped in the real site config.
python3 - <<'PY'
from pathlib import Path
assert Path("deploy/Caddyfile").read_text().endswith(Path("delivery/public/license.Caddyfile").read_text())
PY
cat > "$tmp/back" <<'CADDY'
:18090 {
    respond "{http.request.header.X-Ventry-Client-IP}" 200
}
CADDY
docker network create "$name" >/dev/null
docker run -d --name "$name-back" --network "$name" --network-alias ventry-public-gateway -v "$tmp/back:/etc/caddy/Caddyfile:ro" "$image" >/dev/null
docker run -d --name "$name-front" --network "$name" -p 127.0.0.1:18089:80 -v "$tmp/front:/etc/caddy/Caddyfile:ro" "$image" >/dev/null
url=http://127.0.0.1:18089
for i in $(seq 1 30); do
  if curl -fsS -H 'Host: license.ventrylab.top' -H 'X-Ventry-Client-IP: 203.0.113.99' -X POST "$url/api/v1/entitlement" > "$tmp/body"; then break; fi
  sleep 1
done
python3 - "$tmp/body" <<'PY'
import ipaddress,sys
ip=ipaddress.ip_address(open(sys.argv[1]).read().strip())
assert str(ip)!="203.0.113.99"
PY
for path in / /download /download.js /api/v1/download /api/v1/session /api/v1/projects /api/v1/customers/x /api/v1/subscriptions/x/grant; do
  for method in GET POST; do
    test "$(curl -sS -H 'Host: license.ventrylab.top' -X "$method" -o /dev/null -w '%{http_code}' "$url$path")" = 404
  done
done
for path in /api/v1/activate /api/v1/entitlement; do
  test "$(curl -sS -H 'Host: license.ventrylab.top' -X GET -o /dev/null -w '%{http_code}' "$url$path")" = 404
  test "$(curl -sS -H 'Host: license.ventrylab.top' -X POST -o /dev/null -w '%{http_code}' "$url$path")" = 200
done
echo LICENSE_INGRESS_BOUNDARY_OK
