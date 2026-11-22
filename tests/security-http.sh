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
printf '%s\n' 'public test fixture' > "$tmp/site/public-security-test.txt"

docker run --detach --rm --name "$name" \
  --publish 127.0.0.1:18080:18080 \
  --env VENTRY_SITE_ADDRESS=:18080 \
  --volume "$tmp/site:/srv:ro" \
  --volume "$PWD/deploy/Caddyfile:/etc/caddy/Caddyfile:ro" \
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

curl --fail --silent --show-error --dump-header "$tmp/headers" --output "$tmp/home" "$base/"
grep -Fq 'Ventry' "$tmp/home"
tr -d '\r' < "$tmp/headers" > "$tmp/headers-clean"
grep -Eiq "^content-security-policy: .*default-src 'none'; script-src 'self'; style-src 'self';" "$tmp/headers-clean"
grep -Eiq "^x-content-type-options: nosniff" "$tmp/headers-clean"
grep -Eiq "^x-frame-options: DENY" "$tmp/headers-clean"

for path in '/' '/index.html' '/projects/raschet/' '/legal/' '/privacy/'; do
  curl --fail --silent --show-error --max-time 5 --head "$base$path" > "$tmp/page-headers"
  grep -Eiq '^cache-control: no-cache[[:space:]]*

for path in \
  '/.env' '/.env.local' '/.git/config' '/.github/workflows/deploy.yml' \
  '/backup.sql' '/data.zip' '/archive.tar.gz' '/project.bak' \
  '/projects/raschet/.git/HEAD' '/certs/server.pem' '/snapshots/backup.sqlite'; do
  status="$(curl --path-as-is --silent --show-error --max-time 5 \
    --output /dev/null --write-out '%{http_code}' "$base$path")"
  if [ "$status" != 404 ]; then
    echo "FAIL: sensitive URL $path returned HTTP $status"; exit 1
  fi
done

for path in '/projects/raschet/' '/legal/' '/privacy/' '/app.js' \
  '/styles.css' '/favicon.svg' '/sitemap.xml' \
  '/google9048871eda96ab4a.html' '/public-security-test.txt'; do
  status="$(curl --silent --show-error --max-time 5 \
    --output /dev/null --write-out '%{http_code}' "$base$path")"
  if [ "$status" != 200 ]; then
    echo "FAIL: public URL $path returned HTTP $status"; exit 1
  fi
done

echo "PASS: Caddy CSP/security headers, 11 denied paths (including existing fixtures) and 9 public paths"
 "$tmp/page-headers" || {
    echo "FAIL: HTML cache revalidation missing for $path"; exit 1;
  }
done

for path in \
  '/.env' '/.env.local' '/.git/config' '/.github/workflows/deploy.yml' \
  '/backup.sql' '/data.zip' '/archive.tar.gz' '/project.bak' \
  '/projects/raschet/.git/HEAD' '/certs/server.pem' '/snapshots/backup.sqlite'; do
  status="$(curl --path-as-is --silent --show-error --max-time 5 \
    --output /dev/null --write-out '%{http_code}' "$base$path")"
  if [ "$status" != 404 ]; then
    echo "FAIL: sensitive URL $path returned HTTP $status"; exit 1
  fi
done

for path in '/projects/raschet/' '/legal/' '/privacy/' '/app.js' \
  '/styles.css' '/favicon.svg' '/sitemap.xml' \
  '/google9048871eda96ab4a.html' '/public-security-test.txt'; do
  status="$(curl --silent --show-error --max-time 5 \
    --output /dev/null --write-out '%{http_code}' "$base$path")"
  if [ "$status" != 200 ]; then
    echo "FAIL: public URL $path returned HTTP $status"; exit 1
  fi
done

echo "PASS: Caddy CSP/security headers, 11 denied paths (including existing fixtures) and 9 public paths"
