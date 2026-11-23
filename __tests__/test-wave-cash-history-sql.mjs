import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { parseWaveCashHistory } from '../src/lib/wave-cash-history.js';
const require = createRequire(import.meta.url);
const { PGlite } = require(process.env.PGLITE_PATH || '@electric-sql/pglite');
const db = new PGlite();
const actor = '11111111-1111-1111-1111-111111111111';
const sql = fs.readFileSync(new URL('../supabase/wave-cash-history.sql',import.meta.url),'utf8');
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
create schema wave_history; grant usage on schema wave_history to service_role;
create table wave_history.access_grants(auth_user_id uuid primary key,can_manage boolean);
insert into wave_history.access_grants values('${actor}',true);
create table public.company_categories(company_id text,key text,label text,active boolean);
insert into public.company_categories values('NEXTRADE_BOOKS','rent','Rent',true),('RTM_BOOKS','rtm_only','RTM',true);
create table public.expense_categories(key text,label text,active boolean);
insert into public.expense_categories values('rent','KTC rent',true);
grant select on wave_history.access_grants,public.company_categories,public.expense_categories to service_role;
alter default privileges in schema public grant all on tables to anon,authenticated;
alter default privileges in schema wave_history grant all on tables to anon,authenticated,service_role;`);
await db.exec(sql); await db.exec(sql);
// A small balanced ledger supplied directly exercises the transactional database contract.
const payload = { profile:'Nextrade LLC',basis:'cash',start:'2021-01-01',end:'2021-01-31',currency:'USD',
  fingerprint:'a'.repeat(64),file_name:'fixture.csv',raw_csv:'source',debit:10000,credit:10000,
  entries:[{source_row:8,posted_date:'2021-01-02',account_key:'bank',account_name:'Bank',description:'Payment',debit_minor:0,credit_minor:10000},
    {source_row:13,posted_date:'2021-01-02',account_key:'rent',account_name:'Rent Expense',description:'Rent',debit_minor:10000,credit_minor:0}] };
let checks=0;
const ok = c => {assert(c); checks++;};
async function refuse(fn) { await assert.rejects(fn); checks++; }
await db.exec('set role service_role');
const save = p => db.query('select public.wave_cash_save($1,$2::jsonb) as v',[actor,JSON.stringify(p)]);
ok((await save(payload)).rows[0].v.rows===2);
ok((await save(payload)).rows[0].v.unchanged===true);
await refuse(()=>save({...payload,fingerprint:'b'.repeat(64)}));
await refuse(()=>save({...payload,fingerprint:'c'.repeat(64),start:'2021-02-01',end:'2021-02-28'}));
ok((await db.query('select count(*)::int n from wave_history.cash_imports')).rows[0].n===1);
await refuse(()=>db.query('select public.wave_cash_save($1,$2::jsonb)',['22222222-2222-2222-2222-222222222222',JSON.stringify(payload)]));
const map = (nt,rev=0)=>db.query("select public.wave_cash_map($1,'rent','expense',$2,'rent',$3) as v",[actor,nt,rev]);
await refuse(()=>map('rtm_only'));
ok((await map('rent')).rows[0].v.revision===1);
await refuse(()=>map('rent'));
ok((await map(null,1)).rows[0].v.revision===2);
ok((await db.query('select count(*)::int n from wave_history.cash_mapping_history')).rows[0].n===2);
const read = await db.query("select public.wave_cash_read('2021-01-01','2021-01-31','USD','rent',0) as v");
ok(read.rows[0].v.accounts.length===2 && read.rows[0].v.entries.length===1);
ok(read.rows[0].v.accounts.find(r=>r.account_key==='rent').account_name==='Rent Expense');
ok(!JSON.stringify(read.rows[0].v.imports).includes('raw_csv'));
ok(read.rows[0].v.mapping_history.length===2);
await refuse(()=>db.exec('delete from wave_history.cash_entries'));
await refuse(()=>db.exec('truncate wave_history.cash_imports cascade'));
await refuse(()=>db.exec("update wave_history.cash_entries set account_name='overwritten'"));
await db.exec('reset role; set role anon');
await refuse(()=>db.exec('select * from wave_history.cash_entries'));
await refuse(()=>db.exec("select public.wave_cash_read('2021-01-01','2021-01-31','USD')"));
await db.exec('reset role; set role authenticated');
await refuse(()=>db.exec('select * from wave_history.cash_imports'));
await db.exec('reset role');
if (process.env.WAVE_CASH_TEST_CSV) {
  const parsed = parseWaveCashHistory(fs.readFileSync(process.env.WAVE_CASH_TEST_CSV,'utf8'),'USD');
  // Separate in-memory database state for the real multi-year fixture.
  await db.exec('truncate wave_history.cash_entries, wave_history.cash_imports restart identity');
  const r = await save({...parsed,fingerprint:'d'.repeat(64),raw_csv:'test snapshot',file_name:'user-export.csv'});
  ok(r.rows[0].v.rows===11646);
  const counts=await db.query('select count(distinct account_key)::int n,sum(debit_minor)::text dr,sum(credit_minor)::text cr from wave_history.cash_entries');
  ok(counts.rows[0].n===73 && counts.rows[0].dr==='4197041813' && counts.rows[0].cr==='4197041813');
}
await db.close();
console.log('Cash history SQL: '+checks+' checks passed (memory only).');
