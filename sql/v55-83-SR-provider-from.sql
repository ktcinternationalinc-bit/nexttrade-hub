-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-SR — NextTrade is booked like RTM from a set date; older entries stay as booked.
-- Max, Nov 15 2026: "RTM funding line, this is one professional fee line. It should work the same way as the next trade
-- funding line." · "RTM and next trade are going to be considered two separate entities … They are two separate managing
-- companies." · NextTrade follows RTM from now on; older entries stay as booked.
--
-- What it does
--   1. paid_through_parties.provider_from (date). From that date a company's transfers are treated the way a service
--      provider's are: ONE line by its category (professional fees). Before that date nothing changes.
--      Set to 2026-11-15 for RTM Capital and NextTrade Industries, only where it is still empty.
--   2. ClickBooks ledger (only if the ledger is installed): a dated version of the "Due from <related company>" rule.
--      The four ledger functions that used the undated rule are changed IN PLACE to ask it with a date:
--        bank line  → the line's own date          bill payment → the payment's date        bill on the books → the bill's date
--      So an entry dated before provider_from is computed exactly as before (no reversal, no re-post), and an entry dated
--      on or after it is computed as for RTM.
--   3. A bill of that company that is already on the books (accounts payable) and is paid on/after the date is cleared
--      when the transfer's own line reaches the ledger, like any directly paid bill.
--
-- Safe to run more than once. Deletes nothing. Posted journals are never edited: the nightly check reverses and re-posts
-- only entries dated on/after provider_from that were booked the old way.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.paid_through_parties ADD COLUMN IF NOT EXISTS provider_from date;
COMMENT ON COLUMN public.paid_through_parties.provider_from IS 'From this date the company''s transfers are one line by category (like a service provider), broken down underneath into bills / service fee / waiting for bills. Earlier entries keep their treatment.';

UPDATE public.paid_through_parties SET provider_from = DATE '2026-11-15'
 WHERE provider_from IS NULL
   AND trim(regexp_replace(lower(name), '[^a-z0-9]+', ' ', 'g')) IN ('rtm capital', 'nexttrade industries');

DO $sr$
DECLARE
  fn text; def text; old_s text; new_s text; want int; have_old int; have_new int; patched int := 0; already int := 0;
  jobs text[][] := ARRAY[
    ARRAY['clickbooks_us.classified_sync_run(date,date,uuid)', 'clickbooks_us.affiliate_due_account(b.id, t.third_party_payer)', 'clickbooks_us.affiliate_due_account(b.id, t.third_party_payer, coalesce(t.posted_date, t.date))', '1'],
    ARRAY['clickbooks_us.drift_sync_run(uuid)', 'clickbooks_us.affiliate_due_account(b.id, t.third_party_payer)', 'clickbooks_us.affiliate_due_account(b.id, t.third_party_payer, coalesce(t.posted_date, t.date))', '3'],
    ARRAY['clickbooks_us.affbill_lines(uuid,uuid)', 'clickbooks_us.affiliate_due_account(p_book, coalesce(nullif(trim(bl.paid_via), ''''), ''RTM Capital''))', 'clickbooks_us.affiliate_due_account(p_book, coalesce(nullif(trim(bl.paid_via), ''''), ''RTM Capital''), v.paid_date)', '1'],
    ARRAY['clickbooks_us.apbill_lines(uuid,uuid)', 'clickbooks_us.affiliate_due_account(p_book, bl.paid_via)', 'clickbooks_us.affiliate_due_account(p_book, bl.paid_via, bl.bill_date)', '1'],
    ARRAY['clickbooks_us.appay_lines(uuid,uuid)', 'and coalesce(v.method, '''') <> ''rtm'' then booked := true;', 'and (coalesce(v.method, '''') <> ''rtm'' or clickbooks_us.affiliate_due_account(p_book, (select vb0.paid_via from public.vendor_bills vb0 where vb0.id = v.bill_id), v.paid_date) is null) then booked := true;', '1']
  ];
  i int;
BEGIN
  IF to_regnamespace('clickbooks_us') IS NULL OR to_regprocedure('clickbooks_us.affiliate_due_account(uuid,text)') IS NULL THEN
    RAISE NOTICE 'v55.83-SR: the ClickBooks ledger is not installed here — only provider_from was added.';
    RETURN;
  END IF;

  -- the dated rule: NULL (= "not an advance, book it by its category") once the company is treated as a provider
  EXECUTE $f$
    create or replace function clickbooks_us.affiliate_due_account(p_book uuid, p_payer text, p_on date) returns uuid
    language plpgsql security invoker set search_path='' as $body$
    declare k text; pf date;
    begin
      if p_payer is null or trim(p_payer) = '' or to_regclass('public.paid_through_parties') is null then return null; end if;
      k := trim(regexp_replace(lower(p_payer), '[^a-z0-9]+', ' ', 'g'));
      select p.provider_from into pf from public.paid_through_parties p
       where trim(regexp_replace(lower(p.name), '[^a-z0-9]+', ' ', 'g')) = k and p.active
       order by p.sort limit 1;
      if pf is not null and p_on is not null and p_on >= pf then return null; end if;
      return clickbooks_us.affiliate_due_account(p_book, p_payer);
    end $body$
  $f$;
  REVOKE ALL ON FUNCTION clickbooks_us.affiliate_due_account(uuid, text, date) FROM PUBLIC;

  -- change the callers in place (whatever version is live), or stop with nothing changed
  FOR i IN 1 .. array_length(jobs, 1) LOOP
    fn := jobs[i][1]; old_s := jobs[i][2]; new_s := jobs[i][3]; want := jobs[i][4]::int;
    IF to_regprocedure(fn) IS NULL THEN
      IF fn LIKE '%apbill_lines%' OR fn LIKE '%appay_lines%' THEN CONTINUE; END IF;   -- "bills on the books" not installed: nothing to change
      RAISE EXCEPTION 'v55.83-SR: % is missing — nothing was changed. Run the earlier ledger scripts first.', fn;
    END IF;
    def := pg_get_functiondef(to_regprocedure(fn));
    have_old := (length(def) - length(replace(def, old_s, ''))) / length(old_s);
    have_new := (length(def) - length(replace(def, new_s, ''))) / length(new_s);
    IF have_old = want AND have_new = 0 THEN
      EXECUTE replace(def, old_s, new_s);
      patched := patched + 1;
    ELSIF have_old = 0 AND have_new = want THEN
      already := already + 1;
    ELSE
      RAISE EXCEPTION 'v55.83-SR: % does not look as expected (found % old / % new, expected %) — nothing was changed. Send this message to support.', fn, have_old, have_new, want;
    END IF;
  END LOOP;
  RAISE NOTICE 'v55.83-SR: ledger rule dated — % function(s) changed, % already done.', patched, already;
END
$sr$;
