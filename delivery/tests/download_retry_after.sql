-- CI only: actual 004 -> 005 upgrade with existing rows and role privileges.
BEGIN;
SET LOCAL plpgsql.check_asserts=on;
DO $$
BEGIN
    ASSERT (SELECT count(*) FROM delivery.download_grant WHERE subscription_id='50000000-0000-4000-8000-000000000001')=3;
    ASSERT NOT EXISTS(SELECT 1 FROM delivery.download_grant WHERE subscription_id='50000000-0000-4000-8000-000000000001'
      AND (retry_hash IS NOT NULL OR retry_until IS NOT NULL OR delivery_attempts<>0));
    ASSERT (SELECT consumed_at IS NOT NULL FROM delivery.download_grant WHERE id='50000000-0000-4000-8000-000000000003');
    ASSERT (SELECT revoked_at IS NOT NULL FROM delivery.download_grant WHERE id='50000000-0000-4000-8000-000000000004');
    ASSERT NOT has_table_privilege('delivery_api','delivery.download_grant','SELECT');
END $$;
SET LOCAL ROLE delivery_api;
DO $$
DECLARE s uuid:='50000000-0000-4000-8000-000000000001'; sha text:=repeat('b',64);
        proof bytea:=decode(repeat('54',32),'hex'); h bytea:=decode(repeat('53',32),'hex');
BEGIN
    ASSERT NOT delivery.api_consume_download_retry(decode(repeat('51',32),'hex'),sha,proof);
    ASSERT NOT delivery.api_consume_download_retry(decode(repeat('52',32),'hex'),sha,proof);
    ASSERT NOT delivery.api_consume_download_retry(h,repeat('c',64),proof);
    ASSERT delivery.api_consume_download_retry(h,sha,proof);
    ASSERT NOT delivery.api_consume_download(h,sha);
    ASSERT NOT (delivery.api_history(s)::text LIKE '%retry_hash%');
    BEGIN
        PERFORM delivery.api_issue_download(s,gen_random_uuid(),sha,decode(repeat('55',32),'hex'));
        RAISE EXCEPTION USING ERRCODE='XX000',MESSAGE='live retry allowed second grant';
    EXCEPTION WHEN raise_exception THEN NULL; END;
END $$;
RESET ROLE;
UPDATE delivery.download_grant SET retry_until=consumed_at
 WHERE id='50000000-0000-4000-8000-000000000005';
SET LOCAL ROLE delivery_api;
DO $$ BEGIN
    ASSERT NOT delivery.api_consume_download_retry(decode(repeat('53',32),'hex'),repeat('b',64),decode(repeat('54',32),'hex'));
END $$;
RESET ROLE;
-- Remove only the fixed synthetic fixture so independent API tests see clean data.
DELETE FROM delivery.download_grant WHERE subscription_id='50000000-0000-4000-8000-000000000001';
DELETE FROM delivery.subscription WHERE id='50000000-0000-4000-8000-000000000001';
COMMIT;
SELECT 'DELIVERY_DOWNLOAD_004_TO_005_UPGRADE_PASS';
