-- Additive, staged only. Existing books and entitlement tables are untouched.
BEGIN;
CREATE TABLE delivery.cloud_backup (
 subscription_id uuid NOT NULL REFERENCES delivery.subscription(id),
 slot smallint NOT NULL CHECK(slot BETWEEN 1 AND 3),
 version uuid NOT NULL CHECK(version<>'00000000-0000-0000-0000-000000000000'::uuid),
 envelope bytea NOT NULL CHECK(octet_length(envelope) BETWEEN 49 AND 16777216 AND substring(envelope FROM 1 FOR 4)=decode('56524231','hex')),
 saved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(subscription_id,slot),
 UNIQUE(subscription_id,version)
);
-- Same live binding and refresh-secret check as entitlement. It locks subscription
-- until the calling transaction finishes, serializing transfer, expiry and CAS.
CREATE FUNCTION delivery.backup_subject(p_hash bytea,p_install uuid,p_write boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,delivery AS $$
DECLARE claims jsonb;
BEGIN
 IF p_hash IS NULL OR octet_length(p_hash)<>32 OR p_install IS NULL THEN RETURN NULL; END IF;
 claims:=delivery.api_refresh_entitlement(p_hash,p_install,'raschet');
 IF claims IS NULL THEN RETURN NULL; END IF;
 IF p_write AND NOT coalesce((claims->>'may_create_debt')::boolean,false)
 THEN RAISE insufficient_privilege; END IF;
 RETURN (claims->>'subscription_id')::uuid;
END $$;
CREATE FUNCTION delivery.backup_metadata(b delivery.cloud_backup)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,delivery AS $$
 SELECT jsonb_build_object('slot',b.slot,'version',b.version,'size',octet_length(b.envelope),
 'sha256',encode(sha256(b.envelope),'hex'),'saved_at',b.saved_at);
$$;
CREATE FUNCTION delivery.api_backup_list(p_hash bytea,p_install uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,delivery SET TimeZone='UTC' AS $$
DECLARE sub uuid;
BEGIN
 sub:=delivery.backup_subject(p_hash,p_install,false);
 IF sub IS NULL THEN RETURN NULL; END IF;
 RETURN (SELECT coalesce(jsonb_agg(delivery.backup_metadata(b) ORDER BY slot),'[]'::jsonb)
 FROM delivery.cloud_backup b WHERE subscription_id=sub);
END $$;
CREATE FUNCTION delivery.api_backup_read(p_hash bytea,p_install uuid,p_slot smallint,p_version uuid)
RETURNS bytea LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,delivery AS $$
DECLARE sub uuid; result bytea;
BEGIN
 sub:=delivery.backup_subject(p_hash,p_install,false);
 IF sub IS NULL THEN RETURN NULL; END IF;
 SELECT envelope INTO result FROM delivery.cloud_backup WHERE subscription_id=sub AND slot=p_slot AND version=p_version;
 RETURN result;
END $$;
CREATE FUNCTION delivery.api_backup_put(p_hash bytea,p_install uuid,p_slot smallint,p_version uuid,p_expected uuid,p_envelope bytea)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,delivery SET TimeZone='UTC' AS $$
DECLARE sub uuid; old delivery.cloud_backup; saved delivery.cloud_backup;
BEGIN
 sub:=delivery.backup_subject(p_hash,p_install,true);
 IF sub IS NULL THEN RETURN NULL; END IF;
 IF p_slot IS NULL OR p_slot NOT BETWEEN 1 AND 3 OR p_version IS NULL OR p_version='00000000-0000-0000-0000-000000000000'::uuid
 OR p_expected=p_version OR p_envelope IS NULL OR octet_length(p_envelope) NOT BETWEEN 49 AND 16777216
 OR substring(p_envelope FROM 1 FOR 4)<>decode('56524231','hex') THEN RAISE check_violation; END IF;
 SELECT * INTO old FROM delivery.cloud_backup WHERE subscription_id=sub AND slot=p_slot;
 -- Identical retry after a lost response must not create another version or timestamp.
 IF FOUND AND old.version=p_version THEN
   IF old.envelope IS DISTINCT FROM p_envelope THEN RAISE EXCEPTION 'backup version conflict'; END IF;
   RETURN delivery.backup_metadata(old);
 END IF;
 IF old.version IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'backup revision conflict'; END IF;
 INSERT INTO delivery.cloud_backup(subscription_id,slot,version,envelope)
 VALUES(sub,p_slot,p_version,p_envelope)
 ON CONFLICT(subscription_id,slot) DO UPDATE SET version=excluded.version,envelope=excluded.envelope,saved_at=clock_timestamp()
 RETURNING * INTO saved;
 RETURN delivery.backup_metadata(saved);
END $$;
REVOKE ALL ON delivery.cloud_backup FROM PUBLIC,delivery_api;
REVOKE ALL ON FUNCTION delivery.backup_subject(bytea,uuid,boolean),delivery.backup_metadata(delivery.cloud_backup),
 delivery.api_backup_list(bytea,uuid),delivery.api_backup_read(bytea,uuid,smallint,uuid),
 delivery.api_backup_put(bytea,uuid,smallint,uuid,uuid,bytea) FROM PUBLIC,delivery_api;
GRANT EXECUTE ON FUNCTION delivery.api_backup_list(bytea,uuid),delivery.api_backup_read(bytea,uuid,smallint,uuid),
 delivery.api_backup_put(bytea,uuid,smallint,uuid,uuid,bytea) TO delivery_api;
COMMIT;
