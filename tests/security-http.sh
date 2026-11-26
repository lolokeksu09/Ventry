#!/usr/bin/env bash
# Test the actual Caddy routing and response headers, not just Caddyfile text.
set -euo pipefail

base='http://127.0.0.1:18080'
name="ventry-caddy-sec-${GITHUB_RUN_ID:-local}-$$"
tmp="$(mktemp -d)"
cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT

# Synthetic files exercise blocking of paths that really exist. Never add
# real secrets to the test or to the published site.
cp -a "$PWD/site" "$tmp/site"
mkdir -p "$tmp/site/.git" "$tmp/site/certs" "$tmp/site/projects/raschet/.git"
for fixture in '.env' '.git/config' 'backup.sql' 'data.zip' 'project.bak' \
  'certs/server.pem' 'projects/raschet/.git/HEAD'; do
  printf '%s\n' 'non-secret smoke-test fixture' > "$tmp/site/$fixture"
done
# These files look like ordinary web assets but are not approved for publication.
for fixture in notes.txt debug.json extra.html stray.js stray.css app.js.map; do
  printf '%s\n' 'non-secret unpublished fixture' > "$tmp/site/$fixture"
done

# For HTTP-only security tests, replace just the production site-address line.
# The full production Caddyfile is validated separately with both HTTPS names.
grep -Fxq 'ventrylab.top, 135-106-227-179.sslip.io {' "$PWD/deploy/Caddyfile"
sed 's/^ventrylab[.]top, 135-106-227-179[.]sslip[.]io {$/:80 {/' "$PWD/deploy/Caddyfile" > "$tmp/Caddyfile"
grep -Fxq ':80 {' "$tmp/Caddyfile"

docker run --detach --rm --name "$name" \
  --publish 127.0.0.1:18080:80 \
  --read-only --tmpfs /tmp \
  --security-opt no-new-privileges:true --cap-drop ALL --cap-add NET_BIND_SERVICE \
  --log-driver json-file --log-opt max-size=10m --log-opt max-file=3 \
  --volume "$tmp/site:/srv:ro" \
  --volume "$tmp/Caddyfile:/etc/caddy/Caddyfile:ro" \
  "${VENTRY_CADDY_IMAGE:-ventry-caddy:patched-test}" > /dev/null

ready=0
for i in $(seq 1 40); do
  if curl --silent --max-time 2 "$base/healthz" | grep -Fxq 'ok'; then
    ready=1
    break
  fi
  sleep 1
done
if [ "$ready" != 1 ]; then
  echo "FAIL: Caddy did not start"; docker logs "$name" 2>&1 | tail -20; exit 1
fi

# Confirm process credentials, not merely Docker configuration.
docker exec "$name" cat /proc/1/status > "$tmp/process-status"
grep -Eq '^NoNewPrivs:[[:space:]]+1$' "$tmp/process-status"
grep -Eiq '^CapEff:[[:space:]]+0*400$' "$tmp/process-status"
grep -Eiq '^CapBnd:[[:space:]]+0*400$' "$tmp/process-status"
test "$(docker inspect --format '{{.HostConfig.ReadonlyRootfs}}' "$name")" = true
test "$(docker inspect --format '{{index .HostConfig.LogConfig.Config "max-size"}}' "$name")" = 10m
test "$(docker inspect --format '{{index .HostConfig.LogConfig.Config "max-file"}}' "$name")" = 3

curl --fail --silent --show-error --dump-header "$tmp/headers" --output "$tmp/home" "$base/"
grep -Fq 'Ventry' "$tmp/home"
tr -d '\r' < "$tmp/headers" > "$tmp/headers-clean"
grep -Eiq "^content-security-policy: .*default-src 'none'; script-src 'self'; style-src 'self';" "$tmp/headers-clean"
grep -Eiq "^x-content-type-options: nosniff" "$tmp/headers-clean"
grep -Eiq "^x-frame-options: DENY" "$tmp/headers-clean"
if grep -Eiq "^server:" "$tmp/headers-clean"; then echo "FAIL: Server header exposed"; exit 1; fi

for path in '/' '/index.html' '/projects/raschet/' '/legal/' '/privacy/' '/releases/' '/docs/' '/support/'; do
  curl --fail --silent --show-error --max-time 5 --head "$base$path" > "$tmp/page-headers"
  grep -Eiq '^cache-control: no-cache[[:space:]]*$' "$tmp/page-headers" || {
    echo "FAIL: HTML cache revalidation missing for $path"; exit 1;
  }
done

for path in \
  '/.env' '/.env.local' '/.git/config' '/.github/workflows/deploy.yml' \
  '/backup.sql' '/data.zip' '/archive.tar.gz' '/project.bak' \
  '/projects/raschet/.git/HEAD' '/certs/server.pem' '/snapshots/backup.sqlite' \
  '/notes.txt' '/debug.json' '/extra.html' '/stray.js' '/stray.css' '/app.js.map'; do
  status="$(curl --path-as-is --silent --show-error --max-time 5 \
    --output /dev/null --write-out '%{http_code}' "$base$path")"
  if [ "$status" != 404 ]; then
    echo "FAIL: sensitive URL $path returned HTTP $status"; exit 1
  fi
done

for path in '/projects/raschet/' '/legal/' '/privacy/' '/releases/' '/docs/' '/support/' '/app.js' \
  '/styles.css' '/favicon.svg' '/sitemap.xml' \
  '/google9048871eda96ab4a.html' '/fonts/OFL.txt' '/raschet/' '/raschet/app.js'; do
  status="$(curl --silent --show-error --max-time 5 \
    --output /dev/null --write-out '%{http_code}' "$base$path")"
  if [ "$status" != 200 ]; then
    echo "FAIL: public URL $path returned HTTP $status"; exit 1
  fi
done

for method in POST PUT PATCH DELETE OPTIONS TRACE; do
  for path in '/' '/healthz' '/raschet/'; do
    status="$(curl --silent --show-error --max-time 5 --request "$method" --dump-header "$tmp/method-headers" --output /dev/null --write-out '%{http_code}' "$base$path")"
    test "$status" = 405 || { echo "FAIL: $method $path returned $status"; exit 1; }
    grep -Eiq '^allow: GET, HEAD[[:space:]]*$' "$tmp/method-headers"
    if grep -Eiq '^server:' "$tmp/method-headers"; then echo "FAIL: Server header on rejection"; exit 1; fi
  done
done
for path in '/notes.txt' '/.env' '/__not_found__'; do
  status="$(curl --silent --show-error --max-time 5 --dump-header "$tmp/deny-headers" --output /dev/null --write-out '%{http_code}' "$base$path")"
  test "$status" = 404
  if grep -Eiq '^server:' "$tmp/deny-headers"; then echo "FAIL: Server header on denial"; exit 1; fi
done
echo "PASS: headers, publication manifest, denied existing fixtures, public routes and method restrictions"
