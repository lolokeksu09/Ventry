#!/usr/bin/env bash
# Synthetic staging on a CI runner, never a production installation.
set -euo pipefail
umask 077
export POSTGRES_PASSWORD="$(openssl rand -hex 32)"
runtime_password="$(openssl rand -hex 32)"
docker run -d --name ventry-admin-ci -p 127.0.0.1:55432:5432 --env POSTGRES_PASSWORD -e POSTGRES_DB=delivery postgres:17
for i in $(seq 1 60); do
    if docker exec ventry-admin-ci pg_isready -h 127.0.0.1 -U postgres -d delivery; then break; fi
    sleep 1
done
db() { docker exec -i ventry-admin-ci psql -X -U postgres -d delivery -v ON_ERROR_STOP=1 "$@"; }
for migration in delivery/migrations/001_subscriptions.sql delivery/migrations/002_api_and_downloads.sql delivery/migrations/003_projects.sql delivery/migrations/004_activation.sql; do
    db < "$migration"
done
printf "CREATE ROLE delivery_runtime LOGIN PASSWORD '%s' IN ROLE delivery_api;\n" "$runtime_password" | db
printf 'host=127.0.0.1 port=55432 dbname=delivery user=delivery_runtime password=%s sslmode=disable\n' "$runtime_password" > "$RUNNER_TEMP/ventry-admin-db.conf"
openssl rand -hex 32 > "$RUNNER_TEMP/ventry-admin-token"
python3 - <<'PY'
import hashlib,json,os,subprocess
from pathlib import Path
r=json.loads(Path("delivery/service/release.json").read_text())
p=Path(os.environ["RUNNER_TEMP"])/"ventry-admin-raschet.apk"
subprocess.run(["curl","--fail","--silent","--show-error","--location","--retry","3","--max-time","120",r["source"],"-o",str(p)],check=True)
assert p.stat().st_size==r["size"]
assert hashlib.sha256(p.read_bytes()).hexdigest()==r["sha256"]
PY
export DELIVERY_DB_CONFIG_FILE="$RUNNER_TEMP/ventry-admin-db.conf"
export DELIVERY_ADMIN_TOKEN_FILE="$RUNNER_TEMP/ventry-admin-token"
openssl rand -hex 32 > "$RUNNER_TEMP/ventry-admin-signing-key"
export DELIVERY_SIGNING_KEY_FILE="$RUNNER_TEMP/ventry-admin-signing-key"
export DELIVERY_APK="$RUNNER_TEMP/ventry-admin-raschet.apk"
export DELIVERY_APKSIGNER="$ANDROID_HOME/build-tools/35.0.0/apksigner"
export DELIVERY_AAPT="$ANDROID_HOME/build-tools/35.0.0/aapt"
export DELIVERY_ADMIN_ADDR=127.0.0.1:18081
export DELIVERY_PUBLIC_ADDR=127.0.0.1:18082
export DELIVERY_PUBLIC_ORIGIN=http://127.0.0.1:18082
# Native admin tests use session-only by default.
delivery/service/target/debug/ventry-delivery > "$RUNNER_TEMP/ventry-admin-service.log" 2>&1 &
echo "$!" > "$RUNNER_TEMP/ventry-admin-service.pid"
for i in $(seq 1 40); do
    if curl -fsS http://127.0.0.1:18081/ >/dev/null; then exit 0; fi
    kill -0 "$(cat "$RUNNER_TEMP/ventry-admin-service.pid")" || { cat "$RUNNER_TEMP/ventry-admin-service.log"; exit 1; }
    sleep 1
done
cat "$RUNNER_TEMP/ventry-admin-service.log"; exit 1
