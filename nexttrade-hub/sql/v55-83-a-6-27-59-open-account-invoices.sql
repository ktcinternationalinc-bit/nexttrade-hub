-- v55.83-A.6.27.59 — Mini-invoices for Open Accounts.
--
-- Adds 2 new tables (open_account_invoices + open_account_invoice_items) and
-- 1 new column on open_account_entries (linked_open_invoice_id) so each
-- ledger entry can optionally point back to the invoice that generated it.
--
-- WHAT THIS ENABLES:
--   • Create informal invoices tied to a specific Open Account.
--   • Direction toggle: "We're billing them" → auto-creates a CREDIT ledger
--     entry (they owe us). "They're billing us" → auto-creates a DEBIT
--     ledger entry (we owe them).
--   • Free-text invoice number, line items, optional shipping, optional tax.
--   • Editing an invoice auto-updates its linked ledger entry's amount.
--   • Deleting an invoice cascades to remove the linked ledger entry.
--   • Manual ledger entries with NO invoice still work — both paths coexist.
--
-- CONVENTIONS:
--   • direction = 'credit' means we billed THEM (money coming in to us)
--   • direction = 'debit'  means they billed US (money going out of us)
--
-- ALL CHANGES ARE FULLY REVERSIBLE — backout SQL at the bottom.

-- ──────────────────────────────────────────────────────────────────
-- 1. Invoices table
-- ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS open_account_invoices (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id      UUID NOT NULL REFERENCES open_accounts(id) ON DELETE CASCADE,

  -- Free-text invoice number — user types whatever they want.
  -- NOT unique (different counterparties may use the same number).
  invoice_number  TEXT NOT NULL,

  -- Direction: 'credit' = we billed them, 'debit' = they billed us
  direction       TEXT NOT NULL CHECK (direction IN ('credit', 'debit')),

  -- Counterparty info (defaults from the account but editable per invoice)
  counterparty_name     TEXT NOT NULL,
  counterparty_name_ar  TEXT,
  counterparty_address  TEXT,
  counterparty_email    TEXT,
  counterparty_phone    TEXT,

  -- Dates
  invoice_date          DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date              DATE,

  -- Money
  currency              TEXT NOT NULL DEFAULT 'USD',
  subtotal              NUMERIC(14,2) NOT NULL DEFAULT 0,
  shipping_amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_rate_pct          NUMERIC(6,3),  -- e.g. 14.000 for VAT. NULL when tax not used.
  tax_amount            NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_amount          NUMERIC(14,2) NOT NULL DEFAULT 0,

  -- Free text
  notes                 TEXT,
  terms                 TEXT,

  -- Audit
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by            UUID,
  updated_by            UUID,

  CONSTRAINT chk_inv_currency_not_blank CHECK (length(trim(currency)) >= 2),
  CONSTRAINT chk_inv_amounts_non_negative CHECK (
    subtotal >= 0 AND shipping_amount >= 0 AND tax_amount >= 0 AND total_amount >= 0
  )
);

CREATE INDEX IF NOT EXISTS idx_oai_account     ON open_account_invoices (account_id);
CREATE INDEX IF NOT EXISTS idx_oai_invoice_num ON open_account_invoices (invoice_number);
CREATE INDEX IF NOT EXISTS idx_oai_currency    ON open_account_invoices (currency);
CREATE INDEX IF NOT EXISTS idx_oai_date        ON open_account_invoices (invoice_date DESC);

-- ──────────────────────────────────────────────────────────────────
-- 2. Invoice line items
-- ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS open_account_invoice_items (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id      UUID NOT NULL REFERENCES open_account_invoices(id) ON DELETE CASCADE,

  sort_order      INTEGER NOT NULL DEFAULT 0,

  description     TEXT NOT NULL,
  quantity        NUMERIC(14,3) NOT NULL DEFAULT 1,
  unit_price      NUMERIC(14,2) NOT NULL DEFAULT 0,
  line_total      NUMERIC(14,2) NOT NULL DEFAULT 0,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_oaii_qty_positive CHECK (quantity > 0),
  CONSTRAINT chk_oaii_amounts_non_negative CHECK (unit_price >= 0 AND line_total >= 0)
);

CREATE INDEX IF NOT EXISTS idx_oaii_invoice ON open_account_invoice_items (invoice_id, sort_order);

-- ──────────────────────────────────────────────────────────────────
-- 3. Link column on open_account_entries
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE open_account_entries
  ADD COLUMN IF NOT EXISTS linked_open_invoice_id UUID;

DO $$ BEGIN
  ALTER TABLE open_account_entries
    ADD CONSTRAINT fk_entry_linked_invoice
      FOREIGN KEY (linked_open_invoice_id)
      REFERENCES open_account_invoices(id)
      ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_entry_linked_inv ON open_account_entries (linked_open_invoice_id)
  WHERE linked_open_invoice_id IS NOT NULL;

-- ──────────────────────────────────────────────────────────────────
-- 4. RLS
-- ──────────────────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE open_account_invoices ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN others THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE open_account_invoice_items ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Allow all on open_account_invoices" ON open_account_invoices FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "Allow all on open_account_invoice_items" ON open_account_invoice_items FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ──────────────────────────────────────────────────────────────────
-- 5. updated_at trigger
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_oai_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE TRIGGER trg_oai_updated_at
    BEFORE UPDATE ON open_account_invoices
    FOR EACH ROW EXECUTE FUNCTION trg_oai_set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ──────────────────────────────────────────────────────────────────
-- BACKOUT
-- ──────────────────────────────────────────────────────────────────
--   ALTER TABLE open_account_entries DROP CONSTRAINT IF EXISTS fk_entry_linked_invoice;
--   DROP INDEX IF EXISTS idx_entry_linked_inv;
--   ALTER TABLE open_account_entries DROP COLUMN IF EXISTS linked_open_invoice_id;
--   DROP TABLE IF EXISTS open_account_invoice_items;
--   DROP TABLE IF EXISTS open_account_invoices;
--   DROP FUNCTION IF EXISTS trg_oai_set_updated_at();
