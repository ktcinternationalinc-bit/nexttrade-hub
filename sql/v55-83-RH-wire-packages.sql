-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-RH — Wires are APPROVED BEFORE they are sent (Max, Nov 8 16:04–16:14)
--  "the wire should be set up before a wire is actually sent ...then later
--   when the wire is sent than we attach that whole audit to that wire with
--   the attached bills etc"
--  "wirepreparation is a permissioning. not all of wire will be to one
--   vendor-- BECASUE most of the wires would be going out of RTM..but
--   preparation should be before we send the payment to RTM"
--  "rtm fee is optional ... i like the rtm proof...attach a wire proof that
--   attaches to wires as part of the approgal. nextrade --not necessary but
--   can be only with bills"
--
--  wire_packages        one prepared wire: pay to RTM Capital / NextTrade
--                       Industries (bills only) / a vendor directly; optional
--                       RTM fee; audit + AI + TWO sign-offs bound to a
--                       fingerprint; then SENT (bank confirmation required);
--                       then ATTACHED to the bank line (bills paid then).
--  wire_package_lines   the bills (any number of vendors) and how much of each.
--                       A bill sits in ONE open package at a time (unique index).
--                       RTM proof per bill: paid date, reference, proof file.
--  wire_package_files   proofs: the bank's wire confirmation, RTM's proofs.
--
--  Enforced in the DATABASE (not only the app):
--   • 2nd signer ≠ 1st signer
--   • once SENT, the bills, amounts, payee, fee and signatures cannot change
--     and the package cannot be deleted (only RTM proof fields may be filled)
--   • a bank line attaches to ONE package
--  Read for signed-in users; writes only through the server.
-- SAFE TO RE-RUN.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.wire_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq bigserial,
  payee_kind text NOT NULL CHECK (payee_kind IN ('service_provider', 'affiliate', 'vendor')),
  payee_name text NOT NULL,
  fee_amount numeric NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
  fee_note text,
  memo text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'attached', 'cancelled')),
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  -- the audit (rules + AI) and the two sign-offs, all bound to check_hash
  check_hash text, checked_at timestamptz, checked_by uuid, check_result jsonb, check_pass boolean,
  ai_summary text, ai_ok boolean,
  signoff1_by uuid, signoff1_at timestamptz, signoff1_note text, signoff1_hash text,
  signoff2_by uuid, signoff2_at timestamptz, signoff2_note text, signoff2_hash text,
  -- sent at the bank
  approved_total numeric,
  sent_by uuid, sent_at timestamptz, sent_date date, bank_reference text,
  -- the bank line it became
  bank_transaction_id uuid UNIQUE,
  attached_by uuid, attached_at timestamptz, attach_note text,
  cancelled_by uuid, cancelled_at timestamptz, cancel_note text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wpkg_two_different_people CHECK (signoff2_by IS NULL OR (signoff1_by IS NOT NULL AND signoff2_by <> signoff1_by)),
  CONSTRAINT wpkg_affiliate_bills_only CHECK (payee_kind = 'service_provider' OR fee_amount = 0),
  CONSTRAINT wpkg_sent_complete CHECK (status NOT IN ('sent', 'attached') OR (signoff1_by IS NOT NULL AND signoff2_by IS NOT NULL AND sent_by IS NOT NULL AND approved_total IS NOT NULL)),
  CONSTRAINT wpkg_attached_has_bank CHECK (status <> 'attached' OR bank_transaction_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_wpkg_status ON public.wire_packages (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.wire_package_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.wire_packages(id),
  bill_id uuid NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  is_open boolean NOT NULL DEFAULT true,          -- false once the package is attached or cancelled
  payment_id uuid,                                 -- the vendor_bill_payments row created at attach
  rtm_paid_date date, rtm_reference text, rtm_file_id uuid, rtm_confirmed_by uuid, rtm_confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (package_id, bill_id)
);
-- one bill, one OPEN package (no paying the same bill twice while a wire is in flight)
CREATE UNIQUE INDEX IF NOT EXISTS uq_wpkg_line_open_bill ON public.wire_package_lines (bill_id) WHERE is_open;
CREATE INDEX IF NOT EXISTS idx_wpkg_line_pkg ON public.wire_package_lines (package_id);

CREATE TABLE IF NOT EXISTS public.wire_package_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.wire_packages(id),
  kind text NOT NULL CHECK (kind IN ('bank_confirmation', 'rtm_proof', 'other')),
  path text NOT NULL,
  file_name text,
  uploaded_by uuid, uploaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wpkg_files_pkg ON public.wire_package_files (package_id);

-- ── locks ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wpkg_lock() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'WIRE_PACKAGE_LOCKED: only a draft package can be deleted'; END IF;
    RETURN OLD;
  END IF;
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
    IF NEW.status NOT IN ('sent', 'attached') THEN RAISE EXCEPTION 'WIRE_PACKAGE_LOCKED: a sent wire cannot be cancelled or reopened'; END IF;
    IF OLD.status = 'attached' AND NEW.bank_transaction_id IS DISTINCT FROM OLD.bank_transaction_id THEN
      RAISE EXCEPTION 'WIRE_PACKAGE_LOCKED: the bank line of an attached wire cannot change';
    END IF;
  END IF;
  IF OLD.status = 'cancelled' THEN RAISE EXCEPTION 'WIRE_PACKAGE_LOCKED: a cancelled package cannot change'; END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_wpkg_lock ON public.wire_packages;
CREATE TRIGGER trg_wpkg_lock BEFORE UPDATE OR DELETE ON public.wire_packages FOR EACH ROW EXECUTE FUNCTION public.wpkg_lock();

CREATE OR REPLACE FUNCTION public.wpkg_line_lock() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM public.wire_packages WHERE id = COALESCE(NEW.package_id, OLD.package_id);
  IF TG_OP = 'INSERT' THEN
    IF st <> 'draft' THEN RAISE EXCEPTION 'WIRE_PACKAGE_LOCKED: bills can only be added to a draft package'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF st <> 'draft' THEN RAISE EXCEPTION 'WIRE_PACKAGE_LOCKED: bills cannot be removed from a sent wire'; END IF;
    RETURN OLD;
  END IF;
  IF st <> 'draft' AND (NEW.bill_id IS DISTINCT FROM OLD.bill_id OR NEW.amount IS DISTINCT FROM OLD.amount OR NEW.package_id IS DISTINCT FROM OLD.package_id) THEN
    RAISE EXCEPTION 'WIRE_PACKAGE_LOCKED: the bills and amounts of a sent wire cannot change';
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_wpkg_line_lock ON public.wire_package_lines;
CREATE TRIGGER trg_wpkg_line_lock BEFORE INSERT OR UPDATE OR DELETE ON public.wire_package_lines FOR EACH ROW EXECUTE FUNCTION public.wpkg_line_lock();

-- ── RLS: read for signed-in users, writes only through the server ───────────
DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['wire_packages', 'wire_package_lines', 'wire_package_files'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (false)', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (false)', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (false)', t || '_delete', t);
  END LOOP;
END $rls$;

SELECT 'wire_packages' AS check_name, CASE WHEN to_regclass('public.wire_packages') IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS result
UNION ALL SELECT 'wire_package_lines', CASE WHEN to_regclass('public.wire_package_lines') IS NOT NULL THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'wire_package_files', CASE WHEN to_regclass('public.wire_package_files') IS NOT NULL THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'one open package per bill', CASE WHEN to_regclass('public.uq_wpkg_line_open_bill') IS NOT NULL THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'RG tables present (run RG first)', CASE WHEN to_regclass('public.wire_audits') IS NOT NULL THEN 'OK' ELSE 'MISSING — run v55-83-RG-wires-recon.sql' END;
