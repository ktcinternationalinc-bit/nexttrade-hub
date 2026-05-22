-- v55.83-A.6.27.53 — Business Entities + Open Accounts entity linkage
--
-- Adds a small business_entities table for entity info (name, address, phone,
-- email, default currency) used as the "from" branding on Open Accounts printed
-- ledgers and (in .55) mini-invoices.
--
-- Also adds business_entity_code column to open_accounts so each account knows
-- which entity is the "us" side. Defaults existing accounts to 'ktc_intl'.
--
-- DOES NOT TOUCH: customers, invoices, treasury, checks, banks, inventory, or
-- any other existing table.

-- ──────────────────────────────────────────────────────────────────
-- 1. business_entities table
-- ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_entities (
  -- Stable text code (used as FK from other tables) — NOT a uuid
  entity_code text PRIMARY KEY,

  -- Display
  entity_name text NOT NULL,
  entity_name_ar text,

  -- Contact info (all optional — fill in via Settings panel)
  address_line1 text,
  address_line2 text,
  city text,
  region text,             -- state / governorate
  postal_code text,
  country text,
  phone text,
  email text,
  tax_id text,             -- optional tax registration number for invoices

  -- Display defaults
  default_currency text DEFAULT 'USD',

  active boolean NOT NULL DEFAULT true,
  display_order integer DEFAULT 0,

  -- Audit
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_business_entity_code_not_blank CHECK (length(trim(entity_code)) > 0),
  CONSTRAINT chk_business_entity_name_not_blank CHECK (length(trim(entity_name)) > 0)
);

-- Seed two entities (only if they don't exist already — safe re-runs)
INSERT INTO business_entities (entity_code, entity_name, entity_name_ar, country, default_currency, display_order)
VALUES
  ('ktc_intl',  'KTC International Inc.', 'كي تي سي إنترناشيونال', 'USA',   'USD', 1),
  ('ktc_egypt', 'KTC Egypt',              'كي تي سي مصر',          'Egypt', 'EGP', 2)
ON CONFLICT (entity_code) DO NOTHING;

-- ──────────────────────────────────────────────────────────────────
-- 2. Add business_entity_code to open_accounts
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE open_accounts
  ADD COLUMN IF NOT EXISTS business_entity_code text REFERENCES business_entities(entity_code);

-- Backfill any existing rows to KTC International by default.
-- (At time of this migration there should be 0 rows since .52 just shipped,
--  but the UPDATE is harmless either way.)
UPDATE open_accounts SET business_entity_code = 'ktc_intl' WHERE business_entity_code IS NULL;

-- Going forward, new rows should always specify entity. We don't add a NOT NULL
-- constraint because of the FK constraint timing — but the app will enforce it.

CREATE INDEX IF NOT EXISTS idx_open_accounts_entity ON open_accounts (business_entity_code);

-- ──────────────────────────────────────────────────────────────────
-- 3. RLS + updated_at trigger for business_entities
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE business_entities ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Allow all business_entities" ON business_entities FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION trg_business_entities_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS business_entities_updated_at ON business_entities;
CREATE TRIGGER business_entities_updated_at
  BEFORE UPDATE ON business_entities
  FOR EACH ROW EXECUTE FUNCTION trg_business_entities_updated_at();

-- ──────────────────────────────────────────────────────────────────
-- VERIFY (run after migration to confirm success)
-- ──────────────────────────────────────────────────────────────────
-- SELECT entity_code, entity_name, default_currency FROM business_entities ORDER BY display_order;
-- Expect 2 rows: ktc_intl + ktc_egypt
--
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name='open_accounts' AND column_name='business_entity_code';
-- Expect 1 row.
--
-- SELECT COUNT(*) FROM open_accounts WHERE business_entity_code IS NULL;
-- Expect 0.

-- ──────────────────────────────────────────────────────────────────
-- BACKOUT SQL (only if something goes catastrophically wrong)
-- ──────────────────────────────────────────────────────────────────
--   ALTER TABLE open_accounts DROP COLUMN IF EXISTS business_entity_code;
--   DROP INDEX IF EXISTS idx_open_accounts_entity;
--   DROP TRIGGER IF EXISTS business_entities_updated_at ON business_entities;
--   DROP FUNCTION IF EXISTS trg_business_entities_updated_at();
--   DROP TABLE IF EXISTS business_entities;
