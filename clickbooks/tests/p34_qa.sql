-- Rollback-only acceptance test. Real US source tables are read, never modified.
begin isolation level repeatable read;
do $$
declare b uuid; src text; actor uuid:=gen_random_uuid(); qa_bank uuid; qa_equity uuid; qa_expense uuid; qa_expense2 uuid;
 tests jsonb:='[]'; before_source jsonb; r uuid; r2 uuid; key uuid:=gen_random_uuid(); def jsonb; def2 jsonb; t jsonb; v jsonb; rule_id uuid; rule2 uuid; proposal_id uuid; plans jsonb; balances jsonb; ah text; n bigint; ex record; rev int; original_name text;
begin
select id,wave_business_id into strict b,src from clickbooks_us.books where code='KTC_US';
if exists(select 1 from clickbooks_us.journals) then raise exception 'QA_REQUIRES_EMPTY_STAGING_LEDGER'; end if;
before_source:=clickbooks_us.audit_source()->'source_digests';
if (select posting_enabled from clickbooks_us.books where id=b) or (select migration_execution_enabled from clickbooks_us.workflow_settings where singleton) then raise exception 'QA_START_LOCKS_NOT_OFF'; end if;
tests:=tests||'"execution locks default off"'::jsonb;
insert into clickbooks_us.accounts(book_id,code,name,account_type,normal_side,is_bank_sensitive,origin) values(b,'QA-P34-BANK','QA Bank','asset','debit',true,'manual') returning id into qa_bank;
insert into clickbooks_us.accounts(book_id,code,name,account_type,normal_side,origin) values(b,'QA-P34-EQUITY','QA Equity','equity','credit','manual') returning id into qa_equity;
insert into clickbooks_us.accounts(book_id,code,name,account_type,normal_side,origin) values(b,'QA-P34-EXPENSE','QA Expense','expense','debit','manual') returning id into qa_expense;
insert into clickbooks_us.accounts(book_id,code,name,account_type,normal_side,origin) values(b,'QA-P34-EXPENSE2','QA Expense 2','expense','debit','manual') returning id into qa_expense2;
if clickbooks_us.money_cents('12.34')<>1234 or clickbooks_us.cents('-125',true)<>-125 then raise exception 'QA_PRECISION'; end if;
tests:=tests||'"exact signed and unsigned cents"'::jsonb;
for ex in select * from(values
 ('fractional cents rejected',$q$select clickbooks_us.cents('1.5')$q$,'CB_INTEGER_CENTS_REQUIRED'),
 ('negative debit rejected',$q$select clickbooks_us.cents('-1')$q$,'CB_INTEGER_CENTS_REQUIRED'),
 ('scientific notation rejected',$q$select clickbooks_us.cents('1e3')$q$,'CB_INTEGER_CENTS_REQUIRED'),
 ('null cents rejected',$q$select clickbooks_us.cents(null)$q$,'CB_INTEGER_CENTS_REQUIRED'),
 ('fractional source cents rejected',$q$select clickbooks_us.money_cents('0.001')$q$,'CB_INVALID_SOURCE_AMOUNT'),
 ('future cutoff rejected',$q$select clickbooks_us.source_snapshot(current_date+1)$q$,'CB_INVALID_CUTOFF'),
 ('infinite cutoff rejected',$q$select clickbooks_us.source_snapshot('infinity')$q$,'CB_INVALID_CUTOFF')
 )q(name,command,expected) loop
 begin execute ex.command; raise exception 'QA_EXPECTED_REJECTION: %',ex.name; exception when others then if SQLERRM not like ex.expected||'%' then raise; end if; end;
 tests:=tests||to_jsonb(ex.name);
end loop;
v:=clickbooks_us.source_snapshot(current_date);
if v->>'book'<>'KTC_US' or jsonb_array_length(v->'invoices')=0 or jsonb_array_length(v->'bank')=0 or v::text like '%access_token%' then raise exception 'QA_SOURCE_SNAPSHOT'; end if;
tests:=tests||'"US source snapshot populated without provider secrets"'::jsonb;
r:=clickbooks_us.create_migration_run(key,current_date,'opening_balance',actor);
if clickbooks_us.create_migration_run(key,current_date,'opening_balance',actor)<>r then raise exception 'QA_RETRY_ID'; end if;
tests:=tests||'"snapshot retries are idempotent"'::jsonb;
begin perform clickbooks_us.create_migration_run(key,current_date,'transaction_batch',actor); raise exception 'QA_EXPECTED_REJECTION'; exception when others then if SQLERRM not like 'CB_IDEMPOTENCY_CONFLICT%' then raise; end if; end;
tests:=tests||'"conflicting snapshot key rejected"'::jsonb;
begin update clickbooks_us.migration_runs set snapshot='{}' where id=r; raise exception 'QA_EXPECTED_REJECTION'; exception when others then if SQLERRM not like 'CB_MIGRATION_EVIDENCE_IMMUTABLE%' then raise; end if; end;
tests:=tests||'"source snapshots immutable"'::jsonb;
begin perform clickbooks_us.validate_migration(r); raise exception 'QA_EXPECTED_REJECTION'; exception when others then if SQLERRM not like 'CB_MANIFEST_REQUIRED%' then raise; end if; end;
tests:=tests||'"empty migration cannot validate"'::jsonb;
-- Rule configuration and matching.
def:=jsonb_build_object('name','QA literal rule','priority',100,'enabled',true,'conditions',jsonb_build_object('direction','out','text','A%_B','minCents','101','maxCents','101'),'action',jsonb_build_object('kind','categorize','splits',jsonb_build_array(jsonb_build_object('accountId',qa_expense,'basisPoints',6000),jsonb_build_object('accountId',qa_expense2,'basisPoints',4000))));
perform clickbooks_us.validate_rule(def);
t:=jsonb_build_object('id',gen_random_uuid(),'currency','USD','pending',false,'date',current_date,'direction','out','amount','1.01','name','hello a%_b text','merchant','QA','review','unreviewed','classification',null,'linkedType',null,'linkedId',null,'matchedInvoiceId',null,'hasPayment',false,'hasSplits',false);
if not clickbooks_us.rule_matches(def->'conditions',t) then raise exception 'QA_MATCH'; end if;
tests:=tests||'"case-insensitive literal matching and inclusive amount bounds"'::jsonb;
if clickbooks_us.rule_matches(def->'conditions',jsonb_set(t,'{name}','"hello AXXB text"')) then raise exception 'QA_WILDCARD'; end if;
tests:=tests||'"text is literal, not regex or SQL wildcard"'::jsonb;
if clickbooks_us.rule_matches(def->'conditions',jsonb_set(t,'{pending}','true')) or clickbooks_us.rule_matches(def->'conditions',jsonb_set(t,'{currency}','"EGP"')) or clickbooks_us.rule_matches(def->'conditions',jsonb_set(t,'{direction}','"in"')) then raise exception 'QA_SCOPE_RULE'; end if;
tests:=tests||'"pending non-USD and wrong-direction rows excluded"'::jsonb;
v:=clickbooks_us.rule_outcome(def->'action',t);
if (v#>>'{allocations,0,amountCents}')::int<>60 or (v#>>'{allocations,1,amountCents}')::int<>41 or v->>'postsToLedger'<>'false' then raise exception 'QA_SPLIT'; end if;
tests:=tests||'"split remainder preserves exact cents without posting"'::jsonb;
for ex in select * from(values
 ('missing name rejected',def-'name','CB_INVALID_RULE'),
 ('empty pattern rejected',jsonb_set(def,'{conditions,text}','" "'),'CB_INVALID_TEXT_CONDITION'),
 ('regex field rejected',jsonb_set(def,'{conditions,regex}','".*"'),'CB_INVALID_CONDITIONS'),
 ('zero priority rejected',jsonb_set(def,'{priority}','0'),'CB_INVALID_RULE'),
 ('reversed amount bounds rejected',jsonb_set(def,'{conditions,minCents}','"102"'),'CB_INVALID_AMOUNT_RANGE'),
 ('invalid split total rejected',jsonb_set(def,'{action,splits,0,basisPoints}','5999'),'CB_SPLITS_MUST_TOTAL_10000'),
 ('bank target rejected',jsonb_set(def,'{action,splits,0,accountId}',to_jsonb(qa_bank::text)),'CB_RULE_TARGET_NOT_ALLOWED'),
 ('duplicate allocation target rejected',jsonb_set(def,'{action,splits,1,accountId}',to_jsonb(qa_expense::text)),'CB_RULE_TARGET_NOT_ALLOWED'),
 ('posting action rejected',jsonb_set(def,'{action,kind}','"post_payment"'),'CB_INVALID_ACTION')
 )q(name,value,expected) loop
 begin perform clickbooks_us.validate_rule(ex.value); raise exception 'QA_EXPECTED_REJECTION: %',ex.name; exception when others then if SQLERRM not like ex.expected||'%' then raise; end if; end;
 tests:=tests||to_jsonb(ex.name);
end loop;
if clickbooks_us.rule_eligible(jsonb_set(t,'{review}','"reviewed"')) or clickbooks_us.rule_eligible(jsonb_set(t,'{hasPayment}','true')) or clickbooks_us.rule_eligible(jsonb_set(t,'{hasSplits}','true')) then raise exception 'QA_PROTECTED_ROW'; end if;
tests:=tests||'"manual reviews, invoice matches and splits protected"'::jsonb;
rule_id:=clickbooks_us.save_rule(null,0,def,actor); rule2:=clickbooks_us.save_rule(null,0,def||'{"name":"QA competing"}'::jsonb,actor);
if clickbooks_us.rule_decision(t)->>'state'<>'conflict' then raise exception 'QA_RULE_TIE'; end if;
tests:=tests||'"equal-priority conflict has no automatic winner"'::jsonb;
perform clickbooks_us.save_rule(rule2,1,jsonb_set(def,'{priority}','101'),actor);
if clickbooks_us.rule_decision(t)->>'ruleId'<>rule_id::text then raise exception 'QA_RULE_PRIORITY'; end if;
tests:=tests||'"lower priority number wins deterministically"'::jsonb;
begin perform clickbooks_us.save_rule(rule2,1,def,actor); raise exception 'QA_EXPECTED_REJECTION'; exception when others then if SQLERRM not like 'CB_RULE_REVISION_CONFLICT%' then raise; end if; end;
tests:=tests||'"stale rule edits rejected"'::jsonb;
if (select count(*) from clickbooks_us.rule_versions rv where rv.rule_id=rule2)<>2 then raise exception 'QA_VERSIONS'; end if;
tests:=tests||'"rule versions retained"'::jsonb;
-- Use real source evidence, but only rollback-isolated rules/proposals are changed.
select value into strict t from jsonb_array_elements(clickbooks_us.source_snapshot(current_date)->'bank') where clickbooks_us.rule_eligible(value) and value->>'direction'='out' and length(value->>'name') between 1 and 200 limit 1;
def2:=jsonb_build_object('name','QA real-data preview only','priority',50,'enabled',true,'conditions',jsonb_build_object('direction','out','text',t->>'name'),'action',jsonb_build_object('kind','categorize','splits',jsonb_build_array(jsonb_build_object('accountId',qa_expense,'basisPoints',10000))));
v:=clickbooks_us.preview_rule(def2);
if (v->>'matching')::int<1 or exists(select 1 from clickbooks_us.rule_proposals) then raise exception 'QA_PREVIEW_WRITES'; end if;
tests:=tests||'"live-source preview creates no proposals or financial postings"'::jsonb;
rule2:=clickbooks_us.save_rule(null,0,def2,actor);
v:=clickbooks_us.stage_rule_proposals(actor);
if (v->>'created')::int<1 then raise exception 'QA_STAGE_EMPTY'; end if;
if (clickbooks_us.stage_rule_proposals(actor)->>'created')::int<>0 then raise exception 'QA_STAGE_DUPLICATE'; end if;
tests:=tests||'"staging proposals is retry-safe"'::jsonb;
select id into strict proposal_id from clickbooks_us.rule_proposals rp where rp.source_id=(t->>'id')::uuid and rp.rule_id=rule2;
update clickbooks_us.accounts set needs_review=true where id=qa_expense;
begin perform clickbooks_us.decide_proposal(proposal_id,true,'QA approval',actor); raise exception 'QA_EXPECTED_REJECTION'; exception when others then if SQLERRM not like 'CB_ACCOUNT_REVIEW_REQUIRED%' then raise; end if; end;
tests:=tests||'"unreviewed ledger account blocks classification approval"'::jsonb;
update clickbooks_us.accounts set needs_review=false where id=qa_expense;
perform clickbooks_us.decide_proposal(proposal_id,true,'QA approval',actor);
perform clickbooks_us.decide_proposal(proposal_id,true,'QA approval',actor);
if (select state from clickbooks_us.rule_proposals where id=proposal_id)<>'approved' or exists(select 1 from clickbooks_us.journals) then raise exception 'QA_APPROVAL_POSTED'; end if;
tests:=tests||'"classification approval is not ledger posting"'::jsonb;
perform clickbooks_us.save_rule(rule2,1,def2||'{"enabled":false}',actor); perform clickbooks_us.stage_rule_proposals(actor);
if (select state from clickbooks_us.rule_proposals where id=proposal_id)<>'superseded' then raise exception 'QA_SUPERSEDE'; end if;
tests:=tests||'"changed rules supersede stale classifications"'::jsonb;
-- Opening-balance execution: synthetic cents against QA accounts only.
plans:=jsonb_build_array(jsonb_build_object('source_kind','opening_balance','source_id','opening:'||current_date::text,'date',current_date,'description','QA SYNTHETIC OPENING - ROLLBACK','lines',jsonb_build_array(jsonb_build_object('account_id',qa_bank,'debit_cents','100','credit_cents','0'),jsonb_build_object('account_id',qa_equity,'debit_cents','0','credit_cents','100'))));
balances:=jsonb_build_array(jsonb_build_object('account_id',qa_bank,'net_debit_cents','100'),jsonb_build_object('account_id',qa_equity,'net_debit_cents','-100'));
perform clickbooks_us.set_migration_plan(r,1,plans,jsonb_set(balances,'{0,net_debit_cents}','"99"'),'[]','QA synthetic external evidence reference',actor);
begin perform clickbooks_us.validate_migration(r); raise exception 'QA_EXPECTED_REJECTION'; exception when others then if SQLERRM not like 'CB_RECONCILIATION_MISMATCH%' then raise; end if; end;
tests:=tests||'"balanced but unreconciled migration rejected"'::jsonb;
begin perform clickbooks_us.set_migration_plan(r,1,plans,balances,'[]','QA synthetic evidence',actor); raise exception 'QA_EXPECTED_REJECTION'; exception when others then if SQLERRM not like 'CB_MIGRATION_REVISION_CONFLICT%' then raise; end if; end;
tests:=tests||'"stale manifest edits rejected"'::jsonb;
perform clickbooks_us.set_migration_plan(r,2,plans,balances,'[]','QA synthetic external evidence reference',actor);
if clickbooks_us.validate_migration(r)->>'ok'<>'true' then raise exception 'QA_VALIDATION'; end if;
tests:=tests||'"opening manifest reconciles against all ledger accounts"'::jsonb;
perform clickbooks_us.approve_migration(r,3,actor); select approval_hash into ah from clickbooks_us.migration_runs where id=r;
begin perform clickbooks_us.commit_migration(r,ah,actor); raise exception 'QA_EXPECTED_REJECTION'; exception when others then if SQLERRM not like 'CB_MIGRATION_EXECUTION_DISABLED%' then raise; end if; end;
tests:=tests||'"approval alone cannot enable execution"'::jsonb;
begin update clickbooks_us.migration_runs set plans='[]' where id=r; raise exception 'QA_EXPECTED_REJECTION'; exception when others then if SQLERRM not like 'CB_MIGRATION_PLAN_LOCKED%' then raise; end if; end;
tests:=tests||'"approved plan immutable"'::jsonb;
update clickbooks_us.workflow_settings set migration_execution_enabled=true where singleton; update clickbooks_us.books set posting_enabled=true where id=b;
update clickbooks_us.accounts set name='QA changed chart' where id=qa_bank;
begin perform clickbooks_us.commit_migration(r,ah,actor); raise exception 'QA_EXPECTED_REJECTION'; exception when others then if SQLERRM not like 'CB_APPROVAL_STALE%' then raise; end if; end;
tests:=tests||'"chart drift invalidates approval fingerprint"'::jsonb;
update clickbooks_us.accounts set name='QA Bank' where id=qa_bank;
v:=clickbooks_us.commit_migration(r,ah,actor);
if v->>'state'<>'committed' or (select count(*) from clickbooks_us.journals)<>1 then raise exception 'QA_COMMIT'; end if;
tests:=tests||'"atomic migration fixture posts exactly once"'::jsonb;
if clickbooks_us.commit_migration(r,ah,actor)->>'replayed'<>'true' or (select count(*) from clickbooks_us.journals)<>1 then raise exception 'QA_COMMIT_RETRY'; end if;
tests:=tests||'"commit retry returns prior result without duplicates"'::jsonb;
begin perform clickbooks_us.post_journal(b,current_date,'QA prior-cutoff','manual','qa-pre-cutoff',plans#>'{0,lines}',actor); raise exception 'QA_EXPECTED_REJECTION'; exception when others then if SQLERRM not like 'CB_PRE_CUTOFF_EVENT%' then raise; end if; end;
tests:=tests||'"opening cutoff blocks duplicate historical postings"'::jsonb;
perform clickbooks_us.reverse_migration(r,current_date+1,actor);
if exists(select 1 from clickbooks_us.trial_balance(b,current_date+1) where net_debit_cents<>0) or (select posting_enabled from clickbooks_us.books where id=b) then raise exception 'QA_REVERSE'; end if;
tests:=tests||'"batch reversal nets to zero and locks posting"'::jsonb;
perform clickbooks_us.reverse_migration(r,current_date+1,actor);
if (select count(*) from clickbooks_us.journals)<>2 then raise exception 'QA_REVERSE_RETRY'; end if;
tests:=tests||'"reversal retry preserves original and one reversal"'::jsonb;
if (select historical_data_ready from clickbooks_us.books where id=b) then raise exception 'QA_FALSE_HISTORY_READY'; end if;
tests:=tests||'"batch import does not claim complete historical books"'::jsonb;
if has_function_privilege('anon','public.clickbooks_us_workbench_read(text,uuid)','execute') or has_function_privilege('authenticated','public.clickbooks_us_workbench_action(text,jsonb,uuid)','execute') or has_function_privilege('service_role','clickbooks_us.commit_migration(uuid,text,uuid)','execute') or has_table_privilege('service_role','clickbooks_us.rules','INSERT') then raise exception 'QA_PRIVILEGE_LEAK'; end if;
tests:=tests||'"browser and service roles cannot bypass posting controls"'::jsonb;
if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='clickbooks_us' and c.relkind='r' and not c.relrowsecurity) then raise exception 'QA_NO_RLS'; end if;
tests:=tests||'"all ClickBooks tables have row-level security"'::jsonb;
v:=public.clickbooks_us_workbench_read('rules');
if v ? 'snapshot' or v ? 'bankBalance' or exists(select 1 from jsonb_array_elements(v->'accounts')x join clickbooks_us.accounts a on a.id=(x->>'id')::uuid where a.is_bank_sensitive) then raise exception 'QA_RULE_BANK_LEAK'; end if;
tests:=tests||'"rule workspace omits bank-sensitive accounts and balances"'::jsonb;
if before_source<>clickbooks_us.audit_source()->'source_digests' then raise exception 'QA_LEGACY_CHANGED'; end if;
tests:=tests||'"legacy US sources unchanged"'::jsonb;
perform set_config('clickbooks.p34_qa',jsonb_build_object('passed',jsonb_array_length(tests),'tests',tests,'fixtures','All QA accounts, snapshots, rule proposals, postings, locks and approvals rolled back')::text,true);
end $$;
select current_setting('clickbooks.p34_qa')::jsonb as qa_result;
rollback;
