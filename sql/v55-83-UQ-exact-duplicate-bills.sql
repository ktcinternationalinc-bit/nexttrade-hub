-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-UQ — the exact same bill is never accepted twice (Max, 18 Nov 2026: "the duplicates should be avoided from the
-- beginning by not accepting them if they are the exact same bill")
--   THE EXACT SAME BILL = same vendor (ignoring Inc / Corp / LLC / punctuation / capitals), same bill number (ignoring spaces,
--   dashes, capitals — letters are KEPT: "INV-14481" and "14481" are different numbers), same bill date, same total to the cent,
--   among bills that are active. The Hub server already refuses it; this makes the DATABASE refuse it too, under a lock, so
--   two imports of the same bill at the same moment cannot both get in.
--   Copies that are ALREADY in the Hub are not touched and can still be edited or voided (void the extra ones in 💸 Bills).
-- Changes no data. Safe to run more than once.
-- Run in: Supabase → your project → SQL Editor → New query → paste all of this → Run
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.hub_bill_exact_key(p_vendor text, p_number text, p_date date, p_total numeric) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE v text; n text; w text;
BEGIN
  n := regexp_replace(upper(coalesce(p_number, '')), '[^A-Z0-9]', '', 'g');
  v := upper(coalesce(p_vendor, ''));
  v := replace(v, '&', ' AND ');
  v := regexp_replace(v, '[^A-Z0-9 ]', ' ', 'g');
  v := ' ' || btrim(regexp_replace(v, '\s+', ' ', 'g')) || ' ';
  FOREACH w IN ARRAY ARRAY['INCORPORATED', 'CORPORATION', 'COMPANY', 'LIMITED', 'INC', 'LLC', 'LTD', 'CORP', 'CO', 'LLP', 'LP', 'THE'] LOOP
    v := replace(v, ' ' || w || ' ', ' ');
  END LOOP;
  v := regexp_replace(v, '\s+', '', 'g');
  IF v = '' OR n = '' OR p_date IS NULL THEN RETURN NULL; END IF;
  RETURN v || '|' || n || '|' || p_date::text || '|' || round(coalesce(p_total, 0) * 100)::bigint::text;
END $$;

CREATE OR REPLACE FUNCTION public.hub_bill_exact_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE k text; o record;
BEGIN
  IF NEW.record_status IS NOT NULL AND NEW.record_status <> 'active' THEN RETURN NEW; END IF; -- voiding / deleting is never blocked
  k := public.hub_bill_exact_key(NEW.vendor_name, NEW.bill_number, NEW.bill_date, NEW.total_amount);
  IF k IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND (OLD.record_status IS NULL OR OLD.record_status = 'active')
     AND k IS NOT DISTINCT FROM public.hub_bill_exact_key(OLD.vendor_name, OLD.bill_number, OLD.bill_date, OLD.total_amount) THEN
    RETURN NEW; -- the identifying fields did not change: copies already on file stay editable
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hub-bill-key:' || k, 0));
  SELECT b.id, b.vendor_name, b.bill_number, b.bill_date, b.total_amount INTO o
  FROM public.vendor_bills b
  WHERE b.bill_date = NEW.bill_date AND b.id IS DISTINCT FROM NEW.id AND (b.record_status IS NULL OR b.record_status = 'active')
    AND public.hub_bill_exact_key(b.vendor_name, b.bill_number, b.bill_date, b.total_amount) = k
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'HUB_EXACT_DUPLICATE: This exact bill is already in the Hub — % #% dated % for $%. It was NOT added again.',
      coalesce(o.vendor_name, '?'), coalesce(o.bill_number, '?'), o.bill_date, to_char(round(coalesce(o.total_amount, 0), 2), 'FM999999990.00');
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.hub_bill_exact_guard() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS hub_bill_exact_guard ON public.vendor_bills;
CREATE TRIGGER hub_bill_exact_guard BEFORE INSERT OR UPDATE OF vendor_name, bill_number, bill_date, total_amount, record_status
  ON public.vendor_bills FOR EACH ROW EXECUTE FUNCTION public.hub_bill_exact_guard();

-- CHECK (read-only): the first line must say OK; the second lists exact copies ALREADY in the Hub (void the extra ones in 💸 Bills)
SELECT 'the database refuses the exact same bill twice' AS check_item,
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'hub_bill_exact_guard' AND tgrelid = 'public.vendor_bills'::regclass) THEN 'OK' ELSE 'PROBLEM' END AS result
UNION ALL
SELECT 'exact copies already in the Hub: ' || min(vendor_name) || ' #' || min(bill_number) || ' dated ' || min(bill_date)::text || ' $' || min(total_amount)::text, count(*)::text || ' copies'
FROM public.vendor_bills
WHERE (record_status IS NULL OR record_status = 'active') AND public.hub_bill_exact_key(vendor_name, bill_number, bill_date, total_amount) IS NOT NULL
GROUP BY public.hub_bill_exact_key(vendor_name, bill_number, bill_date, total_amount) HAVING count(*) > 1;
