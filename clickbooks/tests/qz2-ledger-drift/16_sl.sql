-- v55.83-SL — journal entries with a second person's approval. Run after 15_sk.sql (+ the SL SQL file).
\set A '''00000000-0000-0000-0000-0000000000aa'''
\set B '''00000000-0000-0000-0000-0000000000bb'''
create temp table ac as select (select id from clickbooks_us.accounts where code='6000') as exp, (select id from clickbooks_us.accounts where code='6100') as exp2,
  (select id from clickbooks_us.accounts where code like 'B-%' limit 1) as bank, (select id from clickbooks_us.accounts where code='1100') as ar;
select 'J0 accounts offered: '||jsonb_array_length(public.clickbooks_us_mj_accounts())||' — bank offered? '||(public.clickbooks_us_mj_accounts() @> jsonb_build_array(jsonb_build_object('code',(select code from clickbooks_us.accounts where id=(select bank from ac)))));
create or replace function mk(d date, descr text, a1 uuid, a2 uuid, deb bigint, cre bigint, who uuid) returns text language plpgsql as $$
begin return public.clickbooks_us_mj_create(d, descr, jsonb_build_array(jsonb_build_object('account_id', a1, 'debit_cents', deb), jsonb_build_object('account_id', a2, 'credit_cents', cre)), who, 'Writer')::text;
exception when others then return 'REFUSED: '||SQLERRM; end $$;
select 'J1 unbalanced: '||mk('2026-11-05','accrue rent',(select exp from ac),(select exp2 from ac),10000,9000,:A);
select 'J2 bank account: '||mk('2026-11-05','move cash',(select exp from ac),(select bank from ac),10000,10000,:A);
select 'J3 receivable control: '||mk('2026-11-05','fix AR',(select ar from ac),(select exp from ac),10000,10000,:A);
select 'J4 future date: '||mk('2099-01-01','accrue rent',(select exp from ac),(select exp2 from ac),10000,10000,:A);
select 'J5 before opening: '||mk('2026-10-31','accrue rent',(select exp from ac),(select exp2 from ac),10000,10000,:A);
select 'J6 no description: '||mk('2026-11-05','x',(select exp from ac),(select exp2 from ac),10000,10000,:A);
select 'J7 good: '||mk('2026-11-05','Reclass November rent from office',(select exp2 from ac),(select exp from ac),10000,10000,:A);
create temp table rq as select id from clickbooks_us.manual_journal_requests order by seq desc limit 1;
select 'J7 nothing in the ledger yet: live mj entries='||(select count(*) from clickbooks_us.journals where source_id like 'mj:%');
do $$ begin perform public.clickbooks_us_mj_decide((select id from rq), true, null, '00000000-0000-0000-0000-0000000000aa', 'Writer'); raise notice 'J8 FAIL: writer approved own entry'; exception when others then raise notice 'J8 writer cannot approve: %', SQLERRM; end $$;
do $$ begin update clickbooks_us.manual_journal_requests set total_cents = 5 where id = (select id from rq); raise notice 'J9 FAIL: edited'; exception when others then raise notice 'J9 a request cannot be edited: %', SQLERRM; end $$;
select 'J10 second person approves: '||public.clickbooks_us_mj_decide((select id from rq), true, 'ok', :B, 'Approver')::text;
select 'J10 in the ledger: 6100 moved by '||(select sum(l.debit_cents-l.credit_cents) from clickbooks_us.journal_lines l join clickbooks_us.journals j on j.id=l.journal_id where j.source_id='mj:'||(select id from rq)::text and l.account_id=(select exp2 from ac))||' cents, description='||(select description from clickbooks_us.journals where source_id='mj:'||(select id from rq)::text);
do $$ begin perform public.clickbooks_us_mj_decide((select id from rq), true, null, '00000000-0000-0000-0000-0000000000bb', 'Approver'); raise notice 'J11 FAIL: approved twice'; exception when others then raise notice 'J11 already decided: %', SQLERRM; end $$;
-- reject needs a reason; cancel only by the writer
select 'J12 second request: '||mk('2026-11-06','Accrue utilities',(select exp from ac),(select exp2 from ac),2500,2500,:A);
create temp table rq2 as select id from clickbooks_us.manual_journal_requests order by seq desc limit 1;
do $$ begin perform public.clickbooks_us_mj_decide((select id from rq2), false, '', '00000000-0000-0000-0000-0000000000bb', 'Approver'); raise notice 'J12 FAIL'; exception when others then raise notice 'J12 reject needs a reason: %', SQLERRM; end $$;
do $$ begin perform public.clickbooks_us_mj_cancel((select id from rq2), '00000000-0000-0000-0000-0000000000bb'); raise notice 'J12 FAIL'; exception when others then raise notice 'J12 only the writer cancels: %', SQLERRM; end $$;
select 'J13 rejected: '||public.clickbooks_us_mj_decide((select id from rq2), false, 'wrong month', :B, 'Approver')::text;
-- closed month: written before the close, approval refused after it
select 'J14 third request: '||mk('2026-11-07','Accrue insurance',(select exp from ac),(select exp2 from ac),700,700,:A);
create temp table rq3 as select id from clickbooks_us.manual_journal_requests order by seq desc limit 1;
update clickbooks_us.books set locked_through = '2026-11-10' where code='KTC_US';
do $$ begin perform public.clickbooks_us_mj_decide((select id from rq3), true, null, '00000000-0000-0000-0000-0000000000bb', 'Approver'); raise notice 'J14 FAIL: approved into a closed month'; exception when others then raise notice 'J14 month closed since it was written → refused: %', SQLERRM; end $$;
update clickbooks_us.books set locked_through = null where code='KTC_US';
-- reversal = a new request with the lines swapped, linked to the first, approved the same way
select 'J15 reversal request: '||public.clickbooks_us_mj_create('2026-11-08','Reverse JE: reclass was wrong', jsonb_build_array(jsonb_build_object('account_id',(select exp from ac),'debit_cents',10000), jsonb_build_object('account_id',(select exp2 from ac),'credit_cents',10000)), :B, 'Approver', (select id from rq))::text;
select 'J15 approve reversal: '||public.clickbooks_us_mj_decide((select id from clickbooks_us.manual_journal_requests order by seq desc limit 1), true, null, :A, 'Writer')::text;
select 'J15 6100 net after reversal='||(select coalesce(sum(l.debit_cents-l.credit_cents),0) from clickbooks_us.journal_lines l join clickbooks_us.journals j on j.id=l.journal_id where j.source_id like 'mj:%' and l.account_id=(select exp2 from ac));
select 'J16 list: '||(select string_agg((x->>'label')||':'||(x->>'status')||coalesce(' rev '||(x->>'reverses'),'')||coalesce(' revBy '||(x->>'reversed_by'),''), ', ') from jsonb_array_elements(public.clickbooks_us_mj_list()) x);
select 'TRIAL BALANCE nets to zero: '||(select sum(debit_cents-credit_cents) from clickbooks_us.journal_lines);
