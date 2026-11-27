#!/usr/bin/env bash
# Local operator tool. PostgreSQL authentication is provided by libpq (PG* / .pgpass).
# Never place payment data or secrets in arguments. Event IDs are opaque UUIDs.
set -euo pipefail
usage() {
  cat >&2 <<'EOF'
Usage: bash delivery/bin/admin.sh COMMAND ...
  plans
  create SUBSCRIPTION_UUID CUSTOMER_UUID
  bind SUBSCRIPTION_UUID EVENT_UUID INSTALLATION_UUID
  transfer SUBSCRIPTION_UUID EVENT_UUID OLD_INSTALLATION_UUID NEW_INSTALLATION_UUID
  trial SUBSCRIPTION_UUID EVENT_UUID
  renew SUBSCRIPTION_UUID EVENT_UUID month|quarter|year CONFIRMED_KOPECKS
  status SUBSCRIPTION_UUID
  history SUBSCRIPTION_UUID
Requires an authorized database operator; not a public API.
Use the same event UUID to retry a confirmed operation. Never confirm the same payment with a new UUID.
EOF
  exit 2
}
uuid() { [[ "$1" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]] || usage; }
query() {
  local sql="$1"; shift
  printf '%s\n' "$sql" | psql -X -v ON_ERROR_STOP=1 "$@"
}
[[ $# -ge 1 ]] || usage
command="$1"; shift
case "$command" in
  plans)
    [[ $# -eq 0 ]] || usage
    query "SELECT code,amount_kopecks,duration_days,duration_months FROM delivery.plan WHERE product_code='raschet' AND enabled ORDER BY amount_kopecks;"
    ;;
  create)
    [[ $# -eq 2 ]] || usage
    uuid "$1"; uuid "$2"
    query "SELECT * FROM delivery.create_subscription(:'sub'::uuid,:'customer'::uuid,'raschet');" -v sub="$1" -v customer="$2"
    ;;
  bind)
    [[ $# -eq 3 ]] || usage
    uuid "$1"; uuid "$2"; uuid "$3"
    query "SELECT * FROM delivery.set_installation(:'sub'::uuid,:'event'::uuid,NULL,:'device'::uuid);" -v sub="$1" -v event="$2" -v device="$3"
    ;;
  transfer)
    [[ $# -eq 4 ]] || usage
    uuid "$1"; uuid "$2"; uuid "$3"; uuid "$4"
    query "SELECT * FROM delivery.set_installation(:'sub'::uuid,:'event'::uuid,:'old'::uuid,:'device'::uuid);" -v sub="$1" -v event="$2" -v old="$3" -v device="$4"
    ;;
  trial)
    [[ $# -eq 2 ]] || usage
    uuid "$1"; uuid "$2"
    query "SELECT * FROM delivery.grant_period(:'sub'::uuid,:'event'::uuid,'trial',0);" -v sub="$1" -v event="$2"
    ;;
  renew)
    [[ $# -eq 4 ]] || usage
    uuid "$1"; uuid "$2"
    [[ "$3" =~ ^(month|quarter|year)$ && "$4" =~ ^[1-9][0-9]{0,11}$ ]] || usage
    query "SELECT * FROM delivery.grant_period(:'sub'::uuid,:'event'::uuid,:'plan',:'amount'::bigint);" -v sub="$1" -v event="$2" -v plan="$3" -v amount="$4"
    ;;
  status)
    [[ $# -eq 1 ]] || usage; uuid "$1"
    query "SELECT * FROM delivery.subscription_status WHERE id=:'sub'::uuid;" -v sub="$1"
    ;;
  history)
    [[ $# -eq 1 ]] || usage; uuid "$1"
    query "SELECT id,plan_code,amount_kopecks,starts_at,ends_at,revision,recorded_at FROM delivery.grant_event WHERE subscription_id=:'sub'::uuid ORDER BY revision; SELECT id,old_installation,new_installation,revision,recorded_at FROM delivery.installation_event WHERE subscription_id=:'sub'::uuid ORDER BY revision;" -v sub="$1"
    ;;
  *) usage ;;
esac
