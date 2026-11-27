-- Fresh isolated database only. Do not apply to the static site or a customer's ledger.
BEGIN;
CREATE SCHEMA delivery;
REVOKE ALL ON SCHEMA delivery FROM PUBLIC;

CREATE TABLE delivery.product (
    code text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_-]{0,31}$')
);
INSERT INTO delivery.product VALUES ('raschet');

CREATE TABLE delivery.plan (
    product_code text NOT NULL REFERENCES delivery.product(code),
    code text NOT NULL CHECK (code ~ '^[a-z][a-z0-9_-]{0,31}$'),
    amount_kopecks bigint NOT NULL CHECK (amount_kopecks >= 0),
    duration_days integer NOT NULL CHECK (duration_days BETWEEN 0 AND 366),
    duration_months integer NOT NULL CHECK (duration_months BETWEEN 0 AND 12),
    enabled boolean NOT NULL DEFAULT true,
    PRIMARY KEY (product_code, code),
    CHECK ((code = 'trial' AND amount_kopecks = 0 AND duration_days = 7 AND duration_months = 0)
        OR (code <> 'trial' AND amount_kopecks > 0 AND duration_days = 0 AND duration_months > 0))
);
INSERT INTO delivery.plan(product_code, code, amount_kopecks, duration_days, duration_months)
VALUES ('raschet','trial',0,7,0), ('raschet','month',29900,0,1),
       ('raschet','quarter',79900,0,3), ('raschet','year',249000,0,12);

-- Opaque IDs only; no debtor records, phone numbers, card numbers or payment credentials.
CREATE TABLE delivery.subscription (
    id uuid PRIMARY KEY,
    customer_id uuid NOT NULL,
    product_code text NOT NULL REFERENCES delivery.product(code),
    installation_id uuid,
    valid_until timestamptz CHECK (valid_until IS NULL OR isfinite(valid_until)),
    revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (customer_id, product_code),
    UNIQUE (id, product_code),
    UNIQUE (product_code, installation_id)
);

CREATE TABLE delivery.installation_event (
    id uuid PRIMARY KEY,
    subscription_id uuid NOT NULL REFERENCES delivery.subscription(id),
    old_installation uuid,
    new_installation uuid NOT NULL,
    revision bigint NOT NULL CHECK (revision > 0),
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    operator_role text NOT NULL DEFAULT session_user,
    CHECK (old_installation IS DISTINCT FROM new_installation)
);
CREATE INDEX installation_events_by_subscription
    ON delivery.installation_event(subscription_id, recorded_at);

CREATE TABLE delivery.grant_event (
    id uuid PRIMARY KEY,
    subscription_id uuid NOT NULL,
    product_code text NOT NULL,
    plan_code text NOT NULL,
    amount_kopecks bigint NOT NULL CHECK (amount_kopecks >= 0),
    starts_at timestamptz NOT NULL CHECK (isfinite(starts_at)),
    ends_at timestamptz NOT NULL CHECK (isfinite(ends_at) AND ends_at > starts_at),
    revision bigint NOT NULL CHECK (revision > 0),
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    operator_role text NOT NULL DEFAULT session_user,
    FOREIGN KEY (subscription_id, product_code) REFERENCES delivery.subscription(id, product_code),
    FOREIGN KEY (product_code, plan_code) REFERENCES delivery.plan(product_code, code),
    CHECK ((plan_code = 'trial' AND amount_kopecks = 0)
        OR (plan_code <> 'trial' AND amount_kopecks > 0))
);
CREATE INDEX grants_by_subscription ON delivery.grant_event(subscription_id, starts_at, ends_at);

-- A trial is available once per customer/product AND once per known installation ID.
-- An installation ID is not a hardware identity; reinstall abuse requires operator review.
CREATE TABLE delivery.trial_installation (
    product_code text NOT NULL REFERENCES delivery.product(code),
    installation_id uuid NOT NULL,
    event_id uuid NOT NULL UNIQUE REFERENCES delivery.grant_event(id),
    PRIMARY KEY (product_code, installation_id)
);

CREATE FUNCTION delivery.create_subscription(p_id uuid, p_customer uuid, p_product text)
RETURNS delivery.subscription LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, delivery AS $$
DECLARE s delivery.subscription;
BEGIN
    INSERT INTO delivery.subscription(id, customer_id, product_code)
    VALUES (p_id,p_customer,p_product)
    ON CONFLICT (id) DO NOTHING;
    SELECT * INTO STRICT s FROM delivery.subscription WHERE id=p_id;
    IF s.customer_id IS DISTINCT FROM p_customer OR s.product_code IS DISTINCT FROM p_product THEN
        RAISE EXCEPTION 'subscription ID already used by another customer or product';
    END IF;
    RETURN s;
END;
$$;

-- Initial bind: expected old is NULL. Transfer: expected old must match.
-- Serialized with renewal; a retry returns the original receipt, not a second mutation.
CREATE FUNCTION delivery.set_installation(p_id uuid, p_event uuid, p_old uuid, p_new uuid)
RETURNS delivery.installation_event LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, delivery AS $$
DECLARE s delivery.subscription; e delivery.installation_event;
BEGIN
    IF p_event IS NULL OR p_new IS NULL OR p_new IS NOT DISTINCT FROM p_old THEN
        RAISE EXCEPTION 'invalid installation request';
    END IF;
    SELECT * INTO STRICT s FROM delivery.subscription WHERE id=p_id FOR UPDATE;
    SELECT * INTO e FROM delivery.installation_event WHERE id=p_event;
    IF FOUND THEN
        IF e.subscription_id IS DISTINCT FROM p_id OR e.old_installation IS DISTINCT FROM p_old
            OR e.new_installation IS DISTINCT FROM p_new THEN
            RAISE EXCEPTION 'installation event ID reused with different input';
        END IF;
        RETURN e;
    END IF;
    IF s.installation_id IS DISTINCT FROM p_old THEN
        RAISE EXCEPTION 'installation changed; refresh current state';
    END IF;
    UPDATE delivery.subscription SET installation_id=p_new, revision=revision+1
        WHERE id=p_id RETURNING * INTO s;
    INSERT INTO delivery.installation_event(id,subscription_id,old_installation,new_installation,revision)
        VALUES(p_event,p_id,p_old,p_new,s.revision) RETURNING * INTO e;
    RETURN e;
END;
$$;

-- Only an authenticated database operator may execute this. A paid grant represents
-- their confirmation of a real payment; this does not charge a card or create a fiscal receipt.
CREATE FUNCTION delivery.grant_period(p_id uuid, p_event uuid, p_plan text, p_amount bigint)
RETURNS delivery.grant_event LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, delivery SET TimeZone = 'UTC' AS $$
DECLARE s delivery.subscription; e delivery.grant_event; t delivery.plan;
    moment timestamptz; first_at timestamptz; last_at timestamptz;
BEGIN
    IF p_event IS NULL OR p_plan IS NULL OR p_amount IS NULL THEN
        RAISE EXCEPTION 'invalid grant request';
    END IF;
    SELECT * INTO STRICT s FROM delivery.subscription WHERE id=p_id FOR UPDATE;
    SELECT * INTO e FROM delivery.grant_event WHERE id=p_event;
    IF FOUND THEN
        IF e.subscription_id IS DISTINCT FROM p_id OR e.plan_code IS DISTINCT FROM p_plan
            OR e.amount_kopecks IS DISTINCT FROM p_amount THEN
            RAISE EXCEPTION 'grant event ID reused with different input';
        END IF;
        RETURN e;
    END IF;
    SELECT * INTO t FROM delivery.plan WHERE product_code=s.product_code AND code=p_plan AND enabled;
    IF NOT FOUND OR t.amount_kopecks IS DISTINCT FROM p_amount THEN
        RAISE EXCEPTION 'unknown plan or incorrect confirmed amount';
    END IF;
    IF p_plan='trial' THEN
        IF s.installation_id IS NULL OR EXISTS (SELECT 1 FROM delivery.grant_event WHERE subscription_id=p_id) THEN
            RAISE EXCEPTION 'trial requires a bound installation and no prior grant';
        END IF;
        IF EXISTS (SELECT 1 FROM delivery.trial_installation
                   WHERE product_code=s.product_code AND installation_id=s.installation_id) THEN
            RAISE EXCEPTION 'trial already used on this installation';
        END IF;
    END IF;
    moment := clock_timestamp();
    first_at := greatest(moment, coalesce(s.valid_until,moment));
    last_at := first_at + make_interval(months => t.duration_months, days => t.duration_days);
    UPDATE delivery.subscription SET valid_until=last_at, revision=revision+1
        WHERE id=p_id RETURNING * INTO s;
    INSERT INTO delivery.grant_event(id,subscription_id,product_code,plan_code,amount_kopecks,starts_at,ends_at,revision)
        VALUES(p_event,p_id,s.product_code,p_plan,p_amount,first_at,last_at,s.revision) RETURNING * INTO e;
    IF p_plan='trial' THEN
        INSERT INTO delivery.trial_installation VALUES(s.product_code,s.installation_id,p_event);
    END IF;
    RETURN e;
END;
$$;

-- Status is computed from server time, never from a client-supplied timestamp.
CREATE VIEW delivery.subscription_status AS
WITH instant AS MATERIALIZED (SELECT clock_timestamp() AS now_at)
SELECT s.id,s.customer_id,s.product_code,s.installation_id,s.valid_until,s.revision,
    CASE WHEN s.valid_until IS NULL THEN 'not_started'
         WHEN s.valid_until <= instant.now_at THEN 'expired'
         WHEN s.installation_id IS NULL THEN 'awaiting_activation'
         ELSE 'active' END AS status,
    CASE WHEN s.installation_id IS NOT NULL AND s.valid_until > instant.now_at
         THEN true ELSE false END AS may_create_debt,
    (SELECT g.plan_code FROM delivery.grant_event g
     WHERE g.subscription_id=s.id AND g.starts_at<=instant.now_at AND g.ends_at>instant.now_at
     ORDER BY g.starts_at DESC LIMIT 1) AS effective_plan
FROM delivery.subscription s CROSS JOIN instant;

REVOKE ALL ON ALL TABLES IN SCHEMA delivery FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA delivery FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA delivery REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
COMMIT;
