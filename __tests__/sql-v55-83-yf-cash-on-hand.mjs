// v55.83-YF — the REAL sql/v55-83-YF-cash-on-hand.sql in a disposable in-memory Postgres (PGlite), on top of the REAL bill payment caps
// (sql/v55-83-US-partial-wires.sql) so a cash bill payment is checked exactly like any other. Fabricated rows only.
// RUN: PGLITE_DIR=D:/GITHUB/_test-tools/pglite node __tests__/sql-v55-83-yf-cash-on-hand.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(path.join(process.env.PGLITE_DIR || 'D:/GITHUB/_test-tools/pglite', 'package.json'));
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (l, c, x) => { if (c) { pass++; console.log('  ✓ ' + l); } else { fail++; console.log('  ✗ FAIL: ' + l + '  ' + JSON.stringify(x === undefined ? '' : x).slice(0, 500)); } };
console.log('YF — Cash on Hand: the real SQL in PGlite');
const US = 'QnVzaW5lc3M6NWRkNzI3MDctOTExNC00NjQwLTg4MGQtMjYzNmI3YzM4YTdk', EG = 'EGYPT';
const INV = '11111111-0000-0000-0000-000000000001', INV2 = '11111111-0000-0000-0000-000000000002', INVE = '11111111-0000-0000-0000-000000000003';
const BILL = '22222222-0000-0000-0000-000000000001', BILLE = '22222222-0000-0000-0000-000000000002';
const DEP = '33333333-0000-0000-0000-000000000001', DEP2 = '33333333-0000-0000-0000-000000000002', ACTOR = '99999999-9999-9999-9999-999999999999';
const yf = fs.readFileSync(path.join(root, 'sql/v55-83-YF-cash-on-hand.sql'), 'utf8');
const us = fs.readFileSync(path.join(root, 'sql/v55-83-US-partial-wires.sql'), 'utf8');
async function fresh(opts = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema clickbooks_us;
    create table clickbooks_us.books (id uuid primary key default gen_random_uuid(), code text, locked_through date); insert into clickbooks_us.books (code, locked_through) values ('KTC_US', '2026-09-30');
    create table clickbooks_us.accounts (id uuid primary key default gen_random_uuid(), book_id uuid, code text, name text);
    insert into clickbooks_us.accounts (book_id, code, name) select id, 'W-cash', 'Cash on Hand' from clickbooks_us.books;
    ${opts.twoCash ? `insert into clickbooks_us.accounts (book_id, code, name) select id, 'W-cash2', 'cash on hand' from clickbooks_us.books;` : ''}
    create table clickbooks_us.bank_ledger_map (book_id uuid, provider_account_id text, account_id uuid, reviewed boolean, evidence text);
    create table public.hub_audit_log (id uuid default gen_random_uuid(), at timestamptz default now(), actor_id uuid, action text not null, entity text, entity_id text, details jsonb, created_at timestamptz default now());
    create table public.bank_connections (id uuid primary key default gen_random_uuid(), status text, plaid_item_id text, access_token text not null, institution_name text, wave_business_id text, is_read_only boolean, last_synced timestamptz);
    create table public.plaid_accounts (id uuid default gen_random_uuid(), connection_id uuid, plaid_account_id text primary key, name text, official_name text, mask text, type text, subtype text, iso_currency text, is_read_only boolean, wave_business_id text, is_private boolean default false, assignment_source text, updated_at timestamptz);
    create table public.bank_transactions (id uuid primary key default gen_random_uuid(), connection_id uuid, business_id uuid, wave_business_id text, bank_source text, plaid_transaction_id text unique not null, account_id text,
      date date not null, posted_date date, amount numeric not null, amount_abs numeric, direction text, iso_currency text default 'USD', name text, category text, channel text, pending boolean default false,
      review_status text default 'unreviewed', classification text, raw jsonb, matched_invoice_id uuid, linked_type text, linked_id uuid, accounting_customer_id uuid, transfer_group_id uuid, third_party_payer text, notes text, created_at timestamptz default now(), updated_at timestamptz default now());
    create table public.accounting_invoices (id uuid primary key, business_id uuid, invoice_number text, accounting_customer_id uuid, total_amount numeric default 0, amount_paid numeric default 0, balance_due numeric, payment_status text default 'unpaid', wave_imported_paid numeric default 0, record_status text default 'active', currency text default 'USD', wave_business_id text);
    create table public.accounting_invoice_payments (id uuid primary key default gen_random_uuid(), business_id uuid, wave_business_id text, accounting_invoice_id uuid, accounting_customer_id uuid, amount numeric, payment_date date, source text, bank_transaction_id uuid, payment_match_id uuid, wave_payment_id text, sync_status text, memo text, created_by uuid, voided boolean default false, voided_at timestamptz, voided_by uuid);
    create table public.payment_matches (id uuid primary key default gen_random_uuid(), business_id uuid, wave_business_id text, bank_transaction_id uuid not null, invoice_id uuid not null, matched_amount numeric not null, match_type text, is_manual_override boolean, notes text, matched_by uuid, created_by uuid, accounting_customer_id uuid, voided boolean default false, voided_at timestamptz, voided_by uuid);
    create table public.bank_transaction_splits (id uuid primary key default gen_random_uuid(), bank_transaction_id uuid);
    create table public.party_money_entries (id uuid primary key default gen_random_uuid(), kind text, bank_transaction_id uuid);
    create table public.unapplied_deposits (id uuid primary key default gen_random_uuid(), bank_transaction_id uuid, amount numeric, status text default 'open');
    create table public.customer_credits (id uuid primary key default gen_random_uuid(), source_transaction_id uuid, amount numeric, status text default 'open');
    create table public.vendor_bills (id uuid primary key, wave_business_id text, vendor_name text, bill_number text, currency text default 'USD', total_amount numeric, record_status text default 'active', disputed boolean default false);
    create table public.vendor_bill_payments (id uuid primary key default gen_random_uuid(), bill_id uuid, amount numeric check (amount > 0), paid_date date, bank_transaction_id uuid, method text, voided boolean default false, created_by uuid, request_id text);
    create table public.wire_package_lines (id uuid primary key default gen_random_uuid(), package_id uuid, bill_id uuid, amount numeric, is_open boolean default true, payment_id uuid);
    insert into public.accounting_invoices (id, invoice_number, total_amount, balance_due, wave_business_id) values ('${INV}', 'INV-1', 1000, 1000, '${US}'), ('${INV2}', 'INV-2', 300, 300, '${US}'), ('${INVE}', 'EG-1', 500, 500, '${EG}');
    insert into public.vendor_bills (id, wave_business_id, vendor_name, bill_number, total_amount) values ('${BILL}', '${US}', 'Kronos', 'K-1', 400), ('${BILLE}', '${EG}', 'Cairo Co', 'C-1', 100);
    insert into public.bank_transactions (id, wave_business_id, plaid_transaction_id, account_id, date, posted_date, amount, amount_abs, direction, name) values
      ('${DEP}', '${US}', 'p-dep', 'CHASE6338', '2026-10-12', '2026-10-12', -500, 500, 'in', 'DEPOSIT'), ('${DEP2}', '${US}', 'p-dep2', 'CHASE6338', '2026-10-13', '2026-10-13', -700, 700, 'in', 'DEPOSIT 2');
  `);
  await db.exec(us);
  await db.exec(yf);
  return db;
}
const j = (r) => r.rows[0][Object.keys(r.rows[0])[0]];
async function call(db, fn, p) { try { return { ok: true, v: j(await db.query('select public.' + fn + '($1::jsonb) as r', [JSON.stringify(p)])) }; } catch (e) { return { ok: false, e: String(e.message || e) }; } }
async function one(db, sql) { return (await db.query(sql)).rows[0]; }
async function tryExec(db, sql) { try { await db.exec(sql); return null; } catch (e) { return String(e.message || e); } }
const bal = async (db, d) => Number((await one(db, `select public.hub_cash_balance(${d ? `'${d}'` : 'null'}) v`)).v);
const P = (o) => Object.assign({ entry_date: '2026-10-10', person: 'Ahmed (front desk)', reference: 'Receipt 0001', note: null, actor: ACTOR, request_id: 'r' + Math.random() }, o);

let db = await fresh();
const chk = (await db.query(`select what, result from (select 'x' as what, 'y' as result) x`)).rows;
check('the script installs; account private + ledger mapped to "Cash on Hand" + installed flag', (await one(db, `select is_private p, wave_business_id w, mask m from plaid_accounts where plaid_account_id='manual-acct-cash-on-hand-us'`)).p === true
  && (await one(db, `select count(*)::int n from clickbooks_us.bank_ledger_map where provider_account_id='manual-acct-cash-on-hand-us' and reviewed`)).n === 1 && (await one(db, 'select public.hub_cash_installed() v')).v === true && chk.length === 1);
check('it re-runs cleanly: still ONE account, ONE connection, ONE ledger map', (await tryExec(db, yf)) === null && (await one(db, `select count(*)::int n from plaid_accounts where plaid_account_id='manual-acct-cash-on-hand-us'`)).n === 1
  && (await one(db, `select count(*)::int n from bank_connections where plaid_item_id='manual-cash-on-hand-us'`)).n === 1 && (await one(db, `select count(*)::int n from clickbooks_us.bank_ledger_map`)).n === 1);
const db2 = await fresh({ twoCash: true });
check('two ledger accounts called "Cash on Hand" → NOT mapped (never a guess)', (await one(db2, `select count(*)::int n from clickbooks_us.bank_ledger_map`)).n === 0);

// receive an invoice in cash
let r = await call(db, 'hub_cash_receive_invoice', P({ invoice_id: INV, amount: 600, request_id: 'rcv1' }));
const inv1 = await one(db, `select amount_paid, balance_due, payment_status from accounting_invoices where id='${INV}'`);
const line1 = r.ok ? await one(db, `select account_id, direction, amount_abs, matched_invoice_id, review_status, classification, pending from bank_transactions where id='${r.v.line_id}'`) : null;
check('cash received 600 on INV-1 (1,000): a money-IN line on Cash on Hand, matched to the invoice; invoice paid 600 / due 400 / partial; box 600', r.ok && line1.account_id === 'manual-acct-cash-on-hand-us' && line1.direction === 'in' && Number(line1.amount_abs) === 600 && line1.matched_invoice_id === INV
  && Number(inv1.amount_paid) === 600 && Number(inv1.balance_due) === 400 && inv1.payment_status === 'partial' && (await bal(db)) === 600, [r, line1, inv1]);
check('… with the invoice payment (source cash, waiting for Wave) and the match row, both on that line; audited', (await one(db, `select count(*)::int n from accounting_invoice_payments where source='cash' and bank_transaction_id='${r.v.line_id}' and sync_status='pending_wave_sync' and amount=600`)).n === 1
  && (await one(db, `select count(*)::int n from payment_matches where bank_transaction_id='${r.v.line_id}' and matched_amount=600`)).n === 1 && (await one(db, `select count(*)::int n from hub_audit_log where action='cash_receive_invoice'`)).n === 1);
r = await call(db, 'hub_cash_receive_invoice', P({ invoice_id: INV, amount: 600, request_id: 'rcv1' }));
check('the same click again: same answer, received once', r.ok && r.v.repeat === true && (await one(db, `select count(*)::int n from cash_entries`)).n === 1, r);
for (const [label, o, why] of [['more than the invoice still owes (400)', { invoice_id: INV, amount: 400.01 }, /only has \$400\.00 left/], ['another company\'s invoice', { invoice_id: INVE, amount: 10 }, /another company/],
  ['no receipt / note', { invoice_id: INV, amount: 10, reference: '' }, /receipt number or note/], ['no person', { invoice_id: INV, amount: 10, person: '' }, /who handed over/], ['a date in a closed month', { invoice_id: INV, amount: 10, entry_date: '2026-09-15' }, /closed month/],
  ['a future date', { invoice_id: INV, amount: 10, entry_date: '2099-01-01' }, /future/], ['zero', { invoice_id: INV, amount: 0 }, /above zero/]]) {
  r = await call(db, 'hub_cash_receive_invoice', P(o)); check('receive refused: ' + label, !r.ok && why.test(r.e), r);
}

// pay a bill in cash
r = await call(db, 'hub_cash_pay_bill', P({ bill_id: BILL, amount: 400, entry_date: '2026-10-11', request_id: 'pay1' }));
check('a 400 bill paid in cash: money-OUT line + the bill payment (method cash) on it; box 600 → 200', r.ok && (await one(db, `select count(*)::int n from vendor_bill_payments where method='cash' and bank_transaction_id='${r.v.line_id}' and amount=400`)).n === 1 && (await bal(db)) === 200, r);
r = await call(db, 'hub_cash_pay_bill', P({ bill_id: BILL, amount: 1, entry_date: '2026-10-11' }));
check('the bill payment caps still apply: a cash payment beyond what the bill owes is refused', !r.ok && /more than (its total|it owes)/.test(r.e), r);
r = await call(db, 'hub_cash_receive_invoice', P({ invoice_id: INV2, amount: 300, entry_date: '2026-10-11', request_id: 'rcv2' }));
await db.exec(`insert into vendor_bills (id, wave_business_id, vendor_name, bill_number, total_amount) values ('22222222-0000-0000-0000-000000000009', '${US}', 'AMB', 'A-9', 900)`);
r = await call(db, 'hub_cash_pay_bill', P({ bill_id: '22222222-0000-0000-0000-000000000009', amount: 500.01, entry_date: '2026-10-11' }));
check('NEVER below zero: the box has 500 — paying 500.01 in cash is refused', !r.ok && /below zero/.test(r.e), r);
r = await call(db, 'hub_cash_pay_bill', P({ bill_id: '22222222-0000-0000-0000-000000000009', amount: 100, entry_date: '2026-10-09' }));
check('… also not on an EARLIER date, before the cash came in (box empty on 9 Oct)', !r.ok && /below zero/.test(r.e), r);
r = await call(db, 'hub_cash_pay_bill', P({ bill_id: BILLE, amount: 10, entry_date: '2026-10-11' }));
check('another company\'s bill cannot be paid from KTC USA cash', !r.ok && /another company/.test(r.e), r);

// the guards against hand changes
const cashLine = (await one(db, `select id from bank_transactions where account_id='manual-acct-cash-on-hand-us' limit 1`)).id;
let e = await tryExec(db, `insert into bank_transactions (wave_business_id, plaid_transaction_id, account_id, date, amount, amount_abs, direction) values ('${US}', 'hand1', 'manual-acct-cash-on-hand-us', '2026-10-10', -50, 50, 'in')`);
check('a hand-entered line on Cash on Hand is refused', !!e && /only made in Accounting/.test(e), e);
e = await tryExec(db, `update bank_transactions set amount_abs = 1 where id='${cashLine}'`);
check('changing a cash line by hand is refused', !!e && /change only through/.test(e), e);
e = await tryExec(db, `update bank_transactions set review_status='duplicate' where id='${cashLine}'`);
check('… also its status (so an undone line cannot come back by a status change)', !!e && /change only through/.test(e), e);
e = await tryExec(db, `delete from bank_transactions where id='${cashLine}'`);
check('a cash line is never deleted', !!e && /never deleted/.test(e), e);
e = await tryExec(db, `insert into accounting_invoice_payments (accounting_invoice_id, amount, bank_transaction_id) values ('${INV}', 1, '${cashLine}')`);
check('a payment cannot be hung on a cash line from another screen', !!e && /matched only through/.test(e), e);
e = await tryExec(db, `update bank_transactions set wave_sync_status = 'x' where id='${cashLine}'`);
check('… but sync stamps (Wave / ledger) on a cash line are fine', e === null || /column "wave_sync_status"/.test(e), e);

// deposit to the bank
r = await call(db, 'hub_cash_deposit', P({ amount: 500, entry_date: '2026-10-12', bank_transaction_id: DEP, request_id: 'dep1' }));
const pair = r.ok ? await one(db, `select a.transfer_group_id g1, b.transfer_group_id g2, b.classification c from bank_transactions a, bank_transactions b where a.id='${r.v.line_id}' and b.id='${DEP}'`) : null;
check('cash 500 deposited, paired with the bank\'s 500 money-in line as ONE transfer (the deposit is not income again); box 0', r.ok && pair.g1 && pair.g1 === pair.g2 && pair.c === 'transfer' && (await bal(db)) === 0, [r, pair]);
r = await call(db, 'hub_cash_deposit', P({ amount: 1, entry_date: '2026-10-13' }));
check('depositing more than the box holds is refused', !r.ok && /below zero/.test(r.e), r);
await call(db, 'hub_cash_adjust', P({ direction: 'in', amount: 700, entry_date: '2026-10-13', note: 'opening float counted', request_id: 'adj1' }));
for (const [label, line, amt, why] of [['the same bank line again', DEP, 500, /paired as a transfer between own accounts/], ['a different amount', DEP2, 600, /same amount/], ['a cash line', cashLine, 600, /BANK line/]]) {
  r = await call(db, 'hub_cash_deposit', P({ amount: amt, entry_date: '2026-10-12', bank_transaction_id: line })); check('deposit refused: ' + label, !r.ok && why.test(r.e), r);
}
r = await call(db, 'hub_cash_deposit', P({ amount: 700, entry_date: '2026-10-13', request_id: 'dep2' }));
const dep2 = r.ok ? r.v.entry_id : null;
check('a deposit can be recorded BEFORE the bank line arrives (box −700, not paired yet)', r.ok && r.v.paired === false && (await bal(db)) === 0, r);
r = await call(db, 'hub_cash_deposit_pair', { entry_id: dep2, bank_transaction_id: DEP2, actor: ACTOR });
check('… and paired when it arrives', r.ok && (await one(db, `select transfer_group_id g from bank_transactions where id='${DEP2}'`)).g !== null, r);
r = await call(db, 'hub_cash_adjust', P({ direction: 'in', amount: 5, note: 'x', request_id: 'adj2' }));
check('a cash count change needs a reason', !r.ok && /reason/.test(r.e), r);

// undo
const rcv2 = (await one(db, `select id, invoice_payment_id from cash_entries where request_id='rcv2'`));
r = await call(db, 'hub_cash_undo', { entry_id: rcv2.id, reason: 'x', actor: ACTOR });
check('undo needs a reason', !r.ok && /say why/.test(r.e), r);
r = await call(db, 'hub_cash_undo', { entry_id: rcv2.id, reason: 'wrong invoice', actor: ACTOR });
check('undoing the 300 cash receipt would take the box below zero (it was already deposited) → refused', !r.ok && /below zero/.test(r.e), r);
r = await call(db, 'hub_cash_undo', { entry_id: dep2, reason: 'not deposited yet', actor: ACTOR });
check('undo the unbanked-then-paired deposit: unpaired, its cash line taken out; box back to 700', r.ok && (await one(db, `select transfer_group_id g from bank_transactions where id='${DEP2}'`)).g === null && (await bal(db)) === 700, r);
r = await call(db, 'hub_cash_undo', { entry_id: rcv2.id, reason: 'wrong invoice', actor: ACTOR });
check('… still refused: the 500 deposited on 12 Oct used that cash (the box would be −300 that day)', !r.ok && r.e.indexOf('below zero ($-300.00)') >= 0, r);
const dep1 = (await one(db, `select id from cash_entries where request_id='dep1'`)).id;
r = await call(db, 'hub_cash_undo', { entry_id: dep1, reason: 'deposit was the other envelope', actor: ACTOR });
check('undo the 12 Oct deposit: the bank’s 500 line is unpaired again (free to match), box 1,200', r.ok && (await one(db, `select transfer_group_id g, classification c from bank_transactions where id='${DEP}'`)).g === null && (await bal(db)) === 1200, r);
r = await call(db, 'hub_cash_undo', { entry_id: rcv2.id, reason: 'wrong invoice', actor: ACTOR });
const inv2 = await one(db, `select amount_paid, balance_due, payment_status from accounting_invoices where id='${INV2}'`);
check('now the receipt undo works: payment + match voided (kept), invoice owes 300 again, line taken out (duplicate), box 900', r.ok && Number(inv2.balance_due) === 300 && inv2.payment_status === 'unpaid'
  && (await one(db, `select voided v, sync_status s from accounting_invoice_payments where id='${rcv2.invoice_payment_id}'`)).v === true && (await bal(db)) === 900, [r, inv2]);
r = await call(db, 'hub_cash_undo', { entry_id: rcv2.id, reason: 'wrong invoice', actor: ACTOR });
check('undo again: harmless repeat', r.ok && r.v.repeat === true);
await db.exec(`update accounting_invoice_payments set sync_status='synced', wave_payment_id='W1' where source='cash' and accounting_invoice_id='${INV}'`);
const rcv1 = (await one(db, `select id from cash_entries where request_id='rcv1'`)).id;
r = await call(db, 'hub_cash_undo', { entry_id: rcv1, reason: 'mistake', actor: ACTOR });
check('a cash receipt already in Wave cannot be undone here (remove it in Wave first)', !r.ok && /already in Wave/.test(r.e), r);
const pay1 = (await one(db, `select id, bill_payment_id from cash_entries where request_id='pay1'`));
r = await call(db, 'hub_cash_undo', { entry_id: pay1.id, reason: 'paid by wire instead', actor: ACTOR });
check('undo the cash bill payment: the payment is voided (the bill owes again), the cash comes back (box 1,300)', r.ok && (await one(db, `select voided v from vendor_bill_payments where id='${pay1.bill_payment_id}'`)).v === true && (await bal(db)) === 1300, r);
e = await tryExec(db, `delete from cash_entries where id='${pay1.id}'`);
check('a cash entry is never deleted', !!e && /never deleted/.test(e), e);
// ── (Codex 24 Nov P1) ONE BANK LINE, ONE USE: cash can only be paired with an otherwise unallocated bank line; a paired line takes nothing else ──
db = await fresh();
await call(db, 'hub_cash_adjust', P({ direction: 'in', amount: 2000, entry_date: '2026-10-11', note: 'opening float counted', request_id: 'f0' }));
const Q1 = '44444444-0000-0000-0000-000000000001', Q2 = '44444444-0000-0000-0000-000000000002', Q3 = '44444444-0000-0000-0000-000000000003', Q4 = '44444444-0000-0000-0000-000000000004';
await db.exec(`insert into bank_transactions (id, wave_business_id, plaid_transaction_id, account_id, date, posted_date, amount, amount_abs, direction, name) values ('${Q1}', '${US}', 'q1', 'CHASE6338', '2026-10-14', '2026-10-14', -500, 500, 'in', 'D'), ('${Q2}', '${US}', 'q2', 'CHASE6338', '2026-10-14', '2026-10-14', -500, 500, 'in', 'D'), ('${Q3}', '${US}', 'q3', 'CHASE6338', '2026-10-14', '2026-10-14', -500, 500, 'in', 'D'), ('${Q4}', '${US}', 'q4', 'CHASE6338', '2026-10-14', '2026-10-14', -500, 500, 'in', 'D')`);
await db.exec(`insert into unapplied_deposits (bank_transaction_id, amount) values ('${Q1}', 500)`);
const box0 = await bal(db);
r = await call(db, 'hub_cash_deposit', P({ amount: 500, entry_date: '2026-10-13', bank_transaction_id: Q1, request_id: 'f1' }));
check('park-then-deposit: a bank line parked as an unapplied customer deposit cannot take cash; nothing changes (box, parked deposit, line)', !r.ok && /parked as an unapplied customer deposit/.test(r.e) && /Undo that allocation first/.test(r.e) && (await bal(db)) === box0
  && (await one(db, `select count(*)::int n from unapplied_deposits where bank_transaction_id='${Q1}' and status='open'`)).n === 1 && (await one(db, `select transfer_group_id g from bank_transactions where id='${Q1}'`)).g === null, r);
r = await call(db, 'hub_cash_deposit', P({ amount: 500, entry_date: '2026-10-13', request_id: 'f2' }));
const later = r.ok ? r.v.entry_id : null;
r = await call(db, 'hub_cash_deposit_pair', { entry_id: later, bank_transaction_id: Q1, actor: ACTOR });
check('park-then-PAIR-LATER: the same refusal when pairing a deposit recorded earlier', !!later && !r.ok && /parked as an unapplied customer deposit/.test(r.e), r);
await db.exec(`insert into bank_transaction_splits (bank_transaction_id) values ('${Q2}'); insert into customer_credits (source_transaction_id, amount) values ('${Q3}', 50)`);
const rS = await call(db, 'hub_cash_deposit_pair', { entry_id: later, bank_transaction_id: Q2, actor: ACTOR }); const rC = await call(db, 'hub_cash_deposit_pair', { entry_id: later, bank_transaction_id: Q3, actor: ACTOR });
check('a SPLIT line and a line holding an open CUSTOMER CREDIT are refused too', !rS.ok && /split into lines/.test(rS.e) && !rC.ok && /open customer credit/.test(rC.e), [rS, rC]);
r = await call(db, 'hub_cash_deposit_pair', { entry_id: later, bank_transaction_id: Q4, actor: ACTOR });
check('an ordinary unused bank line pairs as usual', r.ok, r);
let rev = []; for (const [label, sql] of [['park it', `insert into unapplied_deposits (bank_transaction_id, amount) values ('${Q4}', 500)`], ['split it', `insert into bank_transaction_splits (bank_transaction_id) values ('${Q4}')`],
  ['give it a customer credit', `insert into customer_credits (source_transaction_id, amount) values ('${Q4}', 10)`], ['match it', `insert into payment_matches (bank_transaction_id, invoice_id, matched_amount) values ('${Q4}', '${INV}', 10)`],
  ['make it a customer payment', `insert into accounting_invoice_payments (accounting_invoice_id, amount, bank_transaction_id) values ('${INV}', 10, '${Q4}')`], ['money back', `insert into party_money_entries (kind, bank_transaction_id) values ('refund', '${Q4}')`]]) {
  const err = await tryExec(db, sql); if (!err || !/cash taken to the bank — undo that first/.test(err)) { rev.push([label, err]); } }
check('REVERSE: while it holds a cash deposit, the bank line cannot be parked, split, credited, matched, paid or be money back', rev.length === 0, rev);
r = await call(db, 'hub_cash_undo', { entry_id: later, reason: 'wrong envelope', actor: ACTOR });
const parkOk = await tryExec(db, `insert into unapplied_deposits (bank_transaction_id, amount) values ('${Q4}', 500)`);
check('explicit UNDO of the cash deposit frees the line: an ordinary allocation (parking it) then works', r.ok && parkOk === null && (await one(db, `select transfer_group_id g from bank_transactions where id='${Q4}'`)).g === null, [r, parkOk]);
const priv = await one(db, `select has_function_privilege('authenticated', 'public.hub_cash_receive_invoice(jsonb)', 'EXECUTE') a, has_table_privilege('anon', 'public.cash_entries', 'SELECT') b`);
check('browser roles can neither call the writers nor read the cash book', priv.a === false && priv.b === false, priv);
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
