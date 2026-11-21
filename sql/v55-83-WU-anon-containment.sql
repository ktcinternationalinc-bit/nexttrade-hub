BEGIN;
REVOKE ALL ON TABLE public.bank_transactions, public.egypt_bank_transactions, public.egypt_bank_accounts, public.egypt_bank_rules, public.module_permissions, public.open_accounts, public.open_account_entries, public.open_account_invoices, public.open_account_invoice_items, public.warehouse_advances, public.fx_rates, public.inventory_landed_costs, public.inventory_layers, public.attachments FROM anon;
COMMIT;
