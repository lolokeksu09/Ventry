-- Real PostgreSQL integration tests; all records are synthetic, rollback afterwards.
BEGIN;
SET LOCAL plpgsql.check_asserts=on;
DO $$
BEGIN
 ASSERT NOT has_table_privilege('delivery_api','delivery.subscription','UPDATE');
 ASSERT NOT has_table_privilege('delivery_api','delivery.download_grant','SELECT');
 ASSERT NOT has_function_privilege('delivery_api','delivery.grant_period(uuid,uuid,text,bigint)','EXECUTE');
 ASSERT has_function_privilege('delivery_api','delivery.api_grant(uuid,uuid,text,bigint)','EXECUTE');
END;
$$;
SET LOCAL ROLE delivery_api;
DO $$
DECLARE a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); e uuid:=gen_random_uuid();
    e2 uuid:=gen_random_uuid(); e3 uuid:=gen_random_uuid(); h bytea:=decode(repeat('a1',32),'hex');
    h2 bytea:=decode(repeat('a2',32),'hex'); h3 bytea:=decode(repeat('a3',32),'hex');
    sha text:=repeat('b',64); v jsonb;
BEGIN
    PERFORM delivery.api_create(a,gen_random_uuid(),'raschet');
    PERFORM delivery.api_create(b,gen_random_uuid(),'raschet');
    ASSERT delivery.api_status(a)->>'status'='not_started';
    ASSERT jsonb_array_length(delivery.api_plans())=4;
    v:=delivery.api_issue_download(a,e,sha,h);
    ASSERT v->>'id'=e::text;
    ASSERT NOT (v ? 'token_hash');
    ASSERT NOT (delivery.api_history(a)::text LIKE '%token_hash%');
    BEGIN
        PERFORM delivery.api_issue_download(a,e2,sha,h2);
        RAISE EXCEPTION USING ERRCODE='XX000',MESSAGE='second outstanding grant';
    EXCEPTION WHEN raise_exception THEN NULL; END;
    ASSERT NOT delivery.api_consume_download(h,repeat('c',64));
    BEGIN
        PERFORM delivery.api_revoke_download(b,e);
        RAISE EXCEPTION USING ERRCODE='XX000',MESSAGE='cross-subscription revoke';
    EXCEPTION WHEN raise_exception THEN NULL; END;
    ASSERT delivery.api_consume_download(h,sha);
    ASSERT NOT delivery.api_consume_download(h,sha);
    PERFORM delivery.api_issue_download(a,e2,sha,h2);
    PERFORM delivery.api_revoke_download(a,e2);
    ASSERT NOT delivery.api_consume_download(h2,sha);
    PERFORM delivery.api_issue_download(a,e3,sha,h3);
    -- Test the role's direct access boundary, not just function privilege introspection.
    BEGIN
        EXECUTE 'SELECT token_hash FROM delivery.download_grant';
        RAISE EXCEPTION USING ERRCODE='XX000',MESSAGE='raw token table accessible';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    PERFORM set_config('delivery.test_expiry',e3::text,true);
END;
$$;
RESET ROLE;
UPDATE delivery.download_grant SET created_at=transaction_timestamp()-interval '31 minutes',
 expires_at=transaction_timestamp()-interval '1 minute'
 WHERE id=current_setting('delivery.test_expiry')::uuid;
SET LOCAL ROLE delivery_api;
DO $$ BEGIN
 ASSERT NOT delivery.api_consume_download(decode(repeat('a3',32),'hex'),repeat('b',64));
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'DELIVERY_API_PRIVILEGES_AND_DOWNLOAD_PASS';
