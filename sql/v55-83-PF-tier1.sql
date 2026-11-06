-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-PF — TIER 1: reminders log · warehouse-link hook · drift detector
-- SAFE TO RE-RUN.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Reminder log: every dunning message (email sent / WhatsApp handed off)
--    recorded against the invoice — who, when, channel, tone, exact text.
CREATE TABLE IF NOT EXISTS public.invoice_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email','whatsapp')),
  sent_to text,
  tone text,
  body text,
  status text NOT NULL DEFAULT 'sent',
  sent_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inv_reminders_inv ON public.invoice_reminders (invoice_id, created_at);
ALTER TABLE public.invoice_reminders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inv_reminders_read ON public.invoice_reminders;
CREATE POLICY inv_reminders_read ON public.invoice_reminders FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.invoice_reminders TO authenticated;
GRANT SELECT, INSERT ON public.invoice_reminders TO service_role;

-- 2. Warehouse-link hook (future NextTrade-system integration lands here)
ALTER TABLE public.vendor_bills ADD COLUMN IF NOT EXISTS warehouse_reference text;

-- 3. Classification drift detector (QA critical #1): bank transactions the
--    bridge posted whose hub classification has CHANGED since — hub vs ledger
--    divergence, surfaced instead of silent. Read-only; fixing stays a
--    deliberate operator reversal.
create or replace function clickbooks_us.classification_drift() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare b clickbooks_us.books%rowtype; rows jsonb;
begin
  select * into strict b from clickbooks_us.books where code='KTC_US';
  select coalesce(jsonb_agg(jsonb_build_object(
           'bank_transaction_id', t.id,
           'date', coalesce(t.posted_date, t.date),
           'amount', t.amount_abs,
           'description', coalesce(t.merchant_name, t.name),
           'posted_to_account', a.name,
           'current_classification', t.classification,
           'expected_account', a2.name,
           'journal_id', j.id)), '[]'::jsonb)
    into rows
    from clickbooks_us.journals j
    join clickbooks_us.journal_lines l on l.journal_id = j.id
    join clickbooks_us.accounts a on a.id = l.account_id and not a.is_bank_sensitive
    join public.bank_transactions t on t.id::text = j.source_id
    left join clickbooks_us.classification_account_map m on m.classification = trim(coalesce(t.classification, '')) and m.reviewed
    left join clickbooks_us.accounts a2 on a2.id = m.account_id
   where j.book_id = b.id and j.source_kind = 'bank_transaction' and j.status = 'posted'
     and j.description like 'Classified bank transaction %'
     and (t.classification is null or t.review_status <> 'reviewed' or m.account_id is null or m.account_id <> l.account_id);
  return jsonb_build_object('count', jsonb_array_length(rows), 'items', rows);
end $$;

create or replace function public.clickbooks_us_classification_drift_job() returns jsonb
language sql security definer set search_path='' as $$ select clickbooks_us.classification_drift() $$;
revoke all on function public.clickbooks_us_classification_drift_job() from public, anon, authenticated;
grant execute on function public.clickbooks_us_classification_drift_job() to service_role;

-- VERIFICATION
SELECT '1. invoice_reminders' AS check_name,
       CASE WHEN to_regclass('public.invoice_reminders') IS NOT NULL THEN '✅' ELSE '❌' END AS result
UNION ALL
SELECT '2. warehouse_reference',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vendor_bills' AND column_name='warehouse_reference') THEN '✅' ELSE '❌' END
UNION ALL
SELECT '3. drift detector',
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='clickbooks_us' AND p.proname='classification_drift') THEN '✅' ELSE '❌' END;
