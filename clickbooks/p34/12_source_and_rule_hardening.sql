-- Null child company IDs inherit only their already-verified US parent; conflicting IDs stay excluded.
-- Hardening is additive to earlier migration versions and rejects unknown definitions.
do $patch$
declare f text;
begin
 select pg_get_functiondef('clickbooks_us.source_snapshot(date)'::regprocedure) into f;
 if strpos(f,'where l.wave_business_id=src group by l.invoice_id')>0 then
  execute replace(f,'where l.wave_business_id=src group by l.invoice_id','where (l.wave_business_id=src or l.wave_business_id is null) group by l.invoice_id');
 elsif strpos(f,'where (l.wave_business_id=src or l.wave_business_id is null) group by l.invoice_id')=0 then raise exception 'CB_SOURCE_VERSION_MISMATCH'; end if;
 select pg_get_functiondef('clickbooks_us.decide_proposal(uuid,boolean,text,uuid)'::regprocedure) into f;
 if strpos(f,$txt$if p.state=(case when p_accept then 'approved' else 'dismissed' end) then return; end if; if p.state<>'proposed' then$txt$)>0 then
  f:=replace(f,$txt$if p.state=(case when p_accept then 'approved' else 'dismissed' end) then return; end if; if p.state<>'proposed' then$txt$,$txt$if not p_accept and p.state='dismissed' then return; end if; if p.state<>'proposed' and not (p_accept and p.state='approved') then$txt$);
  f:=replace(f,$txt$update clickbooks_us.rule_proposals set state=case when p_accept$txt$, $txt$if p_accept and p.state='approved' then return; end if; update clickbooks_us.rule_proposals set state=case when p_accept$txt$);
  execute f;
 elsif strpos(f,$txt$if not p_accept and p.state='dismissed' then return;$txt$)=0 then raise exception 'CB_RULE_DECISION_VERSION_MISMATCH'; end if;
 select pg_get_functiondef('clickbooks_us.validate_migration(uuid)'::regprocedure) into f;
 f:=replace(f,$txt$src->>'direction' not in ('in','out')$txt$,$txt$coalesce(src->>'direction','') not in ('in','out')$txt$);
 f:=replace(f,$txt$src->>'review' not in ('approved','reviewed')$txt$,$txt$coalesce(src->>'review','') not in ('approved','reviewed')$txt$);
 f:=replace(f,$txt$if src->>'hasPayment'='true' or src->>'linkedId' is not null$txt$, $txt$if coalesce(src->>'classification','') in ('customer_payment','vendor_payment','transfer') or src->>'hasPayment'='true' or src->>'linkedId' is not null$txt$);
 execute f;
end $patch$;
