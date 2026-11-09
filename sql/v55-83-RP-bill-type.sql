-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-RP — Max, Nov 9 21:04:
--  "during importing of bill -- Hub should be able to assess if bill is for
--   Trucking or Shipping or Bonded Brokerage fees or supplier bill. The other
--   selection will be for outbound or inbound bills. Outbound will always have
--   a release number so you should be smart enough to automatically check it as
--   outbound. Otherwise leave blank ... Prior to validation there MUST be a
--   selection of the TYPE of bill and the direction of the bill"
-- Safe to re-run. Needs v55-83-RL (shipment_direction) first — included guard.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.vendor_bills ADD COLUMN IF NOT EXISTS shipment_direction text;
ALTER TABLE public.vendor_bills ADD COLUMN IF NOT EXISTS bill_type text;
ALTER TABLE public.vendor_bills ADD COLUMN IF NOT EXISTS bill_type_source text;   -- read_from_bill | vendor_history | manual | validator
ALTER TABLE public.vendor_bills ADD COLUMN IF NOT EXISTS direction_source text;   -- release_number | manual | validator

ALTER TABLE public.vendor_bills DROP CONSTRAINT IF EXISTS vendor_bills_bill_type_check;
ALTER TABLE public.vendor_bills ADD CONSTRAINT vendor_bills_bill_type_check
  CHECK (bill_type IS NULL OR bill_type IN ('trucking', 'shipping', 'bonded_brokerage', 'supplier'));
ALTER TABLE public.vendor_bills DROP CONSTRAINT IF EXISTS vendor_bills_bill_type_source_check;
ALTER TABLE public.vendor_bills ADD CONSTRAINT vendor_bills_bill_type_source_check
  CHECK (bill_type_source IS NULL OR bill_type_source IN ('read_from_bill', 'vendor_history', 'manual', 'validator'));
ALTER TABLE public.vendor_bills DROP CONSTRAINT IF EXISTS vendor_bills_direction_source_check;
ALTER TABLE public.vendor_bills ADD CONSTRAINT vendor_bills_direction_source_check
  CHECK (direction_source IS NULL OR direction_source IN ('release_number', 'manual', 'validator'));

-- Existing bills that already carry a release # and no direction: OUTBOUND (the same rule as on import).
-- Bills already VALIDATED keep whatever they have; nothing else is guessed.
UPDATE public.vendor_bills
   SET shipment_direction = 'outbound', direction_source = 'release_number'
 WHERE shipment_direction IS NULL AND NULLIF(btrim(COALESCE(release_number, '')), '') IS NOT NULL
   AND COALESCE(validation_status, 'pending') <> 'validated' AND record_status = 'active';

-- A validated bill must carry its type and direction (new validations only — older validations are not rewritten).
CREATE OR REPLACE FUNCTION public.vendor_bills_validation_needs_type() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.validation_status = 'validated' AND COALESCE(OLD.validation_status, '') <> 'validated' THEN
    IF NEW.bill_type IS NULL THEN RAISE EXCEPTION 'Pick the bill TYPE before validating it.'; END IF;
    IF NEW.shipment_direction IS NULL THEN RAISE EXCEPTION 'Mark the bill Inbound or Outbound before validating it.'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_vendor_bills_validation_needs_type ON public.vendor_bills;
CREATE TRIGGER trg_vendor_bills_validation_needs_type BEFORE UPDATE OF validation_status ON public.vendor_bills
  FOR EACH ROW EXECUTE FUNCTION public.vendor_bills_validation_needs_type();
