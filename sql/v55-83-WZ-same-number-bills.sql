CREATE OR REPLACE FUNCTION public.hub_bill_number_key(p_vendor text, p_number text) RETURNS text
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
  IF v = '' OR n = '' THEN RETURN NULL; END IF;
  RETURN v || '|' || n;
END $$;

CREATE OR REPLACE FUNCTION public.hub_bill_exact_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE k text; nk text; o record;
BEGIN
  IF NEW.record_status IS NOT NULL AND NEW.record_status <> 'active' THEN RETURN NEW; END IF;
  IF coalesce(NEW.bill_type, '') ILIKE 'credit%' THEN RETURN NEW; END IF;
  k := public.hub_bill_exact_key(NEW.vendor_name, NEW.bill_number, NEW.bill_date, NEW.total_amount);
  nk := public.hub_bill_number_key(NEW.vendor_name, NEW.bill_number);
  IF k IS NULL AND nk IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND (OLD.record_status IS NULL OR OLD.record_status = 'active')
     AND k IS NOT DISTINCT FROM public.hub_bill_exact_key(OLD.vendor_name, OLD.bill_number, OLD.bill_date, OLD.total_amount)
     AND nk IS NOT DISTINCT FROM public.hub_bill_number_key(OLD.vendor_name, OLD.bill_number)
     AND NEW.wave_business_id IS NOT DISTINCT FROM OLD.wave_business_id
     AND coalesce(OLD.bill_type, '') NOT ILIKE 'credit%' THEN
    RETURN NEW;
  END IF;
  IF k IS NOT NULL THEN
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
  END IF;
  IF nk IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.record_status IS DISTINCT FROM 'active' AND OLD.record_status IS NOT NULL
       OR nk IS DISTINCT FROM public.hub_bill_number_key(OLD.vendor_name, OLD.bill_number) OR NEW.wave_business_id IS DISTINCT FROM OLD.wave_business_id
       OR coalesce(OLD.bill_type, '') ILIKE 'credit%') THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('hub-bill-number:' || coalesce(NEW.wave_business_id, '') || '|' || nk, 0));
    SELECT b.id, b.vendor_name, b.bill_number, b.bill_date, b.total_amount, b.disputed INTO o
    FROM public.vendor_bills b
    WHERE b.id IS DISTINCT FROM NEW.id AND (b.record_status IS NULL OR b.record_status = 'active')
      AND b.wave_business_id IS NOT DISTINCT FROM NEW.wave_business_id
      AND coalesce(b.bill_type, '') NOT ILIKE 'credit%'
      AND public.hub_bill_number_key(b.vendor_name, b.bill_number) = nk
    LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'HUB_EXACT_DUPLICATE: Bill #% from % is already in the Hub (dated %, $%, %). A second bill with the same number from the same vendor is not allowed. It was NOT added again — open that bill and change it there.',
        coalesce(o.bill_number, '?'), coalesce(o.vendor_name, '?'), coalesce(o.bill_date::text, 'no date'), to_char(round(coalesce(o.total_amount, 0), 2), 'FM999999990.00'),
        CASE WHEN o.disputed IS TRUE THEN 'disputed' ELSE 'not disputed' END;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.hub_bill_exact_guard() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS hub_bill_exact_guard ON public.vendor_bills;
CREATE TRIGGER hub_bill_exact_guard BEFORE INSERT OR UPDATE OF vendor_name, bill_number, bill_date, total_amount, record_status, wave_business_id, bill_type
  ON public.vendor_bills FOR EACH ROW EXECUTE FUNCTION public.hub_bill_exact_guard();

SELECT 'the database refuses a second active bill with the same vendor and number' AS check_item,
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'hub_bill_exact_guard' AND tgrelid = 'public.vendor_bills'::regclass) THEN 'OK' ELSE 'PROBLEM' END AS result
UNION ALL
SELECT 'same number already in the Hub: ' || min(vendor_name) || ' #' || min(bill_number), count(*)::text || ' active copies'
FROM public.vendor_bills
WHERE (record_status IS NULL OR record_status = 'active') AND coalesce(bill_type, '') NOT ILIKE 'credit%' AND public.hub_bill_number_key(vendor_name, bill_number) IS NOT NULL
GROUP BY wave_business_id, public.hub_bill_number_key(vendor_name, bill_number) HAVING count(*) > 1;
