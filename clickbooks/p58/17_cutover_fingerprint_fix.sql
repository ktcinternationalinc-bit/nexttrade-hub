create or replace function clickbooks_us.cutover_fingerprint(p_run uuid) returns text
language sql stable security invoker set search_path='' as $$
select md5(jsonb_build_object(
  'snapshot',r.snapshot_hash,
  'current',clickbooks_us.parallel_status(r.from_date,r.to_date),
  'ledger',(select coalesce(jsonb_agg(jsonb_build_object('id',j.id,'hash',j.payload_hash) order by j.id),'[]'::jsonb) from clickbooks_us.journals j where j.status='posted'),
  'control',(select jsonb_build_object('phase',c.phase,'shadowSyncEnabled',c.shadow_sync_enabled) from clickbooks_us.cutover_control c where c.singleton)
)::text)
from clickbooks_us.cutover_runs r where r.id=p_run
$$;
revoke all on function clickbooks_us.cutover_fingerprint(uuid) from public,anon,authenticated,service_role;
