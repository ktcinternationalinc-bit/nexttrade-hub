-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-RY — Max, Nov 10 00:11: "add delete bill"
-- A deleted bill disappears from the Hub (lists, reports, wires, duplicate checks, the books) but its row and its
-- audit trail stay — the trail is append-only by design. Who deleted it, when and why are kept on the row.
-- Void stays for a real bill that was cancelled (it stays visible as VOID). Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.vendor_bills DROP CONSTRAINT IF EXISTS vendor_bills_record_status_check;
ALTER TABLE public.vendor_bills ADD CONSTRAINT vendor_bills_record_status_check CHECK (record_status IN ('active', 'void', 'deleted'));
ALTER TABLE public.vendor_bills ADD COLUMN IF NOT EXISTS deleted_by uuid;
ALTER TABLE public.vendor_bills ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.vendor_bills ADD COLUMN IF NOT EXISTS delete_reason text;
ALTER TABLE public.vendor_bills DROP CONSTRAINT IF EXISTS vendor_bills_deleted_has_reason;
ALTER TABLE public.vendor_bills ADD CONSTRAINT vendor_bills_deleted_has_reason
  CHECK (record_status <> 'deleted' OR (deleted_at IS NOT NULL AND length(btrim(COALESCE(delete_reason, ''))) >= 5));
-- a deleted bill can never be brought back by an edit (it stays deleted; re-import or add it again instead)
CREATE OR REPLACE FUNCTION public.vendor_bills_deleted_lock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.record_status = 'deleted' THEN RAISE EXCEPTION 'This bill was deleted — it cannot change.'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_vendor_bills_deleted_lock ON public.vendor_bills;
CREATE TRIGGER trg_vendor_bills_deleted_lock BEFORE UPDATE ON public.vendor_bills FOR EACH ROW EXECUTE FUNCTION public.vendor_bills_deleted_lock();
