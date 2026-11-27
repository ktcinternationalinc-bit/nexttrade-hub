-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- v55.83-AAD — payroll bills validate themselves (Max, 27 Nov 2026: "payroll is automatically validated"). Needs v55.83-ZY first
-- (sql/v55-83-ZY-other-services-operational.sql: Other services / Operational). The Hub decides a bill is payroll with ZD's one rule
-- (src/lib/payroll-bills.js) and calls this ONLY for a bill from a trusted source: entered by the super admin, a repeating payroll
-- bill, or a KTC bill made from a Nextrade payroll line. E-mailed / imported bills are never auto-validated (they wait, as now).
-- Only an ACTIVE bill not validated yet. Type / direction are kept when already set, else Other services / Operational. Validated by
-- nobody (the system): the note and the audit row say so with the rule and the source. Only the Hub server can call it. Adds one
-- function: no row is changed, nothing is deleted, and existing unvalidated payroll bills are NOT back-filled. Re-runnable.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
BEGIN;

DO $g$ DECLARE v_ok boolean; BEGIN
  IF to_regprocedure('public.hub_bill_other_services_installed()') IS NULL THEN
    RAISE EXCEPTION 'Run sql/v55-83-ZY-other-services-operational.sql first (Other services / Operational) — nothing was changed.';
  END IF;
  EXECUTE 'SELECT public.hub_bill_other_services_installed()' INTO v_ok;
  IF v_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'Run sql/v55-83-ZY-other-services-operational.sql first (Other services / Operational) — nothing was changed.';
  END IF;
END $g$;
CREATE OR REPLACE FUNCTION public.hub_bill_auto_validate_payroll(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid := (p->>'bill_id')::uuid; v_reasons text := btrim(coalesce(p->>'reasons', '')); v_source text := btrim(coalesce(p->>'source', '')); b record; v_note text;
BEGIN
  IF v_reasons = '' THEN RAISE EXCEPTION 'HUB_GUARD: the payroll rule that matched is required.'; END IF;
  IF v_source = '' THEN RAISE EXCEPTION 'HUB_GUARD: where the payroll bill came from is required.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-bill:' || v_id::text, 0));
  SELECT id, record_status, validation_status, bill_type, shipment_direction, price_check_status, price_resolved_note INTO b FROM public.vendor_bills WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'not_found'); END IF;
  IF b.record_status IS DISTINCT FROM 'active' THEN RETURN jsonb_build_object('ok', false, 'code', 'not_active'); END IF;
  IF b.validation_status = 'validated' THEN RETURN jsonb_build_object('ok', true, 'repeat', true); END IF;
  v_note := left('Auto-validated: payroll (rule) — ' || v_reasons || ' · ' || v_source || '. No manual checks: payroll bills are validated automatically (Max, 27 Nov 2026).', 1000);
  UPDATE public.vendor_bills SET bill_type = coalesce(bill_type, 'other_services'), bill_type_source = CASE WHEN bill_type IS NULL THEN 'validator' ELSE bill_type_source END,
    shipment_direction = coalesce(shipment_direction, 'operational'), direction_source = CASE WHEN shipment_direction IS NULL THEN 'validator' ELSE direction_source END,
    -- a price check that flagged a payroll bill is answered by the same rule, in plain words (the validation trigger needs a note)
    price_resolved_note = CASE WHEN b.price_check_status = 'flagged' AND length(btrim(coalesce(b.price_resolved_note, ''))) < 10 THEN 'Payroll bill — validated automatically by rule; the price check is not applied to payroll.' ELSE price_resolved_note END,
    price_resolved_by = CASE WHEN b.price_check_status = 'flagged' AND length(btrim(coalesce(b.price_resolved_note, ''))) < 10 THEN 'system (payroll rule)' ELSE price_resolved_by END,
    price_resolved_at = CASE WHEN b.price_check_status = 'flagged' AND length(btrim(coalesce(b.price_resolved_note, ''))) < 10 THEN now() ELSE price_resolved_at END,
    validation_status = 'validated', validated_by = NULL, validated_at = now(), validation_notes = v_note, updated_at = now()
  WHERE id = v_id;
  INSERT INTO public.hub_audit_log (actor_id, action, entity, entity_id, details)
  VALUES (NULL, 'bill_auto_validated_payroll', 'vendor_bill', v_id::text, jsonb_build_object('rule', 'payroll (ZD)', 'reasons', v_reasons, 'source', v_source, 'bill_type_was', b.bill_type, 'direction_was', b.shipment_direction, 'price_check', b.price_check_status, 'by', 'system'));
  RETURN jsonb_build_object('ok', true, 'validated', true, 'note', v_note);
END $$;
REVOKE ALL ON FUNCTION public.hub_bill_auto_validate_payroll(jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hub_bill_auto_validate_payroll(jsonb) TO service_role;

COMMIT;

-- check (read-only): every line should say OK
SELECT 'payroll auto-validation installed' AS what, CASE WHEN to_regprocedure('public.hub_bill_auto_validate_payroll(jsonb)') IS NOT NULL THEN 'OK' ELSE 'PROBLEM' END AS result
UNION ALL SELECT 'server only (the browser cannot call it)', CASE WHEN NOT has_function_privilege('authenticated', 'public.hub_bill_auto_validate_payroll(jsonb)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.hub_bill_auto_validate_payroll(jsonb)', 'EXECUTE') THEN 'OK' ELSE 'PROBLEM' END;
