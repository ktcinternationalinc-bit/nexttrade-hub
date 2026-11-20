alter table public.pl_release_part_estimates drop constraint if exists pl_release_part_estimates_part_check;
alter table public.pl_release_part_estimates add constraint pl_release_part_estimates_part_check check (part in ('trucking', 'freight', 'bond', 'other'));
select 'pl_release_part_estimates' as changed, (select count(*) from public.pl_release_part_estimates) as rows_kept, (select pg_get_constraintdef(oid) from pg_constraint where conname = 'pl_release_part_estimates_part_check') as parts_allowed;
