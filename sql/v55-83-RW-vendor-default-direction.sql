-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-RW — Max, Nov 9 23:26: "nexpac bills are always inbounds — default validation to that with option to manually change"
-- The NexPac rule (📏 Price rules → vendors that bill cost + commission) now also says which way its bills go: INBOUND.
-- Imports and the validation panel pre-pick it; a person can still change it. Safe to re-run. Run after RQ.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.bill_commission_rules ADD COLUMN IF NOT EXISTS default_direction text;
ALTER TABLE public.bill_commission_rules DROP CONSTRAINT IF EXISTS bill_commission_rules_default_direction_check;
ALTER TABLE public.bill_commission_rules ADD CONSTRAINT bill_commission_rules_default_direction_check
  CHECK (default_direction IS NULL OR default_direction IN ('inbound', 'outbound'));
UPDATE public.bill_commission_rules SET default_direction = 'inbound' WHERE lower(vendor_match) = 'nexpac' AND default_direction IS NULL;

-- where a pre-picked direction came from: + the vendor's default
ALTER TABLE public.vendor_bills DROP CONSTRAINT IF EXISTS vendor_bills_direction_source_check;
ALTER TABLE public.vendor_bills ADD CONSTRAINT vendor_bills_direction_source_check
  CHECK (direction_source IS NULL OR direction_source IN ('release_number', 'manual', 'validator', 'vendor_default'));

-- open NexPac bills with no direction yet → inbound (validated bills keep what they were validated with)
UPDATE public.vendor_bills vb SET shipment_direction = 'inbound', direction_source = 'vendor_default'
 WHERE vb.shipment_direction IS NULL AND COALESCE(vb.validation_status, 'pending') <> 'validated' AND vb.record_status = 'active'
   AND EXISTS (SELECT 1 FROM public.bill_commission_rules r WHERE r.active AND r.default_direction IS NOT NULL
                 AND position(lower(regexp_replace(r.vendor_match, '[^a-zA-Z0-9]+', '', 'g')) in lower(regexp_replace(vb.vendor_name, '[^a-zA-Z0-9]+', '', 'g'))) > 0);
