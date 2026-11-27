-- Stream deterministic representations of all original delivery tables.
-- Include table names even when empty. No row contents are logged by the wrapper.
SET TIME ZONE 'UTC';
SELECT format('SELECT %L;', 'TABLE ' || tablename),
       format('COPY (SELECT row_to_json(t)::text FROM %I.%I t ORDER BY row_to_json(t)::text COLLATE "C") TO STDOUT;',
          schemaname,tablename)
FROM pg_catalog.pg_tables
WHERE schemaname='delivery' AND tablename<>'customer'
ORDER BY tablename COLLATE "C"
\gexec
