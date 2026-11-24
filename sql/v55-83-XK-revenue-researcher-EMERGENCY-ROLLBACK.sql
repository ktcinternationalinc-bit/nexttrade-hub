BEGIN;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['accounting_invoices','accounting_invoice_items','accounting_invoice_payments','accounting_proformas','accounting_proforma_items','invoice_items','invoices','checks','customer_credits','open_account_invoices','open_account_invoice_items','open_account_entries','inventory_movements','inventory_layers','bank_transactions','bank_transaction_splits','payment_matches','unapplied_deposits','plaid_accounts'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN EXECUTE format('DROP POLICY IF EXISTS hub_revenue_researcher ON public.%I', t); END IF;
  END LOOP;
END $$;
DROP FUNCTION IF EXISTS public.hub_revenue_guard_installed();
DROP FUNCTION IF EXISTS public.hub_caller_revenue_hidden();
COMMIT;
