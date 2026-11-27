# Ventry Admin: server desk (issue #82, backend stage)
Private admin API only. Existing endpoints unchanged. Migration 006 creates customer IDs from existing subscriptions and attaches a trigger for future creates, including CLI. No production migration is performed by this PR. Existing databases do not rerun Docker initialization scripts; the operator must separately back up, verify restoration and apply 006 with the database owner before enabling the new endpoints. A short write lock on subscription is expected; schedule a maintenance window. Never remove the existing database volume.

- GET /api/v1/customers/{id}: id, display_name (nullable), revision.
- POST same: display_name (nullable), revision; identical retries return current card; conflicting edit returns 409. Null clears name.
- GET /api/v1/projects/{code}/desk?q=&filter=all&after=UUID: up to 100 rows, customer_name and customer_revision; use last id for next page, empty page ends. Expiring sorts by expiry then id; others by id. Restart after mutations; not a snapshot.
- GET /api/v1/projects/{code}/revenue?days=7 (7/30/90, omitted = all): rolling exact 24h days by recorded_at, [from,to), zero-value trials excluded. Confirmed amounts are not fiscal receipts.
- GET /api/v1/subscriptions/{id}/payments?after=UUID: up to 100 positive grants newest first; cursor scoped to subscription, use last id. No tokens or device credentials returned.

Admin Android integration and explicit local-label import are a subsequent part of #82. No new public client routes. SQL and HTTP tests run in isolated CI only.
