-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-UM — "Delete / void invoices 🔒" (Max, 18 Nov 2026: a switch of its own; "switch it on" — no role has it by itself)
--   1. The switch invoice.delete is SENSITIVE: only the super admin can switch it ON (same guard as the other 🔒 switches;
--      advances.manage is added too — the Hub server already treated it as sensitive, the database guard did not).
--   2. Delete / void / cancel / archive / restore of invoices and proformas happen in ONE locked database step
--      (hub_invoice_lifecycle) that only the Hub server may call: all of it or none of it.
--      An invoice with ANY payment record is never deleted (its payment records would be deleted with it) — void or archive it.
--   3. The browser can no longer delete invoices / proformas, nor change their status (void / cancelled / archived / restored):
--      editing an invoice is not affected.
--   4. A person can only delete / void records of a business they belong to (the super admin: every business).
-- Run AFTER sql/v55-83-TQ-add-transactions-permission.sql. Changes no invoice or payment. It may ADD business-membership rows for
-- users who have none (single-business case only — see the end). Safe to run more than once.
-- Run in: Supabase → your project → SQL Editor → New query → paste all of this → Run
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.hub_guard_sensitive_grant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.has_access IS TRUE AND NEW.module_name IN ('pnl.view_margin', 'accounting.view_totals', 'bank.view_private', 'permissions.grant_sensitive', 'bank.add_transactions', 'invoice.delete', 'advances.manage') THEN
    IF auth.uid() IS NULL OR coalesce(auth.jwt() ->> 'role', '') = 'service_role' THEN RETURN NEW; END IF;
    IF NOT public.hub_caller_is_super_admin() THEN
      RAISE EXCEPTION 'HUB_GUARD: only the super admin can switch on "%".', NEW.module_name;
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- ── one locked step for every lifecycle change (the Hub server checks the person and the switch before calling it)
CREATE OR REPLACE FUNCTION public.hub_invoice_lifecycle(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_kind text := coalesce(p->>'kind', 'invoice');
  v_action text := coalesce(p->>'action', '');
  v_id uuid := (p->>'id')::uuid;
  v_actor text := nullif(p->>'actor', '');
  v_after_wave boolean := coalesce((p->>'after_wave_delete')::boolean, false);
  v_reason text := nullif(left(coalesce(p->>'reason', ''), 300), '');
  v_row jsonb; v_status text; v_n int := 0; v_rel int := 0; v_new text;
  v_check boolean := coalesce((p->>'check_only')::boolean, false); -- true = run every check, change NOTHING (used before a Wave delete)
  v_super boolean := coalesce((p->>'is_super')::boolean, false);   -- set by the Hub server from the verified person's role
  v_biz text; v_member boolean;
BEGIN
  IF v_kind NOT IN ('invoice', 'proforma') OR v_action NOT IN ('delete', 'void', 'cancel', 'archive', 'restore') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'bad_request');
  END IF;
  IF v_kind = 'invoice' THEN SELECT to_jsonb(i) INTO v_row FROM public.accounting_invoices i WHERE i.id = v_id FOR UPDATE;
  ELSE SELECT to_jsonb(x) INTO v_row FROM public.accounting_proformas x WHERE x.id = v_id FOR UPDATE; END IF;
  IF v_row IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'not_found'); END IF;
  v_status := coalesce(nullif(v_row->>'record_status', ''), 'active');
  -- business scope (Codex 21:35 / 21:50): the person must be a member of the invoice's business (user_business_memberships, keyed by the
  -- Hub user id — the same id the Hub server verified). The super admin may act on every business. A record with no business is not limited.
  v_biz := nullif(v_row->>'business_id', '');
  IF NOT v_super AND v_biz IS NOT NULL AND to_regclass('public.user_business_memberships') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.user_business_memberships WHERE user_id::text = $1 AND business_id::text = $2)' INTO v_member USING coalesce(v_actor, ''), v_biz;
    IF NOT v_member THEN RETURN jsonb_build_object('ok', false, 'code', 'scope'); END IF;
  END IF;

  IF v_action = 'delete' THEN
    IF v_status IN ('archived', 'void', 'cancelled', 'deleted') THEN RETURN jsonb_build_object('ok', false, 'code', 'state', 'status', v_status); END IF;
    IF v_kind = 'invoice' THEN
      IF v_row->>'source' = 'wave_import' OR (v_row->>'is_historical') = 'true' THEN RETURN jsonb_build_object('ok', false, 'code', 'historical'); END IF;
      IF NOT v_after_wave AND (coalesce(v_row->>'wave_invoice_id', '') <> '' OR v_row->>'wave_sync_status' = 'synced') THEN RETURN jsonb_build_object('ok', false, 'code', 'wave'); END IF;
      -- ANY payment record (even voided) blocks: payments are never deleted, and they would go with the invoice
      PERFORM 1 FROM public.accounting_invoice_payments ap WHERE ap.accounting_invoice_id = v_id FOR UPDATE;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n > 0 THEN RETURN jsonb_build_object('ok', false, 'code', 'payments', 'count', v_n); END IF;
      IF to_regclass('public.payment_matches') IS NOT NULL THEN
        EXECUTE 'SELECT count(*) FROM public.payment_matches WHERE invoice_id::text = $1 AND voided IS NOT TRUE' INTO v_n USING v_id::text;
        IF v_n > 0 THEN RETURN jsonb_build_object('ok', false, 'code', 'payments', 'count', v_n); END IF;
      END IF;
      IF v_check THEN RETURN jsonb_build_object('ok', true, 'check_only', true, 'action', 'delete'); END IF;
      -- a bank line still pointing at it goes back to the review list (nothing else on it changes)
      UPDATE public.bank_transactions SET matched_invoice_id = NULL, review_status = 'unreviewed' WHERE matched_invoice_id::text = v_id::text;
      GET DIAGNOSTICS v_rel = ROW_COUNT;
      IF to_regclass('public.accounting_invoice_items') IS NOT NULL THEN DELETE FROM public.accounting_invoice_items WHERE invoice_id = v_id; END IF;
      DELETE FROM public.accounting_invoices WHERE id = v_id;
    ELSE
      IF v_row->>'status' = 'converted' OR coalesce(v_row->>'converted_invoice_id', '') <> '' THEN RETURN jsonb_build_object('ok', false, 'code', 'converted'); END IF;
      IF v_check THEN RETURN jsonb_build_object('ok', true, 'check_only', true, 'action', 'delete'); END IF;
      DELETE FROM public.accounting_proformas WHERE id = v_id;
    END IF;
    BEGIN
      INSERT INTO public.audit_log (table_name, record_id, action, changed_by, old_values)
      VALUES (CASE WHEN v_kind = 'invoice' THEN 'accounting_invoices' ELSE 'accounting_proformas' END, v_id, 'delete', v_actor::uuid, v_row);
    EXCEPTION WHEN others THEN NULL; -- the record of who deleted it is best-effort; the hub audit below is written by the server
    END;
    RETURN jsonb_build_object('ok', true, 'action', 'delete', 'released', v_rel, 'name', coalesce(v_row->>'invoice_number', v_row->>'proforma_number', v_id::text));
  END IF;

  IF v_action IN ('void', 'cancel') AND v_status IN ('archived', 'void', 'cancelled') THEN RETURN jsonb_build_object('ok', false, 'code', 'state', 'status', v_status); END IF;
  IF v_action = 'archive' AND v_status = 'archived' THEN RETURN jsonb_build_object('ok', false, 'code', 'state', 'status', v_status); END IF;
  IF v_action = 'restore' AND v_status NOT IN ('archived', 'void', 'cancelled') THEN RETURN jsonb_build_object('ok', false, 'code', 'state', 'status', v_status); END IF;
  IF v_check THEN RETURN jsonb_build_object('ok', true, 'check_only', true, 'action', v_action); END IF;
  v_new := CASE v_action WHEN 'void' THEN 'void' WHEN 'cancel' THEN 'cancelled' WHEN 'archive' THEN 'archived' ELSE 'active' END;
  IF v_kind = 'invoice' THEN
    UPDATE public.accounting_invoices SET record_status = v_new,
      archived_at = CASE WHEN v_action = 'archive' THEN now() WHEN v_action = 'restore' THEN NULL ELSE archived_at END,
      archived_by = CASE WHEN v_action IN ('archive', 'void', 'cancel') THEN v_actor::uuid ELSE archived_by END,
      void_reason = CASE WHEN v_action IN ('void', 'cancel') THEN v_reason ELSE void_reason END
    WHERE id = v_id;
  ELSE
    UPDATE public.accounting_proformas SET record_status = v_new,
      archived_at = CASE WHEN v_action = 'archive' THEN now() WHEN v_action = 'restore' THEN NULL ELSE archived_at END,
      archived_by = CASE WHEN v_action IN ('archive', 'void', 'cancel') THEN v_actor::uuid ELSE archived_by END,
      void_reason = CASE WHEN v_action IN ('void', 'cancel') THEN v_reason ELSE void_reason END
    WHERE id = v_id;
  END IF;
  BEGIN
    INSERT INTO public.audit_log (table_name, record_id, action, changed_by, old_values, new_values)
    VALUES (CASE WHEN v_kind = 'invoice' THEN 'accounting_invoices' ELSE 'accounting_proformas' END, v_id, 'update', v_actor::uuid,
            jsonb_build_object('record_status', v_status), jsonb_build_object('record_status', v_new, 'void_reason', v_reason));
  EXCEPTION WHEN others THEN NULL;
  END;
  RETURN jsonb_build_object('ok', true, 'action', v_action, 'from', v_status, 'to', v_new, 'name', coalesce(v_row->>'invoice_number', v_row->>'proforma_number', v_id::text));
END $$;
REVOKE ALL ON FUNCTION public.hub_invoice_lifecycle(jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hub_invoice_lifecycle(jsonb) TO service_role;

-- ── the browser may edit an invoice, but not change its status (void / cancelled / archived / restored) or delete it
CREATE OR REPLACE FUNCTION public.hub_guard_invoice_status() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') AND (
       to_jsonb(NEW)->'record_status' IS DISTINCT FROM to_jsonb(OLD)->'record_status'
    OR to_jsonb(NEW)->'archived_at' IS DISTINCT FROM to_jsonb(OLD)->'archived_at'
    OR to_jsonb(NEW)->'archived_by' IS DISTINCT FROM to_jsonb(OLD)->'archived_by'
    OR to_jsonb(NEW)->'void_reason' IS DISTINCT FROM to_jsonb(OLD)->'void_reason') THEN
    RAISE EXCEPTION 'HUB_GUARD: void, cancel, archive and restore go through the Hub (the “Delete / void invoices” switch).';
  END IF;
  RETURN NEW;
END $$;
DO $$
BEGIN
  IF to_regclass('public.accounting_invoices') IS NOT NULL THEN
    EXECUTE 'REVOKE DELETE ON TABLE public.accounting_invoices FROM public, anon, authenticated';
    EXECUTE 'DROP TRIGGER IF EXISTS hub_guard_invoice_status ON public.accounting_invoices';
    EXECUTE 'CREATE TRIGGER hub_guard_invoice_status BEFORE UPDATE ON public.accounting_invoices FOR EACH ROW EXECUTE FUNCTION public.hub_guard_invoice_status()';
  END IF;
  IF to_regclass('public.accounting_proformas') IS NOT NULL THEN
    EXECUTE 'REVOKE DELETE ON TABLE public.accounting_proformas FROM public, anon, authenticated';
    EXECUTE 'DROP TRIGGER IF EXISTS hub_guard_invoice_status ON public.accounting_proformas';
    EXECUTE 'CREATE TRIGGER hub_guard_invoice_status BEFORE UPDATE ON public.accounting_proformas FOR EACH ROW EXECUTE FUNCTION public.hub_guard_invoice_status()';
  END IF;
END $$;

-- ── business membership top-up. The Hub's own rule (sql/v55-83-y-phase1-hardening.sql): "every current user belongs to the single
--    business". Users added since then have no membership row and would be refused by the business check above. While the Hub has
--    exactly ONE business, each user without any membership is added to it (as 'member'). With two or more businesses nothing is
--    added here: the super admin decides who belongs where. Nobody is removed or changed.
DO $$
DECLARE v_n int;
BEGIN
  -- dynamic SQL: these tables may not exist in every database
  IF to_regclass('public.user_business_memberships') IS NOT NULL AND to_regclass('public.businesses') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.businesses' INTO v_n;
    IF v_n = 1 THEN
      EXECUTE 'INSERT INTO public.user_business_memberships (user_id, business_id, role) SELECT u.id, (SELECT id FROM public.businesses LIMIT 1), ''member'' FROM public.users u WHERE NOT EXISTS (SELECT 1 FROM public.user_business_memberships m WHERE m.user_id = u.id) ON CONFLICT DO NOTHING';
    END IF;
  END IF;
END $$;

-- CHECK (read-only): every line must say OK
SELECT 'only the super admin can switch on "Delete / void invoices"' AS check_item,
       CASE WHEN position('invoice.delete' in pg_get_functiondef('public.hub_guard_sensitive_grant()'::regprocedure)) > 0 THEN 'OK' ELSE 'PROBLEM' END AS result
UNION ALL SELECT 'browser cannot delete invoices',
       CASE WHEN NOT has_table_privilege('authenticated', 'public.accounting_invoices', 'DELETE') THEN 'OK' ELSE 'PROBLEM' END
UNION ALL SELECT 'browser cannot delete proformas',
       CASE WHEN to_regclass('public.accounting_proformas') IS NULL OR NOT has_table_privilege('authenticated', 'public.accounting_proformas', 'DELETE') THEN 'OK' ELSE 'PROBLEM' END
UNION ALL SELECT 'browser cannot change an invoice status (guard on)',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'hub_guard_invoice_status' AND tgrelid = 'public.accounting_invoices'::regclass) THEN 'OK' ELSE 'PROBLEM' END
UNION ALL SELECT 'only the Hub server can run the delete / void step',
       CASE WHEN NOT has_function_privilege('authenticated', 'public.hub_invoice_lifecycle(jsonb)', 'EXECUTE') AND has_function_privilege('service_role', 'public.hub_invoice_lifecycle(jsonb)', 'EXECUTE') THEN 'OK' ELSE 'PROBLEM' END
UNION ALL SELECT 'browser can still read and edit invoices',
       CASE WHEN has_table_privilege('authenticated', 'public.accounting_invoices', 'SELECT') AND has_table_privilege('authenticated', 'public.accounting_invoices', 'UPDATE') THEN 'OK' ELSE 'PROBLEM' END;

-- who is NOT a member of any business (they cannot delete / void invoices that carry a business until the super admin adds them)
-- SELECT u.name, u.email FROM public.users u WHERE NOT EXISTS (SELECT 1 FROM public.user_business_memberships m WHERE m.user_id = u.id);
