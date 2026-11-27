-- Preserve existing products, prices, subscriptions and grants.
BEGIN;
ALTER TABLE delivery.product ADD COLUMN display_name text;
ALTER TABLE delivery.product ADD COLUMN package_name text;
UPDATE delivery.product SET display_name=CASE code WHEN 'raschet' THEN 'Расчёт' ELSE code END,
    package_name=CASE code WHEN 'raschet' THEN 'dev.ventry.raschet' ELSE NULL END;
ALTER TABLE delivery.product ALTER COLUMN display_name SET NOT NULL;
ALTER TABLE delivery.product ADD CONSTRAINT product_display_name
    CHECK (display_name=btrim(display_name) AND length(display_name) BETWEEN 1 AND 100 AND display_name !~ '[[:cntrl:]]');
ALTER TABLE delivery.product ADD CONSTRAINT product_package_format
    CHECK (package_name IS NULL OR (length(package_name)<=180 AND package_name ~ '^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$'));
ALTER TABLE delivery.product ADD CONSTRAINT product_package_unique UNIQUE(package_name);
CREATE INDEX subscription_by_product_id ON delivery.subscription(product_code,id);

-- A server-owned catalog, not a hardcoded Android list. All counts derive from actual rows.
CREATE FUNCTION delivery.api_products()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,delivery AS $$
 SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.display_name,p.code),'[]'::jsonb)
 FROM (
    SELECT product.code,product.display_name,product.package_name,
       coalesce(s.total,0) AS total_subscriptions,
       coalesce(s.active,0) AS active_subscriptions,
       coalesce(s.expired,0) AS expired_subscriptions,
       coalesce(s.pending,0) AS pending_subscriptions,
       coalesce(s.expiring,0) AS expiring_soon,
       coalesce(g.confirmed_kopecks,0) AS confirmed_kopecks,
       coalesce(t.enabled_plans,0) AS enabled_plans
    FROM delivery.product product
    LEFT JOIN (
       SELECT product_code,count(*) total,
          count(*) FILTER(WHERE status='active') active,
          count(*) FILTER(WHERE status='expired') expired,
          count(*) FILTER(WHERE status IN ('not_started','awaiting_activation')) pending,
          count(*) FILTER(WHERE status='active' AND valid_until<=statement_timestamp()+interval '7 days') expiring
       FROM delivery.subscription_status GROUP BY product_code
    ) s ON s.product_code=product.code
    LEFT JOIN (SELECT product_code,sum(amount_kopecks) confirmed_kopecks
          FROM delivery.grant_event GROUP BY product_code) g ON g.product_code=product.code
    LEFT JOIN (SELECT product_code,count(*) enabled_plans FROM delivery.plan WHERE enabled GROUP BY product_code) t
          ON t.product_code=product.code
 ) p;
$$;

CREATE FUNCTION delivery.api_create_product(p_code text,p_name text,p_package text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,delivery AS $$
DECLARE p delivery.product;
BEGIN
    IF p_code IS NULL OR p_name IS NULL OR p_package IS NULL OR btrim(p_name)='' THEN
        RAISE EXCEPTION 'product metadata required';
    END IF;
    INSERT INTO delivery.product(code,display_name,package_name) VALUES(p_code,p_name,p_package)
        ON CONFLICT(code) DO NOTHING;
    SELECT * INTO STRICT p FROM delivery.product WHERE code=p_code;
    IF p.display_name IS DISTINCT FROM p_name OR p.package_name IS DISTINCT FROM p_package THEN
        RAISE EXCEPTION 'product code already registered with different metadata';
    END IF;
    RETURN to_jsonb(p);
END;
$$;

CREATE FUNCTION delivery.api_product_plans(p_product text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,delivery AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM delivery.product WHERE code=p_product) THEN
    RAISE no_data_found;
 END IF;
 RETURN (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.amount_kopecks,p.code),'[]'::jsonb)
         FROM delivery.plan p WHERE product_code=p_product);
END;
$$;

-- New projects have no implicit prices. The operator explicitly configures a tariff.
-- Once created, a price is immutable in this stage: preserves the approved Raschet prices
-- and avoids old-payment/new-price ambiguities. A retry with identical data is safe.
-- Changing existing price/availability needs a separate revisioned tariff design.
CREATE FUNCTION delivery.api_create_plan(p_product text,p_code text,p_amount bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,delivery AS $$
DECLARE p delivery.plan; months integer; days integer;
BEGIN
    IF p_code NOT IN ('trial','month','quarter','year') OR p_code IS NULL OR p_amount IS NULL
       OR p_amount<0 OR p_amount>1000000000
       OR (p_code='trial' AND p_amount<>0) OR (p_code<>'trial' AND p_amount=0) THEN
        RAISE EXCEPTION 'invalid plan';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM delivery.product WHERE code=p_product) THEN RAISE no_data_found; END IF;
    days:=CASE p_code WHEN 'trial' THEN 7 ELSE 0 END;
    months:=CASE p_code WHEN 'month' THEN 1 WHEN 'quarter' THEN 3 WHEN 'year' THEN 12 ELSE 0 END;
    INSERT INTO delivery.plan(product_code,code,amount_kopecks,duration_days,duration_months)
        VALUES(p_product,p_code,p_amount,days,months)
        ON CONFLICT(product_code,code) DO NOTHING;
    SELECT * INTO STRICT p FROM delivery.plan WHERE product_code=p_product AND code=p_code;
    IF p.amount_kopecks IS DISTINCT FROM p_amount THEN
        RAISE EXCEPTION 'plan exists with a different price';
    END IF;
    RETURN to_jsonb(p);
END;
$$;

CREATE FUNCTION delivery.api_list_product(p_product text,p_after uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,delivery AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM delivery.product WHERE code=p_product) THEN RAISE no_data_found; END IF;
 RETURN (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]'::jsonb)
         FROM (SELECT * FROM delivery.subscription_status
         WHERE product_code=p_product AND (p_after IS NULL OR id>p_after) ORDER BY id LIMIT 100) s);
END;
$$;

REVOKE ALL ON FUNCTION delivery.api_products(),delivery.api_create_product(text,text,text),
 delivery.api_product_plans(text),delivery.api_create_plan(text,text,bigint),
 delivery.api_list_product(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delivery.api_products(),delivery.api_create_product(text,text,text),
 delivery.api_product_plans(text),delivery.api_create_plan(text,text,bigint),
 delivery.api_list_product(text,uuid) TO delivery_api;
COMMIT;
