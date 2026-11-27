-- Run after v55-83-VK-rule-apply-guard.sql, v55-83-WX-bill-category-rules.sql,
-- and v55-83-ZD-payroll-bills.sql.
-- Saving a mapping and refreshing the KTC bills that inherit it are one transaction.
BEGIN;

CREATE OR REPLACE FUNCTION public.hub_save_nextrade_ktc_mapping(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_company constant text := 'NEXTRADE_BOOKS';
  v_ktc constant text := 'QnVzaW5lc3M6NWRkNzI3MDctOTExNC00NjQwLTg4MGQtMjYzNmI3YzM4YTdk';
  v_key text := nullif(p->>'category_key', '');
  v_new text := nullif(p->>'ktc_category', '');
  v_actor uuid := (p->>'actor')::uuid;
  v_allow_private boolean := coalesce((p->>'allow_private')::boolean, false);
  v_allow_payroll boolean := coalesce((p->>'allow_payroll')::boolean, false);
  v_previous text;
  v_category_id uuid;
  v_is_payroll boolean;
  v_updated integer;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: No signed-in person.'; END IF;
  SELECT id, is_payroll INTO v_category_id, v_is_payroll
    FROM public.company_categories WHERE company_id = v_company AND key = v_key;
  IF v_category_id IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: Choose a Nextrade category.'; END IF;
  IF v_new IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.expense_categories WHERE key = v_new AND active) THEN
    RAISE EXCEPTION 'HUB_GUARD: Choose an active KTC category.';
  END IF;
  IF NOT v_allow_payroll AND (v_is_payroll OR hub_private.values_are_payroll(NULL, v_new)) THEN
    RAISE EXCEPTION 'HUB_GUARD: A super admin manages KTC payroll mappings.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('hub-nextrade-ktc-map:' || v_key, 0));
  SELECT ktc_category INTO v_previous FROM public.company_category_map WHERE company_id = v_company AND category_key = v_key;

  UPDATE public.vendor_bills b SET category = v_new, updated_at = now()
    FROM public.company_bill_links l
    JOIN public.bank_transactions t ON t.id = l.source_bank_transaction_id AND t.wave_business_id = l.company_id
    LEFT JOIN public.plaid_accounts a ON a.plaid_account_id = t.account_id
    WHERE l.bill_id = b.id AND l.company_id = v_company AND l.category_key = v_key
      AND l.status = 'active' AND l.mode = 'created'
      AND t.company_category = v_key
      AND b.wave_business_id = v_ktc AND b.record_status = 'active'
      AND b.category_source IS NULL AND (b.category IS NULL OR b.category = v_previous)
      AND b.category IS DISTINCT FROM v_new
      AND (v_allow_private OR a.is_private IS NOT TRUE)
      AND (v_allow_payroll OR NOT hub_private.bill_is_payroll(b.id))
      AND NOT EXISTS (
        SELECT 1 FROM public.wire_package_lines wl
        JOIN public.wire_packages w ON w.id = wl.package_id
        WHERE wl.bill_id = b.id AND wl.is_open AND w.status = 'sent'
      );
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  INSERT INTO public.company_category_map (company_id, category_key, ktc_category, updated_by)
    VALUES (v_company, v_key, v_new, v_actor)
    ON CONFLICT (company_id, category_key) DO UPDATE
      SET ktc_category = EXCLUDED.ktc_category, updated_by = EXCLUDED.updated_by, updated_at = now();

  INSERT INTO public.hub_audit_log (actor_id, action, entity, entity_id, details)
    VALUES (v_actor, 'nextrade_category_mapped', 'company_category', v_category_id::text,
      jsonb_build_object('nextrade_category', v_key, 'from', v_previous, 'to', v_new, 'bills_updated', v_updated));
  RETURN jsonb_build_object('ok', true, 'bills_updated', v_updated);
END $$;

-- Read the saved mapping under the same lock so categorizing during a mapping change
-- cannot create a bill with a stale mapping. Reuse the existing line and bill guards.
CREATE OR REPLACE FUNCTION public.hub_company_categorize_with_mapping(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_key text := nullif(p->>'category_key', '');
  v_ktc_category text;
BEGIN
  IF p->>'company_id' = 'NEXTRADE_BOOKS' AND v_key IS NOT NULL AND p ? 'ktc_category' THEN
    PERFORM pg_advisory_xact_lock_shared(hashtextextended('hub-nextrade-ktc-map:' || v_key, 0));
    SELECT ktc_category INTO v_ktc_category FROM public.company_category_map
      WHERE company_id = 'NEXTRADE_BOOKS' AND category_key = v_key;
    IF NOT coalesce((p->>'allow_payroll')::boolean, false) AND hub_private.values_are_payroll(p->'bill'->>'vendor_name', v_ktc_category) THEN
      RAISE EXCEPTION 'HUB_GUARD: A super admin manages KTC payroll bills.';
    END IF;
    p := p || jsonb_build_object('ktc_category', v_ktc_category);
  END IF;
  IF p->>'source' = 'rule' THEN
    RETURN public.hub_company_categorize_if_open(p);
  END IF;
  RETURN public.hub_company_categorize(p);
END $$;

REVOKE ALL ON FUNCTION public.hub_save_nextrade_ktc_mapping(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hub_company_categorize_with_mapping(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hub_save_nextrade_ktc_mapping(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.hub_company_categorize_with_mapping(jsonb) TO service_role;
COMMIT;
