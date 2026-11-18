-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-UJ — plaid_accounts: back to "metadata only" for signed-in users (Codex 17:25 UTC, 18 Nov 2026)
--
-- WHY: on 18 Nov every bank screen showed 0 lines. The v55.83-TP private-accounts rule on bank_transactions reads
-- plaid_accounts.is_private as the signed-in person, but bank-balance-visibility.sql grants signed-in users only a
-- LIST of plaid_accounts columns and is_private is not in it → "permission denied", every bank read failed.
-- The emergency fix (GRANT SELECT ON public.plaid_accounts TO authenticated) made the screens work again but ALSO
-- reopened current_balance / available_balance to every signed-in user. This puts it right:
--   1. takes away the whole-table read again (balances hidden again);
--   2. gives back exactly the metadata columns of bank-balance-visibility.sql PLUS is_private (the only extra column
--      the bank rules read; plaid_account_id is already in the list).
-- Balances stay readable only by the Hub server (service role). Changes no data. Safe to run more than once.
-- Run in: Supabase → your project → SQL Editor → New query → paste all of this → Run
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE v_cols text;
BEGIN
  IF to_regclass('public.plaid_accounts') IS NULL THEN RAISE NOTICE 'plaid_accounts not found — nothing to do'; RETURN; END IF;
  -- 1. no whole-table read for signed-in or anonymous users (column grants are separate and handled below)
  EXECUTE 'REVOKE SELECT ON TABLE public.plaid_accounts FROM public, anon, authenticated';
  -- 2. the metadata columns that exist in this database, plus is_private
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO v_cols
  FROM pg_attribute a
  WHERE a.attrelid = 'public.plaid_accounts'::regclass AND a.attnum > 0 AND NOT a.attisdropped
    AND a.attname IN ('id', 'connection_id', 'business_id', 'plaid_account_id', 'name', 'official_name', 'mask', 'type', 'subtype',
                      'iso_currency', 'is_read_only', 'updated_at', 'wave_business_id', 'assigned_by', 'assigned_at',
                      'assignment_source', 'is_private');
  EXECUTE format('GRANT SELECT (%s) ON public.plaid_accounts TO authenticated', v_cols);
  -- 3. balances explicitly NOT readable by signed-in users (removes any column grant that may exist on them)
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.plaid_accounts'::regclass AND attname = 'current_balance' AND NOT attisdropped) THEN
    EXECUTE 'REVOKE SELECT (current_balance) ON public.plaid_accounts FROM public, anon, authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.plaid_accounts'::regclass AND attname = 'available_balance' AND NOT attisdropped) THEN
    EXECUTE 'REVOKE SELECT (available_balance) ON public.plaid_accounts FROM public, anon, authenticated';
  END IF;
END $$;

-- CHECK (read-only): every line must say OK
SELECT 'whole-table read for signed-in users is OFF' AS check_item,
       CASE WHEN NOT has_table_privilege('authenticated', 'public.plaid_accounts', 'SELECT') THEN 'OK' ELSE 'PROBLEM' END AS result
UNION ALL SELECT 'current_balance hidden from signed-in users',
       CASE WHEN NOT has_column_privilege('authenticated', 'public.plaid_accounts', 'current_balance', 'SELECT') THEN 'OK' ELSE 'PROBLEM' END
UNION ALL SELECT 'available_balance hidden from signed-in users',
       CASE WHEN NOT has_column_privilege('authenticated', 'public.plaid_accounts', 'available_balance', 'SELECT') THEN 'OK' ELSE 'PROBLEM' END
UNION ALL SELECT 'is_private readable (bank screens work)',
       CASE WHEN has_column_privilege('authenticated', 'public.plaid_accounts', 'is_private', 'SELECT') THEN 'OK' ELSE 'PROBLEM' END
UNION ALL SELECT 'plaid_account_id readable (bank screens work)',
       CASE WHEN has_column_privilege('authenticated', 'public.plaid_accounts', 'plaid_account_id', 'SELECT') THEN 'OK' ELSE 'PROBLEM' END
UNION ALL SELECT 'anonymous visitors cannot read it',
       CASE WHEN NOT has_table_privilege('anon', 'public.plaid_accounts', 'SELECT') AND NOT has_column_privilege('anon', 'public.plaid_accounts', 'name', 'SELECT') THEN 'OK' ELSE 'PROBLEM' END;
