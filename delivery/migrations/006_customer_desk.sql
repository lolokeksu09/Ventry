-- Additive migration. Subscription and grant rows remain unchanged.
BEGIN;
LOCK TABLE delivery.subscription IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE delivery.customer (
    id uuid PRIMARY KEY,
    display_name text CHECK (display_name IS NULL OR
      (display_name=btrim(display_name) AND length(display_name) BETWEEN 1 AND 80 AND display_name !~ '[[:cntrl:]]')),
    revision bigint NOT NULL DEFAULT 0 CHECK (revision>=0)
);
INSERT INTO delivery.customer(id) SELECT DISTINCT customer_id FROM delivery.subscription;
ALTER TABLE delivery.subscription ADD CONSTRAINT subscription_customer_fk FOREIGN KEY(customer_id) REFERENCES delivery.customer(id);
CREATE FUNCTION delivery.ensure_customer() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,delivery AS $$
BEGIN
    INSERT INTO delivery.customer(id) VALUES(NEW.customer_id) ON CONFLICT DO NOTHING;
    RETURN NEW;
END $$;
CREATE TRIGGER subscription_customer BEFORE INSERT OR UPDATE OF customer_id ON delivery.subscription
FOR EACH ROW EXECUTE FUNCTION delivery.ensure_customer();
CREATE INDEX grant_product_recorded ON delivery.grant_event(product_code,recorded_at,id) WHERE amount_kopecks>0;
CREATE INDEX grant_subscription_recorded ON delivery.grant_event(subscription_id,recorded_at DESC,id DESC);
CREATE INDEX subscription_product_expiry ON delivery.subscription(product_code,valid_until,id);

CREATE FUNCTION delivery.api_customer(p_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,delivery AS $$
 SELECT to_jsonb(c) FROM delivery.customer c WHERE id=p_id;
$$;
CREATE FUNCTION delivery.api_customer_name(p_id uuid,p_name text,p_revision bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,delivery AS $$
DECLARE c delivery.customer;
BEGIN
    SELECT * INTO STRICT c FROM delivery.customer WHERE id=p_id FOR UPDATE;
    IF c.display_name IS NOT DISTINCT FROM p_name THEN RETURN to_jsonb(c); END IF;
    IF c.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'customer revision changed'; END IF;
    UPDATE delivery.customer SET display_name=p_name,revision=revision+1 WHERE id=p_id RETURNING * INTO c;
    RETURN to_jsonb(c);
END $$;

-- Search entire project, independent of old 100-row list; literal substring (no wildcard).
-- Renewal queue sorts by expiry then UUID; other searches sort by UUID.
CREATE FUNCTION delivery.api_desk(p_product text,p_query text,p_filter text,p_after uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,delivery AS $$
DECLARE expiry timestamptz;
BEGIN
    IF NOT EXISTS(SELECT 1 FROM delivery.product WHERE code=p_product) THEN RAISE no_data_found; END IF;
    IF p_filter IS NULL OR p_filter NOT IN ('all','active','expired','pending','expiring') OR
        p_query IS NULL OR length(p_query)>80 THEN RAISE EXCEPTION 'invalid desk filter'; END IF;
    IF p_after IS NOT NULL AND p_filter='expiring' THEN
        SELECT valid_until INTO STRICT expiry FROM delivery.subscription WHERE id=p_after AND product_code=p_product;
        IF expiry IS NULL THEN RAISE EXCEPTION 'invalid renewal cursor'; END IF;
    END IF;
    RETURN (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY
                CASE WHEN p_filter='expiring' THEN r.valid_until END,r.id),'[]'::jsonb)
        FROM (SELECT s.*,c.display_name AS customer_name,c.revision AS customer_revision
            FROM delivery.subscription_status s JOIN delivery.customer c ON c.id=s.customer_id
            WHERE s.product_code=p_product
              AND (p_query='' OR strpos(lower(coalesce(c.display_name,'')),lower(p_query))>0
                OR strpos(s.customer_id::text,lower(p_query))>0 OR strpos(s.id::text,lower(p_query))>0)
              AND (p_filter='all' OR s.status=p_filter OR
                (p_filter='pending' AND s.status IN ('not_started','awaiting_activation')) OR
                (p_filter='expiring' AND s.status='active' AND s.valid_until<=statement_timestamp()+interval '7 days'))
              AND (p_after IS NULL OR CASE WHEN p_filter='expiring'
                THEN (s.valid_until,s.id)>(expiry,p_after) ELSE s.id>p_after END)
            ORDER BY CASE WHEN p_filter='expiring' THEN s.valid_until END,s.id LIMIT 100) r);
END $$;

-- A grant is an operator-confirmed payment, not a bank or fiscal record.
-- Exact rolling 24-hour days, UTC-compatible timestamptz, exclusive upper bound.
CREATE FUNCTION delivery.api_revenue(p_product text,p_days integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,delivery AS $$
DECLARE upper_at timestamptz:=statement_timestamp(); lower_at timestamptz;
BEGIN
    IF NOT EXISTS(SELECT 1 FROM delivery.product WHERE code=p_product) THEN RAISE no_data_found; END IF;
    IF p_days IS NOT NULL AND p_days NOT IN (7,30,90) THEN RAISE EXCEPTION 'invalid period'; END IF;
    lower_at:=upper_at-make_interval(hours=>p_days*24);
    RETURN (SELECT jsonb_build_object('from',lower_at,'to',upper_at,'confirmed_kopecks',coalesce(sum(amount_kopecks),0),
        'payment_count',count(*)) FROM delivery.grant_event
        WHERE product_code=p_product AND amount_kopecks>0 AND recorded_at<upper_at
          AND (lower_at IS NULL OR recorded_at>=lower_at));
END $$;

CREATE FUNCTION delivery.api_payment_page(p_id uuid,p_after uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,delivery AS $$
DECLARE cursor_at timestamptz;
BEGIN
    IF NOT EXISTS(SELECT 1 FROM delivery.subscription WHERE id=p_id) THEN RAISE no_data_found; END IF;
    IF p_after IS NOT NULL THEN
        SELECT recorded_at INTO STRICT cursor_at FROM delivery.grant_event
          WHERE id=p_after AND subscription_id=p_id AND amount_kopecks>0;
    END IF;
    RETURN (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.recorded_at DESC,r.id DESC),'[]'::jsonb)
      FROM (SELECT id,subscription_id,product_code,plan_code,amount_kopecks,starts_at,ends_at,revision,recorded_at
        FROM delivery.grant_event WHERE subscription_id=p_id AND amount_kopecks>0
          AND (p_after IS NULL OR (recorded_at,id)<(cursor_at,p_after))
        ORDER BY recorded_at DESC,id DESC LIMIT 100) r);
END $$;
REVOKE ALL ON delivery.customer FROM PUBLIC,delivery_api;
REVOKE ALL ON FUNCTION delivery.ensure_customer(),delivery.api_customer(uuid),
 delivery.api_customer_name(uuid,text,bigint),delivery.api_desk(text,text,text,uuid),
 delivery.api_revenue(text,integer),delivery.api_payment_page(uuid,uuid) FROM PUBLIC,delivery_api;
GRANT EXECUTE ON FUNCTION delivery.api_customer(uuid),delivery.api_customer_name(uuid,text,bigint),
 delivery.api_desk(text,text,text,uuid),delivery.api_revenue(text,integer),delivery.api_payment_page(uuid,uuid) TO delivery_api;
COMMIT;
