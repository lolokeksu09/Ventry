#!/usr/bin/env bash
# New private staging only. Never replace existing credentials or database.
set -euo pipefail
cd "$(dirname "$0")"
umask 077
unset DELIVERY_STATE DELIVERY_BIND_IP COMPOSE_PROJECT_NAME COMPOSE_FILE
state=""
bind="127.0.0.1"
iface=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --state) state="$2";shift 2;;
    --wireguard) iface="$2";bind="$3";shift 3;;
    *) echo "Usage: $0 --state /absolute/path [--wireguard IFACE PRIVATE_IPV4]" >&2;exit 2;;
  esac
done
[[ "$state" = /* && "$state" != "/" && "$state" != "/opt/ventry" && "$state" != *[$'\n\r= ']* ]]
[[ ! -e "$state" ]] || { echo "State directory already exists; refusing to replace keys/data." >&2;exit 1; }
python3 - "$bind" <<'PY'
import ipaddress,sys
ip=ipaddress.IPv4Address(sys.argv[1])
assert ip.is_loopback or any(ip in ipaddress.ip_network(n) for n in ('10.0.0.0/8','172.16.0.0/12','192.168.0.0/16'))
PY
if [[ -n "$iface" ]]; then
  command -v wg >/dev/null
  wg show interfaces | tr ' ' '\n' | grep -Fxq "$iface"
  ip -4 -o addr show dev "$iface" | awk '{print $4}' | cut -d/ -f1 | grep -Fxq "$bind"
else
  [[ "$bind" = 127.0.0.1 ]]
fi
docker compose version >/dev/null
if [[ -n "$(docker ps -aq --filter label=com.docker.compose.project=ventry-delivery)" ]] ||
   [[ -n "$(docker volume ls -q --filter label=com.docker.compose.project=ventry-delivery)" ]]; then
  echo "Existing Delivery compose state found; do not re-initialize." >&2;exit 1
fi
mkdir -m 700 -p "$state"
mkdir -m 700 "$state/secrets" "$state/tls" "$state/backups"
# Host parent stays 0700. Each container sees only its own narrow file mounts.
for f in db-owner db-runtime admin-token signing-key; do
  openssl rand -hex 32 > "$state/secrets/$f"
  chmod 0444 "$state/secrets/$f"
done
printf 'host=127.0.0.1 port=5432 dbname=delivery user=delivery_runtime password=%s sslmode=disable\n' \
  "$(cat "$state/secrets/db-runtime")" > "$state/secrets/db.conf"
chmod 0444 "$state/secrets/db.conf"
openssl req -x509 -newkey rsa:3072 -nodes -days 730 -sha256 \
  -subj '/CN=Ventry Delivery Private CA' \
  -addext 'basicConstraints=critical,CA:TRUE,pathlen:0' \
  -addext 'keyUsage=critical,keyCertSign,cRLSign' \
  -keyout "$state/tls/ca-key.pem" -out "$state/tls/ca.pem" >/dev/null 2>&1
openssl req -new -newkey rsa:3072 -nodes -subj '/CN=Ventry Delivery' \
  -keyout "$state/tls/server-key.pem" -out "$state/tls/server.csr" >/dev/null 2>&1
printf 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:%s\n' "$bind" > "$state/tls/server.ext"
openssl x509 -req -in "$state/tls/server.csr" -CA "$state/tls/ca.pem" -CAkey "$state/tls/ca-key.pem" \
  -CAcreateserial -days 365 -sha256 -extfile "$state/tls/server.ext" -out "$state/tls/server.pem" >/dev/null 2>&1
chmod 0444 "$state/tls/server-key.pem" "$state/tls/server.pem"
openssl verify -CAfile "$state/tls/ca.pem" -verify_ip "$bind" "$state/tls/server.pem" >/dev/null
python3 - "$state" <<'PY'
import hashlib,json,subprocess,sys
from pathlib import Path
r=json.loads(Path("../service/release.json").read_text())
p=Path(sys.argv[1])/"Raschet.apk"
subprocess.run(["curl","--fail","--silent","--show-error","--location","--retry","3","--max-time","120",r["source"],"-o",str(p)],check=True)
assert p.stat().st_size==r["size"] and hashlib.sha256(p.read_bytes()).hexdigest()==r["sha256"]
p.chmod(0o444)
PY
python3 - "$state" <<'PY'
import subprocess,sys
from pathlib import Path
p=Path(sys.argv[1]); seed=bytes.fromhex((p/"secrets/signing-key").read_text().strip())
pub=subprocess.run(["openssl","pkey","-inform","DER","-pubout","-outform","DER"],input=bytes.fromhex("302e020100300506032b657004220420")+seed,capture_output=True,check=True).stdout
assert len(pub)==44 and pub.startswith(bytes.fromhex("302a300506032b6570032100"))
(p/"license-public-key.hex").write_text(pub[-32:].hex()+"\n")
PY
printf 'DELIVERY_STATE=%s\nDELIVERY_BIND_IP=%s\n' "$state" "$bind" > "$state/compose.env"
docker compose --env-file "$state/compose.env" -f compose.yaml config --quiet
echo "DELIVERY_PRIVATE_STAGING_PREPARED"
echo "State: $state"
echo "Admin: https://$bind:18443/"
echo "Client staging: https://$bind:18444/"
openssl x509 -in "$state/tls/ca.pem" -noout -fingerprint -sha256
echo "Run start-private.sh with this state path."
