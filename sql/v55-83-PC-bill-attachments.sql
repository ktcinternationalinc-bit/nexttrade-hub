-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-PC — BILL IMPORT ATTACHMENTS
-- Max (Nov 5): "i should be able to import a bill and it will be read and
-- entered as a bill with all of the correct vendors dates amounts etc"
-- The imported photo/PDF is stored in the existing "attachments" bucket and
-- its path travels on the bill for audit. SAFE TO RE-RUN.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.vendor_bills ADD COLUMN IF NOT EXISTS attachment_path text;

-- VERIFICATION
SELECT '1. vendor_bills.attachment_path' AS check_name,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vendor_bills' AND column_name='attachment_path') THEN '✅ exists' ELSE '❌ MISSING' END AS result;
