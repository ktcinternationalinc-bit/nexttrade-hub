-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-UB — NEXTRADE / RTM: TRANSFERS paired like QuickBooks, and CATEGORIES with a direction (Max, Nov 17 2026)
-- 1. A transfer between two of the company's OWN accounts (checking → savings, checking → paying the credit card) is PAIRED:
--    the money-out line and the money-in line are linked as ONE transfer — never income, never spending — and can be
--    unpaired. Pairing and unpairing are each ONE database step: both lines, their categories and any Nextrade KTC bill
--    change together or not at all, under locks (two people at once cannot pair a line twice).
-- 2. A category has a DIRECTION: money in, money out, or both. The database refuses a money-in category on a money-out line.
-- Needs sql/v55-83-TV-TW-TX-all-in-one.sql first. Adds a column + functions only. Nothing is deleted. Safe to re-run.
-- Run in: Supabase → your project → SQL Editor → New query → paste all of this → Run
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.company_categories ADD COLUMN IF NOT EXISTS direction text NOT NULL DEFAULT 'any';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_categories_direction_chk') THEN
    ALTER TABLE public.company_categories ADD CONSTRAINT company_categories_direction_chk CHECK (direction IN ('any', 'in', 'out'));
  END IF;
END $$;
-- the starting categories get their natural direction (only while still 'any', so a person's choice is never changed)
UPDATE public.company_categories SET direction = 'in' WHERE key = 'money_from_ktc' AND direction = 'any';
UPDATE public.company_categories SET direction = 'out' WHERE key IN ('payroll', 'other_expense') AND direction = 'any';

-- the categorize function again, with the direction check and the paired-transfer lock added (everything else unchanged)
CREATE OR REPLACE FUNCTION public.hub_company_categorize(p jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_line record; v_cat record; v_link record; v_bill record; v_want boolean := false; v_action text := 'none';
  v_bill_id uuid; v_paid numeric; v_party text := coalesce(p->>'party', 'NextTrade Industries');
  v_company text := p->>'company_id'; v_key text := nullif(p->>'category_key', ''); v_actor uuid := nullif(p->>'actor', '')::uuid;
  v_ktc text := nullif(p->>'ktc_category', ''); v_attach uuid := nullif(p->>'attach_bill_id', '')::uuid; v_set_via boolean := false;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: no signed-in person.'; END IF;
  IF v_company NOT IN ('NEXTRADE_BOOKS', 'RTM_BOOKS') THEN RAISE EXCEPTION 'HUB_GUARD: say which company (Nextrade or RTM).'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-company-line:' || (p->>'line_id'), 0));
  SELECT id, wave_business_id, direction, amount_abs, company_category, transfer_group_id INTO v_line FROM public.bank_transactions WHERE id = (p->>'line_id')::uuid FOR UPDATE;
  IF v_line.id IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: the bank line was not found.'; END IF;
  IF v_line.wave_business_id IS DISTINCT FROM v_company THEN RAISE EXCEPTION 'HUB_GUARD: that line is not a % line.', CASE WHEN v_company = 'RTM_BOOKS' THEN 'RTM' ELSE 'Nextrade' END; END IF;
  -- v55.83-UB: a line paired as a transfer keeps its transfer category until it is unpaired (the pair / unpair functions pass pairing=true)
  IF v_line.transfer_group_id IS NOT NULL AND coalesce(p->>'pairing', '') <> 'true' THEN
    RAISE EXCEPTION 'HUB_GUARD: this line is paired as a transfer — unpair it first (↔ Unpair), then pick another category.';
  END IF;
  IF v_key IS NOT NULL THEN
    SELECT key, kind, is_payroll, active, direction INTO v_cat FROM public.company_categories WHERE company_id = v_company AND key = v_key;
    IF v_cat.key IS NULL OR v_cat.active IS NOT TRUE THEN RAISE EXCEPTION 'HUB_GUARD: pick one of the company''s own categories.'; END IF;
    -- v55.83-UB: a category made for money IN cannot go on money OUT (and the other way round)
    IF v_cat.direction IN ('in', 'out') AND v_cat.direction <> v_line.direction THEN
      RAISE EXCEPTION 'HUB_GUARD: that category is for money %, and this line is money %.', v_cat.direction, v_line.direction;
    END IF;
    v_want := v_company = 'NEXTRADE_BOOKS' AND v_cat.kind IN ('expense', 'cogs', 'other_expense') AND v_cat.is_payroll IS NOT TRUE AND v_line.direction = 'out';
  END IF;

  IF v_company = 'NEXTRADE_BOOKS' THEN
    SELECT * INTO v_link FROM public.company_bill_links WHERE source_bank_transaction_id = v_line.id FOR UPDATE;
    -- always assigned (a row of NULLs when there is no bill yet), so later checks can read it
    SELECT id, record_status, paid_via, bill_number, category, total_amount INTO v_bill FROM public.vendor_bills WHERE id = v_link.bill_id FOR UPDATE;

    IF NOT v_want THEN
      IF v_link.id IS NOT NULL AND v_link.status = 'active' THEN
        IF v_link.mode = 'created' AND v_bill.record_status = 'active' THEN
          SELECT coalesce(sum(amount), 0) INTO v_paid FROM public.vendor_bill_payments WHERE bill_id = v_bill.id AND voided IS NOT TRUE;
          IF v_paid > 0 THEN RAISE EXCEPTION 'HUB_GUARD: KTC bill % made from this line already has money recorded on it — undo that payment first, then change the category.', v_bill.bill_number; END IF;
          IF to_regclass('public.wire_package_lines') IS NOT NULL AND EXISTS (SELECT 1 FROM public.wire_package_lines WHERE bill_id = v_bill.id AND is_open IS TRUE) THEN
            RAISE EXCEPTION 'HUB_GUARD: KTC bill % made from this line is on a wire — take it off the wire first, then change the category.', v_bill.bill_number;
          END IF;
          UPDATE public.vendor_bills SET record_status = 'void', updated_at = now() WHERE id = v_bill.id;
          v_action := 'voided';
        ELSIF v_link.mode = 'attached' THEN
          IF v_link.set_paid_via AND lower(coalesce(v_bill.paid_via, '')) = lower(v_party) THEN UPDATE public.vendor_bills SET paid_via = NULL, updated_at = now() WHERE id = v_bill.id; END IF;
          v_action := 'detached';
        END IF;
        UPDATE public.company_bill_links SET status = 'void', category_key = v_key, updated_by = v_actor, updated_at = now() WHERE id = v_link.id;
        v_bill_id := v_link.bill_id;
      END IF;
    ELSE
      IF v_link.id IS NOT NULL AND v_link.bill_id IS NOT NULL AND v_bill.id IS NOT NULL AND v_bill.record_status <> 'deleted'
         AND NOT (v_link.mode = 'attached' AND v_bill.record_status <> 'active') THEN
        -- the SAME bill, never a second one
        IF v_link.mode = 'created' THEN
          UPDATE public.vendor_bills SET record_status = 'active', category = coalesce(v_ktc, category), updated_at = now() WHERE id = v_bill.id;
        END IF;
        UPDATE public.company_bill_links SET status = 'active', category_key = v_key, updated_by = v_actor, updated_at = now() WHERE id = v_link.id;
        v_action := CASE WHEN v_link.status = 'void' THEN 'restored' ELSE 'updated' END; v_bill_id := v_bill.id;
      ELSE
        -- attach the open KTC bill the server proposed — re-checked here under its lock
        IF v_attach IS NOT NULL THEN
          SELECT id, record_status, paid_via, bill_number, total_amount, wave_business_id INTO v_bill FROM public.vendor_bills WHERE id = v_attach FOR UPDATE;
          SELECT coalesce(sum(amount), 0) INTO v_paid FROM public.vendor_bill_payments WHERE bill_id = v_attach AND voided IS NOT TRUE;
          IF v_bill.id IS NULL OR v_bill.record_status <> 'active' OR abs(v_bill.total_amount - v_line.amount_abs) > 0.01 OR v_paid + 0.005 >= v_bill.total_amount
             OR EXISTS (SELECT 1 FROM public.company_bill_links WHERE bill_id = v_attach AND status = 'active' AND source_bank_transaction_id <> v_line.id) THEN
            v_attach := NULL; -- no longer attachable: make a new bill instead
          END IF;
        END IF;
        IF v_attach IS NOT NULL THEN
          v_set_via := v_bill.paid_via IS NULL AND v_paid = 0;
          IF v_set_via THEN UPDATE public.vendor_bills SET paid_via = v_party, updated_at = now() WHERE id = v_attach; END IF;
          v_bill_id := v_attach; v_action := 'attached';
        ELSE
          IF p->'bill' IS NULL OR jsonb_typeof(p->'bill') <> 'object' THEN RAISE EXCEPTION 'HUB_GUARD: the KTC bill details are missing.'; END IF;
          INSERT INTO public.vendor_bills (wave_business_id, vendor_name, bill_number, bill_date, due_date, total_amount, category, paid_via, currency, record_status, notes, created_by)
          VALUES (p->'bill'->>'wave_business_id', p->'bill'->>'vendor_name', p->'bill'->>'bill_number', (p->'bill'->>'bill_date')::date, (p->'bill'->>'due_date')::date,
                  v_line.amount_abs, v_ktc, v_party, 'USD', 'active', p->'bill'->>'notes', v_actor)
          RETURNING id INTO v_bill_id;
          v_action := 'created';
        END IF;
        IF v_link.id IS NULL THEN
          INSERT INTO public.company_bill_links (source_bank_transaction_id, company_id, bill_id, mode, status, set_paid_via, category_key, created_by, updated_by)
          VALUES (v_line.id, v_company, v_bill_id, CASE WHEN v_action = 'attached' THEN 'attached' ELSE 'created' END, 'active', v_set_via, v_key, v_actor, v_actor);
        ELSE
          UPDATE public.company_bill_links SET bill_id = v_bill_id, mode = CASE WHEN v_action = 'attached' THEN 'attached' ELSE 'created' END, status = 'active',
            set_paid_via = v_set_via, category_key = v_key, message = NULL, updated_by = v_actor, updated_at = now() WHERE id = v_link.id;
        END IF;
      END IF;
    END IF;
  END IF;

  UPDATE public.bank_transactions SET company_category = v_key, company_category_source = CASE WHEN v_key IS NULL THEN NULL ELSE coalesce(p->>'source', 'manual') END,
    company_category_by = v_actor, company_category_at = now() WHERE id = v_line.id;
  INSERT INTO public.hub_audit_log (actor_id, action, entity, entity_id, details) VALUES (v_actor, 'company_line_categorized', 'bank_transaction', v_line.id::text,
    jsonb_build_object('company', v_company, 'from', v_line.company_category, 'to', v_key, 'source', coalesce(p->>'source', 'manual'), 'ktc_bill_action', v_action, 'ktc_bill_id', v_bill_id));
  IF v_action <> 'none' THEN
    INSERT INTO public.hub_audit_log (actor_id, action, entity, entity_id, details) VALUES (v_actor,
      CASE v_action WHEN 'created' THEN 'bill_created' WHEN 'voided' THEN 'nextrade_bill_voided' WHEN 'detached' THEN 'nextrade_bill_detached' WHEN 'attached' THEN 'nextrade_bill_attached' WHEN 'restored' THEN 'nextrade_bill_restored' ELSE 'nextrade_bill_updated' END,
      'vendor_bill', v_bill_id::text, jsonb_build_object('from_nextrade_line', v_line.id, 'category', v_key, 'ktc_category', v_ktc, 'paid_via_set', v_set_via));
  END IF;
  RETURN jsonb_build_object('ok', true, 'action', v_action, 'bill_id', v_bill_id, 'bill_number', (SELECT bill_number FROM public.vendor_bills WHERE id = v_bill_id));
END $$;
REVOKE ALL ON FUNCTION public.hub_company_categorize(jsonb) FROM PUBLIC, anon, authenticated;

-- PAIR two lines as one transfer. p: { a, b, company_id, actor }
CREATE OR REPLACE FUNCTION public.hub_company_pair_transfer(p jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_a record; v_b record; v_company text := p->>'company_id'; v_actor uuid := nullif(p->>'actor', '')::uuid; v_gid uuid := gen_random_uuid();
  v_key text; v_cat record; v_card boolean;
  v_hidden text[] := CASE WHEN p ? 'hidden_accounts' AND jsonb_typeof(p->'hidden_accounts') = 'array' THEN ARRAY(SELECT jsonb_array_elements_text(p->'hidden_accounts')) ELSE NULL END;
  v_restricted boolean := v_hidden IS NOT NULL OR coalesce((p->>'restricted')::boolean, false); v_own int; v_priv boolean; v_acc record;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: no signed-in person.'; END IF;
  IF v_company NOT IN ('NEXTRADE_BOOKS', 'RTM_BOOKS') THEN RAISE EXCEPTION 'HUB_GUARD: say which company (Nextrade or RTM).'; END IF;
  IF (p->>'a') IS NULL OR (p->>'b') IS NULL OR (p->>'a') = (p->>'b') THEN RAISE EXCEPTION 'HUB_GUARD: pick two different lines.'; END IF;
  -- lock both lines, always in the same order (no deadlock when two people pair the same two lines at once)
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-company-line:' || least(p->>'a', p->>'b'), 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-company-line:' || greatest(p->>'a', p->>'b'), 0));
  SELECT id, wave_business_id, direction, amount_abs, account_id, transfer_group_id, pending, review_status INTO v_a FROM public.bank_transactions WHERE id = (p->>'a')::uuid FOR UPDATE;
  SELECT id, wave_business_id, direction, amount_abs, account_id, transfer_group_id, pending, review_status INTO v_b FROM public.bank_transactions WHERE id = (p->>'b')::uuid FOR UPDATE;
  IF v_a.id IS NULL OR v_b.id IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: a line was not found.'; END IF;
  IF v_a.wave_business_id IS DISTINCT FROM v_company OR v_b.wave_business_id IS DISTINCT FROM v_company THEN
    RAISE EXCEPTION 'HUB_GUARD: both lines must belong to this company — money between two companies is not a transfer.';
  END IF;
  IF v_a.transfer_group_id IS NOT NULL OR v_b.transfer_group_id IS NOT NULL THEN RAISE EXCEPTION 'HUB_GUARD: one of them is already paired to another transfer.'; END IF;
  IF v_a.direction = v_b.direction THEN RAISE EXCEPTION 'HUB_GUARD: a transfer needs one money-out line and one money-in line.'; END IF;
  IF abs(v_a.amount_abs - v_b.amount_abs) > 0.005 THEN RAISE EXCEPTION 'HUB_GUARD: the amounts differ (% vs %).', round(v_a.amount_abs, 2), round(v_b.amount_abs, 2); END IF;
  -- (Codex 22:50) BOTH lines need a real account of THIS company; a missing or unknown account is never an own-account transfer
  IF v_a.account_id IS NULL OR v_b.account_id IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: a line has no bank account — it cannot be paired as a transfer.'; END IF;
  IF v_a.account_id = v_b.account_id THEN RAISE EXCEPTION 'HUB_GUARD: both lines are in the same account — that is not a transfer.'; END IF;
  -- (Codex 23:00) read both ACCOUNT rows now, under a share lock (nobody can flip them private or move them while we work)
  SELECT count(*) FILTER (WHERE wave_business_id = v_company), bool_or(coalesce(is_private, false)) INTO v_own, v_priv
    FROM (SELECT wave_business_id, is_private FROM public.plaid_accounts WHERE plaid_account_id IN (v_a.account_id, v_b.account_id) FOR SHARE) acc;
  IF coalesce(v_own, 0) <> 2 THEN
    RAISE EXCEPTION 'HUB_GUARD: both accounts must be this company''s own accounts.';
  END IF;
  -- (Codex 22:50) a person not allowed to see a private account can neither pair nor see its line (checked inside the locked step)
  -- (Codex 23:00) a restricted caller: privacy is what the account says RIGHT NOW (plus the hidden list the Hub sent)
  IF v_restricted AND (coalesce(v_priv, false) OR v_a.account_id = ANY (coalesce(v_hidden, ARRAY[]::text[])) OR v_b.account_id = ANY (coalesce(v_hidden, ARRAY[]::text[]))) THEN RAISE EXCEPTION 'HUB_GUARD: one of the lines is in a private account.'; END IF;
  IF v_a.pending IS TRUE OR v_b.pending IS TRUE THEN RAISE EXCEPTION 'HUB_GUARD: a line is still pending — pair it once it settles.'; END IF;
  IF v_a.review_status = 'duplicate' OR v_b.review_status = 'duplicate' THEN RAISE EXCEPTION 'HUB_GUARD: one of them is a marked duplicate copy — pair the original.'; END IF;
  -- paying the company's own credit card = 'Credit card payment'; any other own-account move = 'Transfer between own accounts'
  v_card := EXISTS (SELECT 1 FROM public.plaid_accounts WHERE plaid_account_id IN (v_a.account_id, v_b.account_id) AND type = 'credit');
  v_key := CASE WHEN v_card THEN 'card_payment' ELSE 'own_transfer' END;
  SELECT key, kind, active INTO v_cat FROM public.company_categories WHERE company_id = v_company AND key = v_key;
  IF v_cat.key IS NULL OR v_cat.active IS NOT TRUE OR v_cat.kind <> 'transfer' THEN
    RAISE EXCEPTION 'HUB_GUARD: the % category is missing or switched off — switch it on in Categories first.', CASE WHEN v_card THEN 'Credit card payment' ELSE 'Transfer between own accounts' END;
  END IF;
  -- both lines get the transfer category through the categorize function (it voids a Nextrade KTC bill one of them had,
  -- with the same money / wire refusals), then they are linked — all in this one transaction
  PERFORM public.hub_company_categorize(jsonb_build_object('line_id', v_a.id, 'company_id', v_company, 'category_key', v_key, 'actor', v_actor, 'source', 'transfer', 'pairing', 'true'));
  PERFORM public.hub_company_categorize(jsonb_build_object('line_id', v_b.id, 'company_id', v_company, 'category_key', v_key, 'actor', v_actor, 'source', 'transfer', 'pairing', 'true'));
  UPDATE public.bank_transactions SET transfer_group_id = v_gid WHERE id IN (v_a.id, v_b.id);
  INSERT INTO public.hub_audit_log (actor_id, action, entity, entity_id, details) VALUES (v_actor, 'company_transfer_paired', 'transfer_group', v_gid::text,
    jsonb_build_object('company', v_company, 'lines', jsonb_build_array(v_a.id, v_b.id), 'amount', v_a.amount_abs, 'category', v_key));
  RETURN jsonb_build_object('ok', true, 'transfer_group_id', v_gid, 'category', v_key);
END $$;

-- UNPAIR: both lines go back to 'not categorized' and are no longer linked. p: { transfer_group_id, company_id, actor }
CREATE OR REPLACE FUNCTION public.hub_company_unpair_transfer(p jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE v_company text := p->>'company_id'; v_actor uuid := nullif(p->>'actor', '')::uuid; v_gid uuid := nullif(p->>'transfer_group_id', '')::uuid;
  v_ids uuid[]; v_id uuid; v_line record; v_n int := 0;
  v_hidden text[] := CASE WHEN p ? 'hidden_accounts' AND jsonb_typeof(p->'hidden_accounts') = 'array' THEN ARRAY(SELECT jsonb_array_elements_text(p->'hidden_accounts')) ELSE NULL END;
  v_restricted boolean := v_hidden IS NOT NULL OR coalesce((p->>'restricted')::boolean, false); v_own int; v_priv boolean; v_acc record;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: no signed-in person.'; END IF;
  IF v_gid IS NULL THEN RAISE EXCEPTION 'HUB_GUARD: which transfer?'; END IF;
  -- (Codex 22:50) ONE lock order everywhere: the per-line advisory locks first (ids in text order, like pair), then the rows
  v_ids := ARRAY(SELECT id FROM public.bank_transactions WHERE transfer_group_id = v_gid ORDER BY id::text);
  IF coalesce(array_length(v_ids, 1), 0) = 0 THEN RAISE EXCEPTION 'HUB_GUARD: that transfer was not found (maybe already unpaired) — refresh.'; END IF;
  FOREACH v_id IN ARRAY v_ids LOOP PERFORM pg_advisory_xact_lock(hashtextextended('hub-company-line:' || v_id::text, 0)); END LOOP;
  -- re-read under the locks: only the lines STILL in this transfer, each checked for company and privacy before anything changes
  FOR v_line IN SELECT id, wave_business_id, account_id FROM public.bank_transactions WHERE id = ANY (v_ids) AND transfer_group_id = v_gid ORDER BY id::text FOR UPDATE LOOP
    IF v_line.wave_business_id IS DISTINCT FROM v_company THEN RAISE EXCEPTION 'HUB_GUARD: that transfer is not this company''s.'; END IF;
    SELECT wave_business_id, coalesce(is_private, false) AS is_private INTO v_acc FROM public.plaid_accounts WHERE plaid_account_id = v_line.account_id FOR SHARE;
    IF v_line.account_id IS NULL OR v_acc.wave_business_id IS NULL OR v_acc.wave_business_id <> v_company THEN RAISE EXCEPTION 'HUB_GUARD: one side of this transfer is not in one of this company''s own accounts — it cannot be unpaired here; ask the super admin.'; END IF;
    IF v_restricted AND (v_acc.is_private OR v_line.account_id = ANY (coalesce(v_hidden, ARRAY[]::text[]))) THEN RAISE EXCEPTION 'HUB_GUARD: one side of this transfer is in a private account — only someone allowed to see private accounts can unpair it.'; END IF;
    v_n := v_n + 1;
  END LOOP;
  IF v_n = 0 THEN RAISE EXCEPTION 'HUB_GUARD: that transfer was just changed by someone else — refresh.'; END IF;
  FOR v_line IN SELECT id FROM public.bank_transactions WHERE id = ANY (v_ids) AND transfer_group_id = v_gid ORDER BY id::text LOOP
    PERFORM public.hub_company_categorize(jsonb_build_object('line_id', v_line.id, 'company_id', v_company, 'category_key', NULL, 'actor', v_actor, 'source', 'transfer', 'pairing', 'true'));
    UPDATE public.bank_transactions SET transfer_group_id = NULL WHERE id = v_line.id;
  END LOOP;
  INSERT INTO public.hub_audit_log (actor_id, action, entity, entity_id, details) VALUES (v_actor, 'company_transfer_unpaired', 'transfer_group', v_gid::text, jsonb_build_object('company', v_company, 'lines', v_n));
  RETURN jsonb_build_object('ok', true, 'unpaired', v_n);
END $$;

REVOKE ALL ON FUNCTION public.hub_company_pair_transfer(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hub_company_unpair_transfer(jsonb) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.hub_company_transfers_installed() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'hub_company_pair_transfer')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'company_categories' AND column_name = 'direction');
$$;

-- (Codex 23:00, same rule for the NextTrade / RTM advances) a pool is restricted for a restricted caller when any source line's
-- line is missing, has no account, its account row is missing (Codex 23:10), is in the caller's hidden list, OR is private right now (read live, not from the Hub's list)
CREATE OR REPLACE FUNCTION public.hub_party_pool_restricted(p_party text, p_hidden_accounts text[]) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.party_money_entries e LEFT JOIN public.bank_transactions b ON b.id = e.bank_transaction_id
      LEFT JOIN public.plaid_accounts a ON a.plaid_account_id = b.account_id
    WHERE e.party = p_party AND e.bank_transaction_id IS NOT NULL
      AND (b.id IS NULL OR b.account_id IS NULL OR a.plaid_account_id IS NULL OR b.account_id = ANY (coalesce(p_hidden_accounts, ARRAY[]::text[])) OR coalesce(a.is_private, false)));
$$;
REVOKE ALL ON FUNCTION public.hub_party_pool_restricted(text, text[]) FROM PUBLIC, anon, authenticated;

-- check: select key, label, kind, direction from company_categories order by company_id, sort;
