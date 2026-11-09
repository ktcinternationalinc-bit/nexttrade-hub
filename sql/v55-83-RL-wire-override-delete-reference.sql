-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-RL (Max, Nov 9 12:17–12:18)
--  "should be override button. with reason and audit of who approved it."
--  "also ability to delete the wire and everything return to previous state."
--  "also should have a reference column to fill if there is a reference that is
--   part of it that is besides the bill # and release #"
--
--  • vendor_bills.other_reference — any other reference on the bill (BOL, PO,
--    container, booking #…), besides the bill # and the release #.
--  • vendor_bills.shipment_direction — INBOUND (needs the reference) or
--    OUTBOUND (needs the release #). Bill # and bill date: always.
--  • wire_package_overrides — every override of a check: which check, on which
--    bill, the reason, WHO approved it and WHEN, bound to the exact wire it was
--    approved on (change the wire → the override no longer counts). Append-only.
--  • wire_packages: status 'reversed' — a sent / attached wire undone by a super
--    admin or the owner WITH a reason: payments voided, bills back to how they
--    were, the bank line freed. The record itself is kept (who sent it, who
--    signed, who reversed it and why) — only a never-sent draft is erased.
-- SAFE TO RE-RUN. Needs RG + RH (+ RI) first.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.vendor_bills ADD COLUMN IF NOT EXISTS other_reference text;
CREATE INDEX IF NOT EXISTS idx_vendor_bills_other_ref ON public.vendor_bills (upper(other_reference));
-- Max 12:20: "check box if outbound or inbound -- if inbound release number not necessary but a reference number is
-- necessary. if outbound then release number is necessary and reference number is not. Billing is always necessary and
-- date is always necessary"
ALTER TABLE public.vendor_bills ADD COLUMN IF NOT EXISTS shipment_direction text;
ALTER TABLE public.vendor_bills DROP CONSTRAINT IF EXISTS vendor_bills_shipment_direction_check;
ALTER TABLE public.vendor_bills ADD CONSTRAINT vendor_bills_shipment_direction_check CHECK (shipment_direction IS NULL OR shipment_direction IN ('inbound', 'outbound'));

CREATE TABLE IF NOT EXISTS public.wire_package_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.wire_packages(id) ON DELETE CASCADE,
  check_key text NOT NULL,
  code text NOT NULL,
  bill_id uuid,
  check_text text,
  reason text NOT NULL CHECK (length(reason) >= 10),
  overridden_by uuid NOT NULL,
  overridden_at timestamptz NOT NULL DEFAULT now(),
  fingerprint text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wpkg_overrides_pkg ON public.wire_package_overrides (package_id, overridden_at DESC);
ALTER TABLE public.wire_package_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wire_package_overrides_select ON public.wire_package_overrides;
DROP POLICY IF EXISTS wire_package_overrides_insert ON public.wire_package_overrides;
DROP POLICY IF EXISTS wire_package_overrides_update ON public.wire_package_overrides;
DROP POLICY IF EXISTS wire_package_overrides_delete ON public.wire_package_overrides;
CREATE POLICY wire_package_overrides_select ON public.wire_package_overrides FOR SELECT TO authenticated USING (true);
CREATE POLICY wire_package_overrides_insert ON public.wire_package_overrides FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY wire_package_overrides_update ON public.wire_package_overrides FOR UPDATE TO authenticated USING (false);
CREATE POLICY wire_package_overrides_delete ON public.wire_package_overrides FOR DELETE TO authenticated USING (false);

-- the file / override rows of an erased DRAFT go with it
ALTER TABLE public.wire_package_files DROP CONSTRAINT IF EXISTS wire_package_files_package_id_fkey;
ALTER TABLE public.wire_package_files ADD CONSTRAINT wire_package_files_package_id_fkey FOREIGN KEY (package_id) REFERENCES public.wire_packages(id) ON DELETE CASCADE;

ALTER TABLE public.wire_packages ADD COLUMN IF NOT EXISTS reversed_by uuid;
ALTER TABLE public.wire_packages ADD COLUMN IF NOT EXISTS reversed_at timestamptz;
ALTER TABLE public.wire_packages ADD COLUMN IF NOT EXISTS reverse_note text;
ALTER TABLE public.wire_packages ADD COLUMN IF NOT EXISTS prev_third_party_payer text;
ALTER TABLE public.wire_packages DROP CONSTRAINT IF EXISTS wire_packages_status_check;
ALTER TABLE public.wire_packages ADD CONSTRAINT wire_packages_status_check CHECK (status IN ('draft', 'sent', 'attached', 'cancelled', 'reversed'));
ALTER TABLE public.wire_packages DROP CONSTRAINT IF EXISTS wpkg_reversed_has_reason;
ALTER TABLE public.wire_packages ADD CONSTRAINT wpkg_reversed_has_reason CHECK (status <> 'reversed' OR (reversed_by IS NOT NULL AND reversed_at IS NOT NULL AND length(coalesce(reverse_note, '')) >= 10));

-- locks (replaces the RH version): a sent / attached wire can ONLY move to 'reversed' (with who + why), and in that
-- move nothing that was approved may change — only the bank line is released
CREATE OR REPLACE FUNCTION public.wpkg_lock() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'WIRE_PACKAGE_LOCKED: only a draft package can be deleted'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('cancelled', 'reversed') THEN RAISE EXCEPTION 'WIRE_PACKAGE_LOCKED: a % package cannot change', OLD.status; END IF;
  IF OLD.status IN ('sent', 'attached') THEN
    IF NEW.payee_name IS DISTINCT FROM OLD.payee_name OR NEW.payee_kind IS DISTINCT FROM OLD.payee_kind
       OR NEW.fee_amount IS DISTINCT FROM OLD.fee_amount OR NEW.approved_total IS DISTINCT FROM OLD.approved_total
       OR NEW.check_hash IS DISTINCT FROM OLD.check_hash OR NEW.check_pass IS DISTINCT FROM OLD.check_pass
       OR NEW.signoff1_by IS DISTINCT FROM OLD.signoff1_by OR NEW.signoff2_by IS DISTINCT FROM OLD.signoff2_by
       OR NEW.signoff1_hash IS DISTINCT FROM OLD.signoff1_hash OR NEW.signoff2_hash IS DISTINCT FROM OLD.signoff2_hash
       OR NEW.sent_by IS DISTINCT FROM OLD.sent_by OR NEW.sent_date IS DISTINCT FROM OLD.sent_date
       OR NEW.bank_reference IS DISTINCT FROM OLD.bank_reference THEN
      RAISE EXCEPTION 'WIRE_PACKAGE_LOCKED: a sent wire cannot be changed';
    END IF;
    IF NEW.status = 'reversed' THEN RETURN NEW; END IF;
    IF NEW.status NOT IN ('sent', 'attached') THEN RAISE EXCEPTION 'WIRE_PACKAGE_LOCKED: a sent wire cannot be cancelled — it can only be reversed (with a reason)'; END IF;
    IF OLD.status = 'attached' AND NEW.bank_transaction_id IS DISTINCT FROM OLD.bank_transaction_id THEN
      RAISE EXCEPTION 'WIRE_PACKAGE_LOCKED: the bank line of an attached wire cannot change';
    END IF;
  END IF;
  RETURN NEW;
END $fn$;

SELECT 'vendor_bills.other_reference' AS check_name,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'vendor_bills' AND column_name = 'other_reference') THEN 'OK' ELSE 'MISSING' END AS result
UNION ALL SELECT 'vendor_bills.shipment_direction', CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'vendor_bills' AND column_name = 'shipment_direction') THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'wire_package_overrides', CASE WHEN to_regclass('public.wire_package_overrides') IS NOT NULL THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'wire_packages.reversed_*', CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'wire_packages' AND column_name = 'reverse_note') THEN 'OK' ELSE 'MISSING' END;
