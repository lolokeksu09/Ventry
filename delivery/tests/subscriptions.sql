-- Integration tests against a real fresh PostgreSQL instance; synthetic IDs only.
BEGIN;
SET LOCAL plpgsql.check_asserts = on;
SET LOCAL TimeZone = 'UTC';

DO $$
DECLARE a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c uuid:=gen_random_uuid();
    customer uuid:=gen_random_uuid(); device uuid:=gen_random_uuid(); other uuid:=gen_random_uuid();
    binding uuid:=gen_random_uuid(); trial uuid:=gen_random_uuid(); paid uuid:=gen_random_uuid();
    transfer uuid:=gen_random_uuid(); receipt delivery.grant_event; replay delivery.grant_event;
    renewal delivery.grant_event; expired delivery.grant_event; previous timestamptz;
    installed delivery.installation_event; moved delivery.installation_event; s delivery.subscription;
BEGIN
    ASSERT (SELECT array_agg(amount_kopecks ORDER BY amount_kopecks) FROM delivery.plan WHERE product_code='raschet')
        = ARRAY[0,29900,79900,249000]::bigint[];
    PERFORM delivery.create_subscription(a,customer,'raschet');
    PERFORM delivery.create_subscription(a,customer,'raschet');
    ASSERT (SELECT status FROM delivery.subscription_status WHERE id=a)='not_started';
    BEGIN
        PERFORM delivery.create_subscription(a,gen_random_uuid(),'raschet');
        RAISE EXCEPTION USING ERRCODE='XX000',MESSAGE='customer mismatch accepted';
    EXCEPTION WHEN raise_exception THEN NULL; END;
    BEGIN
        PERFORM delivery.create_subscription(b,customer,'raschet');
        RAISE EXCEPTION USING ERRCODE='XX000',MESSAGE='duplicate subscription accepted';
    EXCEPTION WHEN unique_violation THEN NULL; END;
    PERFORM delivery.create_subscription(b,gen_random_uuid(),'raschet');
    PERFORM delivery.create_subscription(c,gen_random_uuid(),'raschet');

    BEGIN
        PERFORM delivery.grant_period(a,trial,'trial',0);
        RAISE EXCEPTION USING ERRCODE='XX000',MESSAGE='unbound trial accepted';
    EXCEPTION WHEN raise_exception THEN NULL; END;
    installed:=delivery.set_installation(a,binding,NULL,device);
    ASSERT installed=delivery.set_installation(a,binding,NULL,device);
    BEGIN
        PERFORM delivery.set_installation(b,gen_random_uuid(),NULL,device);
        RAISE EXCEPTION USING ERRCODE='XX000',MESSAGE='installation assigned twice';
    EXCEPTION WHEN unique_violation THEN NULL; END;
    receipt:=delivery.grant_period(a,trial,'trial',0);
    ASSERT receipt.ends_at=receipt.starts_at+interval '7 days';
    ASSERT receipt=delivery.grant_period(a,trial,'trial',0);
    ASSERT (SELECT status FROM delivery.subscription_status WHERE id=a)='active';
    ASSERT (SELECT effective_plan FROM delivery.subscription_status WHERE id=a)='trial';
    ASSERT (SELECT may_create_debt FROM delivery.subscription_status WHERE id=a);
    BEGIN
        PERFORM delivery.grant_period(a,gen_random_uuid(),'trial',0);
        RAISE EXCEPTION USING ERRCODE='XX000',MESSAGE='second trial accepted';
    EXCEPTION WHEN raise_exception THEN NULL; END;
    BEGIN
        PERFORM delivery.grant_period(a,paid,'month',29899);
        RAISE EXCEPTION USING ERRCODE='XX000',MESSAGE='incorrect amount accepted';
    EXCEPTION WHEN raise_exception THEN NULL; END;
    ASSERT NOT EXISTS (SELECT 1 FROM delivery.grant_event WHERE id=paid);
    renewal:=delivery.grant_period(a,paid,'month',29900);
    ASSERT renewal.starts_at=receipt.ends_at;
    ASSERT renewal.ends_at=renewal.starts_at+interval '1 month';
    replay:=delivery.grant_period(a,paid,'month',29900);
    ASSERT replay=renewal;
    ASSERT (SELECT count(*) FROM delivery.grant_event WHERE subscription_id=a)=2;
    BEGIN
        PERFORM delivery.grant_period(a,paid,'quarter',79900);
        RAISE EXCEPTION USING ERRCODE='XX000',MESSAGE='conflicting replay accepted';
    EXCEPTION WHEN raise_exception THEN NULL; END;
    BEGIN
        PERFORM delivery.grant_period(b,paid,'month',29900);
        RAISE EXCEPTION USING ERRCODE='XX000',MESSAGE='cross-customer replay accepted';
    EXCEPTION WHEN raise_exception THEN NULL; END;
    SELECT valid_until INTO previous FROM delivery.subscription WHERE id=a;
    moved:=delivery.set_installation(a,transfer,device,other);
    ASSERT moved=delivery.set_installation(a,transfer,device,other);
    ASSERT (SELECT valid_until FROM delivery.subscription WHERE id=a)=previous;
    BEGIN
        PERFORM delivery.set_installation(a,gen_random_uuid(),device,gen_random_uuid());
        RAISE EXCEPTION USING ERRCODE='XX000',MESSAGE='stale transfer accepted';
    EXCEPTION WHEN raise_exception THEN NULL; END;
    PERFORM delivery.set_installation(b,gen_random_uuid(),NULL,device);
    BEGIN
        PERFORM delivery.grant_period(b,gen_random_uuid(),'trial',0);
        RAISE EXCEPTION USING ERRCODE='XX000',MESSAGE='trial repeated on previously used installation';
    EXCEPTION WHEN raise_exception THEN NULL; END;
    ASSERT NOT EXISTS (SELECT 1 FROM delivery.grant_event WHERE subscription_id=b);
    renewal:=delivery.grant_period(c,gen_random_uuid(),'year',249000);
    ASSERT renewal.ends_at=renewal.starts_at+interval '12 months';
    ASSERT (SELECT status FROM delivery.subscription_status WHERE id=c)='awaiting_activation';
    ASSERT NOT (SELECT may_create_debt FROM delivery.subscription_status WHERE id=c);
    PERFORM delivery.set_installation(c,gen_random_uuid(),NULL,gen_random_uuid());
    BEGIN
        PERFORM delivery.grant_period(c,gen_random_uuid(),'trial',0);
        RAISE EXCEPTION USING ERRCODE='XX000',MESSAGE='trial after paid grant accepted';
    EXCEPTION WHEN raise_exception THEN NULL; END;

    -- Simulate elapsed time on synthetic history by shifting both bounds and subscription expiry.
    UPDATE delivery.grant_event SET starts_at=starts_at-interval '2 years',ends_at=ends_at-interval '2 years' WHERE subscription_id=a;
    UPDATE delivery.subscription SET valid_until=valid_until-interval '2 years' WHERE id=a;
    ASSERT (SELECT status FROM delivery.subscription_status WHERE id=a)='expired';
    ASSERT NOT (SELECT may_create_debt FROM delivery.subscription_status WHERE id=a);
    expired:=delivery.grant_period(a,gen_random_uuid(),'quarter',79900);
    ASSERT expired.starts_at>=transaction_timestamp();
    ASSERT expired.ends_at=expired.starts_at+interval '3 months';
    SELECT * INTO s FROM delivery.subscription WHERE id=a;
    ASSERT s.valid_until=expired.ends_at AND s.installation_id=other;
    ASSERT (SELECT status FROM delivery.subscription_status WHERE id=a)='active';
END;
$$;

CREATE ROLE delivery_guest_test NOLOGIN;
DO $$
BEGIN
    ASSERT NOT has_schema_privilege('delivery_guest_test','delivery','USAGE');
    ASSERT NOT has_function_privilege('delivery_guest_test','delivery.grant_period(uuid,uuid,text,bigint)','EXECUTE');
    ASSERT NOT has_table_privilege('delivery_guest_test','delivery.subscription','SELECT');
END;
$$;
SET LOCAL ROLE delivery_guest_test;
DO $$
BEGIN
    BEGIN
        PERFORM delivery.grant_period(gen_random_uuid(),gen_random_uuid(),'year',249000);
        RAISE EXCEPTION USING ERRCODE='XX000',MESSAGE='unprivileged grant accepted';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$$;
RESET ROLE;
ROLLBACK;
SELECT 'DELIVERY_CORE_INTEGRATION_PASS';
