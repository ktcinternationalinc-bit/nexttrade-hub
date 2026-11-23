-- ════════════════════════════════════════════════════════════════════════
-- v55.83-XY — REMINDERS: the customer's correspondence language, and three
-- facts on the reminder log (Max, 23 Nov 2026)
--   1. accounting_customers.correspondence_language — "need in customer list
--      in hub radio box to indicate the language to use with correspondce":
--      en / es / fr / ar. Empty = not chosen yet = English.
--   2. arrival_reminders.cc                — who was copied on that reminder
--      arrival_reminders.invoices_attached — how many invoice PDFs went with it
--      arrival_reminders.attachment_note   — why an invoice was NOT attached
--   3. The server role loses the delete / truncate rights Supabase gives every
--      new table by default (the reminder log is never deleted from).
-- ADDS columns only. Changes no existing value, deletes nothing.
-- SAFE TO RE-RUN.
-- ════════════════════════════════════════════════════════════════════════

-- 1. the language to write to this customer in
ALTER TABLE public.accounting_customers ADD COLUMN IF NOT EXISTS correspondence_language text;

DO $xy$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounting_customers_correspondence_language_chk'
                 AND conrelid = 'public.accounting_customers'::regclass) THEN
    ALTER TABLE public.accounting_customers
      ADD CONSTRAINT accounting_customers_correspondence_language_chk
      CHECK (correspondence_language IS NULL OR correspondence_language IN ('en','es','fr','ar'));
  END IF;
END
$xy$;

-- 2. the reminder log: who was copied, and whether the invoice went with it
ALTER TABLE public.arrival_reminders ADD COLUMN IF NOT EXISTS cc text;
ALTER TABLE public.arrival_reminders ADD COLUMN IF NOT EXISTS invoices_attached integer;
ALTER TABLE public.arrival_reminders ADD COLUMN IF NOT EXISTS attachment_note text;

-- 3. the reminder log is read, added to and updated by the Hub server — never deleted from
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.arrival_reminders FROM service_role;
GRANT SELECT, INSERT, UPDATE ON public.arrival_reminders TO service_role;

-- VERIFICATION (every line should say OK)
SELECT 'customer language column' AS check_item,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'accounting_customers' AND column_name = 'correspondence_language') THEN 'OK' ELSE 'MISSING' END AS result
UNION ALL
SELECT 'customer language allows only en / es / fr / ar',
       CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounting_customers_correspondence_language_chk' AND conrelid = 'public.accounting_customers'::regclass) THEN 'OK' ELSE 'MISSING' END
UNION ALL
SELECT 'reminder log: cc / invoices_attached / attachment_note',
       CASE WHEN (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'arrival_reminders' AND column_name IN ('cc','invoices_attached','attachment_note')) = 3 THEN 'OK' ELSE 'MISSING' END
UNION ALL
SELECT 'reminder log: the server cannot delete or truncate',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'arrival_reminders' AND grantee = 'service_role' AND privilege_type IN ('DELETE','TRUNCATE')) THEN 'STILL ALLOWED' ELSE 'OK' END
UNION ALL
SELECT 'customers that already have a language chosen (expected 0 on the first run)',
       (SELECT count(*)::text FROM public.accounting_customers WHERE correspondence_language IS NOT NULL);
