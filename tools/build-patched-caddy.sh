#!/usr/bin/env bash
# Build official Caddy v2.11.9 source with the fixed golang.org/x/net module.
# The Go module proxy/sumdb verify the downloaded source archive and dependencies.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output="${1:-$root/deploy/caddy-patched}"
source_version='v2.11.9'
fixed_net='v0.62.0'
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

go version
go mod download "github.com/caddyserver/caddy/v2@$source_version"
source_dir="$(go env GOMODCACHE)/github.com/caddyserver/caddy/v2@$source_version"
test -f "$source_dir/go.mod"
mkdir "$tmp/src"
cp -a "$source_dir/." "$tmp/src/"
chmod -R u+w "$tmp/src"
cd "$tmp/src"

# Upgrade only the vulnerable Go module, retaining Caddy's other source dependencies.
go get "golang.org/x/net@$fixed_net"
go mod tidy
actual="$(go list -m -f '{{.Version}}' golang.org/x/net)"
if [[ "$actual" != "$fixed_net" ]]; then
  echo "Refusing to build: golang.org/x/net resolved to $actual" >&2
  exit 1
fi

mkdir -p "$(dirname "$output")"
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o "$output" ./cmd/caddy

# Verify the *binary*, not just a go.mod file that could have been ignored.
go version -m "$output" > "$tmp/module-report"
if ! grep -Eq "^[[:space:]]*dep[[:space:]]+golang.org/x/net[[:space:]]+$fixed_net([[:space:]]|$)" "$tmp/module-report"; then
  echo "Refusing to ship: fixed golang.org/x/net is absent from binary" >&2
  exit 1
fi
echo "PASS: Caddy $source_version built with golang.org/x/net $fixed_net"
sha256sum "$output"
