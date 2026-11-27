#!/usr/bin/env bash
# Explicit owner-run offline upgrade of an existing private Delivery 005 database.
# No production invocation in CI; never removes the live database or volume.
set -euo pipefail
cd "$(dirname "$0")"
umask 077
if [[ $# != 2 || "$1" != /* || ( "$2" != --check && "$2" != --apply ) ]]; then
    echo "Usage: bash upgrade-006.sh /absolute/state --check|--apply" >&2
    exit 2
fi
state="$1"; mode="$2"
unset DELIVERY_STATE DELIVERY_BIND_IP COMPOSE_PROJECT_NAME COMPOSE_FILE
grep -Fxq "DELIVERY_STATE=$state" "$state/compose.env"
dc() { docker compose --env-file "$state/compose.env" -f compose.yaml "$@"; }
db() { dc exec -T -u postgres db psql -X -qAt -U postgres -d "$1" -v ON_ERROR_STOP=1 "${@:2}"; }
schema() { db delivery < schema-006-state.sql; }
fingerprint() { db "$1" < fingerprint-005-data.sql | sha256sum | cut -d' ' -f1; }
no_other_clients() {
    test "$(db delivery -c "SELECT count(*) FROM pg_catalog.pg_stat_activity
        WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'")" = 0
}
verify_006() {
    test "$(schema)" = ready
    test "$(db delivery -c "SELECT NOT EXISTS(SELECT 1 FROM delivery.subscription s
        LEFT JOIN delivery.customer c ON c.id=s.customer_id WHERE c.id IS NULL)")" = t
    test "$(db delivery -c "SELECT NOT has_table_privilege('delivery_api','delivery.customer','SELECT')
        AND NOT has_table_privilege('delivery_api','delivery.customer','UPDATE')
        AND has_function_privilege('delivery_api','delivery.api_desk(text,text,text,uuid)','EXECUTE')")" = t
}
if [[ "$mode" = --apply ]]; then
    exec 9>"$state/upgrade-006.lock"
    flock -n 9 || { echo "Another upgrade holds the state lock" >&2; exit 1; }
fi
version="$(schema)"
case "$version" in
    ready) verify_006; echo DELIVERY_SCHEMA_006_ALREADY_READY; exit 0 ;;
    upgrade_required) echo DELIVERY_SCHEMA_005_UPGRADE_REQUIRED ;;
    *) echo "Unsupported or partial Delivery schema; refusing upgrade" >&2; exit 1 ;;
esac
[[ "$mode" = --apply ]] || exit 0
# From this point, a failed operation leaves the API and edge stopped.
# Manual owners must close all CLI sessions and refrain from direct database writes.
dc stop edge api
no_other_clients || { echo "Other database clients are connected; refusing migration" >&2; exit 1; }
test "$(schema)" = upgrade_required
dir="$(mktemp -d "$state/backups/upgrade-006-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXXXX")"
archive="$dir/delivery.dump"
restore_db="delivery_verify_006_$(date +%s)_${RANDOM}_${RANDOM}"
restore_created=false
cleanup() {
    local rc=$?
    trap - EXIT
    if [[ "$restore_created" = true ]]; then
        if ! dc exec -T -u postgres db dropdb -U postgres "$restore_db"; then
            echo "Could not remove temporary verification database $restore_db; inspect manually" >&2
            rc=1
        fi
    fi
    if [[ "$rc" != 0 ]]; then
        echo "Upgrade incomplete. Keep API/edge stopped; inspect state and backup $dir. No automatic restore." >&2
    fi
    exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
before="$(fingerprint delivery)"
dc exec -T -u postgres db pg_dump -U postgres -Fc delivery > "$archive"
test -s "$archive"
sha256sum "$archive" > "$archive.sha256"
sha256sum -c "$archive.sha256"
dc exec -T -u postgres db pg_restore -l < "$archive" >/dev/null
# A dump listing alone does not prove recoverability.
dc exec -T -u postgres db createdb -U postgres --template=template0 "$restore_db"
restore_created=true
dc exec -T -u postgres db pg_restore -U postgres -d "$restore_db" --exit-on-error < "$archive"
test "$(fingerprint "$restore_db")" = "$before"
test "$(fingerprint delivery)" = "$before"
no_other_clients
echo DELIVERY_006_BACKUP_RESTORE_VERIFIED
# The migration owns its BEGIN/COMMIT and rolls back on SQL failure.
dc exec -T -u postgres -e 'PGOPTIONS=-c lock_timeout=5s -c statement_timeout=600s' db \
    psql -X -U postgres -d delivery -v ON_ERROR_STOP=1 < ../migrations/006_customer_desk.sql
verify_006
test "$(fingerprint delivery)" = "$before"
printf '%s\n' "$before" > "$dir/original-tables.sha256"
printf '%s\n' "DELIVERY_006_UPGRADE_VERIFIED $dir"
echo "API/edge remain stopped. Run start-private.sh for the checked revision."
