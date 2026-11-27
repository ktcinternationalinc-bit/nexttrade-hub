-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- v55.83-ZY — bill type "Other services" and "This bill is for: Operational" (Max, 27 Nov 2026, on a QuickBooks subscription bill:
-- "we need other services as a selection for type of bill / this bill is for add Operational").
--   bill_type          + 'other_services'  (software, subscriptions, office and professional services — a service, never goods)
--   shipment_direction + 'operational'     (not tied to a shipment: no release # and no reference needed)
-- The same two lists on the price rules (bill type) and a vendor's default direction. This ONLY widens what is allowed: no row is
-- changed, nothing is deleted, every value allowed before is still allowed. Re-runnable. One transaction.
-- Also: payroll bills validate themselves (hub_bill_auto_validate_payroll), called by the Hub when a payroll bill is created.
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

-- PAYROLL BILLS VALIDATE THEMSELVES (Max, 27 Nov 2026: "payroll is automatically validated"). The Hub decides that a bill is payroll with
-- ZD's one rule (src/lib/payroll-bills.js) and calls this right after the bill is created / imported; the reasons that matched are
-- written on the bill and in the audit trail. Only an ACTIVE bill that is not validated yet. Type / direction are kept when already
-- set, else Other services / Operational. Who validated = nobody (the system); the note says so plainly. Only the Hub server.
CREATE OR REPLACE FUNCTION public.hub_bill_auto_validate_payroll(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid := (p->>'bill_id')::uuid; v_reasons text := btrim(coalesce(p->>'reasons', '')); b record; v_note text;
BEGIN
  IF v_reasons = '' THEN RAISE EXCEPTION 'HUB_GUARD: the payroll rule that matched is required.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-bill:' || v_id::text, 0));
  SELECT id, record_status, validation_status, bill_type, shipment_direction, price_check_status, price_resolved_note INTO b FROM public.vendor_bills WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'not_found'); END IF;
  IF b.record_status IS DISTINCT FROM 'active' THEN RETURN jsonb_build_object('ok', false, 'code', 'not_active'); END IF;
  IF b.validation_status = 'validated' THEN RETURN jsonb_build_object('ok', true, 'repeat', true); END IF;
  v_note := left('Auto-validated: payroll (rule) — ' || v_reasons || '. No manual checks: payroll bills are validated automatically (Max, 27 Nov 2026).', 1000);
  UPDATE public.vendor_bills SET bill_type = coalesce(bill_type, 'other_services'), bill_type_source = CASE WHEN bill_type IS NULL THEN 'validator' ELSE bill_type_source END,
    shipment_direction = coalesce(shipment_direction, 'operational'), direction_source = CASE WHEN shipment_direction IS NULL THEN 'validator' ELSE direction_source END,
    -- a price check that flagged a payroll bill is answered by the same rule, in plain words (the validation trigger needs a note)
    price_resolved_note = CASE WHEN b.price_check_status = 'flagged' AND length(btrim(coalesce(b.price_resolved_note, ''))) < 10 THEN 'Payroll bill — validated automatically by rule; the price check is not applied to payroll.' ELSE price_resolved_note END,
    price_resolved_by = CASE WHEN b.price_check_status = 'flagged' AND length(btrim(coalesce(b.price_resolved_note, ''))) < 10 THEN 'system (payroll rule)' ELSE price_resolved_by END,
    price_resolved_at = CASE WHEN b.price_check_status = 'flagged' AND length(btrim(coalesce(b.price_resolved_note, ''))) < 10 THEN now() ELSE price_resolved_at END,
    validation_status = 'validated', validated_by = NULL, validated_at = now(), validation_notes = v_note, updated_at = now()
  WHERE id = v_id;
  INSERT INTO public.hub_audit_log (actor_id, action, entity, entity_id, details)
  VALUES (NULL, 'bill_auto_validated_payroll', 'vendor_bill', v_id::text, jsonb_build_object('rule', 'payroll (ZD)', 'reasons', v_reasons, 'bill_type_was', b.bill_type, 'direction_was', b.shipment_direction, 'price_check', b.price_check_status, 'by', 'system'));
  RETURN jsonb_build_object('ok', true, 'validated', true, 'note', v_note);
END $$;
REVOKE ALL ON FUNCTION public.hub_bill_auto_validate_payroll(jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hub_bill_auto_validate_payroll(jsonb) TO service_role;

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
UNION ALL SELECT 'payroll auto-validation (server only)', CASE WHEN NOT has_function_privilege('authenticated', 'public.hub_bill_auto_validate_payroll(jsonb)', 'EXECUTE') THEN 'OK' ELSE 'PROBLEM' END
UNION ALL SELECT 'installed flag', CASE WHEN public.hub_bill_other_services_installed() THEN 'OK' ELSE 'PROBLEM' END;
