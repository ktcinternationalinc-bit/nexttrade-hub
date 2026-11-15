-- v55.83-LW — ensure the Wave PAYMENT DEPOSIT ACCOUNT columns exist on wave_business_settings.
-- These were introduced in v55.83-FO as a manual ALTER (no migration file shipped). If that manual step
-- was never run on this database, saving the deposit account silently fails and the transaction push
-- forever reports "No Wave bank account configured" — the exact loop we kept hitting. Run this once.
-- Safe to re-run.

ALTER TABLE wave_business_settings ADD COLUMN IF NOT EXISTS default_payment_account_id text;
ALTER TABLE wave_business_settings ADD COLUMN IF NOT EXISTS default_payment_account_name text;

-- (Related columns the app also relies on — harmless if already present.)
ALTER TABLE wave_business_settings ADD COLUMN IF NOT EXISTS default_invoice_product_id text;
ALTER TABLE wave_business_settings ADD COLUMN IF NOT EXISTS default_invoice_product_name text;

COMMENT ON COLUMN wave_business_settings.default_payment_account_id IS 'Wave Cash&Bank account id used as the bank-side anchor for transaction/payment pushes (v55.83-FO/LW).';
