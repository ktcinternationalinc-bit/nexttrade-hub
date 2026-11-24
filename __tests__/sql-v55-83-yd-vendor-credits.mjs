// v55.83-YD — the REAL sql/v55-83-YD-vendor-credits.sql run in a disposable in-memory Postgres (PGlite), on top of the WZ vendor/number
// key function as installed (sql/v55-83-WZ-same-number-bills.sql, its first function). Fabricated rows only.
// RUN: PGLITE_DIR=D:/GITHUB/_test-tools/pglite node __tests__/sql-v55-83-yd-vendor-credits.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(path.join(process.env.PGLITE_DIR || 'D:/GITHUB/_test-tools/pglite', 'package.json'));
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (l, c, x) => { if (c) { pass++; console.log('  ✓ ' + l); } else { fail++; console.log('  ✗ FAIL: ' + l + '  ' + JSON.stringify(x === undefined ? '' : x).slice(0, 500)); } };
console.log('YD — vendor credit memos: the real SQL in PGlite');

const US = 'US', EG = 'EG';
const B1 = '11111111-1111-1111-1111-111111111111', B2 = '22222222-2222-2222-2222-222222222222', B3 = '33333333-3333-3333-3333-333333333333', B4 = '44444444-4444-4444-4444-444444444444', B5 = '55555555-5555-5555-5555-555555555555';
const BANK = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', ACTOR = '99999999-9999-9999-9999-999999999999';
const wz = fs.readFileSync(path.join(root, 'sql/v55-83-WZ-same-number-bills.sql'), 'utf8');
const wzKey = wz.substring(0, wz.indexOf('END $$;') + 'END $$;'.length);
const yd = fs.readFileSync(path.join(root, 'sql/v55-83-YD-vendor-credits.sql'), 'utf8');

async function fresh() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema clickbooks_us; create table clickbooks_us.books (code text, locked_through date); insert into clickbooks_us.books values ('KTC_US', '2026-09-30');
    create table public.hub_audit_log (id uuid default gen_random_uuid(), at timestamptz default now(), actor_id uuid, action text not null, entity text, entity_id text, details jsonb, created_at timestamptz default now());
    create table public.bank_transactions (id uuid primary key, wave_business_id text default 'US', direction text default 'out', pending boolean default false, review_status text default 'unreviewed', amount_abs numeric, date date default '2026-10-20', posted_date date, iso_currency text default 'USD', matched_invoice_id uuid, transfer_group_id uuid, linked_id uuid);
    create table public.accounting_invoice_payments (id uuid primary key default gen_random_uuid(), bank_transaction_id uuid, amount numeric, voided boolean default false, sync_status text);
    create table public.party_money_entries (id uuid primary key default gen_random_uuid(), party text, kind text, bucket text, amount numeric, bank_transaction_id uuid, source_bank_transaction_id uuid);
    create table public.payment_matches (id uuid primary key default gen_random_uuid(), bank_transaction_id uuid, invoice_id uuid, matched_amount numeric, voided boolean default false);
    create table public.bank_transaction_splits (id uuid primary key default gen_random_uuid(), bank_transaction_id uuid, split_amount numeric);
    create table public.unapplied_deposits (id uuid primary key default gen_random_uuid(), bank_transaction_id uuid, amount numeric, status text default 'open');
    create table public.customer_credits (id uuid primary key default gen_random_uuid(), source_transaction_id uuid, amount numeric, status text default 'open');
    create table public.vendor_bills (id uuid primary key, wave_business_id text, vendor_name text, bill_number text, currency text default 'USD', total_amount numeric, record_status text default 'active', disputed boolean default false);
    create table public.vendor_bill_payments (id uuid primary key default gen_random_uuid(), bill_id uuid, amount numeric, paid_date date, bank_transaction_id uuid, method text, voided boolean default false, created_by uuid);
    create table public.wire_package_lines (id uuid primary key default gen_random_uuid(), package_id uuid, bill_id uuid, amount numeric, is_open boolean default true, payment_id uuid);
    insert into public.bank_transactions (id, amount_abs) values ('${BANK}', 10000);
    insert into public.vendor_bills (id, wave_business_id, vendor_name, bill_number, total_amount) values
      ('${B1}', '${US}', 'Kronos Logistics, LLC', 'K-100', 1000), ('${B2}', '${US}', 'KRONOS LOGISTICS', 'K-101', 500),
      ('${B3}', '${US}', 'AMB Trucking', 'A-1', 800), ('${B4}', '${EG}', 'Kronos Logistics', 'K-900', 700);
    insert into public.vendor_bills (id, wave_business_id, vendor_name, bill_number, currency, total_amount) values ('${B5}', '${US}', 'Kronos Logistics', 'K-CAD', 'CAD', 300);
  `);
  await db.exec(wzKey);
  await db.exec(yd);
  return db;
}
const j = (r) => r.rows[0][Object.keys(r.rows[0])[0]];
async function call(db, fn, p) { try { return { ok: true, v: j(await db.query('select public.' + fn + '($1::jsonb) as r', [JSON.stringify(p)])) }; } catch (e) { return { ok: false, e: String(e.message || e) }; } }
async function one(db, sql) { return (await db.query(sql)).rows[0]; }
async function tryExec(db, sql) { try { await db.exec(sql); return null; } catch (e) { return String(e.message || e); } }

let db = await fresh();
const checks = (await db.query(`SELECT what, result FROM (SELECT 'credit tables, RLS on, no browser access' AS what, CASE WHEN (SELECT bool_and(c.relrowsecurity) FROM pg_class c WHERE c.oid IN ('public.vendor_credits'::regclass, 'public.vendor_credit_applications'::regclass)) AND NOT has_table_privilege('authenticated', 'public.vendor_credits', 'SELECT') THEN 'OK' ELSE 'PROBLEM' END AS result) x`)).rows;
check('the script installs; its own read-only check says OK for the tables; installed flag true', checks[0].result === 'OK' && (await one(db, 'select public.hub_vendor_credits_installed() as v')).v === true);
check('it re-runs cleanly (re-runnable)', (await tryExec(db, yd)) === null);

// create
const C = { wave_business_id: US, vendor_name: 'Kronos Logistics Inc.', credit_number: 'CM-7', credit_date: '2026-10-05', currency: 'USD', amount: 600, reason: 'overcharge refund', request_id: 'c1', actor: ACTOR };
let r = await call(db, 'hub_vendor_credit_create', C);
check('a credit memo of 600 is recorded (audited)', r.ok && r.v.ok === true && (await one(db, `select count(*)::int n from hub_audit_log where action='vendor_credit_create'`)).n === 1, r);
const CID = r.ok ? r.v.credit_id : null;
r = await call(db, 'hub_vendor_credit_create', C);
check('the same click again gives the same answer (no second credit)', r.ok && r.v.repeat === true && r.v.credit_id === CID && (await one(db, 'select count(*)::int n from vendor_credits')).n === 1, r);
r = await call(db, 'hub_vendor_credit_create', Object.assign({}, C, { request_id: 'c2', vendor_name: 'KRONOS LOGISTICS, LLC', credit_number: 'cm 7' }));
check('the same credit memo entered again (other spelling of vendor / number) is refused', !r.ok && /already recorded/.test(r.e), r);
r = await call(db, 'hub_vendor_credit_create', Object.assign({}, C, { request_id: 'c1', amount: 601 }));
check('the same request id for a different credit is refused', !r.ok && /different action/.test(r.e), r);
for (const [bad, why] of [[{ amount: 0 }, /above zero/], [{ amount: -5 }, /above zero/], [{ credit_number: '' }, /required/], [{ reason: 'x' }, /say why/]]) {
  r = await call(db, 'hub_vendor_credit_create', Object.assign({}, C, { request_id: 'bad' + Math.random(), credit_number: 'CM-BAD-' + Math.random() }, bad));
  check('refused: ' + JSON.stringify(bad), !r.ok && why.test(r.e), r);
}

// apply
const A = (o) => Object.assign({ credit_id: CID, bill_id: B1, amount: 400, applied_date: '2026-10-06', request_id: 'a' + Math.random(), actor: ACTOR }, o);
r = await call(db, 'hub_vendor_credit_apply', A({ request_id: 'a1' }));
check('apply 400 to bill K-100 (1,000): bill left 600, credit left 200; audited', r.ok && Number(r.v.bill_left) === 600 && Number(r.v.credit_left) === 200 && (await one(db, `select count(*)::int n from hub_audit_log where action='vendor_credit_apply'`)).n === 1, r);
r = await call(db, 'hub_vendor_credit_apply', A({ request_id: 'a1' }));
check('the same apply click again: same answer, applied once', r.ok && r.v.repeat === true && (await one(db, 'select count(*)::int n from vendor_credit_applications')).n === 1, r);
r = await call(db, 'hub_vendor_credit_apply', A({ bill_id: B2, amount: 250 }));
check('more than the credit has left (200) is refused', !r.ok && /only \$200\.00 of this credit memo is left/.test(r.e), r);
r = await call(db, 'hub_vendor_credit_apply', A({ bill_id: B2, amount: 200 }));
check('the rest (200) goes to the same vendor\'s other bill (vendor spelled differently): credit fully used', r.ok && Number(r.v.credit_left) === 0, r);
const C2 = (await call(db, 'hub_vendor_credit_create', Object.assign({}, C, { request_id: 'c3', credit_number: 'CM-8', amount: 5000 }))).v.credit_id;
for (const [label, o, why] of [
  ['another vendor\'s bill', { credit_id: C2, bill_id: B3, amount: 10 }, /only applied to the same vendor/],
  ['another company\'s bill', { credit_id: C2, bill_id: B4, amount: 10 }, /different companies/],
  ['a bill in another currency', { credit_id: C2, bill_id: B5, amount: 10 }, /no conversion/],
  ['more than the bill still owes (600 left on K-100)', { credit_id: C2, bill_id: B1, amount: 600.01 }, /only has \$600\.00 left/],
  ['a date before the credit memo', { credit_id: C2, bill_id: B1, amount: 10, applied_date: '2026-10-01' }, /before its own date/],
  ['a date inside a closed month', { credit_id: C2, bill_id: B1, amount: 10, applied_date: '2026-09-30' }, /before its own date|closed month/],
  ['zero', { credit_id: C2, bill_id: B1, amount: 0 }, /above zero/]]) {
  r = await call(db, 'hub_vendor_credit_apply', A(o)); check('apply refused: ' + label, !r.ok && why.test(r.e), r);
}
await db.exec(`update clickbooks_us.books set locked_through='2026-10-10'`);
r = await call(db, 'hub_vendor_credit_apply', A({ credit_id: C2, bill_id: B1, amount: 10, applied_date: '2026-10-10' }));
check('apply refused inside a closed month', !r.ok && /closed month/.test(r.e), r);
await db.exec(`update clickbooks_us.books set locked_through='2026-09-30'`);

// the EXISTING caps count the credits
let e = await tryExec(db, `insert into vendor_bill_payments (bill_id, amount, bank_transaction_id) values ('${B1}', 600.01, '${BANK}')`);
check('a PAYMENT of more than what is left after the credit (600) is refused by the payment cap', !!e && /vendor credits applied \$400\.00/.test(e), e);
e = await tryExec(db, `insert into vendor_bill_payments (bill_id, amount, bank_transaction_id) values ('${B1}', 600, '${BANK}')`);
check('a payment of exactly the rest (600) is accepted', e === null, e);
e = await tryExec(db, `insert into wire_package_lines (bill_id, amount) values ('${B2}', 300.01)`);
check('a WIRE line of more than K-101 still owes (500 − 200 credit = 300) is refused by the wire cap', !!e && /vendor credits applied \$200\.00/.test(e), e);
e = await tryExec(db, `insert into wire_package_lines (bill_id, amount) values ('${B2}', 300)`);
check('a wire line of exactly 300 is accepted', e === null, e);
r = await call(db, 'hub_vendor_credit_apply', A({ credit_id: C2, bill_id: B2, amount: 0.01 }));
check('no credit can be applied to K-101 while its whole rest is held on an open wire', !r.ok && /only has \$0\.00 left/.test(r.e), r);
e = await tryExec(db, `begin; insert into vendor_bill_payments (bill_id, amount, bank_transaction_id) values ('${B2}', 1, '${BANK}'); commit;`);
check('a payment on K-101 while the wire holds the rest is refused at the end of the transaction (credits counted)', !!e && /vendor credits/.test(e), e);
await tryExec(db, 'rollback');
e = await tryExec(db, `update vendor_bills set total_amount = 900 where id='${B1}'`);
check('the bill total cannot be lowered below paid + credited (1,000 → 900 refused)', !!e && /cannot go below \$1,000\.00/.test(e), e);
e = await tryExec(db, `update vendor_bills set record_status='void' where id='${B3}'`);
check('a bill without payments / credits can still be voided as before', e === null, e);

// undo + void
const app1 = (await one(db, `select id from vendor_credit_applications where bill_id='${B1}'`)).id;
r = await call(db, 'hub_vendor_credit_void', { credit_id: CID, reason: 'entered by mistake', actor: ACTOR });
check('a credit memo that is applied cannot be voided', !r.ok && /undo those first/.test(r.e), r);
e = await tryExec(db, `delete from vendor_credit_applications where id='${app1}'`);
check('an application is never deleted', !!e && /never deleted/.test(e), e);
e = await tryExec(db, `update vendor_credit_applications set amount=1 where id='${app1}'`);
check('an application\'s amount cannot be changed', !!e && /cannot be changed/.test(e), e);
r = await call(db, 'hub_vendor_credit_unapply', { application_id: app1, reason: 'x', actor: ACTOR });
check('undo needs a reason', !r.ok && /say why/.test(r.e), r);
r = await call(db, 'hub_vendor_credit_unapply', { application_id: app1, reason: 'wrong bill', actor: ACTOR });
const after = await one(db, `select voided, void_reason from vendor_credit_applications where id='${app1}'`);
check('undo voids the application (kept, with the reason; audited); the bill owes 400 again (paid 600 of 1,000)', r.ok && after.voided === true && after.void_reason === 'wrong bill' && Number((await one(db, `select public.hub_bill_credits('${B1}') v`)).v) === 0, [r, after]);
r = await call(db, 'hub_vendor_credit_unapply', { application_id: app1, reason: 'wrong bill', actor: ACTOR });
check('undo again: harmless repeat', r.ok && r.v.repeat === true);
e = await tryExec(db, `update vendor_credit_applications set voided=false where id='${app1}'`);
check('a voided application stays voided', !!e && /stays voided/.test(e), e);
e = await tryExec(db, `update vendor_bills set record_status='void' where id='${B2}'`);
check('a bill with a credit applied (K-101) cannot be voided', !!e && /(vendor credits of \$200\.00 are applied|open wire)/.test(e), e);
e = await tryExec(db, `update vendor_credits set total_amount = 1 where id='${CID}'`);
check('a recorded credit memo cannot be changed', !!e && /cannot be changed/.test(e), e);
e = await tryExec(db, `delete from vendor_credits where id='${CID}'`);
check('a credit memo is never deleted', !!e && /never deleted/.test(e), e);
r = await call(db, 'hub_vendor_credit_void', { credit_id: C2, reason: 'duplicate entry', actor: ACTOR });
check('a credit memo with nothing applied can be voided (kept, reason recorded)', r.ok && (await one(db, `select record_status s, void_reason v from vendor_credits where id='${C2}'`)).s === 'void');
r = await call(db, 'hub_vendor_credit_apply', A({ credit_id: C2, bill_id: B1, amount: 10 }));
check('a voided credit memo cannot be applied', !r.ok && /voided/.test(r.e), r);

// ── (Codex 23 Nov) EVERY payment source counts the credit: an RTM / NextTrade starting-balance payment (no bank line, method rtm) ──
db = await fresh();
const K = (await call(db, 'hub_vendor_credit_create', Object.assign({}, C, { request_id: 'k1', amount: 300 }))).v.credit_id;
r = await call(db, 'hub_vendor_credit_apply', { credit_id: K, bill_id: B1, amount: 300, applied_date: '2026-10-06', request_id: 'k-a1', actor: ACTOR });
check('partial credit: 300 of the 1,000 bill credited', r.ok && Number(r.v.bill_left) === 700, r);
e = await tryExec(db, `insert into vendor_bill_payments (bill_id, amount, method) values ('${B1}', 700.01, 'rtm')`);
check('a starting-balance payment (no bank line, method rtm) above the credit-adjusted rest (700) is refused', !!e && /vendor credits applied \$300\.00/.test(e), e);
e = await tryExec(db, `insert into vendor_bill_payments (bill_id, amount, bank_transaction_id) values ('${B1}', 250, '${BANK}')`);
check('partial payment 250 (bank line) is accepted; 450 left', e === null, e);
e = await tryExec(db, `insert into wire_package_lines (bill_id, amount) values ('${B1}', 450)`);
check('a wire reserving the last 450 is accepted', e === null, e);
e = await tryExec(db, `begin; insert into vendor_bill_payments (bill_id, amount, method) values ('${B1}', 1, 'rtm'); commit;`);
await tryExec(db, 'rollback');
check('… then even 1 from the starting balance is refused (paid 250 + wire 450 + credit 300 = 1,000)', !!e && /vendor credits/.test(e), e);
const kApp = (await one(db, `select id from vendor_credit_applications where credit_id='${K}'`)).id;
r = await call(db, 'hub_vendor_credit_unapply', { application_id: kApp, reason: 'credit belongs to another bill', actor: ACTOR });
check('undo is allowed although the bill was paid / wired since (it only raises what is owed: 300 again)', r.ok && Number((await one(db, `select public.hub_bill_credits('${B1}') v`)).v) === 0, r);

// ── (Codex 23 Nov) a CASH REFUND of a credit uses it up ──
const L1 = 'bbbbbbbb-0000-0000-0000-000000000001', L2 = 'bbbbbbbb-0000-0000-0000-000000000002', L3 = 'bbbbbbbb-0000-0000-0000-000000000003', L4 = 'bbbbbbbb-0000-0000-0000-000000000004', L5 = 'bbbbbbbb-0000-0000-0000-000000000005';
await db.exec(`insert into bank_transactions (id, direction, amount_abs, date) values ('${L1}', 'in', 200, '2026-10-20'), ('${L2}', 'in', 500, '2026-10-21'), ('${L3}', 'out', 100, '2026-10-21'), ('${L4}', 'in', 100, '2026-10-01'), ('${L5}', 'in', 50, '2026-10-22')`);
r = await call(db, 'hub_vendor_credit_refund', { credit_id: K, bank_transaction_id: L1, request_id: 'r1', actor: ACTOR });
check('the vendor refunds 200 of the 300 credit: recorded on the money-in line (whole line), credit left 100', r.ok && Number(r.v.credit_left) === 100, r);
r = await call(db, 'hub_vendor_credit_apply', { credit_id: K, bill_id: B2, amount: 100.01, applied_date: '2026-10-21', request_id: 'r-a1', actor: ACTOR });
check('… so only 100 can still be applied to a bill (100.01 refused)', !r.ok && /only \$100\.00 of this credit memo is left/.test(r.e), r);
for (const [label, line, why] of [['a line bigger than what is left (500 > 100)', L2, /only \$100\.00 of this credit memo is left/], ['money OUT', L3, /settled money-in/], ['a line dated before the credit memo', L4, /before the credit memo/], ['the same line again', L1, /it is a vendor credit refund/]]) {
  r = await call(db, 'hub_vendor_credit_refund', { credit_id: K, bank_transaction_id: line, request_id: 'rr' + Math.random(), actor: ACTOR }); check('refund refused: ' + label, !r.ok && why.test(r.e), r);
}
e = await tryExec(db, `update bank_transactions set matched_invoice_id = gen_random_uuid() where id='${L1}'`);
check('the refund line cannot afterwards be matched to an invoice', !!e && /vendor credit refund/.test(e), e);
e = await tryExec(db, `insert into accounting_invoice_payments (bank_transaction_id, amount) values ('${L1}', 200)`);
check('… nor become a customer payment', !!e && /vendor credit refund/.test(e), e);
e = await tryExec(db, `insert into party_money_entries (kind, bucket, amount, bank_transaction_id) values ('refund', 'refund', 200, '${L1}')`);
check('… nor an RTM / NextTrade money back', !!e && /vendor credit refund/.test(e), e);
await db.exec(`insert into accounting_invoice_payments (bank_transaction_id, amount) values ('${L5}', 50)`);
r = await call(db, 'hub_vendor_credit_refund', { credit_id: K, bank_transaction_id: L5, request_id: 'r5', actor: ACTOR });
check('a line already used as a customer payment cannot be a credit refund', !r.ok && /customer payment/.test(r.e), r);
r = await call(db, 'hub_vendor_credit_void', { credit_id: K, reason: 'entered twice', actor: ACTOR });
check('a credit with a recorded refund cannot be voided', !r.ok && /refunded/.test(r.e), r);
const rApp = (await one(db, `select id from vendor_credit_applications where kind='refund' and bank_transaction_id='${L1}'`)).id;
r = await call(db, 'hub_vendor_credit_unapply', { application_id: rApp, reason: 'wrong deposit', actor: ACTOR });
check('undo the refund (kept, voided, audited): the line is free again and the credit has 300 left', r.ok && (await tryExec(db, `update bank_transactions set matched_invoice_id = gen_random_uuid() where id='${L1}'`)) === null
  && Number((await one(db, `select public.hub_credit_used('${K}') v`)).v) === 0 && (await one(db, `select count(*)::int n from hub_audit_log where action='vendor_credit_unapply' and entity='bank_transaction'`)).n === 1, r);
// ── (Codex 24 Nov P1) ONE BANK LINE, ONE USE: a refund only takes an otherwise unallocated line; while it is a refund nothing else can be put on it ──
db = await fresh();
const KX = (await call(db, 'hub_vendor_credit_create', Object.assign({}, C, { request_id: 'kx', amount: 1000 }))).v.credit_id;
const P1 = 'cccccccc-0000-0000-0000-000000000001', P2 = 'cccccccc-0000-0000-0000-000000000002', P3 = 'cccccccc-0000-0000-0000-000000000003', P4 = 'cccccccc-0000-0000-0000-000000000004';
await db.exec(`insert into bank_transactions (id, direction, amount_abs, date) values ('${P1}', 'in', 200, '2026-10-20'), ('${P2}', 'in', 200, '2026-10-21'), ('${P3}', 'in', 200, '2026-10-22'), ('${P4}', 'in', 200, '2026-10-23')`);
await db.exec(`insert into unapplied_deposits (bank_transaction_id, amount) values ('${P1}', 200)`);
r = await call(db, 'hub_vendor_credit_refund', { credit_id: KX, bank_transaction_id: P1, request_id: 'x1', actor: ACTOR });
check('(1) a deposit PARKED as an unapplied customer deposit cannot be a vendor refund; the parked deposit and the credit stay as they were', !r.ok && /parked as an unapplied customer deposit/.test(r.e) && /Undo that allocation first/.test(r.e)
  && (await one(db, `select count(*)::int n from unapplied_deposits where bank_transaction_id='${P1}' and status='open'`)).n === 1 && Number((await one(db, `select public.hub_credit_used('${KX}') v`)).v) === 0, r);
await db.exec(`insert into bank_transaction_splits (bank_transaction_id, split_amount) values ('${P2}', 200); insert into customer_credits (source_transaction_id, amount) values ('${P3}', 50)`);
r = await call(db, 'hub_vendor_credit_refund', { credit_id: KX, bank_transaction_id: P2, request_id: 'x2', actor: ACTOR }); const r3 = await call(db, 'hub_vendor_credit_refund', { credit_id: KX, bank_transaction_id: P3, request_id: 'x3', actor: ACTOR });
check('(3) … nor a SPLIT deposit, nor one holding an open CUSTOMER CREDIT', !r.ok && /split into lines/.test(r.e) && !r3.ok && /open customer credit/.test(r3.e), [r, r3]);
r = await call(db, 'hub_vendor_credit_refund', { credit_id: KX, bank_transaction_id: P4, request_id: 'x4', actor: ACTOR });
const r4b = await call(db, 'hub_vendor_credit_refund', { credit_id: KX, bank_transaction_id: P4, request_id: 'x4', actor: ACTOR });
check('(5) an ordinary unused deposit still works as a refund, and the same click again is the same answer (once)', r.ok && Number(r.v.amount) === 200 && r4b.ok && r4b.v.repeat === true && (await one(db, `select count(*)::int n from vendor_credit_applications where kind='refund' and bank_transaction_id='${P4}'`)).n === 1, [r, r4b]);
let ex = []; for (const [label, sql] of [['park it (unapplied deposit)', `insert into unapplied_deposits (bank_transaction_id, amount) values ('${P4}', 200)`], ['split it', `insert into bank_transaction_splits (bank_transaction_id, split_amount) values ('${P4}', 50)`],
  ['give it a customer credit', `insert into customer_credits (source_transaction_id, amount) values ('${P4}', 50)`], ['match it', `insert into payment_matches (bank_transaction_id, invoice_id, matched_amount) values ('${P4}', gen_random_uuid(), 10)`],
  ['make it a customer payment', `insert into accounting_invoice_payments (bank_transaction_id, amount) values ('${P4}', 10)`], ['re-open a voided parked deposit on it', `insert into unapplied_deposits (bank_transaction_id, amount, status) values ('${P4}', 10, 'void'); update unapplied_deposits set status='open' where bank_transaction_id='${P4}'`]]) {
  const err = await tryExec(db, sql); if (!err || !/a vendor credit refund — undo that first/.test(err)) { ex.push([label, err]); } }
check('(2) while it is a refund, the line cannot be parked, split, credited, matched or paid — every way, at the database', ex.length === 0 && (await one(db, `select count(*)::int n from unapplied_deposits where bank_transaction_id='${P4}' and status='open'`)).n === 0, ex);
const xApp = (await one(db, `select id from vendor_credit_applications where kind='refund' and bank_transaction_id='${P4}'`)).id;
r = await call(db, 'hub_vendor_credit_unapply', { application_id: xApp, reason: 'deposit was a customer payment', actor: ACTOR });
const parkAfter = await tryExec(db, `insert into unapplied_deposits (bank_transaction_id, amount) values ('${P4}', 200)`);
check('(4) after undoing the refund (kept, voided, audited) the line can be parked again as usual', r.ok && parkAfter === null && Number((await one(db, `select public.hub_credit_used('${KX}') v`)).v) === 0, [r, parkAfter]);
r = await call(db, 'hub_vendor_credit_refund', { credit_id: KX, bank_transaction_id: P4, request_id: 'x5', actor: ACTOR });
check('… and then it cannot be a refund any more (parked) — nothing removed to make room', !r.ok && /parked as an unapplied customer deposit/.test(r.e), r);
// browser roles
const priv = await one(db, `select has_function_privilege('authenticated', 'public.hub_vendor_credit_apply(jsonb)', 'EXECUTE') a, has_table_privilege('anon', 'public.vendor_credit_applications', 'SELECT') b`);
check('browser roles can neither call the writers nor read the tables', priv.a === false && priv.b === false, priv);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
