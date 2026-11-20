import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const require = createRequire(path.join(process.env.PGLITE_DIR || process.cwd(), 'package.json'));
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role;
create table bank_transactions (
 id uuid primary key default gen_random_uuid(), plaid_transaction_id text unique, pending_transaction_id text,
 account_id text, connection_id uuid, wave_business_id text, date date, posted_date date,
 amount numeric, amount_abs numeric, direction text, iso_currency text, pending boolean,
 name text, classification text, category_source text, category_verified boolean default false,
 review_status text, matched_invoice_id text, transfer_group_id text, linked_id text, raw jsonb);
create table vendor_bill_payments(id uuid primary key, bank_transaction_id uuid references bank_transactions(id), amount numeric, voided boolean default false);
create table accounting_invoice_payments(id uuid primary key, bank_transaction_id uuid references bank_transactions(id), amount numeric, voided boolean default false);
create table wire_packages(id uuid primary key,bank_transaction_id uuid references bank_transactions(id),funding_txn_id uuid references bank_transactions(id),status text);
create schema clickbooks_us;
create table clickbooks_us.books(code text,locked_through date);
insert into clickbooks_us.books values('KTC_US','2026-10-31');
`);
for (const name of ['SO-duplicates','TU-pending-settle','WC-pending-identity','WC-pending-identity']) {
  await db.exec(fs.readFileSync(path.join(root,'sql','v55-83-'+name+'.sql'),'utf8'));
}
const U = n => '00000000-0000-0000-0000-'+String(n).padStart(12,'0');
let count=0;
function check(label, condition) { assert.ok(condition,label); count++; console.log('PASS '+label); }
async function pair(n, opts={}) {
  for (const [id,pending] of [[n,true],[n+1,false]]) {
    const r={id:U(id),plaid_transaction_id:'bank-'+id,pending_transaction_id:pending?null:'bank-'+n,
      account_id:'A',connection_id:U(999),wave_business_id:'KTC',date:'2026-11-17',posted_date:pending?null:'2026-11-19',
      amount:100,amount_abs:100,direction:'out',iso_currency:'USD',pending,name:pending?'pending name':'posted name',
      classification:pending?'supplies':null,review_status:'unreviewed',...opts[pending?'pending':'posted']};
    await db.query('insert into bank_transactions select * from jsonb_populate_record(null::bank_transactions,$1)',[JSON.stringify(r)]);
  }
}
const repair=async n=>(await db.query('select hub_reconcile_pending($1,$2,$3) as r',[U(n),U(n+1),'WC isolated test'])).rows[0].r;
const get=async n=>(await db.query('select * from bank_transactions where id=$1',[U(n)])).rows[0];
await pair(1);
await db.query('insert into vendor_bill_payments values($1,$2,100,false)',[U(501),U(1)]);
let r=await repair(1);
check('linked pending settles, preserving original UUID',r.ok && r.links_preserved && (await get(1)).pending===false);
check('bank identity and posted date refreshed', (await get(1)).plaid_transaction_id==='bank-2' && new Date((await get(1)).posted_date).toISOString().slice(0,10)==='2026-11-19');
check('existing category and bill payment preserved',(await get(1)).classification==='supplies' && (await db.query('select bank_transaction_id,amount from vendor_bill_payments')).rows[0].bank_transaction_id===U(1));
check('unworked posted copy archived, only one active transaction',!(await get(2)) && (await db.query('select count(*)::int as n from bank_transaction_duplicates')).rows[0].n===1);
check('both original snapshots retained',(await db.query('select pending_snapshot,posted_snapshot from hub_pending_identity_repairs')).rows[0].pending_snapshot.pending===true);
check('repeat repair is idempotent',(await repair(1)).already===true);
await db.query(`insert into bank_transactions(id,plaid_transaction_id,name,pending) values($1,'bank-2','fresh posted description',false)
 on conflict(plaid_transaction_id) do update set name=excluded.name`,[U(700)]);
check('later sync still refreshes retained row despite archived posted identity',(await get(1)).name==='fresh posted description');
await db.query(`insert into bank_transactions(id,plaid_transaction_id,pending) values($1,'bank-1',true)`,[U(701)]);
check('late pending response cannot resurrect old hold',!(await get(701)));
await pair(10,{pending:{matched_invoice_id:'invoice-5'}});
await db.query('insert into accounting_invoice_payments values($1,$2,100,false)',[U(510),U(10)]);
check('invoice allocation and legacy match preserved',(await repair(10)).ok && (await get(10)).matched_invoice_id==='invoice-5');
check('no invoice payment duplicated',(await db.query('select count(*)::int as n from accounting_invoice_payments')).rows[0].n===1);
await pair(20,{pending:{linked_id:'bill-a'},posted:{linked_id:'bill-b'}});
check('both sides worked refuses without changing either',(await repair(20)).ok===false && (await get(20)).pending===true && !!(await get(21)));
await pair(30,{pending:{linked_id:'bill-a'},posted:{amount:105,amount_abs:105}});
check('changed amount on linked payment requires review',(await repair(30)).ok===false && Number((await get(30)).amount_abs)===100);
await pair(40,{pending:{linked_id:'bill-a'},posted:{account_id:'B'}});
check('different account refused',(await repair(40)).ok===false);
await pair(50,{pending:{linked_id:'bill-a'},posted:{pending_transaction_id:null}});
check('similar money without bank replacement identity refused',(await repair(50)).ok===false);
await pair(60,{pending:{linked_id:'bill-a',date:'2026-10-20'}});
check('closed pending period refused',(await repair(60)).ok===false);
await pair(70,{pending:{linked_id:'bill-a'},posted:{posted_date:'2026-10-20'}});
check('closed posted period refused',(await repair(70)).ok===false);
await pair(80,{pending:{linked_id:'bill-a'},posted:{classification:'different'}});
check('conflicting saved classification refused',(await repair(80)).ok===false);
await pair(90,{pending:{linked_id:'bill-a'}});
await db.query('insert into wire_packages values($1,null,$2,$3)',[U(590),U(91),'draft']);
check('posted copy funding a request refused',(await repair(90)).ok===false);
await pair(100);
check('ordinary unlinked settlement still uses existing audited TU path',(await repair(100)).ok && !(await get(100)) && (await get(101)).classification==='supplies');
check('ordinary settlement repeats safely',(await repair(100)).already===true);
await db.exec(`set role authenticated`);
let denied=false; try { await repair(20); } catch { denied=true; }
check('ordinary browser role cannot call repair SQL',denied);
await db.exec('reset role');
// Force a late failure: the archive and identity update must roll back together.
await pair(110,{pending:{linked_id:'bill-a'}});
await db.exec(`create function refuse_refresh() returns trigger language plpgsql as $$ begin
 if new.id='${U(110)}' and new.pending=false then raise exception 'forced late failure'; end if; return new; end $$;
 create trigger fail_test before update on bank_transactions for each row execute function refuse_refresh();`);
let failed=false; try { await repair(110); } catch { failed=true; }
check('failure after archive rolls back both records',failed && (await get(110)).pending && !!(await get(111)));
check('failed repair leaves no identity audit',(await db.query('select * from hub_pending_identity_repairs where pending_id=$1',[U(110)])).rows.length===0);
await db.close();
console.log('WC pending identity SQL: '+count+' passed');
