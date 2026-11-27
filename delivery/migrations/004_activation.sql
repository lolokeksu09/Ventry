-- Staging migration; no customer debt records or actual payment operations.
BEGIN;
CREATE TABLE delivery.activation_code (
    id uuid PRIMARY KEY,
    subscription_id uuid NOT NULL REFERENCES delivery.subscription(id),
    token_hash bytea NOT NULL UNIQUE CHECK(octet_length(token_hash)=32),
    expected_revision bigint NOT NULL CHECK(expected_revision>=0),
    trial boolean NOT NULL,
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    revoked_at timestamptz,
    installation_id uuid,
    refresh_hash bytea CHECK(refresh_hash IS NULL OR octet_length(refresh_hash)=32),
    CHECK(expires_at=created_at+interval '24 hours'),
    CHECK((consumed_at IS NULL AND installation_id IS NULL AND refresh_hash IS NULL)
        OR (consumed_at IS NOT NULL AND installation_id IS NOT NULL AND refresh_hash IS NOT NULL))
);
CREATE INDEX activation_by_subscription ON delivery.activation_code(subscription_id,created_at DESC);
CREATE TABLE delivery.activation_session (
    subscription_id uuid PRIMARY KEY REFERENCES delivery.subscription(id),
    installation_id uuid NOT NULL,
    binding_revision bigint NOT NULL,
    refresh_hash bytea NOT NULL UNIQUE CHECK(octet_length(refresh_hash)=32),
    activation_id uuid NOT NULL UNIQUE REFERENCES delivery.activation_code(id),
    activated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION delivery.api_issue_activation(p_sub uuid,p_event uuid,p_hash bytea,p_trial boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,delivery SET TimeZone='UTC' AS $$
DECLARE s delivery.subscription; a delivery.activation_code; moment timestamptz;
BEGIN
    SELECT * INTO STRICT s FROM delivery.subscription WHERE id=p_sub FOR UPDATE;
    moment:=clock_timestamp();
    IF p_trial IS NULL THEN RAISE EXCEPTION 'trial selection required'; END IF;
    IF p_trial THEN
        IF s.installation_id IS NOT NULL OR EXISTS(SELECT 1 FROM delivery.grant_event WHERE subscription_id=p_sub)
           OR NOT EXISTS(SELECT 1 FROM delivery.plan WHERE product_code=s.product_code AND code='trial' AND enabled)
        THEN RAISE EXCEPTION 'trial unavailable'; END IF;
    ELSIF s.valid_until IS NULL OR s.valid_until<=moment THEN
        RAISE EXCEPTION 'active paid period required';
    END IF;
    IF EXISTS(SELECT 1 FROM delivery.activation_code WHERE subscription_id=p_sub
        AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>moment) THEN
        RAISE EXCEPTION 'revoke existing activation first';
    END IF;
    INSERT INTO delivery.activation_code(id,subscription_id,token_hash,expected_revision,trial,created_at,expires_at)
      VALUES(p_event,p_sub,p_hash,s.revision,p_trial,moment,moment+interval '24 hours') RETURNING * INTO a;
    RETURN to_jsonb(a)-'token_hash'-'refresh_hash';
END;
$$;

CREATE FUNCTION delivery.api_activation_history(p_sub uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,delivery AS $$
 SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC),'[]'::jsonb)
 FROM (SELECT id,subscription_id,trial,created_at,expires_at,consumed_at,revoked_at,installation_id
       FROM delivery.activation_code WHERE subscription_id=p_sub ORDER BY created_at DESC LIMIT 100) a;
$$;

CREATE FUNCTION delivery.api_revoke_activation(p_sub uuid,p_event uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,delivery AS $$
DECLARE a delivery.activation_code;
BEGIN
    PERFORM 1 FROM delivery.subscription WHERE id=p_sub FOR UPDATE;
    UPDATE delivery.activation_code SET revoked_at=coalesce(revoked_at,clock_timestamp())
     WHERE id=p_event AND subscription_id=p_sub AND consumed_at IS NULL RETURNING * INTO a;
    IF NOT FOUND THEN RAISE EXCEPTION 'activation not found or consumed'; END IF;
    RETURN to_jsonb(a)-'token_hash'-'refresh_hash';
END;
$$;

-- Claims are server-authored, not supplied by the customer. A new binding invalidates
-- previous refresh credentials even if the operator later transfers back to the same UUID.
CREATE FUNCTION delivery.entitlement_claims(p_sub uuid,p_install uuid,p_hash bytea,p_product text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,delivery AS $$
DECLARE s delivery.subscription; a delivery.activation_session; moment timestamptz; enabled boolean; until_epoch bigint;
BEGIN
    SELECT * INTO s FROM delivery.subscription WHERE id=p_sub FOR UPDATE;
    IF NOT FOUND OR s.product_code IS DISTINCT FROM p_product OR s.installation_id IS DISTINCT FROM p_install THEN RETURN NULL; END IF;
    SELECT * INTO a FROM delivery.activation_session WHERE subscription_id=p_sub;
    IF NOT FOUND OR a.installation_id IS DISTINCT FROM p_install OR a.refresh_hash IS DISTINCT FROM p_hash
       OR a.binding_revision IS DISTINCT FROM (SELECT max(revision) FROM delivery.installation_event WHERE subscription_id=p_sub)
    THEN RETURN NULL; END IF;
    moment:=clock_timestamp();
    enabled:=coalesce(s.valid_until>moment,false);
    until_epoch:=floor(extract(epoch FROM s.valid_until))::bigint;
    RETURN jsonb_build_object('v',1,'issuer','ventry-delivery','product',s.product_code,
      'package_name',(SELECT package_name FROM delivery.product WHERE code=s.product_code),
      'subscription_id',s.id,'installation_id',p_install,'revision',s.revision,
      'issued_at',floor(extract(epoch FROM moment))::bigint,'valid_until',until_epoch,
      'lease_until',floor(extract(epoch FROM CASE WHEN enabled THEN least(s.valid_until,moment+interval '72 hours') ELSE moment END))::bigint,
      'may_create_debt',enabled);
END;
$$;

-- Client creates and keeps an independent random refresh secret before the first
-- request. Same code + installation + refresh secret is retry-safe during the code TTL.
-- All mutation and trial grant is one PostgreSQL transaction.
CREATE FUNCTION delivery.api_activate(p_code bytea,p_install uuid,p_refresh bytea,p_product text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,delivery AS $$
DECLARE a delivery.activation_code; s delivery.subscription; sub uuid; binding bigint;
BEGIN
    IF p_install IS NULL OR p_install='00000000-0000-0000-0000-000000000000'::uuid
       OR p_refresh IS NULL OR octet_length(p_refresh)<>32 OR p_refresh=p_code THEN RETURN NULL; END IF;
    SELECT subscription_id INTO sub FROM delivery.activation_code WHERE token_hash=p_code;
    IF NOT FOUND THEN RETURN NULL; END IF;
    SELECT * INTO STRICT s FROM delivery.subscription WHERE id=sub FOR UPDATE;
    SELECT * INTO STRICT a FROM delivery.activation_code WHERE token_hash=p_code FOR UPDATE;
    IF s.product_code IS DISTINCT FROM p_product OR a.revoked_at IS NOT NULL OR a.expires_at<=clock_timestamp()
    THEN RETURN NULL; END IF;
    IF a.consumed_at IS NOT NULL THEN
        IF a.installation_id IS DISTINCT FROM p_install OR a.refresh_hash IS DISTINCT FROM p_refresh
           OR NOT EXISTS(SELECT 1 FROM delivery.activation_session WHERE subscription_id=sub AND activation_id=a.id)
        THEN RETURN NULL; END IF;
        RETURN delivery.entitlement_claims(sub,p_install,p_refresh,p_product);
    END IF;
    IF a.expected_revision<>s.revision THEN RETURN NULL; END IF;
    IF NOT a.trial AND (s.valid_until IS NULL OR s.valid_until<=clock_timestamp()) THEN RETURN NULL; END IF;
    IF s.installation_id IS DISTINCT FROM p_install THEN
        PERFORM delivery.set_installation(sub,gen_random_uuid(),s.installation_id,p_install);
    END IF;
    IF a.trial THEN
        PERFORM delivery.grant_period(sub,gen_random_uuid(),'trial',0);
    END IF;
    SELECT max(revision) INTO binding FROM delivery.installation_event WHERE subscription_id=sub;
    INSERT INTO delivery.activation_session(subscription_id,installation_id,binding_revision,refresh_hash,activation_id)
       VALUES(sub,p_install,binding,p_refresh,a.id)
       ON CONFLICT(subscription_id) DO UPDATE SET installation_id=excluded.installation_id,
          binding_revision=excluded.binding_revision,refresh_hash=excluded.refresh_hash,
          activation_id=excluded.activation_id,activated_at=clock_timestamp();
    UPDATE delivery.activation_code SET consumed_at=clock_timestamp(),installation_id=p_install,refresh_hash=p_refresh WHERE id=a.id;
    RETURN delivery.entitlement_claims(sub,p_install,p_refresh,p_product);
END;
$$;

CREATE FUNCTION delivery.api_refresh_entitlement(p_hash bytea,p_install uuid,p_product text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,delivery AS $$
DECLARE sub uuid;
BEGIN
    SELECT subscription_id INTO sub FROM delivery.activation_session WHERE refresh_hash=p_hash;
    IF NOT FOUND THEN RETURN NULL; END IF;
    RETURN delivery.entitlement_claims(sub,p_install,p_hash,p_product);
END;
$$;

REVOKE ALL ON delivery.activation_code,delivery.activation_session FROM PUBLIC,delivery_api;
REVOKE ALL ON FUNCTION delivery.entitlement_claims(uuid,uuid,bytea,text),
 delivery.api_issue_activation(uuid,uuid,bytea,boolean),delivery.api_activation_history(uuid),
 delivery.api_revoke_activation(uuid,uuid),delivery.api_activate(bytea,uuid,bytea,text),
 delivery.api_refresh_entitlement(bytea,uuid,text) FROM PUBLIC,delivery_api;
GRANT EXECUTE ON FUNCTION delivery.api_issue_activation(uuid,uuid,bytea,boolean),
 delivery.api_activation_history(uuid),delivery.api_revoke_activation(uuid,uuid),
 delivery.api_activate(bytea,uuid,bytea,text),delivery.api_refresh_entitlement(bytea,uuid,text) TO delivery_api;
COMMIT;
