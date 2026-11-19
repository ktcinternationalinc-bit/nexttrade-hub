-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-UM — OPTIONAL, only if Max approves: who belongs to which business
-- Since v55.83-UM a person can delete / void invoices only of a business they are a member of (the super admin: all).
-- STEP 1 (read-only — run this first and look at the list): every Hub user and the businesses they belong to.
-- ═══════════════════════════════════════════════════════════════════════════
SELECT u.name, u.email, u.role,
       coalesce(string_agg(b.name, ', '), '— NOT A MEMBER OF ANY BUSINESS —') AS businesses,
       (SELECT count(*) FROM public.businesses)::int AS businesses_in_hub
FROM public.users u
LEFT JOIN public.user_business_memberships m ON m.user_id = u.id
LEFT JOIN public.businesses b ON b.id = m.business_id
GROUP BY u.id, u.name, u.email, u.role
ORDER BY (count(m.business_id) = 0) DESC, u.name;

-- STEP 2 (CHANGES DATA — run ONLY after Max has looked at step 1 and agreed). While the Hub has exactly ONE business, every user
-- with no membership is added to it as 'member'. With two or more businesses it adds nobody. Nobody is removed or changed.
-- To run it: remove the two lines that say /* and */ around the block below, then Run.
/*
DO $$
DECLARE v_n int;
BEGIN
  -- dynamic SQL: these tables may not exist in every database
  IF to_regclass('public.user_business_memberships') IS NOT NULL AND to_regclass('public.businesses') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.businesses' INTO v_n;
    IF v_n = 1 THEN
      EXECUTE 'INSERT INTO public.user_business_memberships (user_id, business_id, role) SELECT u.id, (SELECT id FROM public.businesses LIMIT 1), ''member'' FROM public.users u WHERE NOT EXISTS (SELECT 1 FROM public.user_business_memberships m WHERE m.user_id = u.id) ON CONFLICT DO NOTHING';
    END IF;
  END IF;
END $$;

*/
