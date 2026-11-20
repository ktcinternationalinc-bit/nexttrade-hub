-- WC additive database update: install separately after approval. Requires SO and TU.
-- No business rows are changed by installing this file.
-- An exact Plaid pending reference is required; amount/name similarity is never enough.
begin;
do $$ begin
  if to_regprocedure('public.bank_duplicate_remove(uuid,uuid,uuid,text)') is null
     or to_regprocedure('public.hub_settle_pending(uuid,uuid,text)') is null
     or not exists(select 1 from pg_trigger where tgrelid='public.bank_transactions'::regclass
                   and tgname='bank_duplicate_tombstone_t' and tgenabled <> 'D') then
    raise exception 'Install SO duplicates and TU pending settlement before WC pending identity.';
  end if;
end $$;
create table if not exists public.hub_pending_identity_repairs (
  pending_id uuid primary key,
  posted_id uuid not null unique,
  pending_plaid_id text not null unique,
  posted_plaid_id text not null unique,
  pending_snapshot jsonb not null,
  posted_snapshot jsonb not null,
  repaired_at timestamptz not null default now()
);
alter table public.hub_pending_identity_repairs enable row level security;
revoke all on public.hub_pending_identity_repairs from public, anon, authenticated;

create or replace function public.hub_reconcile_pending(p_pending uuid, p_posted uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  pj jsonb; qj jsonb; result jsonb; prior public.hub_pending_identity_repairs%rowtype;
  col text; lock_through date; d date; hit boolean;
  bank_cols text[] := array['plaid_transaction_id','pending_transaction_id','date','posted_date',
    'authorized_date','amount','amount_abs','direction','iso_currency','name','merchant_name',
    'category','channel','transaction_code','check_number','pending','raw','updated_at'];
begin
  if p_pending is null or p_posted is null or p_pending = p_posted then
    return jsonb_build_object('ok',false,'why','Two distinct pending and posted records are required.');
  end if;
  -- Consistent lock order, also used by repeated repair requests.
  perform id from public.bank_transactions where id in (p_pending,p_posted) order by id for update;
  select to_jsonb(t) into pj from public.bank_transactions t where t.id=p_pending;
  select to_jsonb(t) into qj from public.bank_transactions t where t.id=p_posted;
  select * into prior from public.hub_pending_identity_repairs where pending_id=p_pending;
  if found then
    if prior.posted_id=p_posted and pj->>'plaid_transaction_id'=prior.posted_plaid_id and pj->>'pending'='false' then
      return jsonb_build_object('ok',true,'already',true,'kept_id',p_pending,'links_preserved',true);
    end if;
    return jsonb_build_object('ok',false,'why','This pending identity already has a different repair history.');
  end if;
  if pj is null then
    -- Preserve TU's exact-pair replay check for its ordinary, unlinked settlement.
    return public.hub_settle_pending(p_pending,p_posted,p_reason);
  end if;
  if pj->>'pending' is distinct from 'true' or qj->>'pending' is distinct from 'false'
     or qj->>'review_status'='duplicate' or pj->>'review_status'='duplicate' then
    return jsonb_build_object('ok',false,'why','The records are not an active pending-to-posted pair.');
  end if;
  if nullif(pj->>'plaid_transaction_id','') is null
     or qj->>'pending_transaction_id' is distinct from pj->>'plaid_transaction_id'
     or nullif(qj->>'plaid_transaction_id','') is null
     or nullif(pj->>'account_id','') is null
     or nullif(pj->>'wave_business_id','') is null
     or qj->>'account_id' is distinct from pj->>'account_id'
     or qj->>'wave_business_id' is distinct from pj->>'wave_business_id'
     or qj->>'connection_id' is distinct from pj->>'connection_id' then
    return jsonb_build_object('ok',false,'why','The bank has not confirmed this replacement in the same account and company.');
  end if;
  result := public.hub_settle_pending(p_pending,p_posted,p_reason);
  if coalesce((result->>'ok')::boolean,false) then return result; end if;

  -- TU refuses linked pending lines. Retain that UUID and all its existing payment FKs.
  -- Changed amounts (tips, revised holds) require review instead of changing a paid amount.
  if round(abs(coalesce((pj->>'amount_abs')::numeric,(pj->>'amount')::numeric))*100)
       is distinct from round(abs(coalesce((qj->>'amount_abs')::numeric,(qj->>'amount')::numeric))*100)
     or pj->>'direction' is distinct from qj->>'direction'
     or coalesce(pj->>'iso_currency','USD') is distinct from coalesce(qj->>'iso_currency','USD') then
    return jsonb_build_object('ok',false,'why','The final amount or currency differs; review the existing payment before settling.');
  end if;
  if to_regclass('clickbooks_us.books') is not null then
    execute 'select locked_through from clickbooks_us.books where code=''KTC_US''' into lock_through;
    foreach d in array array[coalesce(nullif(pj->>'posted_date','')::date,(pj->>'date')::date),
                            coalesce(nullif(qj->>'posted_date','')::date,(qj->>'date')::date)] loop
      if lock_through is not null and d<=lock_through then
        return jsonb_build_object('ok',false,'why','A record is inside a closed month. Reopen the month before repairing.');
      end if;
    end loop;
  end if;
  foreach col in array array['classification','third_party_payer','customer_id','notes'] loop
    if nullif(qj->>col,'') is not null and qj->>col is distinct from pj->>col then
      return jsonb_build_object('ok',false,'why','The posted copy has different saved work; review both records first.');
    end if;
  end loop;
  if qj->>'category_verified'='true' or qj->>'review_status' in ('reviewed','matched') then
    return jsonb_build_object('ok',false,'why','The posted copy has already been reviewed; review both records first.');
  end if;
  -- Existing duplicate removal checks invoice/bill payments, splits, credits, wires, links and closed books.
  -- Funding requests are another reference not covered by the older duplicate function.
  if to_regclass('public.wire_packages') is not null then
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='wire_packages' and column_name='funding_txn_id') then
      execute 'select exists(select 1 from public.wire_packages where funding_txn_id=$1)' into hit using p_posted;
      if hit then
        return jsonb_build_object('ok',false,'why','The posted copy funds a request; review both records first.');
      end if;
    end if;
  end if;
  result := public.bank_duplicate_remove(p_posted,p_pending,null,p_reason || ' Posted duplicate archived; existing payment record retained.');
  if coalesce((result->>'ok')::boolean,false) is not true then return result; end if;
  insert into public.hub_pending_identity_repairs(pending_id,posted_id,pending_plaid_id,posted_plaid_id,pending_snapshot,posted_snapshot)
    values(p_pending,p_posted,pj->>'plaid_transaction_id',qj->>'plaid_transaction_id',pj,qj);
  foreach col in array bank_cols loop
    if exists(select 1 from information_schema.columns where table_schema='public' and table_name='bank_transactions' and column_name=col) then
      execute format('update public.bank_transactions set %I=(jsonb_populate_record(null::public.bank_transactions,$1)).%I where id=$2',col,col)
        using qj,p_pending;
    end if;
  end loop;
  return jsonb_build_object('ok',true,'kept_id',p_pending,'links_preserved',true,'carried','[]'::jsonb);
end $$;
revoke all on function public.hub_reconcile_pending(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.hub_reconcile_pending(uuid,uuid,text) to service_role;

-- The archived posted UUID must not suppress future refreshes of its identity on the retained UUID.
-- The old pending identity must never be re-created by a late/repeated provider response.
create or replace function public.bank_duplicate_tombstone() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.hub_pending_identity_repairs r where r.pending_plaid_id=new.plaid_transaction_id) then return null; end if;
  if exists(select 1 from public.bank_transaction_duplicates x where x.status='removed' and x.id=new.id) then return null; end if;
  if exists(select 1 from public.hub_pending_identity_repairs r join public.bank_transactions t on t.id=r.pending_id
            where r.posted_plaid_id=new.plaid_transaction_id and t.plaid_transaction_id=r.posted_plaid_id and t.pending=false) then
    return new;
  end if;
  if exists(select 1 from public.bank_transaction_duplicates x where x.status='removed'
            and x.plaid_transaction_id=new.plaid_transaction_id) then return null; end if;
  return new;
end $$;
commit;
