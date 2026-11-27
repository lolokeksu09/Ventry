# Owner runbook: private Delivery schema 005 → 006

This is a planned maintenance operation on an existing private Delivery PostgreSQL 17 installation, not an automatic production deployment. Do not run provision again or remove volumes. Use a CI-verified revision; keep the signing seed, CA, operator token and DB runtime secrets unchanged. The Ventry site is a separate Compose project and is not modified.

## Preconditions
- Actual owner SSH access to the VDS and exact existing state path; site-only CI SSH cannot perform this.
- Verified checkout and sufficient free disk for a complete custom-format dump and temporary restored database in the existing cluster. Ubuntu util-linux flock, Docker Compose, PostgreSQL owner access through the container.
- Maintenance window; notify users of temporary interruption, close administrator and manual database clients, stop other operator automation. No concurrent start/provision/update/manual writes. Upgrade stops only Delivery API and edge, leaves the DB running.
- Back up state keys separately using an approved protected backup mechanism; pg_dump is not a backup of keys, roles or the host. Store dumps under restricted access and arrange off-host encrypted copies. The script does not copy secrets.

## Check (read-only)
Run from the verified checkout:
```bash
bash delivery/deploy/upgrade-006.sh /opt/ventry-delivery-state --check
```
Only DELIVERY_SCHEMA_005_UPGRADE_REQUIRED or DELIVERY_SCHEMA_006_ALREADY_READY is supported. A partial/unknown schema or unavailable DB blocks the operation. For a stopped DB, start only the existing db service with its existing Compose project before the check. Do not use the example state path if your installation uses a different path.

## Apply (explicit, downtime)
```bash
bash delivery/deploy/upgrade-006.sh /opt/ventry-delivery-state --apply
```
The script takes a state lock, refuses other connected database clients, stops edge/API, creates a restricted archive, verifies SHA-256, restores the complete dump into a newly named temporary database, compares deterministic fingerprints of every original delivery table, checks the live fingerprint again and applies the transactional migration with timeouts. It verifies schema, foreign-key backfill, least-privilege boundary and unchanged original data. It removes only the temporary verification database. The retained archive and hash are never automatically deleted. Re-running on a complete 006 schema is a no-op, not a second migration.

On success DELIVERY_006_UPGRADE_VERIFIED is printed. Restart only after success, with the same verified checkout:
```bash
bash delivery/deploy/start-private.sh /opt/ventry-delivery-state
```
The start script refuses a stale/partial schema before starting the updated API; existing DB containers are not recreated by the preflight. Existing TLS/session smoke tests then verify connectivity and private routing. Check existing real subscriptions and an authorized read-only customer/desk/revenue query without printing private customer names or tokens. The migration does not issue or renew licenses.

## Failure / rollback
Before the migration commits, a SQL error rolls back the transaction. If a failure occurs after commit, the script cannot reverse it; it leaves API/edge stopped for owner investigation. A persistent upgrade-006.incomplete marker is created before migration and removed only after successful verification and temporary database cleanup. Both upgrade and startup refuse while the marker exists. Do not remove it without inspecting the referenced backup and reconciling the exact schema and original table fingerprints. Preserve the archive and database, inspect which schema is present, and reconcile any writes before recovery. Never blindly restore over the live database. For destructive restore or cutover use a separate owner-approved recovery plan, verify in a separate database/cluster, account for writes and preserve signing identity. No claim of zero downtime or automatic rollback after commit.

CI uses a synthetic populated 005 volume, rejects stale-schema startup, executes the exact upgrade, verifies restoration and existing subscription/payment fields, checks a repeat invocation and starts the private TLS stack. No real VDS or production data is touched by CI.
