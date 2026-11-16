-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-SW — A RULE CAN MARK A BANK LINE AS "SENT TO RTM / NEXTTRADE"
-- Max, Nov 16 2026: "need to add in category and rules.. ability to find a description and to also select
--   not only expense but if it is RTM or NEXTRADE flag"
--
-- What it does
--   1. us_expense_rules.third_party_payer (text): the paid-through company a matching money-out line is
--      marked as sent to. Empty = the rule only gives a category, exactly as before.
--   2. A rule may now have NO category when it has a company (NextTrade is an advance, not an expense).
--      Every rule must still do at least one of the two.
--
-- Nothing is removed. Existing rules are unchanged. Safe to run more than once.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.us_expense_rules ADD COLUMN IF NOT EXISTS third_party_payer text;

ALTER TABLE public.us_expense_rules ALTER COLUMN classification DROP NOT NULL;

ALTER TABLE public.us_expense_rules DROP CONSTRAINT IF EXISTS us_expense_rules_what_ck;
ALTER TABLE public.us_expense_rules ADD CONSTRAINT us_expense_rules_what_ck
  CHECK (classification IS NOT NULL OR third_party_payer IS NOT NULL);

-- proof
SELECT column_name, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'us_expense_rules'
   AND column_name IN ('classification', 'third_party_payer')
 ORDER BY column_name;
