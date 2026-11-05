alter table clickbooks_us.books add column historical_data_ready boolean not null default false;
create function clickbooks_us.guard_book_binding() returns trigger language plpgsql security invoker set search_path='' as $$ begin
 if (NEW.id,NEW.code,NEW.wave_business_id,NEW.country,NEW.currency) is distinct from (OLD.id,OLD.code,OLD.wave_business_id,OLD.country,OLD.currency) then raise exception 'CB_US_BOOK_BINDING_IMMUTABLE'; end if; return NEW; end $$;
create trigger cb_us_book_binding before update on clickbooks_us.books for each row execute function clickbooks_us.guard_book_binding();
create function clickbooks_us.guard_source_scope() returns trigger language plpgsql security invoker set search_path='' as $$
declare src text; valid boolean:=false;
begin
 if NEW.source_kind in ('manual','opening_balance','reversal') then return NEW; end if;
 select wave_business_id into strict src from clickbooks_us.books where id=NEW.book_id;
 if NEW.source_kind='accounting_invoice' then
 select exists(select 1 from public.accounting_invoices i where i.id::text=NEW.source_id and i.wave_business_id=src and i.currency='USD' and i.record_status='active') into valid;
 elsif NEW.source_kind='accounting_invoice_payment' then
 select exists(select 1 from public.accounting_invoice_payments p join public.accounting_invoices i on i.id=p.accounting_invoice_id where p.id::text=NEW.source_id and p.wave_business_id=src and p.voided is not true and i.wave_business_id=src and i.currency='USD' and i.record_status='active' and (p.bank_transaction_id is null or exists(select 1 from public.bank_transactions t where t.id=p.bank_transaction_id and t.wave_business_id=src and t.pending is false and t.iso_currency='USD'))) into valid;
 elsif NEW.source_kind='bank_transaction' then
 select exists(select 1 from public.bank_transactions t where t.id::text=NEW.source_id and t.wave_business_id=src and t.iso_currency='USD' and t.pending is false) into valid;
 end if;
 if not valid then raise exception 'CB_SOURCE_OUT_OF_SCOPE_OR_NOT_POSTABLE'; end if;
 return NEW;
end $$;
create trigger cb_us_source_scope before insert or update on clickbooks_us.journals for each row execute function clickbooks_us.guard_source_scope();
create function public.clickbooks_us_read(p_with_bank boolean default false) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare b clickbooks_us.books%rowtype; a jsonb; facts jsonb; tb jsonb; has_entries boolean;
begin
 select * into strict b from clickbooks_us.books where code='KTC_US';
 select findings into facts from clickbooks_us.audit_runs where book_id=b.id order by checked_at desc,id desc limit 1;
 select exists(select 1 from clickbooks_us.journals where book_id=b.id and status='posted') into has_entries;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name,'type',account_type,'normalSide',normal_side,'contra',is_contra,'active',is_active,'needsReview',needs_review,'bankSensitive',is_bank_sensitive) order by account_type,name,code),'[]'::jsonb) into a from clickbooks_us.accounts where book_id=b.id and (coalesce(p_with_bank,false) or not is_bank_sensitive);
 if coalesce(p_with_bank,false) and has_entries then
 select jsonb_agg(jsonb_build_object('code',account_code,'name',account_name,'type',account_type,'debitCents',debit_cents::text,'creditCents',credit_cents::text,'netDebitCents',net_debit_cents::text) order by account_code) into tb from clickbooks_us.trial_balance(b.id,current_date);
 end if;
 if facts is not null then
 facts:=facts-'source_digests'-'active_bank_connection_sync';
 if not coalesce(p_with_bank,false) then
 facts:=facts||jsonb_build_object('counts',(facts->'counts')-'bank_rows'-'pending_bank_rows','checks',(facts->'checks')-'duplicate_bank_source_ids'-'payment_missing_us_bank_row'-'unreviewed_bank_rows'-'bank_missing_legacy_business_uuid'-'bank_missing_wave_account_mapping'-'us_scheduled_sync_log_rows');
 end if; end if;
 return jsonb_build_object('book',jsonb_build_object('code',b.code,'name',b.name,'currency',b.currency,'postingEnabled',b.posting_enabled,'historyReady',b.historical_data_ready,'hasPostedEntries',has_entries),'accounts',a,'audit',facts,'trialBalance',tb,'trialBalanceAvailable',coalesce(p_with_bank,false) and has_entries,'bankingIncluded',coalesce(p_with_bank,false),'asOf',current_date);
end $$;
revoke all on function public.clickbooks_us_read(boolean) from public,anon,authenticated;
grant execute on function public.clickbooks_us_read(boolean) to service_role;
revoke all on all functions in schema clickbooks_us from public,anon,authenticated,service_role;
