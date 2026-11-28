begin;

-- Approvals and reopening go through the verified invoice API. Keep ordinary
-- browser draft saves working while the rest of the invoice writer is migrated.
create or replace function public.hub_guard_invoice_approval()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if lower(trim(coalesce(new.approval_status, ''))) = 'approved'
      or new.ready_for_wave is true
      or new.approved_by is not null
      or new.approved_at is not null then
      raise insufficient_privilege using message = 'Invoice approval goes through the Hub.';
    end if;
    return new;
  end if;

  if (new.approval_status is distinct from old.approval_status
      and (lower(trim(coalesce(old.approval_status, ''))) = 'approved'
        or lower(trim(coalesce(new.approval_status, ''))) = 'approved'))
    or (new.ready_for_wave is true and new.ready_for_wave is distinct from old.ready_for_wave)
    or new.approved_by is distinct from old.approved_by
    or new.approved_at is distinct from old.approved_at then
    raise insufficient_privilege using message = 'Invoice approval and reopening go through the Hub.';
  end if;

  return new;
end;
$function$;

drop trigger if exists hub_guard_invoice_approval on public.accounting_invoices;
create trigger hub_guard_invoice_approval
  before insert or update of approval_status, ready_for_wave, approved_by, approved_at
  on public.accounting_invoices
  for each row execute function public.hub_guard_invoice_approval();

commit;
