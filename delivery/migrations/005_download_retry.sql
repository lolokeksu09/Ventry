-- Preserve all pre-existing grants and strict one-use API behavior.
BEGIN;
ALTER TABLE delivery.download_grant
    ADD COLUMN retry_hash bytea,
    ADD COLUMN retry_until timestamptz,
    ADD COLUMN delivery_attempts integer NOT NULL DEFAULT 0,
    ADD CONSTRAINT download_retry_shape CHECK (
       (retry_hash IS NULL AND retry_until IS NULL AND delivery_attempts=0)
       OR (retry_hash IS NOT NULL AND octet_length(retry_hash)=32
           AND retry_hash<>token_hash AND retry_until IS NOT NULL
           AND consumed_at IS NOT NULL AND retry_until>=consumed_at
           AND retry_until<=expires_at AND retry_until<=consumed_at+interval '5 minutes'
           AND delivery_attempts BETWEEN 1 AND 3)
    );

CREATE OR REPLACE FUNCTION delivery.api_issue_download(p_sub uuid,p_event uuid,p_sha text,p_hash bytea)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,delivery AS $$
DECLARE s delivery.subscription; d delivery.download_grant; moment timestamptz;
BEGIN
    SELECT * INTO STRICT s FROM delivery.subscription WHERE id=p_sub FOR UPDATE;
    IF s.product_code<>'raschet' THEN RAISE EXCEPTION 'product has no approved release'; END IF;
    moment:=clock_timestamp();
    IF EXISTS (SELECT 1 FROM delivery.download_grant WHERE subscription_id=p_sub
        AND revoked_at IS NULL AND expires_at>moment
        AND (consumed_at IS NULL OR (retry_until>moment AND delivery_attempts<3))) THEN
        RAISE EXCEPTION 'revoke existing download code first';
    END IF;
    INSERT INTO delivery.download_grant(id,subscription_id,release_sha256,token_hash,created_at,expires_at)
        VALUES(p_event,p_sub,p_sha,p_hash,moment,moment+interval '30 minutes')
        RETURNING * INTO d;
    RETURN to_jsonb(d)-'token_hash'-'retry_hash';
END;
$$;

CREATE OR REPLACE FUNCTION delivery.api_history(p_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,delivery AS $$
 SELECT jsonb_build_object(
   'grants',(SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY g.revision DESC),'[]'::jsonb)
             FROM (SELECT * FROM delivery.grant_event WHERE subscription_id=p_id
                   ORDER BY revision DESC LIMIT 100) g),
   'installations',(SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.revision DESC),'[]'::jsonb)
             FROM (SELECT * FROM delivery.installation_event WHERE subscription_id=p_id
                   ORDER BY revision DESC LIMIT 100) i),
   'downloads',(SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.created_at DESC),'[]'::jsonb)
             FROM (SELECT id,subscription_id,release_sha256,created_at,expires_at,consumed_at,revoked_at,retry_until,delivery_attempts
                   FROM delivery.download_grant WHERE subscription_id=p_id
                   ORDER BY created_at DESC LIMIT 100) d)
 );
$$;

CREATE OR REPLACE FUNCTION delivery.api_revoke_download(p_sub uuid,p_event uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,delivery AS $$
DECLARE d delivery.download_grant;
BEGIN
    UPDATE delivery.download_grant
       SET revoked_at=coalesce(revoked_at,clock_timestamp())
     WHERE id=p_event AND subscription_id=p_sub
       AND (consumed_at IS NULL OR retry_hash IS NOT NULL)
     RETURNING * INTO d;
    IF NOT FOUND THEN RAISE EXCEPTION 'download code not found or consumed'; END IF;
    RETURN to_jsonb(d)-'token_hash'-'retry_hash';
END;
$$;

-- First caller claims the existing one-time grant with an independent secret.
-- Subsequent attempts must possess both credentials. UPDATE row locking and
-- predicate rechecks serialize competing recipients and enforce the cap.
CREATE FUNCTION delivery.api_consume_download_retry(p_hash bytea,p_sha text,p_retry bytea)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,delivery AS $$
DECLARE moment timestamptz;
BEGIN
    IF p_hash IS NULL OR p_retry IS NULL OR octet_length(p_hash)<>32
       OR octet_length(p_retry)<>32 OR p_hash=p_retry THEN RETURN false; END IF;
    -- Lock before reading the clock, so waiting behind a concurrent request
    -- cannot extend the original validity window.
    PERFORM 1 FROM delivery.download_grant WHERE token_hash=p_hash FOR UPDATE;
    IF NOT FOUND THEN RETURN false; END IF;
    moment:=clock_timestamp();
    UPDATE delivery.download_grant
       SET consumed_at=coalesce(consumed_at,moment),
           retry_hash=coalesce(retry_hash,p_retry),
           retry_until=coalesce(retry_until,least(expires_at,moment+interval '5 minutes')),
           delivery_attempts=delivery_attempts+1
     WHERE token_hash=p_hash AND release_sha256=p_sha
       AND revoked_at IS NULL AND expires_at>moment
       AND ((consumed_at IS NULL AND retry_hash IS NULL)
            OR (retry_hash=p_retry AND retry_until>moment AND delivery_attempts<3));
    RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION delivery.api_consume_download_retry(bytea,text,bytea) FROM PUBLIC,delivery_api;
GRANT EXECUTE ON FUNCTION delivery.api_consume_download_retry(bytea,text,bytea) TO delivery_api;
COMMIT;
