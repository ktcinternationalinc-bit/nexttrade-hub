-- P3/P4 additive storage; no legacy source updates, no ledger posting.
-- Apply ONCE through the migration ledger. Requires P1/P2 01-04.
do $$ begin
 if to_regprocedure('clickbooks_us.post_journal(uuid,date,text,text,text,jsonb,uuid,uuid)') is null
 or not exists(select 1 from clickbooks_us.books where code='KTC_US' and currency='USD') then raise exception 'CB_P12_REQUIRED'; end if;
end $$;
create table clickbooks_us.workflow_events (
 id bigint generated always as identity primary key, kind text not null, object_id uuid,
 actor_id uuid, details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create trigger cb_workflow_append_only before update or delete on clickbooks_us.workflow_events for each row execute function clickbooks_us.deny_mutation();
create table clickbooks_us.workflow_settings (
 singleton boolean primary key default true check(singleton), release text not null default 'p34-v1',
 migration_execution_enabled boolean not null default false
);
insert into clickbooks_us.workflow_settings(singleton) values(true);
create table clickbooks_us.operator_grants (
 auth_user_id uuid primary key references auth.users(id), can_manage_rules boolean not null default false,
 can_manage_migration boolean not null default false, granted_by uuid, granted_at timestamptz not null default now()
);
create table clickbooks_us.migration_runs (
 id uuid primary key default gen_random_uuid(), request_key uuid not null unique,
 book_id uuid not null references clickbooks_us.books(id), cutoff date not null,
 strategy text not null check(strategy in ('transaction_batch','opening_balance')),
 state text not null default 'staged' check(state in ('staged','approved','committed','reversed')),
 revision integer not null default 1, snapshot jsonb not null, snapshot_hash text not null,
 plans jsonb not null default '[]', expected_balances jsonb not null default '[]',
 opening_subledger jsonb not null default '[]', evidence text, approval_hash text,
 created_by uuid, approved_by uuid, created_at timestamptz not null default now(),
 approved_at timestamptz, committed_at timestamptz, reversal_date date,
 check(jsonb_typeof(plans)='array' and jsonb_typeof(expected_balances)='array' and jsonb_typeof(opening_subledger)='array')
);
create table clickbooks_us.migration_postings (
 run_id uuid not null references clickbooks_us.migration_runs(id), ordinal integer not null,
 journal_id uuid not null unique references clickbooks_us.journals(id), reversal_id uuid references clickbooks_us.journals(id),
 primary key(run_id,ordinal)
);
create table clickbooks_us.opening_subledger (
 run_id uuid not null references clickbooks_us.migration_runs(id), book_id uuid not null,
 kind text not null check(kind in ('receivable','payable')), source_ref text not null,
 account_id uuid not null, amount_cents bigint not null check(amount_cents>0),
 primary key(book_id,kind,source_ref), foreign key(book_id,account_id) references clickbooks_us.accounts(book_id,id)
);
alter table clickbooks_us.books add column opening_cutoff date;
create table clickbooks_us.rules (
 id uuid primary key default gen_random_uuid(), book_id uuid not null references clickbooks_us.books(id),
 name text not null check(length(trim(name)) between 1 and 120), priority integer not null check(priority between 1 and 10000),
 enabled boolean not null default false, revision integer not null default 1,
 conditions jsonb not null, action jsonb not null, created_by uuid, updated_by uuid,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table clickbooks_us.rule_versions (
 rule_id uuid not null references clickbooks_us.rules(id), revision integer not null,
 definition jsonb not null, actor_id uuid, created_at timestamptz not null default now(), primary key(rule_id,revision)
);
create trigger cb_rule_version_append_only before update or delete on clickbooks_us.rule_versions for each row execute function clickbooks_us.deny_mutation();
create table clickbooks_us.rule_proposals (
 id uuid primary key default gen_random_uuid(), book_id uuid not null references clickbooks_us.books(id),
 source_id uuid not null, source_hash text not null, rule_id uuid not null references clickbooks_us.rules(id),
 rule_revision integer not null, outcome jsonb not null,
 state text not null default 'proposed' check(state in ('proposed','approved','dismissed','superseded')),
 created_by uuid, decided_by uuid, reason text, created_at timestamptz not null default now(), decided_at timestamptz,
 unique(book_id,source_id,source_hash,rule_id,rule_revision)
);
create index cb_migration_created on clickbooks_us.migration_runs(created_at desc);
create index cb_rule_priority on clickbooks_us.rules(book_id,enabled,priority);
create index cb_proposal_source on clickbooks_us.rule_proposals(book_id,source_id,state);
-- No direct-client or service-role DML. Service-only facades are installed separately.
do $$ declare t text; begin
 foreach t in array array['workflow_events','workflow_settings','operator_grants','migration_runs','migration_postings','opening_subledger','rules','rule_versions','rule_proposals'] loop
 execute format('alter table clickbooks_us.%I enable row level security',t);
 execute format('revoke all on table clickbooks_us.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;
revoke all on all sequences in schema clickbooks_us from public,anon,authenticated,service_role;
