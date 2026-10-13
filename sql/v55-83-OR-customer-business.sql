-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-OR — WHICH BUSINESS DOES A CUSTOMER BELONG TO? (US vs Egypt)
-- The split cannot ride on invoice currency alone: Egyptian customers also
-- hold USD-denominated invoices. The business is a property of the CUSTOMER.
--   business_tag = 'egypt'  → all their invoices belong to the Egypt book
--   business_tag = 'us' / NULL → US book (unless an invoice itself is EGP)
-- SEED: any customer with at least one EGP invoice is tagged 'egypt'.
-- Customers whose invoices are all-USD but who are Egyptian: flip them on the
-- Customers screen (one click) — the Hub cannot infer those from data.
-- SAFE TO RE-RUN.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE accounting_customers ADD COLUMN IF NOT EXISTS business_tag text;

UPDATE accounting_customers
   SET business_tag = 'egypt'
 WHERE business_tag IS NULL
   AND id IN (SELECT DISTINCT accounting_customer_id FROM accounting_invoices WHERE currency = 'EGP' AND accounting_customer_id IS NOT NULL);

-- VERIFICATION — expect ✅ and a seeded count
SELECT 'accounting_customers.business_tag' AS check_name,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='accounting_customers' AND column_name='business_tag') THEN '✅ exists' ELSE '❌ MISSING' END AS result
UNION ALL
SELECT 'customers tagged egypt (seeded from EGP invoices)', COUNT(*)::text FROM accounting_customers WHERE business_tag = 'egypt';
