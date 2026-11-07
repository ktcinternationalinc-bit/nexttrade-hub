-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-QB — RTM Capital: third-party payer (Max, Nov 7 2026, 11:32–11:40)
--
-- "we have a 3rd party (RTM Capital) that pays lots of our trucking and
--  other values... when we make a professional fee payment to RTM it will be
--  one line item under professional fees but underlying sub heading will be
--  breakdown of these bills in the pnl report if i select a radio button...
--  otherwise it would be as one fee for tax reporting."
--
-- Two columns, no new money tables:
--   vendor_bills.paid_via            — 'RTM Capital' marks a bill a third
--                                      party pays for us: it is TRACKED but
--                                      stays OUT of what-we-owe totals, cash
--                                      forecasts and shortage math.
--   bank_transactions.third_party_payer — stamps the money-out payment to
--                                      RTM. Which bills it covers is written
--                                      as ordinary vendor_bill_payments rows
--                                      with method='rtm' (same overpay and
--                                      over-allocation guards as every other
--                                      bill payment — money math is never
--                                      duplicated).
-- Paste into the Supabase SQL Editor and Run. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE vendor_bills      ADD COLUMN IF NOT EXISTS paid_via text;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS third_party_payer text;

CREATE INDEX IF NOT EXISTS vendor_bills_paid_via_idx
  ON vendor_bills (paid_via) WHERE paid_via IS NOT NULL;
CREATE INDEX IF NOT EXISTS bank_tx_third_party_payer_idx
  ON bank_transactions (third_party_payer) WHERE third_party_payer IS NOT NULL;

select 'QB ok — via-RTM bills: ' || count(*) from vendor_bills where paid_via is not null;
