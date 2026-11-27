-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- v55.83-ZY — bill type "Other services" and "This bill is for: Operational" (Max, 27 Nov 2026, on a QuickBooks subscription bill:
-- "we need other services as a selection for type of bill / this bill is for add Operational").
--   bill_type          + 'other_services'  (software, subscriptions, office and professional services — a service, never goods)
--   shipment_direction + 'operational'     (not tied to a shipment: no release # and no reference needed)
-- The same two lists on the price rules (bill type) and a vendor's default direction. This ONLY widens what is allowed: no row is
-- changed, nothing is deleted, every value allowed before is still allowed. Re-runnable. One transaction.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
BEGIN;

ALTER TABLE public.vendor_bills DROP CONSTRAINT IF EXISTS vendor_bills_bill_type_check;
ALTER TABLE public.vendor_bills ADD CONSTRAINT vendor_bills_bill_type_check
  CHECK (bill_type IS NULL OR bill_type IN ('trucking', 'shipping', 'bonded_brokerage', 'supplier', 'other_services'));

ALTER TABLE public.vendor_bills DROP CONSTRAINT IF EXISTS vendor_bills_shipment_direction_check;
ALTER TABLE public.vendor_bills ADD CONSTRAINT vendor_bills_shipment_direction_check
  CHECK (shipment_direction IS NULL OR shipment_direction IN ('inbound', 'outbound', 'operational'));

DO $r$ BEGIN
  IF to_regclass('public.bill_price_rules') IS NOT NULL THEN
    ALTER TABLE public.bill_price_rules DROP CONSTRAINT IF EXISTS bill_price_rules_bill_type_check;
    ALTER TABLE public.bill_price_rules ADD CONSTRAINT bill_price_rules_bill_type_check
      CHECK (bill_type IS NULL OR bill_type IN ('trucking', 'shipping', 'bonded_brokerage', 'supplier', 'other_services'));
  END IF;
  IF to_regclass('public.bill_commission_rules') IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'bill_commission_rules' AND column_name = 'default_direction') THEN
    ALTER TABLE public.bill_commission_rules DROP CONSTRAINT IF EXISTS bill_commission_rules_default_direction_check;
    ALTER TABLE public.bill_commission_rules ADD CONSTRAINT bill_commission_rules_default_direction_check
      CHECK (default_direction IS NULL OR default_direction IN ('inbound', 'outbound', 'operational'));
  END IF;
END $r$;

-- the validation rule (RP) says the three choices now; it still needs a type and a direction, nothing else changes
CREATE OR REPLACE FUNCTION public.vendor_bills_validation_needs_type() RETURNS trigger LANGUAGE plpgsql AS $t$
BEGIN
  IF NEW.validation_status = 'validated' AND COALESCE(OLD.validation_status, '') <> 'validated' THEN
    IF NEW.bill_type IS NULL THEN RAISE EXCEPTION 'Pick the bill TYPE before validating it.'; END IF;
    IF NEW.shipment_direction IS NULL THEN RAISE EXCEPTION 'Mark what the bill is for (Inbound, Outbound or Operational) before validating it.'; END IF;
  END IF;
  RETURN NEW;
END $t$;

-- the Hub asks this before offering the two new choices
CREATE OR REPLACE FUNCTION public.hub_bill_other_services_installed() RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT position('other_services' in coalesce((SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c WHERE c.conrelid = 'public.vendor_bills'::regclass AND c.conname = 'vendor_bills_bill_type_check'), '')) > 0
     AND position('operational' in coalesce((SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c WHERE c.conrelid = 'public.vendor_bills'::regclass AND c.conname = 'vendor_bills_shipment_direction_check'), '')) > 0 $$;
GRANT EXECUTE ON FUNCTION public.hub_bill_other_services_installed() TO service_role, authenticated;

COMMIT;

-- check (read-only): every line should say OK
SELECT 'bill type allows other_services' AS what, CASE WHEN position('other_services' in pg_get_constraintdef(oid)) > 0 THEN 'OK' ELSE 'PROBLEM' END AS result FROM pg_constraint WHERE conrelid = 'public.vendor_bills'::regclass AND conname = 'vendor_bills_bill_type_check'
UNION ALL SELECT 'direction allows operational', CASE WHEN position('operational' in pg_get_constraintdef(oid)) > 0 THEN 'OK' ELSE 'PROBLEM' END FROM pg_constraint WHERE conrelid = 'public.vendor_bills'::regclass AND conname = 'vendor_bills_shipment_direction_check'
UNION ALL SELECT 'installed flag', CASE WHEN public.hub_bill_other_services_installed() THEN 'OK' ELSE 'PROBLEM' END;
