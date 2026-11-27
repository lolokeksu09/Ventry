#!/usr/bin/env bash
# Host-side test against the isolated CI database container, never a production DB.
set -euo pipefail
[[ $# -eq 1 ]] || exit 2
container="$1"
db() { docker exec -i "$container" psql -X -U postgres -d delivery -v ON_ERROR_STOP=1 "$@"; }
sub=10000000-0000-4000-8000-000000000001
customer=10000000-0000-4000-8000-000000000002
event=10000000-0000-4000-8000-000000000003
event2=10000000-0000-4000-8000-000000000004
event3=10000000-0000-4000-8000-000000000005
db -c "SELECT * FROM delivery.create_subscription('$sub','$customer','raschet');"
db -c "SELECT * FROM delivery.grant_period('$sub','$event','month',29900);" &
a=$!
db -c "SELECT * FROM delivery.grant_period('$sub','$event','month',29900);" &
b=$!
wait "$a"; wait "$b"
test "$(db -Atc "SELECT count(*) FROM delivery.grant_event WHERE subscription_id='$sub'")" = 1
db -c "SELECT * FROM delivery.grant_period('$sub','$event2','month',29900);" &
a=$!
db -c "SELECT * FROM delivery.grant_period('$sub','$event3','month',29900);" &
b=$!
wait "$a"; wait "$b"
test "$(db -Atc "SELECT count(*) FROM delivery.grant_event WHERE subscription_id='$sub'")" = 3
test "$(db -Atc "SELECT count(*) FROM (SELECT starts_at,lag(ends_at) OVER (ORDER BY revision) AS prior FROM delivery.grant_event WHERE subscription_id='$sub') q WHERE prior IS NOT NULL AND starts_at<>prior")" = 0
test "$(db -Atc "SELECT (s.valid_until=max(g.ends_at))::int FROM delivery.subscription s JOIN delivery.grant_event g ON g.subscription_id=s.id WHERE s.id='$sub' GROUP BY s.valid_until")" = 1
echo 'DELIVERY_CONCURRENT_RENEWAL_PASS'
