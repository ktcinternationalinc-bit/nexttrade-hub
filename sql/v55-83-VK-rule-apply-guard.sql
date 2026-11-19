-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-VK — a RULE may only categorize a line that is still waiting (Codex 19 Nov 20:27, P1)
--   Nextrade / RTM books: when a rule categorizes a bank line, the database now checks — under the same lock the
--   categorizing step itself takes — that the line is STILL not categorized, not pending, not a duplicate and not paired
--   as a transfer. If a person categorized it a moment earlier, the rule leaves it alone (answer: skipped) and no KTC bill
--   is made, changed or voided. A person's own categorizing is not affected: it uses the same step as before.
-- Adds two small functions. Changes no data, no table and no existing function. Safe to run more than once.
-- Run AFTER sql/v55-83-UD-pay-nextrade.sql (already installed).
-- Run in: Supabase → your project → SQL Editor → New query → paste all of this → Run
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.hub_company_categorize_if_open(p jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_line record; v_company text := p->>'company_id'; v_why text := NULL;
BEGIN
  IF nullif(p->>'category_key', '') IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: a rule must name a category.'; END IF;
  IF v_company NOT IN ('NEXTRADE_BOOKS', 'RTM_BOOKS') THEN RAISE EXCEPTION 'HUB_GUARD: say which company (Nextrade or RTM).'; END IF;
  -- the SAME lock hub_company_categorize takes (held to the end of the transaction; taking it again inside is allowed)
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-company-line:' || (p->>'line_id'), 0));
  SELECT id, wave_business_id, company_category, pending, review_status, transfer_group_id INTO v_line
    FROM public.bank_transactions WHERE id = (p->>'line_id')::uuid FOR UPDATE;
  IF v_line.id IS NULL THEN v_why := 'not_found';
  ELSIF v_line.wave_business_id IS DISTINCT FROM v_company THEN v_why := 'other_company';
  ELSIF v_line.company_category IS NOT NULL THEN v_why := 'already_categorized';
  ELSIF v_line.pending IS TRUE THEN v_why := 'pending';
  ELSIF v_line.review_status = 'duplicate' THEN v_why := 'duplicate';
  ELSIF v_line.transfer_group_id IS NOT NULL THEN v_why := 'paired_transfer';
  END IF;
  IF v_why IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'why', v_why, 'action', 'none');
  END IF;
  -- still waiting: the ordinary step, in this same transaction (category + KTC bill + link, all or nothing)
  RETURN public.hub_company_categorize(p || jsonb_build_object('source', 'rule'));
END $$;
REVOKE ALL ON FUNCTION public.hub_company_categorize_if_open(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hub_company_categorize_if_open(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.hub_company_rule_guard_installed() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'hub_company_categorize_if_open')
     AND EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'hub_company_categorize');
$$;
REVOKE ALL ON FUNCTION public.hub_company_rule_guard_installed() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hub_company_rule_guard_installed() TO service_role;

-- CHECK (read-only): every line must say OK
SELECT 'rules only categorize a line that is still waiting' AS check_item,
       CASE WHEN public.hub_company_rule_guard_installed() THEN 'OK' ELSE 'PROBLEM' END AS result
UNION ALL SELECT 'only the Hub server can run it',
       CASE WHEN NOT has_function_privilege('authenticated', 'public.hub_company_categorize_if_open(jsonb)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.hub_company_categorize_if_open(jsonb)', 'EXECUTE')
             AND has_function_privilege('service_role', 'public.hub_company_categorize_if_open(jsonb)', 'EXECUTE') THEN 'OK' ELSE 'PROBLEM' END;
