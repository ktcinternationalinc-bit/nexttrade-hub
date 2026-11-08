-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-QY — Paid-through companies (Max, Nov 8 11:45–11:50): RTM Capital
-- (outside service that pays vendors for us) and NextTrade Industries
-- (related company running the Texas warehouse: payroll, insurance,
-- electricity, gas, internet, bonding fees, rent). KTC sends NextTrade money
-- as needed; NextTrade charges a service fee at some point; 100% KTC.
--
-- One small registry. Bills say WHO pays them (vendor_bills.paid_via =
-- name), payments say WHO they went to (bank_transactions.third_party_payer
-- = name). kind decides how an UNLINKED remainder of a payment is labeled:
--   service_provider → that party's FEE           (RTM: "RTM service fee")
--   affiliate        → an ADVANCE awaiting costs   (NextTrade: never a fee)
-- Paste into the Supabase SQL Editor and Run. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS paid_through_parties (
  name text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('service_provider','affiliate')),
  remainder_label text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  sort int NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO paid_through_parties(name, kind, remainder_label, sort) VALUES
  ('RTM Capital', 'service_provider', 'RTM service fee (payments − covered bills)', 10),
  ('NextTrade Industries', 'affiliate', 'Advance with NextTrade — awaiting its costs (not an expense yet)', 20)
ON CONFLICT (name) DO NOTHING;
ALTER TABLE paid_through_parties ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY ptp_read ON paid_through_parties FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
select 'QY ok — parties: ' || string_agg(name, ', ' order by sort) from paid_through_parties;
