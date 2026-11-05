-- ClickBooks P1/P2: additive, US Accounting only. No legacy-table mutations.
create schema clickbooks_us;
revoke all on schema clickbooks_us from public, anon, authenticated;
alter default privileges in schema clickbooks_us revoke execute on functions from public;

create table clickbooks_us.books (
 id uuid primary key default gen_random_uuid(),
 code text not null unique check(code = 'KTC_US'),
 name text not null,
 wave_business_id text not null unique references public.wave_business_registry(wave_business_id),
 country text not null default 'US' check(country='US'),
 currency text not null default 'USD' check(currency='USD'),
 posting_enabled boolean not null default false,
 locked_through date,
 created_at timestamptz not null default now()
);
create table clickbooks_us.accounts (
 id uuid primary key default gen_random_uuid(),
 book_id uuid not null references clickbooks_us.books(id),
 code text not null,
 name text not null,
 account_type text not null check(account_type in ('asset','liability','equity','income','expense')),
 normal_side text not null check(normal_side in ('debit','credit')),
 is_contra boolean not null default false,
 is_bank_sensitive boolean not null default false,
 is_active boolean not null default true,
 needs_review boolean not null default false,
 currency text not null default 'USD' check(currency='USD'),
 origin text not null check(origin in ('control','wave','manual')),
 unique(book_id,code), unique(book_id,id),
 check(normal_side = case when (account_type in ('asset','expense')) <> is_contra then 'debit' else 'credit' end)
);
create table clickbooks_us.source_account_map (
 book_id uuid not null references clickbooks_us.books(id),
 source_account_id text not null,
 account_id uuid not null,
 source_subtype text,
 mapping_policy text not null check(mapping_policy in ('one_to_one','receivable_control','payable_control','transfer_clearing')),
 reviewed boolean not null default false,
 primary key(book_id,source_account_id),
 foreign key(book_id,account_id) references clickbooks_us.accounts(book_id,id)
);
create table clickbooks_us.journals (
 id uuid primary key default gen_random_uuid(),
 book_id uuid not null references clickbooks_us.books(id),
 entry_date date not null,
 description text not null check(length(description) between 1 and 2000),
 currency text not null default 'USD' check(currency='USD'),
 status text not null default 'draft' check(status in ('draft','posted')),
 source_kind text not null check(source_kind in ('manual','opening_balance','accounting_invoice','accounting_invoice_payment','bank_transaction','reversal')),
 source_id text not null check(length(source_id) between 1 and 200),
 payload_hash text not null,
 reverses_id uuid unique,
 created_by uuid,
 created_at timestamptz not null default now(),
 posted_at timestamptz,
 unique(book_id,source_kind,source_id), unique(book_id,id),
 foreign key(book_id,reverses_id) references clickbooks_us.journals(book_id,id),
 check ((status='posted')=(posted_at is not null)),
 check ((source_kind='reversal')=(reverses_id is not null))
);
create table clickbooks_us.journal_lines (
 journal_id uuid not null,
 book_id uuid not null,
 line_no integer not null check(line_no between 1 and 500),
 account_id uuid not null,
 debit_cents bigint not null default 0,
 credit_cents bigint not null default 0,
 description text,
 primary key(journal_id,line_no),
 foreign key(book_id,journal_id) references clickbooks_us.journals(book_id,id),
 foreign key(book_id,account_id) references clickbooks_us.accounts(book_id,id),
 check(debit_cents between 0 and 999999999999999 and credit_cents between 0 and 999999999999999),
 check((debit_cents>0 and credit_cents=0) or (credit_cents>0 and debit_cents=0))
);
create table clickbooks_us.audit_events (
 id bigint generated always as identity primary key,
 journal_id uuid not null references clickbooks_us.journals(id),
 event text not null check(event in ('posted','reversal_posted')),
 actor_id uuid,
 database_role text not null default current_user,
 recorded_at timestamptz not null default now()
);
create table clickbooks_us.audit_runs (
 id uuid primary key default gen_random_uuid(),
 book_id uuid not null references clickbooks_us.books(id),
 checked_at timestamptz not null default now(),
 findings jsonb not null
);
create index cb_us_journal_date on clickbooks_us.journals(book_id,entry_date);
create index cb_us_line_account on clickbooks_us.journal_lines(book_id,account_id);

create function clickbooks_us.guard_journal() returns trigger language plpgsql security invoker set search_path='' as $$
declare b clickbooks_us.books%rowtype; n bigint; d numeric; c numeric;
begin
 if TG_OP='DELETE' then
   if OLD.status='posted' then raise exception 'CB_IMMUTABLE: posted journal'; end if;
   return OLD;
 end if;
 if TG_OP='UPDATE' and OLD.status='posted' then raise exception 'CB_IMMUTABLE: posted journal'; end if;
 if TG_OP='INSERT' and NEW.status<>'draft' then raise exception 'CB_DRAFT_REQUIRED'; end if;
 if TG_OP='UPDATE' and (NEW.book_id<>OLD.book_id or NEW.id<>OLD.id) then raise exception 'CB_IDENTITY_IMMUTABLE'; end if;
 if NEW.status='posted' then
   select * into strict b from clickbooks_us.books where id=NEW.book_id for update;
   if not b.posting_enabled then raise exception 'CB_POSTING_DISABLED'; end if;
   if b.locked_through is not null and NEW.entry_date<=b.locked_through then raise exception 'CB_PERIOD_LOCKED'; end if;
   select count(*),coalesce(sum(debit_cents),0),coalesce(sum(credit_cents),0) into n,d,c from clickbooks_us.journal_lines where journal_id=NEW.id;
   if n<2 or d=0 or d<>c then raise exception 'CB_UNBALANCED'; end if;
   if exists(select 1 from clickbooks_us.journal_lines l join clickbooks_us.accounts a on a.id=l.account_id where l.journal_id=NEW.id and (not a.is_active or a.needs_review)) then raise exception 'CB_ACCOUNT_REVIEW_REQUIRED'; end if;
 end if;
 return NEW;
end $$;
create trigger cb_us_guard_journal before insert or update or delete on clickbooks_us.journals for each row execute function clickbooks_us.guard_journal();

create function clickbooks_us.guard_line() returns trigger language plpgsql security invoker set search_path='' as $$
declare j uuid; st text;
begin
 if TG_OP='UPDATE' and (NEW.journal_id<>OLD.journal_id or NEW.book_id<>OLD.book_id) then raise exception 'CB_LINE_REPARENT_DENIED'; end if;
 j := case when TG_OP='DELETE' then OLD.journal_id else NEW.journal_id end;
 select status into strict st from clickbooks_us.journals where id=j for update;
 if st<>'draft' then raise exception 'CB_IMMUTABLE: posted journal lines'; end if;
 if TG_OP='DELETE' then return OLD; end if;
 return NEW;
end $$;
create trigger cb_us_guard_line before insert or update or delete on clickbooks_us.journal_lines for each row execute function clickbooks_us.guard_line();

create function clickbooks_us.guard_account() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if TG_OP='DELETE' then return OLD; end if;
 if NEW.book_id<>OLD.book_id or NEW.id<>OLD.id then raise exception 'CB_ACCOUNT_IDENTITY_IMMUTABLE'; end if;
 if (NEW.account_type,NEW.normal_side,NEW.is_contra,NEW.code,NEW.currency,NEW.is_bank_sensitive) is distinct from (OLD.account_type,OLD.normal_side,OLD.is_contra,OLD.code,OLD.currency,OLD.is_bank_sensitive)
 and exists(select 1 from clickbooks_us.journal_lines l join clickbooks_us.journals j on j.id=l.journal_id where l.account_id=OLD.id and j.status='posted') then raise exception 'CB_ACCOUNT_HAS_POSTINGS'; end if;
 return NEW;
end $$;
create trigger cb_us_guard_account before update on clickbooks_us.accounts for each row execute function clickbooks_us.guard_account();
create function clickbooks_us.deny_mutation() returns trigger language plpgsql security invoker set search_path='' as $$ begin raise exception 'CB_APPEND_ONLY'; end $$;
create trigger cb_us_audit_append_only before update or delete on clickbooks_us.audit_events for each row execute function clickbooks_us.deny_mutation();

create function clickbooks_us.post_journal(p_book uuid,p_date date,p_description text,p_source_kind text,p_source_id text,p_lines jsonb,p_actor uuid default null,p_reverses uuid default null) returns uuid
language plpgsql security invoker set search_path='' as $$
declare b clickbooks_us.books%rowtype; prev clickbooks_us.journals%rowtype; orig clickbooks_us.journals%rowtype; jid uuid; h text; x jsonb; i integer:=0; a uuid; d bigint; c bigint; ac clickbooks_us.accounts%rowtype;
begin
 select * into strict b from clickbooks_us.books where id=p_book for update;
 if p_date is null or not isfinite(p_date) then raise exception 'CB_INVALID_DATE'; end if;
 if p_description is null or length(trim(p_description)) not between 1 and 2000 then raise exception 'CB_INVALID_DESCRIPTION'; end if;
 if p_source_kind is null or p_source_kind not in ('manual','opening_balance','accounting_invoice','accounting_invoice_payment','bank_transaction','reversal') or p_source_id is null or length(trim(p_source_id)) not between 1 and 200 then raise exception 'CB_INVALID_SOURCE'; end if;
 if p_lines is null or jsonb_typeof(p_lines)<>'array' then raise exception 'CB_INVALID_LINES'; end if;
 if jsonb_array_length(p_lines) not between 2 and 500 then raise exception 'CB_INVALID_LINE_COUNT'; end if;
 h := md5(jsonb_build_object('date',p_date,'description',p_description,'lines',p_lines,'reverses',p_reverses)::text);
 select * into prev from clickbooks_us.journals where book_id=p_book and source_kind=p_source_kind and source_id=p_source_id;
 if found then
  if prev.payload_hash=h and prev.status='posted' then return prev.id; end if;
  raise exception 'CB_IDEMPOTENCY_CONFLICT';
 end if;
 if not b.posting_enabled then raise exception 'CB_POSTING_DISABLED'; end if;
 if b.locked_through is not null and p_date<=b.locked_through then raise exception 'CB_PERIOD_LOCKED'; end if;
 if (p_source_kind='reversal') <> (p_reverses is not null) then raise exception 'CB_INVALID_REVERSAL'; end if;
 if p_reverses is not null then
   select * into strict orig from clickbooks_us.journals where id=p_reverses and book_id=p_book and status='posted';
   if orig.reverses_id is not null or p_date<orig.entry_date then raise exception 'CB_INVALID_REVERSAL'; end if;
   if exists(select 1 from clickbooks_us.journals where reverses_id=p_reverses) then raise exception 'CB_ALREADY_REVERSED'; end if;
   if jsonb_array_length(p_lines)<>(select count(*) from clickbooks_us.journal_lines where journal_id=p_reverses) then raise exception 'CB_REVERSAL_MISMATCH'; end if;
 end if;
 insert into clickbooks_us.journals(book_id,entry_date,description,source_kind,source_id,payload_hash,created_by,reverses_id) values(p_book,p_date,p_description,p_source_kind,p_source_id,h,p_actor,p_reverses) returning id into jid;
 for x in select value from jsonb_array_elements(p_lines) loop
   i:=i+1;
   if jsonb_typeof(x)<>'object' or coalesce(x->>'debit_cents','') !~ '^[0-9]{1,15}$' or coalesce(x->>'credit_cents','') !~ '^[0-9]{1,15}$' then raise exception 'CB_INTEGER_CENTS_REQUIRED'; end if;
   a:=(x->>'account_id')::uuid; d:=(x->>'debit_cents')::bigint; c:=(x->>'credit_cents')::bigint;
   select * into strict ac from clickbooks_us.accounts where id=a and book_id=p_book for share;
   if not ac.is_active or ac.needs_review then raise exception 'CB_ACCOUNT_REVIEW_REQUIRED'; end if;
   if p_reverses is not null and not exists(select 1 from clickbooks_us.journal_lines where journal_id=p_reverses and line_no=i and account_id=a and debit_cents=c and credit_cents=d) then raise exception 'CB_REVERSAL_MISMATCH'; end if;
   insert into clickbooks_us.journal_lines(journal_id,book_id,line_no,account_id,debit_cents,credit_cents,description) values(jid,p_book,i,a,d,c,left(x->>'description',2000));
 end loop;
 update clickbooks_us.journals set status='posted',posted_at=now() where id=jid;
 insert into clickbooks_us.audit_events(journal_id,event,actor_id) values(jid,case when p_reverses is null then 'posted' else 'reversal_posted' end,p_actor);
 return jid;
end $$;

create function clickbooks_us.reverse_journal(p_journal uuid,p_date date,p_reason text,p_actor uuid default null) returns uuid
language plpgsql security invoker set search_path='' as $$
declare j clickbooks_us.journals%rowtype; ls jsonb;
begin
 select * into strict j from clickbooks_us.journals where id=p_journal and status='posted';
 if p_reason is null or length(trim(p_reason)) not between 1 and 1800 then raise exception 'CB_REVERSAL_REASON_REQUIRED'; end if;
 select jsonb_agg(jsonb_build_object('account_id',account_id,'debit_cents',credit_cents::text,'credit_cents',debit_cents::text) order by line_no) into ls from clickbooks_us.journal_lines where journal_id=p_journal;
 return clickbooks_us.post_journal(j.book_id,p_date,'Reversal: '||p_reason,'reversal',p_journal::text,ls,p_actor,p_journal);
end $$;

create function clickbooks_us.trial_balance(p_book uuid,p_as_of date) returns table(account_code text,account_name text,account_type text,normal_side text,bank_sensitive boolean,debit_cents numeric,credit_cents numeric,net_debit_cents numeric)
language sql stable security invoker set search_path='' as $$
 select a.code,a.name,a.account_type,a.normal_side,a.is_bank_sensitive,
 coalesce(sum(l.debit_cents) filter(where j.id is not null),0),coalesce(sum(l.credit_cents) filter(where j.id is not null),0),coalesce(sum(l.debit_cents-l.credit_cents) filter(where j.id is not null),0)
 from clickbooks_us.accounts a left join clickbooks_us.journal_lines l on l.account_id=a.id and l.book_id=a.book_id
 left join clickbooks_us.journals j on j.id=l.journal_id and j.status='posted' and j.entry_date<=p_as_of
 where a.book_id=p_book group by a.id order by a.code
$$;

alter table clickbooks_us.books enable row level security;
alter table clickbooks_us.accounts enable row level security;
alter table clickbooks_us.source_account_map enable row level security;
alter table clickbooks_us.journals enable row level security;
alter table clickbooks_us.journal_lines enable row level security;
alter table clickbooks_us.audit_events enable row level security;
alter table clickbooks_us.audit_runs enable row level security;
revoke all on all tables in schema clickbooks_us from public,anon,authenticated,service_role;
revoke all on all sequences in schema clickbooks_us from public,anon,authenticated,service_role;
revoke all on all functions in schema clickbooks_us from public,anon,authenticated,service_role;
