-- ============================================================
-- v55.83-X — PHASE 1: Bank ingestion data layer
-- Principle: Bank -> Application (read-only). 100% additive; safe to re-run.
-- Carries business_id everywhere (single business now, multi-business later)
-- and reserves expansion paths (vendor/bill/PO/expense) per the plan.
-- ============================================================

-- 1) Connection store: tag to a business + room for incremental sync later
ALTER TABLE bank_connections ADD COLUMN IF NOT EXISTS business_id      uuid;
ALTER TABLE bank_connections ADD COLUMN IF NOT EXISTS institution_name text;
ALTER TABLE bank_connections ADD COLUMN IF NOT EXISTS sync_cursor      text;     -- for Plaid /transactions/sync (future)
ALTER TABLE bank_connections ADD COLUMN IF NOT EXISTS is_read_only     boolean DEFAULT true;

-- 2) bank_transactions: classification-ready + expansion-ready
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS business_id            uuid;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS bank_source            text;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS posted_date            date;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS authorized_date        date;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS direction              text;            -- 'in' | 'out'
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS amount_abs             numeric(14,2);
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS iso_currency           text DEFAULT 'USD';
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS check_number           text;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS channel                text;            -- ach|wire|card|check|online|in store|other
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS transaction_code       text;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS classification         text;            -- income/expense/transfer/refund/owner_contribution/loan/payroll/vendor_payment/customer_payment
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS review_status          text DEFAULT 'unreviewed';
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS linked_type            text;            -- customer|vendor|invoice|bill|purchase_order|expense|shipment|order|project
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS linked_id              uuid;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS customer_id            uuid;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS notes                  text;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS pending_transaction_id text;            -- Plaid: pending twin this row supersedes
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS raw                    jsonb;           -- full Plaid payload (audit)
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS reviewed_by            uuid;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS reviewed_at            timestamptz;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS created_at             timestamptz DEFAULT now();
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS updated_at             timestamptz DEFAULT now();

-- Dedupe key (idempotent upserts) + read indexes
CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_txn_plaid_id     ON bank_transactions(plaid_transaction_id);
CREATE INDEX        IF NOT EXISTS ix_bank_txn_business_date ON bank_transactions(business_id, posted_date DESC);
CREATE INDEX        IF NOT EXISTS ix_bank_txn_review        ON bank_transactions(review_status);
CREATE INDEX        IF NOT EXISTS ix_bank_txn_customer      ON bank_transactions(customer_id);
CREATE INDEX        IF NOT EXISTS ix_bank_txn_linked        ON bank_transactions(linked_type, linked_id);

-- 3) Splits: one bank line across many targets (Req 9)
CREATE TABLE IF NOT EXISTS bank_transaction_splits (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id         uuid,
  bank_transaction_id uuid NOT NULL,
  split_amount        numeric(14,2) NOT NULL,
  category            text,
  linked_type         text,
  linked_id           uuid,
  notes               text,
  created_by          uuid,
  created_at          timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_splits_txn ON bank_transaction_splits(bank_transaction_id);

-- 4) RLS (Rule 9) — enable + authenticated policies on both tables (idempotent)
DO $$ BEGIN ALTER TABLE bank_transaction_splits ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY bts_sel ON bank_transaction_splits FOR SELECT TO authenticated USING (true);      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY bts_ins ON bank_transaction_splits FOR INSERT TO authenticated WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY bts_upd ON bank_transaction_splits FOR UPDATE TO authenticated USING (true);      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY bts_del ON bank_transaction_splits FOR DELETE TO authenticated USING (true);      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY bt_sel ON bank_transactions FOR SELECT TO authenticated USING (true);      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY bt_ins ON bank_transactions FOR INSERT TO authenticated WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY bt_upd ON bank_transactions FOR UPDATE TO authenticated USING (true);      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY bt_del ON bank_transactions FOR DELETE TO authenticated USING (true);      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 5) Backfill existing rows into the new shape (Plaid sign: amount<0 = money IN)
UPDATE bank_transactions
   SET posted_date   = COALESCE(posted_date, date),
       direction     = COALESCE(direction, CASE WHEN amount < 0 THEN 'in' ELSE 'out' END),
       amount_abs    = COALESCE(amount_abs, ABS(amount)),
       review_status = COALESCE(review_status, 'unreviewed')
 WHERE posted_date IS NULL OR direction IS NULL OR amount_abs IS NULL OR review_status IS NULL;

-- VERIFY:
--   SELECT review_status, count(*) FROM bank_transactions GROUP BY 1;
--   SELECT direction, count(*), sum(amount_abs) FROM bank_transactions GROUP BY 1;
