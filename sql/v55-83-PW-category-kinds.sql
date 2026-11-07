-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-PW — CATEGORY TYPES, QUICKBOOKS-STYLE (Max, Nov 7 10:42: "categories
-- should be whether they are income or expense as quickbooks does.. make it
-- work like this and same process").
--
-- Every category gets a KIND, like QuickBooks account types:
--   income / cogs / expense / other_income / other_expense / transfer /
--   not_pnl (balance-sheet money: loan principal, owner contributions —
--   NEVER income and NEVER a deductible expense).
-- Reports then separate taxable income from loan proceeds, and deductible
-- spending from loan repayments — that is the "proper accounting" part.
-- Idempotent; safe to run repeatedly.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'expense';
DO $$ BEGIN
  ALTER TABLE expense_categories ADD CONSTRAINT expense_categories_kind_chk
    CHECK (kind IN ('income','cogs','expense','other_income','other_expense','transfer','not_pnl'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Sensible defaults for the built-ins (only where still at the default):
UPDATE expense_categories SET kind = 'income'       WHERE key = 'customer_payment'   AND kind = 'expense';
UPDATE expense_categories SET kind = 'other_income' WHERE key = 'other_income'       AND kind = 'expense';
UPDATE expense_categories SET kind = 'other_income' WHERE key = 'refund'             AND kind = 'expense';
UPDATE expense_categories SET kind = 'transfer'     WHERE key = 'transfer'           AND kind = 'expense';
UPDATE expense_categories SET kind = 'not_pnl'      WHERE key = 'loan'               AND kind = 'expense';
UPDATE expense_categories SET kind = 'not_pnl'      WHERE key = 'owner_contribution' AND kind = 'expense';
UPDATE expense_categories SET kind = 'other_expense' WHERE key = 'other_expense'     AND kind = 'expense';
-- vendor_payment, payroll, bank_fee, needs_clarification stay 'expense'.

SELECT 'v55.83-PW category kinds installed' AS status,
  (SELECT count(*) FROM expense_categories WHERE kind <> 'expense') AS typed;

-- ── Customer merge/unmerge (Max, Nov 7 10:49: "merge and unmerge more than
-- one customer to make it one set of data aggregated... companies change
-- names but same customer... ability to unmerge if needed... see the names
-- together"). NON-DESTRUCTIVE: merging only sets a pointer on the merged
-- customer; every invoice/payment keeps its original customer id, so
-- unmerging is one click and nothing is ever rewritten. Idempotent.
ALTER TABLE accounting_customers ADD COLUMN IF NOT EXISTS merged_into uuid;
CREATE INDEX IF NOT EXISTS accounting_customers_merged_ix ON accounting_customers (merged_into) WHERE merged_into IS NOT NULL;
SELECT 'v55.83-PW customer merge installed' AS status;
