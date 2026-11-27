-- CI only: create legacy grants using the pre-005 API.
BEGIN;
SELECT delivery.api_create('50000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002','raschet');
DO $$
DECLARE s uuid:='50000000-0000-4000-8000-000000000001'; sha text:=repeat('b',64);
BEGIN
    PERFORM delivery.api_issue_download(s,'50000000-0000-4000-8000-000000000003',sha,decode(repeat('51',32),'hex'));
    ASSERT delivery.api_consume_download(decode(repeat('51',32),'hex'),sha);
    PERFORM delivery.api_issue_download(s,'50000000-0000-4000-8000-000000000004',sha,decode(repeat('52',32),'hex'));
    PERFORM delivery.api_revoke_download(s,'50000000-0000-4000-8000-000000000004');
    PERFORM delivery.api_issue_download(s,'50000000-0000-4000-8000-000000000005',sha,decode(repeat('53',32),'hex'));
END $$;
COMMIT;
