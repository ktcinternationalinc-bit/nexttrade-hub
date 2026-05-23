-- v55.83-A.6.27.61 — Attachments infrastructure.
--
-- ──────────────────────────────────────────────────────────────────
-- WHAT THIS DOES (in plain English)
-- ──────────────────────────────────────────────────────────────────
-- Adds a new attachments table so you can attach files to:
--   • Open Account Invoices (PDFs, supplier receipts, etc.)
--   • System Tickets (screenshots, error logs, design specs)
--   • Open Account ledger entries (warehouse expense receipts, etc.)
--   • Any other record in the future (extensible by parent_type)
--
-- The actual file BYTES live in Supabase Storage (in a bucket called
-- "attachments" that Max creates manually from the Dashboard). This
-- table just stores the METADATA — file name, size, where it lives,
-- and who uploaded it.
--
-- 100 MB max per file. Any file type allowed.
--
-- ──────────────────────────────────────────────────────────────────
-- BEFORE RUNNING THIS SQL: create the bucket
-- ──────────────────────────────────────────────────────────────────
-- 1. Supabase Dashboard → Storage → New bucket
-- 2. Name: attachments (lowercase, exactly this name)
-- 3. Public bucket: YES (so we can show files via public URL)
-- 4. File size limit: 100 MB (104857600 bytes)
-- 5. Allowed MIME types: leave blank (any file)
-- 6. Save
--
-- Then run the SQL below.

CREATE TABLE IF NOT EXISTS attachments (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- What kind of record does this file belong to?
  --   'open_account_invoice'  → src/components/OpenAccountsTab.jsx
  --   'system_ticket'         → tickets where ticket_type = 'system'
  --   'open_account_entry'    → ledger entries (expenses with receipts)
  --   (extensible — add more types as needed without schema changes)
  parent_type     TEXT NOT NULL,
  parent_id       UUID NOT NULL,

  -- File metadata
  file_name       TEXT NOT NULL,           -- original filename as uploaded
  file_size       BIGINT NOT NULL,         -- bytes
  mime_type       TEXT,                    -- e.g. 'image/png', 'application/pdf'

  -- Storage location
  storage_path    TEXT NOT NULL,           -- path inside the attachments bucket
                                           -- e.g. 'open_account_invoice/abc123/receipt-001.pdf'
  public_url      TEXT NOT NULL,           -- pre-computed public URL for display

  -- Audit
  uploaded_by     UUID,                    -- users.id of who uploaded it
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_attachment_file_size_positive CHECK (file_size > 0),
  CONSTRAINT chk_attachment_file_size_under_limit CHECK (file_size <= 104857600), -- 100 MB
  CONSTRAINT chk_attachment_parent_type_not_blank CHECK (length(trim(parent_type)) > 0),
  CONSTRAINT chk_attachment_file_name_not_blank CHECK (length(trim(file_name)) > 0),
  CONSTRAINT chk_attachment_storage_path_not_blank CHECK (length(trim(storage_path)) > 0)
);

-- Indexes for fast lookup by parent
CREATE INDEX IF NOT EXISTS idx_attachments_parent
  ON attachments (parent_type, parent_id);
CREATE INDEX IF NOT EXISTS idx_attachments_uploaded_by
  ON attachments (uploaded_by);
CREATE INDEX IF NOT EXISTS idx_attachments_uploaded_at
  ON attachments (uploaded_at DESC);

-- RLS — permissive policy, app-level access control
DO $$ BEGIN
  ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Allow all on attachments" ON attachments FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ──────────────────────────────────────────────────────────────────
-- VERIFY (run after migration)
-- ──────────────────────────────────────────────────────────────────
-- 1) Table exists with all columns:
--    SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name = 'attachments' ORDER BY ordinal_position;
--    Expected: id, parent_type, parent_id, file_name, file_size,
--              mime_type, storage_path, public_url,
--              uploaded_by, uploaded_at  (10 columns)
--
-- 2) Indexes exist:
--    SELECT indexname FROM pg_indexes WHERE tablename = 'attachments';
--    Expected: attachments_pkey + 3 idx_* indexes
--
-- 3) Bucket exists in Storage:
--    SELECT name, public FROM storage.buckets WHERE name = 'attachments';
--    Expected: one row, public = true

-- ──────────────────────────────────────────────────────────────────
-- BACKOUT (only if catastrophic problems)
-- ──────────────────────────────────────────────────────────────────
--   DROP TABLE IF EXISTS attachments;
--   (Then manually empty + delete the Storage bucket from Dashboard if desired.)
