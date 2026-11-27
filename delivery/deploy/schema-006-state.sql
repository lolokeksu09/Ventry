-- Read-only classification. Reject partial/unknown schemas rather than guessing.
WITH checks AS (
  SELECT
    to_regclass('delivery.subscription') IS NOT NULL
      AND to_regclass('delivery.grant_event') IS NOT NULL
      AND to_regprocedure('delivery.api_consume_download_retry(bytea,text,bytea)') IS NOT NULL
      AND EXISTS(SELECT 1 FROM pg_catalog.pg_attribute
        WHERE attrelid=to_regclass('delivery.download_grant') AND attname='retry_hash' AND NOT attisdropped) AS v5,
    to_regclass('delivery.customer') IS NOT NULL AS customer,
    to_regprocedure('delivery.ensure_customer()') IS NOT NULL AS ensure_customer,
    to_regprocedure('delivery.api_customer(uuid)') IS NOT NULL AS customer_api,
    to_regprocedure('delivery.api_customer_name(uuid,text,bigint)') IS NOT NULL AS name_api,
    to_regprocedure('delivery.api_desk(text,text,text,uuid)') IS NOT NULL AS desk_api,
    to_regprocedure('delivery.api_revenue(text,integer)') IS NOT NULL AS revenue_api,
    to_regprocedure('delivery.api_payment_page(uuid,uuid)') IS NOT NULL AS payment_api,
    EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid=to_regclass('delivery.subscription')
      AND conname='subscription_customer_fk') AS fk_exists,
    EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid=to_regclass('delivery.subscription')
      AND conname='subscription_customer_fk' AND contype='f' AND convalidated
      AND confrelid=to_regclass('delivery.customer')) AS fk_valid,
    EXISTS(SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid=to_regclass('delivery.subscription')
      AND tgname='subscription_customer') AS trigger_exists,
    EXISTS(SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid=to_regclass('delivery.subscription')
      AND tgname='subscription_customer' AND tgenabled IN ('O','A')
      AND tgfoid=to_regprocedure('delivery.ensure_customer()')) AS trigger_valid,
    to_regclass('delivery.grant_product_recorded') IS NOT NULL AS revenue_index,
    to_regclass('delivery.grant_subscription_recorded') IS NOT NULL AS payments_index,
    to_regclass('delivery.subscription_product_expiry') IS NOT NULL AS expiry_index
)
SELECT CASE
  WHEN v5 AND customer AND ensure_customer AND customer_api AND name_api AND desk_api
    AND revenue_api AND payment_api AND fk_valid AND trigger_valid
    AND revenue_index AND payments_index AND expiry_index THEN 'ready'
  WHEN v5 AND NOT (customer OR ensure_customer OR customer_api OR name_api OR desk_api
    OR revenue_api OR payment_api OR fk_exists OR trigger_exists
    OR revenue_index OR payments_index OR expiry_index) THEN 'upgrade_required'
  ELSE 'unknown'
END FROM checks;
