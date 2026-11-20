alter table public.pl_name_units add column if not exists keep_unit boolean not null default false;
alter table public.pl_line_costs add column if not exists cost_unit text not null default 'lb';
alter table public.pl_group_costs add column if not exists cost_unit text not null default 'lb';
alter table public.pl_line_costs drop constraint if exists pl_line_costs_cost_unit_chk;
alter table public.pl_line_costs add constraint pl_line_costs_cost_unit_chk check (cost_unit in ('lb', 'sold_unit'));
alter table public.pl_group_costs drop constraint if exists pl_group_costs_cost_unit_chk;
alter table public.pl_group_costs add constraint pl_group_costs_cost_unit_chk check (cost_unit in ('lb', 'sold_unit'));
select 'pl_name_units.keep_unit' as added, count(*) filter (where keep_unit) as switched_on, count(*) as rows_total from public.pl_name_units;
