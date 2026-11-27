-- Apply only to the isolated Delivery database, as its trusted schema owner.
-- The service login must be a non-superuser member of delivery_api, never its owner.
BEGIN;
CREATE ROLE delivery_api NOLOGIN;

CREATE TABLE delivery.download_grant (
    id uuid PRIMARY KEY,
    subscription_id uuid NOT NULL REFERENCES delivery.subscription(id),
    release_sha256 text NOT NULL CHECK (release_sha256 ~ '^[0-9a-f]{64}$'),
    token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash)=32),
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    revoked_at timestamptz,
    operator_role text NOT NULL DEFAULT session_user,
    CHECK (expires_at > created_at AND expires_at <= created_at + interval '30 minutes'),
    CHECK (consumed_at IS NULL OR consumed_at >= created_at),
    CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);
CREATE INDEX download_grants_by_subscription ON delivery.download_grant(subscription_id,created_at DESC);
CREATE INDEX download_grants_expiry ON delivery.download_grant(expires_at);

-- Fixed, narrow capabilities. SECURITY DEFINER wrappers intentionally run the
-- existing transaction functions as the trusted owner. No dynamic SQL or caller-controlled search path.
CREATE FUNCTION delivery.api_plans()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,delivery AS $$
 SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.amount_kopecks),'[]'::jsonb)
 FROM delivery.plan p WHERE enabled;
$$;

CREATE FUNCTION delivery.api_list(p_after uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,delivery AS $$
 SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]'::jsonb)
 FROM (SELECT * FROM delivery.subscription_status
       WHERE p_after IS NULL OR id>p_after ORDER BY id LIMIT 100) s;
$$;

CREATE FUNCTION delivery.api_status(p_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,delivery AS $$
 SELECT to_jsonb(s) FROM delivery.subscription_status s WHERE id=p_id;
$$;

CREATE FUNCTION delivery.api_create(p_id uuid,p_customer uuid,p_product text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,delivery AS $$
 SELECT to_jsonb(s) FROM delivery.create_subscription(p_id,p_customer,p_product) s;
$$;

CREATE FUNCTION delivery.api_bind(p_id uuid,p_event uuid,p_old uuid,p_new uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,delivery AS $$
 SELECT to_jsonb(s) FROM delivery.set_installation(p_id,p_event,p_old,p_new) s;
$$;

CREATE FUNCTION delivery.api_grant(p_id uuid,p_event uuid,p_plan text,p_amount bigint)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,delivery AS $$
 SELECT to_jsonb(s) FROM delivery.grant_period(p_id,p_event,p_plan,p_amount) s;
$$;

CREATE FUNCTION delivery.api_history(p_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,delivery AS $$
 SELECT jsonb_build_object(
   'grants',(SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY g.revision DESC),'[]'::jsonb)
             FROM (SELECT * FROM delivery.grant_event WHERE subscription_id=p_id
                   ORDER BY revision DESC LIMIT 100) g),
   'installations',(SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.revision DESC),'[]'::jsonb)
             FROM (SELECT * FROM delivery.installation_event WHERE subscription_id=p_id
                   ORDER BY revision DESC LIMIT 100) i),
   'downloads',(SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.created_at DESC),'[]'::jsonb)
             FROM (SELECT id,subscription_id,release_sha256,created_at,expires_at,consumed_at,revoked_at
                   FROM delivery.download_grant WHERE subscription_id=p_id
                   ORDER BY created_at DESC LIMIT 100) d)
 );
$$;

-- An operator may send a bootstrap APK before activation/trial. Download is not a license.
-- Serialize issuance against other requests for this subscription. At most one outstanding
-- code per subscription; explicitly revoke an older code to issue a replacement.
CREATE FUNCTION delivery.api_issue_download(p_sub uuid,p_event uuid,p_sha text,p_hash bytea)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,delivery AS $$
DECLARE s delivery.subscription; d delivery.download_grant; moment timestamptz;
BEGIN
    SELECT * INTO STRICT s FROM delivery.subscription WHERE id=p_sub FOR UPDATE;
    IF s.product_code<>'raschet' THEN RAISE EXCEPTION 'product has no approved release'; END IF;
    moment:=clock_timestamp();
    IF EXISTS (SELECT 1 FROM delivery.download_grant WHERE subscription_id=p_sub
        AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>moment) THEN
        RAISE EXCEPTION 'revoke existing download code first';
    END IF;
    INSERT INTO delivery.download_grant(id,subscription_id,release_sha256,token_hash,created_at,expires_at)
        VALUES(p_event,p_sub,p_sha,p_hash,moment,moment+interval '30 minutes')
        RETURNING * INTO d;
    RETURN to_jsonb(d)-'token_hash';
END;
$$;

CREATE FUNCTION delivery.api_revoke_download(p_sub uuid,p_event uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,delivery AS $$
DECLARE d delivery.download_grant;
BEGIN
    UPDATE delivery.download_grant
       SET revoked_at=coalesce(revoked_at,clock_timestamp())
     WHERE id=p_event AND subscription_id=p_sub AND consumed_at IS NULL
     RETURNING * INTO d;
    IF NOT FOUND THEN RAISE EXCEPTION 'download code not found or consumed'; END IF;
    RETURN to_jsonb(d)-'token_hash';
END;
$$;

-- One atomic UPDATE: concurrent retries cannot both consume a grant.
-- Invalid, expired, wrong-release, revoked and consumed credentials have identical results.
CREATE FUNCTION delivery.api_consume_download(p_hash bytea,p_sha text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,delivery AS $$
BEGIN
    UPDATE delivery.download_grant SET consumed_at=clock_timestamp()
      WHERE token_hash=p_hash AND release_sha256=p_sha
        AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>clock_timestamp();
    RETURN FOUND;
END;
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA delivery FROM PUBLIC,delivery_api;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA delivery FROM PUBLIC,delivery_api;
GRANT USAGE ON SCHEMA delivery TO delivery_api;
GRANT EXECUTE ON FUNCTION delivery.api_plans(),delivery.api_list(uuid),delivery.api_status(uuid),
 delivery.api_create(uuid,uuid,text),delivery.api_bind(uuid,uuid,uuid,uuid),
 delivery.api_grant(uuid,uuid,text,bigint),delivery.api_history(uuid),
 delivery.api_issue_download(uuid,uuid,text,bytea),delivery.api_revoke_download(uuid,uuid),
 delivery.api_consume_download(bytea,text) TO delivery_api;
COMMIT;
