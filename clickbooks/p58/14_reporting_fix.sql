-- QA correction: period rows must filter journal lines by the period-matched posted journal.
create or replace function clickbooks_us.report_profit_loss(p_from date,p_to date) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare b uuid; rows jsonb; income bigint; expense bigint; begin
 if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_from>p_to or p_to-p_from>3660 then raise exception 'CB_REPORT_PERIOD'; end if;
 select id into strict b from clickbooks_us.books where code='KTC_US';
 with x as (
  select a.id,a.code,a.name,a.account_type,a.is_contra,
    coalesce(sum(l.debit_cents) filter(where j.id is not null),0)::bigint debit,
    coalesce(sum(l.credit_cents) filter(where j.id is not null),0)::bigint credit
  from clickbooks_us.accounts a
  left join clickbooks_us.journal_lines l on l.account_id=a.id and l.book_id=a.book_id
  left join clickbooks_us.journals j on j.id=l.journal_id and j.status='posted' and j.entry_date between p_from and p_to
  where a.book_id=b and a.account_type in ('income','expense') group by a.id
 ), y as (select *,case when account_type='income' then credit-debit else debit-credit end amount from x)
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name,'type',account_type,'amountCents',amount) order by account_type,code),'[]') into rows from y where amount<>0;
 select coalesce(sum(case when a.account_type='income' then l.credit_cents-l.debit_cents else 0 end),0)::bigint,
        coalesce(sum(case when a.account_type='expense' then l.debit_cents-l.credit_cents else 0 end),0)::bigint
 into income,expense from clickbooks_us.journals j join clickbooks_us.journal_lines l on l.journal_id=j.id join clickbooks_us.accounts a on a.id=l.account_id
 where j.book_id=b and j.status='posted' and j.entry_date between p_from and p_to;
 return jsonb_build_object('report','profit_loss','from',p_from,'to',p_to,'currency','USD','rows',rows,'revenueCents',income,'expenseCents',expense,'netIncomeCents',income-expense,'readiness',clickbooks_us.reporting_readiness());
end $$;
revoke all on function clickbooks_us.report_profit_loss(date,date) from public,anon,authenticated,service_role;
