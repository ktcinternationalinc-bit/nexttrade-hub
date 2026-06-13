-- ============================================================
-- v55.83-BM — Purchase Orders (INTERNAL ONLY). A simple create + print tool.
-- These NEVER touch Wave, AR, customer balances, or any financial report.
-- Additive + idempotent. RLS open to authenticated (app enforces edit perms).
-- ============================================================
CREATE TABLE IF NOT EXISTS purchase_orders (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id      uuid,
  po_number        text,
  supplier_name    text,
  supplier_contact text,
  po_date          date,
  expected_date    date,
  currency         text DEFAULT 'USD',
  status           text DEFAULT 'open',     -- open | received | closed | cancelled
  notes            text,
  terms            text,
  total_amount     numeric(14,2) DEFAULT 0,
  created_by       uuid,
  updated_by       uuid,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  po_id       uuid,
  description text,
  quantity    numeric DEFAULT 0,
  unit_price  numeric(14,2) DEFAULT 0,
  line_total  numeric(14,2) DEFAULT 0,
  sort_order  int DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_po_items_po ON purchase_order_items(po_id);

ALTER TABLE purchase_orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN CREATE POLICY po_sel ON purchase_orders FOR SELECT TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY po_ins ON purchase_orders FOR INSERT TO authenticated WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY po_upd ON purchase_orders FOR UPDATE TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY po_del ON purchase_orders FOR DELETE TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE POLICY poi_sel ON purchase_order_items FOR SELECT TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY poi_ins ON purchase_order_items FOR INSERT TO authenticated WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY poi_upd ON purchase_order_items FOR UPDATE TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY poi_del ON purchase_order_items FOR DELETE TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
