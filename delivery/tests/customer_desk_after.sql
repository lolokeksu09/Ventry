BEGIN;
SET LOCAL plpgsql.check_asserts=on;
DO $$
BEGIN
    ASSERT (SELECT to_jsonb(s) FROM delivery.subscription s WHERE id='60000000-0000-4000-8000-000000000001')=(SELECT subscription FROM public.desk_upgrade_snapshot);
    ASSERT (SELECT to_jsonb(g) FROM delivery.grant_event g WHERE id='60000000-0000-4000-8000-000000000005')=(SELECT grant FROM public.desk_upgrade_snapshot);
    ASSERT NOT has_table_privilege('delivery_api','delivery.customer','SELECT');
    ASSERT NOT has_table_privilege('delivery_api','delivery.customer','UPDATE');
END $$;
SET LOCAL ROLE delivery_api;
DO $$
DECLARE s uuid:='60000000-0000-4000-8000-000000000001'; c uuid:='60000000-0000-4000-8000-000000000002';
    other uuid:=gen_random_uuid(); fresh uuid:=gen_random_uuid(); results jsonb;
BEGIN
    ASSERT delivery.api_customer(c)->>'revision'='0';
    ASSERT delivery.api_customer_name(c,'Test % shop',0)->>'revision'='1';
    ASSERT delivery.api_customer_name(c,'Test % shop',0)->>'revision'='1';
    BEGIN
        PERFORM delivery.api_customer_name(c,'stale write',0);
        RAISE EXCEPTION USING ERRCODE='XX000',MESSAGE='stale revision accepted';
    EXCEPTION WHEN raise_exception THEN NULL; END;
    ASSERT delivery.api_desk('raschet','%','all',NULL)->0->>'id'=s::text;
    ASSERT jsonb_array_length(delivery.api_desk('raschet','absent','all',NULL))=0;
    ASSERT jsonb_array_length(delivery.api_desk('raschet','%','all',s))=0;
    ASSERT delivery.api_revenue('raschet',7)->>'confirmed_kopecks'='29900';
    ASSERT delivery.api_revenue('raschet',7)->>'payment_count'='1';
    ASSERT jsonb_array_length(delivery.api_payment_page(s,NULL))=1;
    ASSERT jsonb_array_length(delivery.api_payment_page(s,'60000000-0000-4000-8000-000000000005'))=0;
    PERFORM delivery.api_create(other,fresh,'raschet');
    ASSERT delivery.api_customer(fresh)->>'id'=fresh::text;
    BEGIN
        PERFORM delivery.api_payment_page(other,'60000000-0000-4000-8000-000000000005');
        RAISE EXCEPTION USING ERRCODE='XX000',MESSAGE='foreign cursor accepted';
    EXCEPTION WHEN no_data_found THEN NULL; END;
END $$;
RESET ROLE;
-- 101 paid records across page boundary; equal timestamps force UUID tie-break.
INSERT INTO delivery.grant_event(id,subscription_id,product_code,plan_code,amount_kopecks,starts_at,ends_at,revision,recorded_at)
SELECT gen_random_uuid(),'60000000-0000-4000-8000-000000000001','raschet','month',29900,
  now()-interval '2 days',now()-interval '1 day',100+i,now()-interval '2 days' FROM generate_series(1,101) i;
UPDATE delivery.subscription SET valid_until=now()+interval '3 days' WHERE id='60000000-0000-4000-8000-000000000001';
SET LOCAL ROLE delivery_api;
DO $$
DECLARE s uuid:='60000000-0000-4000-8000-000000000001'; p jsonb; q jsonb;
BEGIN
    p:=delivery.api_payment_page(s,NULL);
    q:=delivery.api_payment_page(s,(p->99->>'id')::uuid);
    ASSERT jsonb_array_length(p)=100 AND jsonb_array_length(q)=2;
    ASSERT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p) a CROSS JOIN jsonb_array_elements(q) b WHERE a->>'id'=b->>'id');
    ASSERT delivery.api_revenue('raschet',7)->>'payment_count'='102';
    ASSERT delivery.api_desk('raschet','Test','expiring',NULL)->0->>'id'=s::text;
END $$;
ROLLBACK;
-- Remove fixture before independent HTTP scenarios (test database only).
DELETE FROM delivery.grant_event WHERE subscription_id='60000000-0000-4000-8000-000000000001';
DELETE FROM delivery.installation_event WHERE subscription_id='60000000-0000-4000-8000-000000000001';
DELETE FROM delivery.subscription WHERE id='60000000-0000-4000-8000-000000000001';
DELETE FROM delivery.customer WHERE id='60000000-0000-4000-8000-000000000002';
DROP TABLE public.desk_upgrade_snapshot;
SELECT 'DELIVERY_CUSTOMER_005_TO_006_PASS';
