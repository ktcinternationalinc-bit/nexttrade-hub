create or replace function public.hub_bank_ledger_posted(p_ids text[])
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select distinct split_part(j.source_id, ':', 1)
    from clickbooks_us.journals j
   where j.source_kind = 'bank_transaction'
     and split_part(j.source_id, ':', 1) = any(p_ids)
$$;
revoke all on function public.hub_bank_ledger_posted(text[]) from public;
revoke all on function public.hub_bank_ledger_posted(text[]) from anon;
revoke all on function public.hub_bank_ledger_posted(text[]) from authenticated;
grant execute on function public.hub_bank_ledger_posted(text[]) to service_role;
select 'hub_bank_ledger_posted installed' as result, count(*) as bank_lines_in_ledger from (select distinct split_part(source_id, ':', 1) from clickbooks_us.journals where source_kind = 'bank_transaction') x;
