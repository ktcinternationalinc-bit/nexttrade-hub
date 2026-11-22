// v55.83-XU — REAL Postgres run of sql/v55-83-XU-clear-category.sql (Codex 22 Nov 18:08 P2 + 17:49): loads the real WS ledger
// check and the real XU script into PGlite (Postgres 16 for Node, in memory) on top of a small stand-in of the tables it reads, then
// RUNS hub_bank_clear_category: a clean clear with its audit row; every association refused with its own code and nothing written;
// the "still exactly as read" guard; and an audit-insert failure that leaves the line exactly as it was (all or nothing), then a
// retry that records ONE real change. Needs @electric-sql/pglite: set PGLITE_DIR. Never touches Supabase.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
var here = path.dirname(fileURLToPath(import.meta.url)); var root = path.join(here, '..');
var req = createRequire(path.join(process.env.PGLITE_DIR || root, 'package.json'));
var PGlite;
try { PGlite = (await import('file://' + req.resolve('@electric-sql/pglite').replace(/\\/g, '/'))).PGlite; }
catch (e) { console.log('SKIPPED — @electric-sql/pglite not found (set PGLITE_DIR). Nothing was checked.'); process.exit(2); }
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 900))); }
var US = 'QnVzaW5lc3M6NWRkNzI3MDctOTExNC00NjQwLTg4MGQtMjYzNmI3YzM4YTdk';
var ACTOR = '11111111-1111-1111-1111-111111111111';
var db = new PGlite();
console.log('XU — hub_bank_clear_category on real Postgres (PGlite)');
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema clickbooks_us;
create table clickbooks_us.books (id int primary key, locked_through date);
insert into clickbooks_us.books values (1, null);
create table clickbooks_us.journals (id serial primary key, source_kind text, source_id text);
create table clickbooks_us.manual_bank_adjustments (id serial primary key, bank_transaction_id uuid, reversed_at timestamptz);
create table public.bank_transactions (id uuid primary key default gen_random_uuid(), name text, merchant_name text, account_id text, wave_business_id text,
  date date, posted_date date, amount_abs numeric, direction text, pending boolean default false, transfer_group_id uuid, matched_invoice_id uuid,
  classification text, category_source text, category_verified boolean default false, review_status text, reviewed_by uuid, reviewed_at timestamptz,
  wave_account_id text, wave_account_name text, category_status text, wave_sync_status text, sync_status text);
create table public.hub_audit_log (id uuid primary key default gen_random_uuid(), at timestamptz default now(), actor_id uuid, action text, entity text, entity_id text, details jsonb, created_at timestamptz default now());
create table public.accounting_invoice_payments (id serial primary key, bank_transaction_id uuid, voided boolean);
create table public.payment_matches (id serial primary key, bank_transaction_id uuid, voided boolean);
create table public.vendor_bill_payments (id serial primary key, bank_transaction_id uuid, voided boolean);
create table public.bank_transaction_splits (id serial primary key, bank_transaction_id uuid, split_amount numeric);
create table public.unapplied_deposits (id serial primary key, bank_transaction_id uuid, status text);
create table public.customer_credits (id serial primary key, source_transaction_id uuid, status text);
create table public.wire_packages (id serial primary key, bank_transaction_id uuid, funding_txn_id uuid, status text, reversed_at timestamptz);
create table public.party_money_entries (id serial primary key, bank_transaction_id uuid, source_bank_transaction_id uuid);
create table public.party_funding_transfers (id serial primary key, bank_transaction_id uuid);
create table public.party_reconciliations (id serial primary key, bank_transaction_id uuid);
create table public.company_bill_links (id serial primary key, source_bank_transaction_id uuid, status text);
create table public.order_deposit_links (id serial primary key, bank_transaction_id uuid, voided boolean);
create table public.treasury (id serial primary key, matched_bank_txn_id uuid);
`);
for (var f of ['v55-83-WS-ledger-posted-check.sql', 'v55-83-XU-clear-category.sql', 'v55-83-XU-clear-category.sql']) {
  var e = null; try { await db.exec(fs.readFileSync(path.join(root, 'sql', f), 'utf8')); } catch (x) { e = String(x.message || x); }
  check('script ' + f + ' runs (the XU script twice: safe to re-run)', !e, e);
}
async function one(sql, params) { return (await db.query(sql, params || [])).rows[0]; }
async function count(sql, params) { return Number((await one(sql, params)).n); }
async function line(o) {
  var d = Object.assign({ name: 'PUBLIC SERVICE ELEC', account_id: 'A1', wave_business_id: US, date: '2026-11-05', posted_date: '2026-11-05', amount_abs: 10, direction: 'out', classification: 'utilities', category_source: 'classification', review_status: 'reviewed', reviewed_by: ACTOR, reviewed_at: '2026-11-10T00:00:00Z', wave_account_id: 'W-UTIL', wave_account_name: 'Utilities (Wave)', category_status: 'pending_wave_sync', wave_sync_status: 'not_synced', sync_status: 'not_synced' }, o || {});
  var keys = Object.keys(d);
  return (await one('insert into bank_transactions (' + keys.join(',') + ') values (' + keys.map(function (k, i) { return '$' + (i + 1); }).join(',') + ') returning id', keys.map(function (k) { return d[k]; }))).id;
}
var EXP = ['classification', 'category_source', 'category_verified', 'review_status', 'wave_account_id', 'category_status', 'wave_sync_status', 'sync_status', 'transfer_group_id', 'matched_invoice_id', 'pending', 'account_id', 'date', 'posted_date'];
async function expectOf(id) {
  var t = await one('select classification, category_source, category_verified, review_status, wave_account_id, category_status, wave_sync_status, sync_status, transfer_group_id::text, matched_invoice_id::text, pending, account_id, date::text, posted_date::text from bank_transactions where id = $1', [id]);
  var o = {}; EXP.forEach(function (k) { o[k] = t[k] === undefined ? null : t[k]; }); return o;
}
async function clear(id, expect, biz) { return (await one('select public.hub_bank_clear_category($1::jsonb) as r', [JSON.stringify({ id: id, actor: ACTOR, business: biz || US, expect: expect || await expectOf(id) })])).r; }
async function state(id) { return JSON.stringify(await one('select * from bank_transactions where id = $1', [id])); }
async function audits(id) { return count("select count(*) n from hub_audit_log where action = 'category_removed' and entity_id = $1", [String(id)]); }

// 1. a clean clear: the change and its audit row together
var L1 = await line();
var r1 = await clear(L1);
var T1 = await one('select * from bank_transactions where id = $1', [L1]);
check('CLEAR: ok; category off, marked cleared, Wave category off, local only, reviewed → unreviewed (who / when cleared)', r1.ok === true && T1.classification === null && T1.category_source === 'cleared' && T1.wave_account_id === null && T1.wave_account_name === null && T1.category_status === 'local_only' && T1.review_status === 'unreviewed' && T1.reviewed_by === null && T1.reviewed_at === null, [r1, T1]);
var A1 = await one("select * from hub_audit_log where action = 'category_removed' and entity_id = $1", [String(L1)]);
check('AUDIT: one row, written by the same step, with the actor and the exact before (category, source, review, reviewer, Wave) and after', !!A1 && A1.actor_id === ACTOR && A1.details.before.classification === 'utilities' && A1.details.before.review_status === 'reviewed' && A1.details.before.reviewed_by === ACTOR && A1.details.before.wave_account_id === 'W-UTIL' && A1.details.after.category_source === 'cleared' && A1.details.after.review_status === 'unreviewed', A1);
var r1b = await clear(L1);
check('AGAIN: the same line a second time → "blank", nothing written, still one audit row', r1b.ok === false && r1b.code === 'blank' && (await audits(L1)) === 1, r1b);
var L1u = await line({ review_status: 'unreviewed', reviewed_by: null, reviewed_at: null });
await clear(L1u);
check('an UNREVIEWED line stays unreviewed', (await one('select review_status from bank_transactions where id=$1', [L1u])).review_status === 'unreviewed');

// 2. every association → refused with its own code, NOTHING written (line and audit)
async function refused(label, code, setup, lineOpts) {
  var id = await line(lineOpts); if (setup) { await setup(id); }
  var before = await state(id); var r = await clear(id);
  check('REFUSED ' + code + ' — ' + label + ': nothing written, no audit row', r.ok === false && r.code === code && (await state(id)) === before && (await audits(id)) === 0, r);
}
await refused('already in the ClickBooks ledger', 'ledger', async function (id) { await db.query("insert into clickbooks_us.journals (source_kind, source_id) values ('bank_transaction', $1)", [id + ':1']); });
await refused('sent to Wave (wave_sync_status)', 'wave', null, { wave_sync_status: 'synced' });
await refused('syncing to Wave (category_status)', 'wave', null, { category_status: 'syncing' });
await db.query("update clickbooks_us.books set locked_through = '2026-10-31'");
await refused('in a closed month (posted date)', 'closed', null, { date: '2026-11-02', posted_date: '2026-10-30' });
var Lafter = await line({ date: '2026-10-30', posted_date: '2026-11-01' }); var rA = await clear(Lafter);
check('CLOSED MONTH uses the POSTED date: dated in the closed month but posted after it → cleared', rA.ok === true, rA);
await db.query('update clickbooks_us.books set locked_through = null');
await refused('paired as a transfer', 'transfer', null, { transfer_group_id: '22222222-2222-2222-2222-222222222222', classification: 'transfer' });
await refused('matched_invoice_id', 'invoice', null, { matched_invoice_id: '33333333-3333-3333-3333-333333333333', direction: 'in' });
await refused('a live invoice payment', 'invoice', async function (id) { await db.query('insert into accounting_invoice_payments (bank_transaction_id, voided) values ($1, false)', [id]); });
await refused('a live payment match', 'match', async function (id) { await db.query('insert into payment_matches (bank_transaction_id, voided) values ($1, null)', [id]); });
await refused('a live bill payment', 'bill', async function (id) { await db.query('insert into vendor_bill_payments (bank_transaction_id, voided) values ($1, false)', [id]); });
await refused('a saved split', 'split', async function (id) { await db.query('insert into bank_transaction_splits (bank_transaction_id, split_amount) values ($1, 4)', [id]); });
await refused('an open unapplied deposit (held customer money)', 'held', async function (id) { await db.query("insert into unapplied_deposits (bank_transaction_id, status) values ($1, 'open')", [id]); });
await refused('an open customer credit from it', 'held', async function (id) { await db.query("insert into customer_credits (source_transaction_id, status) values ($1, null)", [id]); });
await refused('a wire funded by it', 'wire', async function (id) { await db.query("insert into wire_packages (funding_txn_id, status) values ($1, 'draft')", [id]); });
await refused('the bank line of a sent wire', 'wire', async function (id) { await db.query("insert into wire_packages (bank_transaction_id, status) values ($1, 'sent')", [id]); });
await refused('a company-funds entry (RTM / NextTrade money)', 'funds', async function (id) { await db.query('insert into party_money_entries (source_bank_transaction_id) values ($1)', [id]); });
await refused('a funding transfer', 'funds', async function (id) { await db.query('insert into party_funding_transfers (bank_transaction_id) values ($1)', [id]); });
await refused('a party reconciliation', 'funds', async function (id) { await db.query('insert into party_reconciliations (bank_transaction_id) values ($1)', [id]); });
await refused('an active Nextrade bill link', 'funds', async function (id) { await db.query("insert into company_bill_links (source_bank_transaction_id, status) values ($1, 'active')", [id]); });
await refused('a manual bank adjustment not reversed', 'adjustment', async function (id) { await db.query('insert into clickbooks_us.manual_bank_adjustments (bank_transaction_id) values ($1)', [id]); });
await refused('an order deposit link', 'order', async function (id) { await db.query('insert into order_deposit_links (bank_transaction_id, voided) values ($1, false)', [id]); });
await refused('a treasury match', 'treasury', async function (id) { await db.query('insert into treasury (matched_bank_txn_id) values ($1)', [id]); });
await refused('verified', 'verified', null, { category_verified: true });
await refused('pending at the bank', 'pending', null, { pending: true });
await refused('a marked duplicate', 'duplicate', null, { review_status: 'duplicate' });
// associations that are over (voided / applied / cancelled / reversed / void) do not block
var Lv = await line();
await db.query('insert into accounting_invoice_payments (bank_transaction_id, voided) values ($1, true)', [Lv]); await db.query('insert into payment_matches (bank_transaction_id, voided) values ($1, true)', [Lv]); await db.query('insert into vendor_bill_payments (bank_transaction_id, voided) values ($1, true)', [Lv]);
await db.query("insert into unapplied_deposits (bank_transaction_id, status) values ($1, 'applied')", [Lv]); await db.query("insert into customer_credits (source_transaction_id, status) values ($1, 'void')", [Lv]);
await db.query("insert into wire_packages (funding_txn_id, status) values ($1, 'cancelled')", [Lv]); await db.query("insert into wire_packages (bank_transaction_id, status, reversed_at) values ($1, 'sent', now())", [Lv]);
await db.query("insert into company_bill_links (source_bank_transaction_id, status) values ($1, 'void')", [Lv]); await db.query('insert into clickbooks_us.manual_bank_adjustments (bank_transaction_id, reversed_at) values ($1, now())', [Lv]); await db.query('insert into order_deposit_links (bank_transaction_id, voided) values ($1, true)', [Lv]);
var rV = await clear(Lv);
check('OVER: voided payments / matches / bill payments, applied deposit, void credit, cancelled or reversed wires, void bill link, reversed adjustment, voided order link → cleared', rV.ok === true, rV);
var Ln = await line(); var rN = await clear(Ln);
check('a normal line with no associations at all → cleared (control)', rN.ok === true, rN);

// 3. "still exactly as read" — every compared field, null-safe
var stale = 0; var staleBad = [];
for (var k of EXP) {
  var Ls = await line(); var ex = await expectOf(Ls);
  var exS = Object.assign({}, ex);
  exS[k] = k === 'category_verified' || k === 'pending' ? !ex[k] : (k === 'date' || k === 'posted_date' ? '2026-11-04' : (ex[k] === null ? 'x-something' : (k === 'transfer_group_id' || k === 'matched_invoice_id' ? '44444444-4444-4444-4444-444444444444' : null)));
  var before = await state(Ls); var rs = await clear(Ls, exS);
  if (rs.ok === false && rs.code === 'changed' && (await state(Ls)) === before && (await audits(Ls)) === 0) { stale++; } else { staleBad.push([k, rs]); }
}
check('CHANGED: when any one of the ' + EXP.length + ' compared fields (incl. pending, account, dates, Wave and sync status, pairing, invoice match, verified) differs from what was read → "changed", nothing written', stale === EXP.length, staleBad);
var Lb = await line(); var rB = await clear(Lb, null, 'OTHER-COMPANY');
check('another company’s line → "restricted", nothing written', rB.ok === false && rB.code === 'restricted' && (await audits(Lb)) === 0, rB);
var rM = (await one('select public.hub_bank_clear_category($1::jsonb) as r', [JSON.stringify({ id: '55555555-5555-5555-5555-555555555555', actor: ACTOR, business: US, expect: {} })])).r;
var rNoA = (await one('select public.hub_bank_clear_category($1::jsonb) as r', [JSON.stringify({ id: Ln, business: US, expect: {} })])).r;
check('a line that does not exist → "missing"; no actor → refused', rM.code === 'missing' && rNoA.code === 'no_actor');

// 4. all or nothing: the audit insert fails → the line is exactly as it was; a retry then records ONE real change
var Lf = await line(); var beforeF = await state(Lf);
await db.exec("create function t_fail() returns trigger language plpgsql as $f$ begin raise exception 'injected audit failure'; end $f$; create trigger t_fail before insert on hub_audit_log for each row execute function t_fail();");
var errF = null; try { await clear(Lf); } catch (x) { errF = String(x.message || x); }
check('AUDIT FAILS: the whole step fails and the LINE IS UNCHANGED (category still there) — never cleared without its audit', /injected audit failure/.test(errF || '') && (await state(Lf)) === beforeF && (await audits(Lf)) === 0, errF);
await db.exec('drop trigger t_fail on hub_audit_log; drop function t_fail();');
var rF = await clear(Lf);
check('RETRY after the failure: cleared once, ONE audit row with the original before', rF.ok === true && (await audits(Lf)) === 1 && (await one("select details from hub_audit_log where action='category_removed' and entity_id=$1", [String(Lf)])).details.before.classification === 'utilities', rF);

// 5. who may run it
var priv = await one("select has_function_privilege('anon','public.hub_bank_clear_category(jsonb)','execute') a, has_function_privilege('authenticated','public.hub_bank_clear_category(jsonb)','execute') b, has_function_privilege('service_role','public.hub_bank_clear_category(jsonb)','execute') c");
check('only the server (service_role) may run it; browser roles may not', priv.a === false && priv.b === false && priv.c === true, priv);
var xuSql = fs.readFileSync(path.join(root, 'sql/v55-83-XU-clear-category.sql'), 'utf8');
var lastCheck = (await db.query(xuSql.substring(xuSql.indexOf("select 'hub_bank_clear_category installed'")).trim().replace(/;\s*$/, ''))).rows;
check('the script ends with its own OK lines', lastCheck.length === 3 && lastCheck.every(function (r) { return r.result === 'OK'; }), lastCheck);

console.log('\nXU real Postgres: ' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
