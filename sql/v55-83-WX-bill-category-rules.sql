CREATE TABLE IF NOT EXISTS public.bill_category_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  vendor_match text NOT NULL,
  amount_exact numeric(14,2),
  amount_min numeric(14,2),
  amount_max numeric(14,2),
  words text,
  currency text NOT NULL DEFAULT 'USD',
  wave_business_id text NOT NULL,
  category text NOT NULL,
  priority integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bill_category_rules_amount_one_way CHECK (amount_exact IS NULL OR (amount_min IS NULL AND amount_max IS NULL)),
  CONSTRAINT bill_category_rules_range_order CHECK (amount_min IS NULL OR amount_max IS NULL OR amount_min <= amount_max),
  CONSTRAINT bill_category_rules_positive CHECK ((amount_exact IS NULL OR amount_exact > 0) AND (amount_min IS NULL OR amount_min > 0) AND (amount_max IS NULL OR amount_max > 0)),
  CONSTRAINT bill_category_rules_currency CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT bill_category_rules_vendor CHECK (length(btrim(vendor_match)) > 0)
);
ALTER TABLE public.bill_category_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bill_category_rules FROM public, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.bill_category_rules TO service_role;

CREATE OR REPLACE FUNCTION public.hub_bill_rule_no_delete() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'HUB_GUARD: A bill rule is never deleted - switch it off instead.';
END $$;
REVOKE ALL ON FUNCTION public.hub_bill_rule_no_delete() FROM public, anon, authenticated;
DROP TRIGGER IF EXISTS hub_bill_rule_no_delete ON public.bill_category_rules;
CREATE TRIGGER hub_bill_rule_no_delete BEFORE DELETE ON public.bill_category_rules FOR EACH ROW EXECUTE FUNCTION public.hub_bill_rule_no_delete();

ALTER TABLE public.vendor_bills ADD COLUMN IF NOT EXISTS category_source text;
ALTER TABLE public.vendor_bills ADD COLUMN IF NOT EXISTS category_rule_id uuid;
ALTER TABLE public.vendor_bills ADD COLUMN IF NOT EXISTS category_rule_version integer;
ALTER TABLE public.vendor_bills DROP CONSTRAINT IF EXISTS vendor_bills_category_source_check;
ALTER TABLE public.vendor_bills ADD CONSTRAINT vendor_bills_category_source_check CHECK (category_source IS NULL OR category_source IN ('manual', 'rule', 'rule_conflict', 'vendor_memory'));

SELECT 'bill rules table' AS check_item, CASE WHEN to_regclass('public.bill_category_rules') IS NOT NULL THEN 'OK' ELSE 'PROBLEM' END AS result
UNION ALL
SELECT 'bills remember where their category came from', CASE WHEN (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'vendor_bills' AND column_name IN ('category_source', 'category_rule_id', 'category_rule_version')) = 3 THEN 'OK' ELSE 'PROBLEM' END
UNION ALL
SELECT 'browser roles cannot read or change rules', CASE WHEN NOT has_table_privilege('anon', 'public.bill_category_rules', 'SELECT') AND NOT has_table_privilege('authenticated', 'public.bill_category_rules', 'SELECT') THEN 'OK' ELSE 'PROBLEM' END
UNION ALL
SELECT 'bills with a category set before rules (kept as they are)', count(*)::text FROM public.vendor_bills WHERE category IS NOT NULL AND category_source IS NULL;
