-- Synthetic populated 005 fixture, preserved across the migration.
SELECT delivery.create_subscription('60000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000002','raschet');
SELECT delivery.set_installation('60000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000003',NULL,'60000000-0000-4000-8000-000000000004');
SELECT delivery.grant_period('60000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000005','month',29900);
CREATE TABLE public.desk_upgrade_snapshot AS SELECT to_jsonb(s) AS subscription,
 (SELECT to_jsonb(g) FROM delivery.grant_event g WHERE g.subscription_id=s.id) AS grant
 FROM delivery.subscription s WHERE id='60000000-0000-4000-8000-000000000001';
