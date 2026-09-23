-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-NM — NEXTTRADE ORDERS (reconciliation source)
-- Holds the orders/scan-outs pasted from nextradeindustries.com/admin so the
-- Hub can reconcile them against invoices. One row per RELEASE # (re-importing
-- the same release UPDATES it — no duplicates). SAFE TO RE-RUN.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS nexttrade_orders (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_number text NOT NULL UNIQUE,
  customer_name  text,
  warehouse      text,            -- CANADA / USA / Non-Bonded USA / Other
  container      text,            -- '0' means local delivery, else container no.
  order_date     date,
  shipped_date   date,
  arrival_date   date,
  status         text,            -- Shipped / End Stage / Post Loading Documentation / ...
  country        text,            -- destination country
  qty_seconds    numeric DEFAULT 0,
  qty_thirds     numeric DEFAULT 0,
  qty_paper      numeric DEFAULT 0,
  imported_by    uuid,
  imported_at    timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nexttrade_orders_date ON nexttrade_orders (order_date DESC);

ALTER TABLE nexttrade_orders ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "nexttrade_orders_select" ON nexttrade_orders FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "nexttrade_orders_insert" ON nexttrade_orders FOR INSERT TO authenticated WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "nexttrade_orders_update" ON nexttrade_orders FOR UPDATE TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "nexttrade_orders_delete" ON nexttrade_orders FOR DELETE TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- VERIFICATION
SELECT '1. nexttrade_orders table' AS check_name,
       CASE WHEN to_regclass('public.nexttrade_orders') IS NULL THEN '❌ MISSING' ELSE '✅ exists' END AS result
UNION ALL
SELECT '2. RLS policies (need 4)', COUNT(*)::text FROM pg_policies WHERE tablename='nexttrade_orders';
