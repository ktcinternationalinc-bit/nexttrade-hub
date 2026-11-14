-- v55.83-SK — bank reconciliation + month-end close. Run after 14_sj.sql (+ the SK SQL file).
alter table public.bank_transactions add column if not exists pending boolean default false, add column if not exists name text, add column if not exists merchant_name text;
\set A '''00000000-0000-0000-0000-0000000000aa'''
select 'K1 accounts on 2026-10-31: '||(select string_agg((x->>'code')||'='||(x->>'ledger')||' act='||(x->>'has_activity'), ', ' order by x->>'code') from jsonb_array_elements(public.clickbooks_us_recon_overview('2026-10-31')->'accounts') x);
-- the one account with a balance on Oct 31 (the PNC opening balance, 5000.00)
create temp table pnc as select a.id from clickbooks_us.accounts a where a.code like 'B-%' limit 1;
select 'K2 wrong statement: '||public.clickbooks_us_recon_save((select id from pnc), '2026-10-31', 5100, 'first try', :A)::text;
do $$ begin perform public.clickbooks_us_close_period('2026-10-31','00000000-0000-0000-0000-0000000000aa'); raise notice 'K2 FAIL: closed with a difference'; exception when others then raise notice 'K2 close refused: %', SQLERRM; end $$;
select 'K3 right statement: '||public.clickbooks_us_recon_save((select id from pnc), '2026-10-31', 5000, null, :A)::text;
do $$ begin perform public.clickbooks_us_close_period('2026-10-15','00000000-0000-0000-0000-0000000000aa'); raise notice 'K3 FAIL'; exception when others then raise notice 'K3 mid-month refused: %', SQLERRM; end $$;
do $$ begin perform public.clickbooks_us_close_period('2026-11-30','00000000-0000-0000-0000-0000000000aa'); raise notice 'K3 FAIL'; exception when others then raise notice 'K3 month not over refused: %', SQLERRM; end $$;
do $$ declare r jsonb; begin r := public.clickbooks_us_close_period('2026-10-31','00000000-0000-0000-0000-0000000000aa'); raise notice 'K4 closed: %', r; exception when others then raise notice 'K4 close said: %', SQLERRM; end $$;
select 'K4 locked_through='||coalesce((select locked_through::text from clickbooks_us.books where code='KTC_US'),'null');
do $$ begin perform public.clickbooks_us_close_period('2026-10-31','00000000-0000-0000-0000-0000000000aa'); raise notice 'K5 FAIL'; exception when others then raise notice 'K5 already closed refused: %', SQLERRM; end $$;
do $$ declare b uuid; a1 uuid; a2 uuid; begin select id into b from clickbooks_us.books where code='KTC_US'; select id into a1 from clickbooks_us.accounts where code like 'B-%' limit 1; select id into a2 from clickbooks_us.accounts where code='6000';
  perform clickbooks_us.post_journal(b, date '2026-10-31', 'late entry into a closed month', 'manual', 'sk-test-1', jsonb_build_array(jsonb_build_object('account_id', a2, 'debit_cents', 100, 'credit_cents', 0), jsonb_build_object('account_id', a1, 'debit_cents', 0, 'credit_cents', 100)), '00000000-0000-0000-0000-0000000000aa');
  raise notice 'K6 FAIL: posted into a closed month'; exception when others then raise notice 'K6 entry into the closed month refused: %', SQLERRM; end $$;
begin isolation level repeatable read; select 'K7 the 15-minute job still runs after closing: '||(public.clickbooks_us_ledger_extras_job('2026-11-01','2026-11-12',:A) ? 'payables'); commit;
do $$ begin update clickbooks_us.bank_reconciliations set note='x'; raise notice 'K8 FAIL: reconciliation row changed'; exception when others then raise notice 'K8 reconciliation rows are append-only: %', SQLERRM; end $$;
do $$ begin perform public.clickbooks_us_reopen_period(null,'oops','00000000-0000-0000-0000-0000000000aa'); raise notice 'K9 FAIL'; exception when others then raise notice 'K9 reopen needs a reason: %', SQLERRM; end $$;
select 'K9 reopen: '||public.clickbooks_us_reopen_period(null,'accountant found a missing October entry',:A)::text;
select 'K9 locked_through='||coalesce((select locked_through::text from clickbooks_us.books where code='KTC_US'),'null');
-- a bank line not on the books yet shows as the reason for a difference
insert into public.bank_transactions(id,wave_business_id,account_id,review_status,classification,date,amount_abs,direction,name) values ('e5000000-0000-0000-0000-000000000001','WB1','ACC1',null,null,'2026-11-09',42.5,'out','UNREVIEWED COFFEE');
select 'K10 not on the books for the ACC1 ledger account on 2026-11-12: '||(select (x->'not_on_books'->>'count')||' line(s) total '||(x->'not_on_books'->>'total') from jsonb_array_elements(public.clickbooks_us_recon_overview('2026-11-12')->'accounts') x where (x->'not_on_books'->>'count')::int > 0 order by x->>'code' limit 1);
select 'K11 events: '||(select string_agg(kind, ',' order by id) from clickbooks_us.workflow_events where kind in ('bank_reconciliation_saved','period_closed','period_reopened'));
select 'TRIAL BALANCE nets to zero: '||(select sum(debit_cents-credit_cents) from clickbooks_us.journal_lines);
