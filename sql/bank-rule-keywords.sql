begin;

alter table public.company_rules
  add column if not exists match_mode text not null default 'phrase'
  check (match_mode in ('phrase', 'any_keyword', 'all_keywords'));
alter table public.us_expense_rules
  add column if not exists match_mode text not null default 'phrase'
  check (match_mode in ('phrase', 'any_keyword', 'all_keywords'));

create unique index if not exists company_rules_one_per_match
  on public.company_rules (company_id, lower(match_text), direction, match_mode);
create unique index if not exists us_expense_rules_one_per_match
  on public.us_expense_rules (lower(match_text), match_mode);

drop index if exists public.company_rules_one_per_text;
drop index if exists public.us_expense_rules_match_uq;

notify pgrst, 'reload schema';

commit;
