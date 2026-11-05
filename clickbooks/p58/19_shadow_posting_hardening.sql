-- Reproduction SQL for clickbooks_us_p58_shadow_posting_hardening_v1.
create or replace function clickbooks_us.shadow_sync_preview(p_from date,p_to date) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare b clickbooks_us.books%rowtype; src text; invoice_count int; payment_count int; rule_count int; invoice_block int; payment_block int; rule_block int; begin
 if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_from>p_to or p_to-p_from>400 then raise exception 'CB_SHADOW_PERIOD'; end if;
 select * into strict b from clickbooks_us.books where code='KTC_US'; src:=b.wave_business_id;
 select count(*),count(*) filter(where
   not exists(select 1 from public.accounting_invoice_items li where li.invoice_id=i.id)
   or coalesce(i.total_amount,0)<=0 or coalesce(i.amount_paid,0)<0 or coalesce(i.amount_paid,0)>coalesce(i.total_amount,0)
   or coalesce(i.total_amount,0)<>(select coalesce(sum(li.line_total),0) from public.accounting_invoice_items li where li.invoice_id=i.id)
   or coalesce(i.amount_paid,0)<>(select coalesce(sum(p.amount),0) from public.accounting_invoice_payments p where p.accounting_invoice_id=i.id and p.wave_business_id=src and p.voided is not true)
 ) into invoice_count,invoice_block
 from public.accounting_invoices i where i.wave_business_id=src and i.currency='USD' and i.record_status='active' and i.approval_status='approved' and i.invoice_date between p_from and p_to and not exists(select 1 from clickbooks_us.journals j where j.book_id=b.id and j.source_kind='accounting_invoice' and j.source_id=i.id::text);
 select count(*),count(*) filter(where
   p.bank_transaction_id is null
   or not exists(select 1 from public.bank_transactions t where t.id=p.bank_transaction_id and t.wave_business_id=src and t.pending is false and t.iso_currency='USD' and t.direction='in')
   or not exists(select 1 from clickbooks_us.bank_ledger_map m where m.book_id=b.id and m.provider_account_id=(select t.account_id from public.bank_transactions t where t.id=p.bank_transaction_id) and m.reviewed)
   or (select coalesce(sum(pp.amount),0) from public.accounting_invoice_payments pp where pp.bank_transaction_id=p.bank_transaction_id and pp.wave_business_id=src and pp.voided is not true)
      is distinct from (select t.amount_abs from public.bank_transactions t where t.id=p.bank_transaction_id and t.wave_business_id=src)
   or not (
     exists(select 1 from clickbooks_us.journals j where j.book_id=b.id and j.source_kind='accounting_invoice' and j.source_id=p.accounting_invoice_id::text and j.status='posted')
     or exists(select 1 from clickbooks_us.opening_subledger o join clickbooks_us.migration_runs mr on mr.id=o.run_id and mr.state='committed' where o.book_id=b.id and o.kind='receivable' and o.source_ref=p.accounting_invoice_id::text)
     or exists(select 1 from public.accounting_invoices ii where ii.id=p.accounting_invoice_id and ii.wave_business_id=src and ii.currency='USD' and ii.record_status='active' and ii.approval_status='approved' and ii.invoice_date between p_from and p_to
       and coalesce(ii.total_amount,0)>0 and coalesce(ii.amount_paid,0) between 0 and coalesce(ii.total_amount,0)
       and coalesce(ii.total_amount,0)=(select coalesce(sum(li.line_total),0) from public.accounting_invoice_items li where li.invoice_id=ii.id)
       and coalesce(ii.amount_paid,0)=(select coalesce(sum(pp.amount),0) from public.accounting_invoice_payments pp where pp.accounting_invoice_id=ii.id and pp.wave_business_id=src and pp.voided is not true))
   )
 ) into payment_count,payment_block
 from public.accounting_invoice_payments p join public.accounting_invoices i on i.id=p.accounting_invoice_id and i.wave_business_id=src and i.currency='USD'
 where p.wave_business_id=src and p.voided is not true and p.payment_date between p_from and p_to and not exists(select 1 from clickbooks_us.journals j where j.book_id=b.id and j.source_kind='accounting_invoice_payment' and j.source_id=p.id::text);
 select count(*),count(*) filter(where q.posted_journal_id is null and (r.enabled is false or q.rule_revision<>r.revision)) into rule_count,rule_block
 from clickbooks_us.rule_proposals q join clickbooks_us.rules r on r.id=q.rule_id where q.book_id=b.id and q.state='approved' and q.posted_journal_id is null;
 return jsonb_build_object('scope','KTC_US','from',p_from,'to',p_to,'historyReady',b.historical_data_ready,'openingCutoff',b.opening_cutoff,
  'postingDefaultReady',exists(select 1 from clickbooks_us.posting_defaults d join clickbooks_us.accounts a on a.id=d.invoice_income_account_id and a.book_id=d.book_id where d.book_id=b.id and d.reviewed and a.is_active and not a.needs_review and a.account_type='income'),
  'candidates',jsonb_build_object('invoices',invoice_count,'payments',payment_count,'approvedRuleBankTransactions',rule_count),
  'blocked',jsonb_build_object('invoices',invoice_block,'payments',payment_block,'ruleProposals',rule_block),
  'bankMappingsReviewed',(select count(*) from clickbooks_us.bank_ledger_map where book_id=b.id and reviewed),
  'postsNow',false,'note','Preview only. Exact invoice totals, payment allocations, opening receivable links, reviewed bank mappings and disabled-by-default execution controls are required.');
end $$;

create or replace function clickbooks_us.shadow_sync_run(p_from date,p_to date,p_actor uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare b clickbooks_us.books%rowtype; c clickbooks_us.cutover_control%rowtype; src text; ar uuid; income uuid; i record; p record; q record; bank record; bank_gl uuid; lines jsonb; jid uuid; invoice_posted int:=0; payment_posted int:=0; rules_posted int:=0; skipped int:=0; result jsonb; snapshot text; alloc jsonb; alloc_lines jsonb; n bigint; opening_remaining bigint; prior_paid bigint; begin
 if current_setting('transaction_isolation') not in ('repeatable read','serializable') then raise exception 'CB_REPEATABLE_READ_REQUIRED'; end if;
 if p_actor is null then raise exception 'CB_VERIFIED_ACTOR_REQUIRED'; end if;
 select * into strict b from clickbooks_us.books where code='KTC_US' for update; select * into strict c from clickbooks_us.cutover_control where singleton for update; src:=b.wave_business_id;
 if not b.historical_data_ready or not b.posting_enabled or not c.shadow_sync_enabled or c.phase not in ('parallel','clickbooks_primary') then raise exception 'CB_SHADOW_SYNC_DISABLED'; end if;
 if b.opening_cutoff is null or p_from<=b.opening_cutoff or p_from>p_to or p_to>current_date+1 or p_to-p_from>31 then raise exception 'CB_SHADOW_PERIOD'; end if;
 select id into strict ar from clickbooks_us.accounts where book_id=b.id and code='1100';
 select d.invoice_income_account_id into income from clickbooks_us.posting_defaults d join clickbooks_us.accounts a on a.id=d.invoice_income_account_id and a.book_id=d.book_id where d.book_id=b.id and d.reviewed and a.is_active and not a.needs_review and a.account_type='income';
 if income is null then raise exception 'CB_POSTING_DEFAULT_ACCOUNT'; end if;
 snapshot:=md5(clickbooks_us.source_snapshot(p_to)::text);
 for i in select * from public.accounting_invoices x where x.wave_business_id=src and x.currency='USD' and x.record_status='active' and x.approval_status='approved' and x.invoice_date between p_from and p_to and not exists(select 1 from clickbooks_us.journals j where j.book_id=b.id and j.source_kind='accounting_invoice' and j.source_id=x.id::text) order by x.invoice_date,x.id loop
  if not exists(select 1 from public.accounting_invoice_items li where li.invoice_id=i.id)
   or coalesce(i.total_amount,0)<=0 or coalesce(i.amount_paid,0)<0 or coalesce(i.amount_paid,0)>coalesce(i.total_amount,0)
   or coalesce(i.total_amount,0)<>(select coalesce(sum(li.line_total),0) from public.accounting_invoice_items li where li.invoice_id=i.id)
   or coalesce(i.amount_paid,0)<>(select coalesce(sum(pp.amount),0) from public.accounting_invoice_payments pp where pp.accounting_invoice_id=i.id and pp.wave_business_id=src and pp.voided is not true)
  then skipped:=skipped+1; continue; end if;
  n:=clickbooks_us.money_cents(i.total_amount::text); lines:=jsonb_build_array(jsonb_build_object('account_id',ar,'debit_cents',n::text,'credit_cents','0'),jsonb_build_object('account_id',income,'debit_cents','0','credit_cents',n::text));
  perform clickbooks_us.post_journal(b.id,i.invoice_date,'Invoice '||coalesce(i.invoice_number,i.id::text),'accounting_invoice',i.id::text,lines,p_actor); invoice_posted:=invoice_posted+1;
 end loop;
 for p in select pp.* from public.accounting_invoice_payments pp join public.accounting_invoices ii on ii.id=pp.accounting_invoice_id and ii.wave_business_id=src and ii.currency='USD' where pp.wave_business_id=src and pp.voided is not true and pp.payment_date between p_from and p_to and not exists(select 1 from clickbooks_us.journals j where j.book_id=b.id and j.source_kind='accounting_invoice_payment' and j.source_id=pp.id::text) order by pp.payment_date,pp.id loop
  if not exists(select 1 from clickbooks_us.journals j where j.book_id=b.id and j.source_kind='accounting_invoice' and j.source_id=p.accounting_invoice_id::text and j.status='posted')
     and not exists(select 1 from clickbooks_us.opening_subledger o join clickbooks_us.migration_runs mr on mr.id=o.run_id and mr.state='committed' where o.book_id=b.id and o.kind='receivable' and o.source_ref=p.accounting_invoice_id::text)
  then skipped:=skipped+1; continue; end if;
  select t.* into bank from public.bank_transactions t where t.id=p.bank_transaction_id and t.wave_business_id=src and t.pending is false and t.iso_currency='USD' and t.direction='in'; if not found then skipped:=skipped+1; continue; end if;
  if (select coalesce(sum(pp.amount),0) from public.accounting_invoice_payments pp where pp.bank_transaction_id=bank.id and pp.wave_business_id=src and pp.voided is not true) is distinct from bank.amount_abs then skipped:=skipped+1; continue; end if;
  select m.account_id into bank_gl from clickbooks_us.bank_ledger_map m join clickbooks_us.accounts a on a.id=m.account_id and a.book_id=m.book_id where m.book_id=b.id and m.provider_account_id=bank.account_id and m.reviewed and a.is_active and not a.needs_review and a.is_bank_sensitive; if bank_gl is null then skipped:=skipped+1; continue; end if;
  select o.amount_cents into opening_remaining from clickbooks_us.opening_subledger o join clickbooks_us.migration_runs mr on mr.id=o.run_id and mr.state='committed' where o.book_id=b.id and o.kind='receivable' and o.source_ref=p.accounting_invoice_id::text limit 1;
  if opening_remaining is not null then
    select coalesce(sum(l.credit_cents-l.debit_cents),0)::bigint into prior_paid from clickbooks_us.journals j join clickbooks_us.journal_lines l on l.journal_id=j.id where j.book_id=b.id and j.status='posted' and j.source_kind='accounting_invoice_payment' and l.account_id=ar and j.entry_date>b.opening_cutoff and exists(select 1 from public.accounting_invoice_payments px where px.id::text=j.source_id and px.accounting_invoice_id=p.accounting_invoice_id);
    if prior_paid+clickbooks_us.money_cents(p.amount::text)>opening_remaining then skipped:=skipped+1; continue; end if;
  end if;
  n:=clickbooks_us.money_cents(p.amount::text); lines:=jsonb_build_array(jsonb_build_object('account_id',bank_gl,'debit_cents',n::text,'credit_cents','0'),jsonb_build_object('account_id',ar,'debit_cents','0','credit_cents',n::text));
  perform clickbooks_us.post_journal(b.id,p.payment_date,'Invoice payment '||p.id::text,'accounting_invoice_payment',p.id::text,lines,p_actor); payment_posted:=payment_posted+1;
 end loop;
 for q in select qp.*,r.enabled,r.revision current_revision from clickbooks_us.rule_proposals qp join clickbooks_us.rules r on r.id=qp.rule_id where qp.book_id=b.id and qp.state='approved' and qp.posted_journal_id is null order by qp.created_at,qp.id loop
  if not q.enabled or q.rule_revision<>q.current_revision or q.outcome->>'kind'<>'categorize' then skipped:=skipped+1; continue; end if;
  select t.* into bank from public.bank_transactions t where t.id=q.source_id and t.wave_business_id=src and t.pending is false and t.iso_currency='USD' and t.review_status='unreviewed' and t.classification is null and t.linked_id is null and t.matched_invoice_id is null; if not found or coalesce(bank.posted_date,bank.date) not between p_from and p_to then continue; end if;
  if md5((select value::text from jsonb_array_elements(clickbooks_us.source_snapshot(p_to)->'bank') where value->>'id'=bank.id::text))<>q.source_hash then skipped:=skipped+1; continue; end if;
  select m.account_id into bank_gl from clickbooks_us.bank_ledger_map m join clickbooks_us.accounts a on a.id=m.account_id and a.book_id=m.book_id where m.book_id=b.id and m.provider_account_id=bank.account_id and m.reviewed and a.is_active and not a.needs_review and a.is_bank_sensitive; if bank_gl is null then skipped:=skipped+1; continue; end if;
  n:=clickbooks_us.money_cents(bank.amount_abs::text); alloc_lines:='[]'::jsonb;
  for alloc in select value from jsonb_array_elements(q.outcome->'allocations') loop
   if not exists(select 1 from clickbooks_us.accounts a where a.book_id=b.id and a.id=(alloc->>'accountId')::uuid and a.is_active and not a.needs_review and not a.is_bank_sensitive) then raise exception 'CB_ACCOUNT_REVIEW_REQUIRED'; end if;
   if bank.direction='out' then alloc_lines:=alloc_lines||jsonb_build_array(jsonb_build_object('account_id',alloc->>'accountId','debit_cents',alloc->>'amountCents','credit_cents','0')); else alloc_lines:=alloc_lines||jsonb_build_array(jsonb_build_object('account_id',alloc->>'accountId','debit_cents','0','credit_cents',alloc->>'amountCents')); end if;
  end loop;
  if bank.direction='out' then lines:=jsonb_build_array(jsonb_build_object('account_id',bank_gl,'debit_cents','0','credit_cents',n::text))||alloc_lines; else lines:=jsonb_build_array(jsonb_build_object('account_id',bank_gl,'debit_cents',n::text,'credit_cents','0'))||alloc_lines; end if;
  jid:=clickbooks_us.post_journal(b.id,coalesce(bank.posted_date,bank.date),'Rule-classified bank transaction '||bank.id::text,'bank_transaction',bank.id::text,lines,p_actor); update clickbooks_us.rule_proposals set posted_journal_id=jid where id=q.id; rules_posted:=rules_posted+1;
 end loop;
 result:=jsonb_build_object('from',p_from,'to',p_to,'invoicesPosted',invoice_posted,'paymentsPosted',payment_posted,'ruleBankTransactionsPosted',rules_posted,'skippedForReview',skipped,'sourceFingerprint',snapshot);
 insert into clickbooks_us.shadow_sync_runs(from_date,to_date,source_fingerprint,result,actor_id) values(p_from,p_to,snapshot,result,p_actor);
 insert into clickbooks_us.workflow_events(kind,actor_id,details) values('shadow_sync_completed',p_actor,result); return result;
end $$;
revoke all on function clickbooks_us.shadow_sync_preview(date,date),clickbooks_us.shadow_sync_run(date,date,uuid) from public,anon,authenticated,service_role;
