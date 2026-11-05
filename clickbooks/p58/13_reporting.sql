-- ClickBooks US P5: financial and tax reporting foundation. Private US ledger only.
create table clickbooks_us.account_reporting_settings (
  book_id uuid not null references clickbooks_us.books(id),
  account_id uuid not null,
  cash_flow_class text not null default 'unclassified' check (cash_flow_class in ('operating','investing','financing','noncash','unclassified')),
  tax_category text,
  tax_form_line text,
  deductibility text not null default 'review' check (deductibility in ('review','deductible','nondeductible','mixed')),
  notes text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (book_id, account_id),
  foreign key (book_id, account_id) references clickbooks_us.accounts(book_id,id),
  check (tax_category is null or length(btrim(tax_category)) between 1 and 120),
  check (tax_form_line is null or length(btrim(tax_form_line)) between 1 and 120),
  check (notes is null or length(notes) <= 2000)
);
insert into clickbooks_us.account_reporting_settings(book_id,account_id)
select book_id,id from clickbooks_us.accounts on conflict do nothing;
alter table clickbooks_us.account_reporting_settings enable row level security;
revoke all on table clickbooks_us.account_reporting_settings from public,anon,authenticated,service_role;

create function clickbooks_us.reporting_readiness() returns jsonb
language sql stable security invoker set search_path='' as $$
with b as (select * from clickbooks_us.books where code='KTC_US'),
active as (
 select a.*,s.tax_category,s.tax_form_line,s.deductibility,s.cash_flow_class,s.reviewed_at
 from clickbooks_us.accounts a left join clickbooks_us.account_reporting_settings s on s.book_id=a.book_id and s.account_id=a.id
 where a.book_id=(select id from b) and a.is_active
), used as (
 select distinct l.account_id from clickbooks_us.journal_lines l join clickbooks_us.journals j on j.id=l.journal_id
 where j.book_id=(select id from b) and j.status='posted'
)
select jsonb_build_object(
 'scope','KTC_US','currency','USD','historyReady',(select historical_data_ready from b),
 'postingEnabled',(select posting_enabled from b),'openingCutoff',(select opening_cutoff from b),
 'postedJournals',(select count(*) from clickbooks_us.journals where book_id=(select id from b) and status='posted'),
 'accountsNeedingReview',(select count(*) from active where needs_review),
 'usedTaxAccountsUnmapped',(select count(*) from active a join used u on u.account_id=a.id where a.account_type in ('income','expense') and (a.tax_category is null or a.deductibility='review')),
 'usedCashFlowAccountsUnmapped',(select count(*) from active a join used u on u.account_id=a.id where a.cash_flow_class='unclassified' and a.account_type not in ('income','expense')),
 'filingReady',((select historical_data_ready from b) and not exists(select 1 from active a join used u on u.account_id=a.id where a.account_type in ('income','expense') and (a.tax_category is null or a.deductibility='review'))),
 'warning',case when not (select historical_data_ready from b) then 'Historical books are not certified complete. Reports are preview-only.' else 'Financial statements are ledger-derived; tax output still depends on reviewed tax mappings.' end
)
$$;

create function clickbooks_us.report_profit_loss(p_from date,p_to date) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare b uuid; rows jsonb; income bigint; expense bigint; begin
 if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_from>p_to or p_to-p_from>3660 then raise exception 'CB_REPORT_PERIOD'; end if;
 select id into strict b from clickbooks_us.books where code='KTC_US';
 with x as (
  select a.id,a.code,a.name,a.account_type,a.is_contra,
    coalesce(sum(l.debit_cents),0)::bigint debit,coalesce(sum(l.credit_cents),0)::bigint credit
  from clickbooks_us.accounts a left join clickbooks_us.journal_lines l on l.account_id=a.id and l.book_id=a.book_id
  left join clickbooks_us.journals j on j.id=l.journal_id and j.status='posted' and j.entry_date between p_from and p_to
  where a.book_id=b and a.account_type in ('income','expense') group by a.id
 ), y as (
  select *,case when account_type='income' then credit-debit else debit-credit end amount from x
 )
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name,'type',account_type,'amountCents',amount) order by account_type,code),'[]') into rows from y where amount<>0;
 select coalesce(sum(case when a.account_type='income' then l.credit_cents-l.debit_cents else 0 end),0)::bigint,
        coalesce(sum(case when a.account_type='expense' then l.debit_cents-l.credit_cents else 0 end),0)::bigint
 into income,expense
 from clickbooks_us.journals j join clickbooks_us.journal_lines l on l.journal_id=j.id join clickbooks_us.accounts a on a.id=l.account_id
 where j.book_id=b and j.status='posted' and j.entry_date between p_from and p_to;
 return jsonb_build_object('report','profit_loss','from',p_from,'to',p_to,'currency','USD','rows',rows,'revenueCents',income,'expenseCents',expense,'netIncomeCents',income-expense,'readiness',clickbooks_us.reporting_readiness());
end $$;

create function clickbooks_us.report_balance_sheet(p_as_of date,p_with_bank boolean) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare b uuid; rows jsonb; assets bigint; liabilities bigint; equity bigint; earnings bigint; hidden int; begin
 if p_as_of is null or not isfinite(p_as_of) then raise exception 'CB_REPORT_PERIOD'; end if; select id into strict b from clickbooks_us.books where code='KTC_US';
 with x as (
  select a.id,a.code,a.name,a.account_type,a.is_bank_sensitive,
   coalesce(sum(l.debit_cents-l.credit_cents) filter(where j.id is not null),0)::bigint net_debit
  from clickbooks_us.accounts a left join clickbooks_us.journal_lines l on l.account_id=a.id and l.book_id=a.book_id
  left join clickbooks_us.journals j on j.id=l.journal_id and j.status='posted' and j.entry_date<=p_as_of
  where a.book_id=b group by a.id
 ), z as (
  select *,case when account_type='asset' then net_debit when account_type in ('liability','equity') then -net_debit else 0 end amount
  from x where account_type in ('asset','liability','equity')
 )
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name,'type',account_type,'amountCents',amount,'bankSensitive',is_bank_sensitive) order by account_type,code) filter(where amount<>0 and (p_with_bank or not is_bank_sensitive)),'[]'),
        coalesce(sum(amount) filter(where account_type='asset'),0)::bigint,
        coalesce(sum(amount) filter(where account_type='liability'),0)::bigint,
        coalesce(sum(amount) filter(where account_type='equity'),0)::bigint,
        count(*) filter(where amount<>0 and is_bank_sensitive)
 into rows,assets,liabilities,equity,hidden from z;
 select coalesce(sum(case when a.account_type='income' then l.credit_cents-l.debit_cents when a.account_type='expense' then -(l.debit_cents-l.credit_cents) else 0 end),0)::bigint into earnings
 from clickbooks_us.journals j join clickbooks_us.journal_lines l on l.journal_id=j.id join clickbooks_us.accounts a on a.id=l.account_id where j.book_id=b and j.status='posted' and j.entry_date<=p_as_of;
 return jsonb_build_object('report','balance_sheet','asOf',p_as_of,'currency','USD','rows',rows,'bankingIncluded',p_with_bank,'hiddenBankAccountCount',case when p_with_bank then 0 else hidden end,
  'totals',case when p_with_bank then jsonb_build_object('assetsCents',assets,'liabilitiesCents',liabilities,'equityCents',equity,'currentEarningsCents',earnings,'liabilitiesAndEquityCents',liabilities+equity+earnings,'differenceCents',assets-(liabilities+equity+earnings)) else null end,
  'readiness',clickbooks_us.reporting_readiness());
end $$;

create function clickbooks_us.report_trial_balance(p_as_of date,p_with_bank boolean) returns jsonb
language plpgsql stable security invoker set search_path='' as $$ declare b uuid; rows jsonb; begin
 if not p_with_bank then raise exception 'CB_BANK_PERMISSION_REQUIRED'; end if; if p_as_of is null or not isfinite(p_as_of) then raise exception 'CB_REPORT_PERIOD'; end if;
 select id into strict b from clickbooks_us.books where code='KTC_US';
 select coalesce(jsonb_agg(jsonb_build_object('code',account_code,'name',account_name,'type',account_type,'debitCents',debit_cents,'creditCents',credit_cents,'netDebitCents',net_debit_cents,'bankSensitive',bank_sensitive) order by account_code),'[]') into rows from clickbooks_us.trial_balance(b,p_as_of);
 return jsonb_build_object('report','trial_balance','asOf',p_as_of,'currency','USD','rows',rows,'readiness',clickbooks_us.reporting_readiness()); end $$;

create function clickbooks_us.report_general_ledger(p_from date,p_to date,p_with_bank boolean) returns jsonb
language plpgsql stable security invoker set search_path='' as $$ declare b uuid; rows jsonb; n int; begin
 if not p_with_bank then raise exception 'CB_BANK_PERMISSION_REQUIRED'; end if; if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_from>p_to or p_to-p_from>3660 then raise exception 'CB_REPORT_PERIOD'; end if;
 select id into strict b from clickbooks_us.books where code='KTC_US';
 select count(*) into n from clickbooks_us.journals j join clickbooks_us.journal_lines l on l.journal_id=j.id where j.book_id=b and j.status='posted' and j.entry_date between p_from and p_to;
 if n>10000 then raise exception 'CB_REPORT_TOO_LARGE'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('journalId',j.id,'date',j.entry_date,'description',j.description,'sourceKind',j.source_kind,'sourceId',j.source_id,'accountId',a.id,'accountCode',a.code,'accountName',a.name,'debitCents',l.debit_cents,'creditCents',l.credit_cents,'lineDescription',l.description) order by j.entry_date,j.id,l.line_no),'[]') into rows
 from clickbooks_us.journals j join clickbooks_us.journal_lines l on l.journal_id=j.id join clickbooks_us.accounts a on a.id=l.account_id where j.book_id=b and j.status='posted' and j.entry_date between p_from and p_to;
 return jsonb_build_object('report','general_ledger','from',p_from,'to',p_to,'currency','USD','rows',rows,'rowCount',n,'readiness',clickbooks_us.reporting_readiness()); end $$;

create function clickbooks_us.report_tax_summary(p_from date,p_to date) returns jsonb
language plpgsql stable security invoker set search_path='' as $$ declare b uuid; rows jsonb; unmapped int; begin
 if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_from>p_to or p_to-p_from>3660 then raise exception 'CB_REPORT_PERIOD'; end if; select id into strict b from clickbooks_us.books where code='KTC_US';
 with x as (
  select a.id,a.code,a.name,a.account_type,s.tax_category,s.tax_form_line,s.deductibility,s.reviewed_at,
   case when a.account_type='income' then coalesce(sum(l.credit_cents-l.debit_cents),0) else coalesce(sum(l.debit_cents-l.credit_cents),0) end::bigint amount
  from clickbooks_us.accounts a left join clickbooks_us.account_reporting_settings s on s.book_id=a.book_id and s.account_id=a.id
  left join clickbooks_us.journal_lines l on l.account_id=a.id left join clickbooks_us.journals j on j.id=l.journal_id and j.status='posted' and j.entry_date between p_from and p_to
  where a.book_id=b and a.account_type in ('income','expense') group by a.id,s.tax_category,s.tax_form_line,s.deductibility,s.reviewed_at
 )
 select coalesce(jsonb_agg(jsonb_build_object('accountId',id,'code',code,'name',name,'type',account_type,'taxCategory',tax_category,'taxFormLine',tax_form_line,'deductibility',deductibility,'reviewed',reviewed_at is not null,'amountCents',amount) order by account_type,coalesce(tax_category,'~'),code) filter(where amount<>0),'[]'),
 count(*) filter(where amount<>0 and (tax_category is null or deductibility='review')) into rows,unmapped from x;
 return jsonb_build_object('report','tax_summary','from',p_from,'to',p_to,'currency','USD','rows',rows,'unmappedActiveAccounts',unmapped,'filingReady',(clickbooks_us.reporting_readiness()->>'filingReady')::boolean and unmapped=0,
 'disclaimer','Tax categories are reviewed bookkeeping classifications, not a filed return or tax advice.','readiness',clickbooks_us.reporting_readiness()); end $$;

create function clickbooks_us.report_cash_flow(p_from date,p_to date,p_with_bank boolean) returns jsonb
language plpgsql stable security invoker set search_path='' as $$ declare b uuid; rows jsonb; begin
 if not p_with_bank then raise exception 'CB_BANK_PERMISSION_REQUIRED'; end if; if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_from>p_to or p_to-p_from>3660 then raise exception 'CB_REPORT_PERIOD'; end if; select id into strict b from clickbooks_us.books where code='KTC_US';
 with cash_j as (
  select distinct j.id,j.entry_date from clickbooks_us.journals j join clickbooks_us.journal_lines l on l.journal_id=j.id join clickbooks_us.accounts a on a.id=l.account_id
  where j.book_id=b and j.status='posted' and j.entry_date between p_from and p_to and a.account_type='asset' and a.is_bank_sensitive
 ), counterpart as (
  select coalesce(s.cash_flow_class,'unclassified') class,sum(case when a.account_type='asset' and a.is_bank_sensitive then 0 else l.credit_cents-l.debit_cents end)::bigint amount
  from cash_j cj join clickbooks_us.journal_lines l on l.journal_id=cj.id join clickbooks_us.accounts a on a.id=l.account_id left join clickbooks_us.account_reporting_settings s on s.book_id=a.book_id and s.account_id=a.id group by 1
 ) select coalesce(jsonb_agg(jsonb_build_object('class',class,'netCashCents',amount) order by class),'[]') into rows from counterpart where amount<>0;
 return jsonb_build_object('report','cash_flow','method','direct-counterparty-classification','from',p_from,'to',p_to,'currency','USD','rows',rows,'readiness',clickbooks_us.reporting_readiness()); end $$;

create function clickbooks_us.report_bank_reconciliation(p_as_of date,p_with_bank boolean) returns jsonb
language plpgsql stable security invoker set search_path='' as $$ declare b clickbooks_us.books%rowtype; rows jsonb; begin
 if not p_with_bank then raise exception 'CB_BANK_PERMISSION_REQUIRED'; end if; if p_as_of is null or not isfinite(p_as_of) then raise exception 'CB_REPORT_PERIOD'; end if; select * into strict b from clickbooks_us.books where code='KTC_US';
 with src as (
  select t.account_id provider_account_id,coalesce(sum(case when t.pending then 0 when t.direction='in' then t.amount_abs else -t.amount_abs end),0) movement
  from public.bank_transactions t where t.wave_business_id=b.wave_business_id and coalesce(t.posted_date,t.date)<=p_as_of group by t.account_id
 ), mapped as (
  select m.provider_account_id,m.account_id,a.code,a.name,m.reviewed,p.name provider_name,p.mask,p.current_balance,p.available_balance
  from clickbooks_us.bank_ledger_map m join clickbooks_us.accounts a on a.id=m.account_id and a.book_id=m.book_id left join public.plaid_accounts p on p.plaid_account_id=m.provider_account_id where m.book_id=b.id
 ), ledger as (
  select a.id,coalesce(sum(l.debit_cents-l.credit_cents) filter(where j.id is not null),0)::bigint net
  from clickbooks_us.accounts a left join clickbooks_us.journal_lines l on l.account_id=a.id left join clickbooks_us.journals j on j.id=l.journal_id and j.status='posted' and j.entry_date<=p_as_of where a.book_id=b.id group by a.id
 )
 select coalesce(jsonb_agg(jsonb_build_object('providerAccountId',m.provider_account_id,'providerName',m.provider_name,'mask',m.mask,'ledgerAccountId',m.account_id,'ledgerCode',m.code,'ledgerName',m.name,'reviewed',m.reviewed,'sourceNetMovementDollars',coalesce(s.movement,0),'ledgerBalanceCents',coalesce(l.net,0),'currentBalance',m.current_balance,'availableBalance',m.available_balance) order by m.code),'[]') into rows
 from mapped m left join src s on s.provider_account_id=m.provider_account_id left join ledger l on l.id=m.account_id;
 return jsonb_build_object('report','bank_reconciliation','asOf',p_as_of,'currency','USD','rows',rows,'note','Source net movement is not an opening balance. Reconcile each mapped account to independent bank statements before close.','readiness',clickbooks_us.reporting_readiness()); end $$;

create function public.clickbooks_us_report_read(p_report text,p_from date,p_to date,p_with_bank boolean default false) returns jsonb
language plpgsql stable security definer set search_path='' as $$ begin
 case p_report
  when 'readiness' then return clickbooks_us.reporting_readiness();
  when 'profit_loss' then return clickbooks_us.report_profit_loss(p_from,p_to);
  when 'balance_sheet' then return clickbooks_us.report_balance_sheet(p_to,p_with_bank);
  when 'trial_balance' then return clickbooks_us.report_trial_balance(p_to,p_with_bank);
  when 'general_ledger' then return clickbooks_us.report_general_ledger(p_from,p_to,p_with_bank);
  when 'tax_summary' then return clickbooks_us.report_tax_summary(p_from,p_to);
  when 'cash_flow' then return clickbooks_us.report_cash_flow(p_from,p_to,p_with_bank);
  when 'bank_reconciliation' then return clickbooks_us.report_bank_reconciliation(p_to,p_with_bank);
  else raise exception 'CB_UNKNOWN_REPORT'; end case;
end $$;

create function public.clickbooks_us_reporting_setting_set(p_account uuid,p_cash_flow_class text,p_tax_category text,p_tax_form_line text,p_deductibility text,p_notes text,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$ declare b uuid; a clickbooks_us.accounts%rowtype; begin
 if p_actor is null then raise exception 'CB_VERIFIED_ACTOR_REQUIRED'; end if; select id into strict b from clickbooks_us.books where code='KTC_US'; select * into strict a from clickbooks_us.accounts where book_id=b and id=p_account;
 if p_cash_flow_class not in ('operating','investing','financing','noncash','unclassified') or p_deductibility not in ('review','deductible','nondeductible','mixed') then raise exception 'CB_REPORTING_SETTING'; end if;
 if a.account_type not in ('income','expense') and (nullif(btrim(p_tax_category),'') is not null or nullif(btrim(p_tax_form_line),'') is not null or p_deductibility<>'review') then raise exception 'CB_TAX_MAPPING_ACCOUNT_TYPE'; end if;
 insert into clickbooks_us.account_reporting_settings(book_id,account_id,cash_flow_class,tax_category,tax_form_line,deductibility,notes,reviewed_by,reviewed_at,updated_at)
 values(b,p_account,p_cash_flow_class,nullif(btrim(p_tax_category),''),nullif(btrim(p_tax_form_line),''),p_deductibility,nullif(btrim(p_notes),''),p_actor,now(),now())
 on conflict(book_id,account_id) do update set cash_flow_class=excluded.cash_flow_class,tax_category=excluded.tax_category,tax_form_line=excluded.tax_form_line,deductibility=excluded.deductibility,notes=excluded.notes,reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at,updated_at=excluded.updated_at;
 insert into clickbooks_us.workflow_events(kind,object_id,actor_id,details) values('reporting_setting_saved',p_account,p_actor,jsonb_build_object('cashFlowClass',p_cash_flow_class,'taxCategory',nullif(btrim(p_tax_category),''),'taxFormLine',nullif(btrim(p_tax_form_line),''),'deductibility',p_deductibility));
 return jsonb_build_object('saved',true,'accountId',p_account); end $$;

revoke all on all functions in schema clickbooks_us from public,anon,authenticated,service_role;
revoke all on function public.clickbooks_us_report_read(text,date,date,boolean),public.clickbooks_us_reporting_setting_set(uuid,text,text,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.clickbooks_us_report_read(text,date,date,boolean),public.clickbooks_us_reporting_setting_set(uuid,text,text,text,text,text,uuid) to service_role;
