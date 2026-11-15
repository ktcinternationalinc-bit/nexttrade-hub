-- v55.83-II — Inventory product photos (INTERNAL-ONLY).
--
-- ──────────────────────────────────────────────────────────────────
-- WHAT THIS DOES (plain English)
-- ──────────────────────────────────────────────────────────────────
-- Lets staff attach PHOTOS to inventory products (colors, patterns,
-- material texture, variants) so they can visually verify a SKU before
-- choosing it in Product Master / ProductPicker / Receiving / Stock Mix.
--
-- Max's decision (2026-06-17): product photos are INTERNAL-ONLY, NOT a
-- public catalog. So they live in a PRIVATE Storage bucket and are shown
-- via short-lived SIGNED URLs — never a public URL. This is different
-- from the existing public "attachments" bucket used for invoice/ticket
-- documents.
--
-- Photos reuse the existing `attachments` table with
-- parent_type = 'inventory_product' and parent_id = inventory_products.id.
-- This migration adds the small bit of metadata that table was missing
-- (primary/cover flag, sort order, caption, private flag) and sets up the
-- private bucket's storage policies.
--
-- ──────────────────────────────────────────────────────────────────
-- BEFORE RUNNING THIS SQL: create the PRIVATE bucket
-- ──────────────────────────────────────────────────────────────────
-- 1. Supabase Dashboard → Storage → New bucket
-- 2. Name: product-photos   (lowercase, exactly this name)
-- 3. Public bucket: NO  ← IMPORTANT. Leave it PRIVATE.
-- 4. File size limit: 100 MB (104857600 bytes)
-- 5. Allowed MIME types: image/*  (or leave blank; the app enforces images)
-- 6. Save
--
-- Then run the SQL below.

-- ── 1. Metadata columns on attachments (idempotent; safe to re-run) ──
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS is_private  BOOLEAN DEFAULT false;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS is_primary  BOOLEAN DEFAULT false;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS sort_order  INTEGER DEFAULT 0;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS caption     TEXT;

-- public_url was NOT NULL with no default. Private photos never have a public
-- URL — the app inserts '' (empty string), which already satisfies NOT NULL,
-- so no constraint change is required. (Documented here so it isn't a surprise.)

-- Fast lookup of the primary photo per product.
CREATE INDEX IF NOT EXISTS idx_attachments_primary
  ON attachments (parent_type, parent_id, is_primary)
  WHERE is_primary = true;

-- ── 2. Storage policies for the PRIVATE product-photos bucket ──
-- Mirrors the attachments-bucket policies but scoped to bucket_id =
-- 'product-photos'. SELECT here only lets an authenticated client REQUEST a
-- signed URL; the bucket stays private (no anonymous public URL).
DROP POLICY IF EXISTS "auth users upload to product-photos" ON storage.objects;
CREATE POLICY "auth users upload to product-photos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'product-photos');

DROP POLICY IF EXISTS "auth users read product-photos" ON storage.objects;
CREATE POLICY "auth users read product-photos"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'product-photos');

DROP POLICY IF EXISTS "auth users update product-photos" ON storage.objects;
CREATE POLICY "auth users update product-photos"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'product-photos')
  WITH CHECK (bucket_id = 'product-photos');

DROP POLICY IF EXISTS "auth users delete product-photos" ON storage.objects;
CREATE POLICY "auth users delete product-photos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'product-photos');

-- ──────────────────────────────────────────────────────────────────
-- VERIFY (run after migration)
-- ──────────────────────────────────────────────────────────────────
-- 1) New columns exist:
--    SELECT column_name FROM information_schema.columns
--    WHERE table_name='attachments'
--      AND column_name IN ('is_private','is_primary','sort_order','caption');
--    Expected: 4 rows.
--
-- 2) Bucket exists and is PRIVATE:
--    SELECT name, public FROM storage.buckets WHERE name='product-photos';
--    Expected: one row, public = false.
--
-- 3) Policies exist:
--    SELECT policyname FROM pg_policies
--    WHERE tablename='objects' AND policyname LIKE '%product-photos%';
--    Expected: 4 rows.

-- ──────────────────────────────────────────────────────────────────
-- BACKOUT (only if needed)
-- ──────────────────────────────────────────────────────────────────
--   ALTER TABLE attachments DROP COLUMN IF EXISTS caption;
--   ALTER TABLE attachments DROP COLUMN IF EXISTS sort_order;
--   ALTER TABLE attachments DROP COLUMN IF EXISTS is_primary;
--   ALTER TABLE attachments DROP COLUMN IF EXISTS is_private;
--   DROP POLICY IF EXISTS "auth users upload to product-photos" ON storage.objects;
--   DROP POLICY IF EXISTS "auth users read product-photos"     ON storage.objects;
--   DROP POLICY IF EXISTS "auth users update product-photos"   ON storage.objects;
--   DROP POLICY IF EXISTS "auth users delete product-photos"   ON storage.objects;
--   (Then manually empty + delete the product-photos bucket from the Dashboard.)
