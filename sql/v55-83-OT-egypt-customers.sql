-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-OT — TAG THE EGYPTIAN-SIDE CUSTOMERS SEEN IN THE US BOOK (Oct 14)
-- These customers' invoices came through Treasury/Sales testing and carry
-- Wave linkage in the data, so the Wave-bound rule classed them US. Max has
-- identified them as the Egyptian side. The customer tag overrides everything,
-- both ways — once tagged, ALL their invoices leave the US book instantly.
-- (The names below are exactly the non-US customers from Max's own US-book
-- CSV export, Oct 14. SAAD EGYPT is NOT here — AMERICA 1608 is a real Wave
-- invoice on the US side despite the name.)
-- SAFE TO RE-RUN. Add more names any time, or flip one-by-one on the
-- Customers screen.
-- ═══════════════════════════════════════════════════════════════════════════
UPDATE accounting_customers
   SET business_tag = 'egypt'
 WHERE (
       company_name ILIKE 'Adel Saeed'
    OR company_name ILIKE 'Ahmed Abdel Hafiz'
    OR company_name ILIKE 'ABU FASIF'
    OR company_name ILIKE 'A K TRADERS'
    OR company_name ILIKE '1 is 3 Company Limited'
    OR company_name ILIKE 'test'
 );

-- Also run the OR seed if it never ran (safe either way):
UPDATE accounting_customers
   SET business_tag = 'egypt'
 WHERE business_tag IS NULL
   AND id IN (SELECT DISTINCT accounting_customer_id FROM accounting_invoices WHERE currency = 'EGP' AND accounting_customer_id IS NOT NULL);

-- VERIFICATION — expect the named customers listed with tag egypt
SELECT company_name, business_tag FROM accounting_customers WHERE business_tag = 'egypt' ORDER BY company_name;
