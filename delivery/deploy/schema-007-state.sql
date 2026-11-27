-- Run after schema-006-state.sql returns ready.
WITH checks AS (
 SELECT to_regclass('delivery.cloud_backup') AS tbl,
 to_regprocedure('delivery.backup_subject(bytea,uuid,boolean)') AS subject,
 to_regprocedure('delivery.api_backup_list(bytea,uuid)') AS list,
 to_regprocedure('delivery.api_backup_read(bytea,uuid,smallint,uuid)') AS reader,
 to_regprocedure('delivery.api_backup_put(bytea,uuid,smallint,uuid,uuid,bytea)') AS writer
)
SELECT CASE
 WHEN tbl IS NULL AND subject IS NULL AND list IS NULL AND reader IS NULL AND writer IS NULL
  AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='delivery' AND p.proname='backup_metadata')
 THEN 'upgrade_required'
 WHEN tbl IS NOT NULL AND subject IS NOT NULL AND list IS NOT NULL AND reader IS NOT NULL AND writer IS NOT NULL
 THEN CASE WHEN
  to_regprocedure('delivery.backup_metadata(delivery.cloud_backup)') IS NOT NULL
  AND NOT has_table_privilege('delivery_api',tbl,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  AND NOT has_function_privilege('delivery_api',subject,'EXECUTE')
  AND NOT has_function_privilege('delivery_api',to_regprocedure('delivery.backup_metadata(delivery.cloud_backup)'),'EXECUTE')
  AND has_function_privilege('delivery_api',list,'EXECUTE')
  AND has_function_privilege('delivery_api',reader,'EXECUTE')
  AND has_function_privilege('delivery_api',writer,'EXECUTE')
  AND (SELECT count(*) FROM pg_proc WHERE oid IN (list,reader,writer) AND prosecdef)=3
  AND (SELECT count(*) FROM pg_constraint WHERE conrelid=tbl AND convalidated AND contype IN ('p','u','f','c'))=6
 THEN 'ready' ELSE 'unknown' END
 ELSE 'unknown' END FROM checks;
