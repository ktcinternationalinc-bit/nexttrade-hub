-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-PE — BILLS REGISTER: validation, disputes, audit trail
--
-- Max (Nov 6): "a centralized, continuously updated Bills Register... a
-- dedicated validation section showing whether the bill has been verified,
-- who verified it, when, and exactly how... every validation must have
-- supporting documentation. These records will be audited... every disputed
-- bill must have a ticket... I should never have to repeatedly request basic
-- information about what our company owes."
-- SAFE TO RE-RUN.
-- ═══════════════════════════════════════════════════════════════════════════

-- Validation axis (orthogonal to payment status)
ALTER TABLE public.vendor_bills ADD COLUMN IF NOT EXISTS validation_status text NOT NULL DEFAULT 'pending';
ALTER TABLE public.vendor_bills ADD COLUMN IF NOT EXISTS validated_by uuid;
ALTER TABLE public.vendor_bills ADD COLUMN IF NOT EXISTS validated_at timestamptz;
ALTER TABLE public.vendor_bills ADD COLUMN IF NOT EXISTS validation_notes text;
ALTER TABLE public.vendor_bills ADD COLUMN IF NOT EXISTS validation_attachment_path text;
-- Dispute axis (disputed bills are EXCLUDED from payable totals until resolved)
ALTER TABLE public.vendor_bills ADD COLUMN IF NOT EXISTS disputed boolean NOT NULL DEFAULT false;
ALTER TABLE public.vendor_bills ADD COLUMN IF NOT EXISTS dispute_ticket_id uuid;
ALTER TABLE public.vendor_bills ADD COLUMN IF NOT EXISTS dispute_reason text;

-- Append-only audit trail: every validation, dispute, resolution, void —
-- who, when, and the full detail. No UPDATE/DELETE grants exist on it.
CREATE TABLE IF NOT EXISTS public.vendor_bill_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id uuid NOT NULL REFERENCES public.vendor_bills(id),
  kind text NOT NULL,
  actor_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vbe_bill ON public.vendor_bill_events (bill_id, created_at);
ALTER TABLE public.vendor_bill_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vbe_read ON public.vendor_bill_events;
CREATE POLICY vbe_read ON public.vendor_bill_events FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.vendor_bill_events TO authenticated;
GRANT SELECT, INSERT ON public.vendor_bill_events TO service_role;
-- deliberately NO update/delete grants to anyone: the audit trail is append-only.

-- Private storage for bill documents (scans + validation evidence).
-- The shared 'attachments' bucket is PUBLIC; financial documents should not be.
INSERT INTO storage.buckets (id, name, public) VALUES ('bills-private','bills-private', false)
ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS bills_private_read ON storage.objects;
CREATE POLICY bills_private_read ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'bills-private');
DROP POLICY IF EXISTS bills_private_write ON storage.objects;
CREATE POLICY bills_private_write ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'bills-private');

-- VERIFICATION
SELECT '1. validation columns' AS check_name,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vendor_bills' AND column_name='validation_status') THEN '✅' ELSE '❌' END AS result
UNION ALL
SELECT '2. dispute columns',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vendor_bills' AND column_name='dispute_ticket_id') THEN '✅' ELSE '❌' END
UNION ALL
SELECT '3. audit trail table',
       CASE WHEN to_regclass('public.vendor_bill_events') IS NOT NULL THEN '✅' ELSE '❌' END
UNION ALL
SELECT '4. private bills bucket',
       CASE WHEN EXISTS (SELECT 1 FROM storage.buckets WHERE id='bills-private' AND public=false) THEN '✅' ELSE '❌' END;
