// ═══════════════════════════════════════════════════════════════════════════
// v55.83-TW / TX — REAL Postgres run (Codex QA 17 Nov, P1-2 + the money function). Loads the REAL scripts
// sql/v55-83-TO-payment-guards.sql, v55-83-TV-repeating-bills.sql, v55-83-TW-company-books.sql, v55-83-TX-advances-fees.sql
// into PGlite (Postgres 16 compiled for Node, in memory) on top of __tests__/pg/stub-schema.sql, then RUNS
// hub_company_categorize and hub_party_money — including failures injected half-way to prove "all or nothing".
// Needs @electric-sql/pglite: set PGLITE_DIR to a folder whose node_modules has it (it is NOT a project dependency).
// Limits: one connection — real two-session concurrency is NOT shown here (locks + unique indexes are checked by reading
// the SQL and by the unique-index probes below). Never touches Supabase.
// ═══════════════════════════════════════════════════════════════════════════
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
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra))); }
async function fails(db, sql, params) { try { await db.query(sql, params || []); return null; } catch (e) { return String(e.message || e); } }
var ACTOR = '11111111-1111-1111-1111-111111111111';
var US = 'QnVzaW5lc3M6NWRkNzI3MDctOTExNC00NjQwLTg4MGQtMjYzNmI3YzM4YTdk';
var db = new PGlite();
console.log('TW / TX — real Postgres (PGlite)');
await db.exec(fs.readFileSync(path.join(here, 'pg/stub-schema.sql'), 'utf8'));
for (var f of ['v55-83-TO-payment-guards.sql', 'v55-83-TV-repeating-bills.sql', 'v55-83-TW-company-books.sql', 'v55-83-TX-advances-fees.sql']) {
  var e = null; try { await db.exec(fs.readFileSync(path.join(root, 'sql', f), 'utf8')); } catch (x) { e = String(x.message || x); }
  check('script ' + f + ' runs', !e, e);
}
var again = null; try { await db.exec(fs.readFileSync(path.join(root, 'sql/v55-83-TV-TW-TX-all-in-one.sql'), 'utf8')); } catch (x) { again = String(x.message || x); }
check('the combined TV+TW+TX file runs again on top (safe to re-run)', !again, again);
async function one(sql, params) { return (await db.query(sql, params || [])).rows[0]; }
async function count(sql, params) { return Number((await one(sql, params)).n); }

// ── TV ──
var b1 = await one("insert into vendor_bills (vendor_name, bill_date, total_amount, recurring_id, recurring_date) values ('A','2026-12-01',1,'22222222-2222-2222-2222-222222222222','2026-12-01') returning id");
check('TV: one bill per repeating bill per date — enforced by the database', !!(await fails(db, "insert into vendor_bills (vendor_name, bill_date, total_amount, recurring_id, recurring_date) values ('A','2026-12-01',1,'22222222-2222-2222-2222-222222222222','2026-12-01')")) && !!b1);

// ── TW: one function, all or nothing ──
await db.query("insert into company_categories (company_id, key, label, kind) values ('NEXTRADE_BOOKS','elec','Electricity','expense'), ('RTM_BOOKS','rent','Rent','expense')");
var L1 = (await one("insert into bank_transactions (wave_business_id, account_id, direction, amount_abs, date, name) values ('NEXTRADE_BOOKS','A1','out',412.5,'2026-11-17','CENTERPOINT') returning id")).id;
function bill(lineId) { return { wave_business_id: US, vendor_name: 'CenterPoint Energy', bill_number: 'NXT-20261117-' + String(lineId).substring(0, 6).toUpperCase(), bill_date: '2026-11-17', due_date: '2026-11-30', notes: 'Created from Nextrade' }; }
async function cat(lineId, key, extra) { return (await one('select public.hub_company_categorize($1::jsonb) as r', [JSON.stringify(Object.assign({ line_id: lineId, company_id: 'NEXTRADE_BOOKS', category_key: key, actor: ACTOR, ktc_category: 'utilities', party: 'NextTrade Industries', bill: bill(lineId), source: 'manual' }, extra || {}))])).r; }
async function catErr(lineId, key, extra) { try { await cat(lineId, key, extra); return null; } catch (x) { return String(x.message || x); } }
var r = await cat(L1, 'elec');
var B = await one('select * from vendor_bills where id = $1', [r.bill_id]);
check('expense → KTC bill made: full amount, end of month, paid via NextTrade, KTC category, KTC books', r.action === 'created' && Number(B.total_amount) === 412.5 && String(B.due_date).indexOf('2026-11-30') >= 0 || (B.due_date && new Date(B.due_date).toISOString().substring(0, 10) === '2026-11-30'), B);
check('… paid via NextTrade, category from the mapping, open, KTC books', B.paid_via === 'NextTrade Industries' && B.category === 'utilities' && B.record_status === 'active' && B.wave_business_id === US);
check('… line category, link and audit saved together', (await one('select company_category from bank_transactions where id=$1', [L1])).company_category === 'elec' && (await count("select count(*) n from company_bill_links where source_bank_transaction_id=$1 and status='active' and bill_id=$2", [L1, r.bill_id])) === 1 && (await count("select count(*) n from hub_audit_log where action in ('bill_created','company_line_categorized')")) === 2);
var r2 = await cat(L1, 'elec');
check('same category again → same bill (idempotent), never a second', r2.action === 'updated' && (await count('select count(*) n from vendor_bills where notes = $1', ['Created from Nextrade'])) === 1);
var r3 = await cat(L1, 'own_transfer');
check('no longer an expense → bill VOIDED (kept), link void, line category saved', r3.action === 'voided' && (await one('select record_status from vendor_bills where id=$1', [r.bill_id])).record_status === 'void' && (await one('select company_category from bank_transactions where id=$1', [L1])).company_category === 'own_transfer');
var r4 = await cat(L1, 'elec');
check('expense again → the SAME bill comes back', r4.action === 'restored' && r4.bill_id === r.bill_id && (await one('select record_status from vendor_bills where id=$1', [r.bill_id])).record_status === 'active');

// failure injected AFTER the bill insert (the final link write fails) → nothing at all is left behind
var L2 = (await one("insert into bank_transactions (wave_business_id, account_id, direction, amount_abs, date, name) values ('NEXTRADE_BOOKS','A1','out',99,'2026-11-18','POWER') returning id")).id;
await db.exec("create function t_fail() returns trigger language plpgsql as $$ begin raise exception 'injected link failure'; end $$; create trigger t_fail before insert on company_bill_links for each row execute function t_fail();");
var billsBefore = await count('select count(*) n from vendor_bills');
var e2 = await catErr(L2, 'elec');
check('final link write fails → error returned, NO bill left behind, line NOT categorized, no audit', !!e2 && /injected link failure/.test(e2) && (await count('select count(*) n from vendor_bills')) === billsBefore && (await one('select company_category from bank_transactions where id=$1', [L2])).company_category === null && (await count("select count(*) n from hub_audit_log where entity_id = $1", [String(L2)])) === 0, e2);
await db.exec('drop trigger t_fail on company_bill_links');
// failure injected in the LAST step (the line's category write) → bill and link undone too
await db.exec("create trigger t_fail2 before update on bank_transactions for each row execute function t_fail();");
var e3 = await catErr(L2, 'elec');
check('category write fails → bill and link undone too (all or nothing)', !!e3 && (await count('select count(*) n from vendor_bills')) === billsBefore && (await count('select count(*) n from company_bill_links where source_bank_transaction_id=$1', [L2])) === 0, e3);
await db.exec('drop trigger t_fail2 on bank_transactions');
var r5 = await cat(L2, 'elec');
check('retry after the failures → exactly one bill', r5.action === 'created' && (await count('select count(*) n from company_bill_links where source_bank_transaction_id=$1', [L2])) === 1 && (await count('select count(*) n from vendor_bills')) === billsBefore + 1);
check('database refuses a second link for the same line', !!(await fails(db, "insert into company_bill_links (source_bank_transaction_id, company_id, status) values ($1,'NEXTRADE_BOOKS','active')", [L2])));

// attach to an existing open bill (proposed by the server, re-checked under the lock)
var RENT = (await one("insert into vendor_bills (wave_business_id, vendor_name, bill_number, bill_date, total_amount) values ($1,'Rent Co','AUTO-RENT-1','2026-11-15',3000) returning id", [US])).id;
var L3 = (await one("insert into bank_transactions (wave_business_id, account_id, direction, amount_abs, date, name) values ('NEXTRADE_BOOKS','A1','out',3000,'2026-11-17','RENT CO') returning id")).id;
var r6 = await cat(L3, 'elec', { attach_bill_id: RENT });
check('open KTC bill attached instead of a second bill; it becomes paid via NextTrade', r6.action === 'attached' && r6.bill_id === RENT && (await one('select paid_via from vendor_bills where id=$1', [RENT])).paid_via === 'NextTrade Industries');
var L4 = (await one("insert into bank_transactions (wave_business_id, account_id, direction, amount_abs, date, name) values ('NEXTRADE_BOOKS','A1','out',3000,'2026-11-18','RENT CO') returning id")).id;
var r7 = await cat(L4, 'elec', { attach_bill_id: RENT });
check('a bill already attached to another line is NOT attached again — a new bill is made', r7.action === 'created' && r7.bill_id !== RENT);
var r8 = await cat(L3, 'own_transfer');
check('detaching never voids the attached bill and gives back its paid-via', r8.action === 'detached' && (await one('select record_status, paid_via from vendor_bills where id=$1', [RENT])).record_status === 'active' && (await one('select paid_via from vendor_bills where id=$1', [RENT])).paid_via === null);

// a bill with money on it is never voided; payroll / RTM / wrong company
await db.query("insert into vendor_bill_payments (bill_id, amount, paid_date, method) values ($1, 10, '2026-11-20', 'test')", [r.bill_id]);
var e4 = await catErr(L1, 'own_transfer');
check('bill with a payment → change refused; bill and line untouched', !!e4 && /undo that payment/.test(e4) && (await one('select record_status from vendor_bills where id=$1', [r.bill_id])).record_status === 'active' && (await one('select company_category from bank_transactions where id=$1', [L1])).company_category === 'elec');
var L5 = (await one("insert into bank_transactions (wave_business_id, account_id, direction, amount_abs, date, name) values ('NEXTRADE_BOOKS','A1','out',5000,'2026-11-17','ADP PAYROLL') returning id")).id;
var r9 = await cat(L5, 'payroll');
check('payroll → no bill, no link', r9.action === 'none' && (await count('select count(*) n from company_bill_links where source_bank_transaction_id=$1', [L5])) === 0);
var R1 = (await one("insert into bank_transactions (wave_business_id, account_id, direction, amount_abs, date, name) values ('RTM_BOOKS','R1','out',800,'2026-11-17','LANDLORD') returning id")).id;
var r10 = (await one('select public.hub_company_categorize($1::jsonb) as r', [JSON.stringify({ line_id: R1, company_id: 'RTM_BOOKS', category_key: 'rent', actor: ACTOR })])).r;
check('RTM line: categorized, never a KTC bill', r10.action === 'none' && (await one('select company_category from bank_transactions where id=$1', [R1])).company_category === 'rent' && (await count('select count(*) n from company_bill_links where source_bank_transaction_id=$1', [R1])) === 0);
check('a line of another company is refused', !!(await catErr(R1, 'elec')));
check('another company\'s category is refused', !!(await catErr(L5, 'rent')));

// ── TX: hub_party_money ──
var NT = 'NextTrade Industries';
async function money(a, amount, fee, bank, billId, reason, reqId) { return (await one('select public.hub_party_money($1,$2,$3,$4,$5,$6,$7,$8,$9) as r', [a, NT, amount, fee, bank, billId, reason, ACTOR, reqId || null])).r; }
async function moneyErr() { try { await money.apply(null, arguments); return null; } catch (x) { return String(x.message || x); } }
async function bal() { return one("select coalesce(sum(amount) filter (where bucket='advance'),0)::float adv, coalesce(sum(amount) filter (where bucket='fee'),0)::float fee from party_money_entries where party=$1", [NT]); }
var W1 = (await one("insert into bank_transactions (wave_business_id, account_id, direction, amount_abs, date, name, third_party_payer) values ($1,'K1','out',10000,'2026-11-20','WIRE NEXTTRADE','NextTrade Industries') returning id", [US])).id;
var s1 = await money('split', 3000, 500, W1, null, null, 'req-1');
var b0 = await bal();
check('split a payment: advance 3,000 + extra fee 500', s1.ok && b0.adv === 3000 && b0.fee === 500);
check('the same click again → nothing moved twice', (await money('split', 3000, 500, W1, null, null, 'req-1')).repeat === true && (await bal()).adv === 3000);
check('the same click id re-used for a DIFFERENT move is refused (not silently treated as a repeat)', /different move/.test(await moneyErr('split', 1000, 0, W1, null, null, 'req-1') || '') && (await bal()).adv === 3000);
check('split beyond the payment is refused', /over by/.test(await moneyErr('split', 7000, 0, W1, null, null, 'req-2') || ''));
var W2 = (await one("insert into bank_transactions (wave_business_id, account_id, direction, amount_abs, date, name) values ($1,'K1','out',500,'2026-11-20','OTHER') returning id", [US])).id;
check('a line not marked as a NextTrade payment cannot be split', /not marked as a payment/.test(await moneyErr('split', 100, 0, W2, null, null, 'req-3') || ''));
var NB = (await one("insert into vendor_bills (wave_business_id, vendor_name, bill_number, bill_date, total_amount, paid_via) values ($1,'Power Co','P1','2026-11-21',1200,'NextTrade Industries') returning id", [US])).id;
var a1 = await money('apply', 1200, 0, null, NB, null, 'req-4');
check('pay a NextTrade bill from the advance → bill payment (method advance) and advance 1,800', a1.ok && (await bal()).adv === 1800 && (await count("select count(*) n from vendor_bill_payments where bill_id=$1 and method='advance'", [NB])) === 1);
var SB = (await one("insert into vendor_bills (wave_business_id, vendor_name, bill_number, bill_date, total_amount, paid_via) values ($1,'Small','S1','2026-11-21',100,'NextTrade Industries') returning id", [US])).id;
var over = await moneyErr('apply', 150, 0, null, SB, null, 'req-5');
check('paying a bill beyond its total → the TO guard refuses, and the advance is NOT reduced (all or nothing)', !!over && /HUB_GUARD/.test(over) && (await bal()).adv === 1800 && (await count('select count(*) n from vendor_bill_payments where bill_id=$1', [SB])) === 0, over);
check('applying more than the advance is refused', /advance is only/.test(await moneyErr('apply', 5000, 0, null, SB, null, 'req-6') || ''));
var OB = (await one("insert into vendor_bills (wave_business_id, vendor_name, bill_number, bill_date, total_amount) values ($1,'Other','O1','2026-11-21',50) returning id", [US])).id;
check('a bill not paid via NextTrade cannot be paid from its advance', /only their bills/.test(await moneyErr('apply', 50, 0, null, OB, null, 'req-7') || ''));
check('advance → fee needs a reason', /say why/.test(await moneyErr('to_fee', 300, 0, null, null, null, 'req-8') || ''));
await money('to_fee', 300, 0, null, null, 'agreed with Max', 'req-9');
await money('to_advance', 100, 0, null, null, 'over-charged', 'req-10');
var b2 = await bal();
check('advance → fee 300, fee → advance 100: advance 1,600 · fees 700', b2.adv === 1600 && b2.fee === 700, b2);
check('fee → advance beyond the fees on record is refused', /fees on record are only/.test(await moneyErr('to_advance', 5000, 0, null, null, 'x', 'req-11') || ''));
check('entries are append-only: an UPDATE is refused', /never changed or deleted/.test(await fails(db, 'update party_money_entries set amount = 1') || ''));
check('entries are append-only: a DELETE is refused', /never changed or deleted/.test(await fails(db, 'delete from party_money_entries') || ''));
// ── Codex 17 Nov 19:50: privacy + balances over the COMPLETE ledger, inside the database ──
await db.query("insert into bank_transactions (id, wave_business_id, account_id, direction, amount_abs, date, name, third_party_payer) values ('aaaaaaaa-0000-0000-0000-000000000001', $1, 'KTC-PRIV', 'out', 5000, '2026-10-01', 'PRIVATE WIRE', 'RTM Capital')", [US]);
await db.query("insert into party_money_entries (party, bucket, amount, kind, bank_transaction_id, action_id, created_by, entry_date) values ('RTM Capital','advance',5000,'payment_split','aaaaaaaa-0000-0000-0000-000000000001',gen_random_uuid(),$1,'2026-10-01')", [ACTOR]);
await db.query("insert into bank_transactions (wave_business_id, account_id, direction, amount_abs, date, name) select $1, 'KTC-OPEN', 'out', 1, '2026-11-01', 'PUB' || g from generate_series(1, 1500) g", [US]);
await db.query("insert into party_money_entries (party, bucket, amount, kind, bank_transaction_id, action_id, created_by, entry_date) select 'RTM Capital','advance',1,'payment_split', id, gen_random_uuid(), $1, '2026-11-01' from bank_transactions where name like 'PUB%'", [ACTOR]);
await db.query("insert into party_money_entries (party, bucket, amount, kind, action_id, created_by, entry_date) select 'RTM Capital','advance',-1,'advance_to_fee', gen_random_uuid(), $1, '2026-12-01' from generate_series(1, 6000)", [ACTOR]);
var stR = (await db.query("select * from public.hub_party_pool_status(ARRAY['KTC-PRIV'])")).rows.filter(function (r) { return r.party === 'RTM Capital'; })[0];
check('pool status over the COMPLETE ledger (7,501 RTM moves): advance 5,000 + 1,500 − 6,000 = 500, restricted for someone who may not see KTC-PRIV', Number(stR.advance) === 500 && Number(stR.entries) === 7501 && stR.restricted === true, stR);
var stOpen = (await db.query("select * from public.hub_party_pool_status(ARRAY[]::text[])")).rows.filter(function (r) { return r.party === 'RTM Capital'; })[0];
check('… not restricted for someone with no hidden accounts', stOpen.restricted === false);
check('private source behind 1,500 public sources: the money move is refused (whole ledger, inside the move)', /private account/.test(await fails(db, "select public.hub_party_money('to_fee','RTM Capital',10,0,null,null,'why',$1,'req-rtm-1',ARRAY['KTC-PRIV'])", [ACTOR]) || ''));
check('… and allowed when the caller may see every private account (no restriction passed)', !(await fails(db, "select public.hub_party_money('to_fee','RTM Capital',10,0,null,null,'why',$1,'req-rtm-2',NULL)", [ACTOR])));
await db.query("update bank_transactions set account_id = null where id = 'aaaaaaaa-0000-0000-0000-000000000001'");
check('source line with NO account counts as private (fails closed), even with an empty hidden list', /private account/.test(await fails(db, "select public.hub_party_money('to_fee','RTM Capital',10,0,null,null,'why',$1,'req-rtm-3',ARRAY[]::text[])", [ACTOR]) || ''));
await db.query("insert into party_money_entries (party, bucket, amount, kind, bank_transaction_id, action_id, created_by) values ('NextTrade Industries','advance',1,'payment_split','bbbbbbbb-0000-0000-0000-00000000dead',gen_random_uuid(),$1)", [ACTOR]);
check('source line MISSING counts as private (fails closed)', /private account/.test(await fails(db, "select public.hub_party_money('to_fee','NextTrade Industries',1,0,null,null,'why',$1,'req-nt-x',ARRAY[]::text[])", [ACTOR]) || ''));
var Wp = (await one("insert into bank_transactions (wave_business_id, account_id, direction, amount_abs, date, name, third_party_payer) values ($1,'KTC-PRIV','out',50,'2026-11-20','PRIV2','NextTrade Industries') returning id", [US])).id;
check('splitting a line in an account the caller may not see is refused by the database', /private account/.test(await fails(db, "select public.hub_party_money('split','NextTrade Industries',10,0,$2,null,null,$1,'req-split-priv',ARRAY['KTC-PRIV'])", [ACTOR, Wp]) || ''));
check('installed-check reports true', (await one('select public.hub_party_money_installed() as ok')).ok === true && (await one('select public.hub_company_books_installed() as ok')).ok === true);

console.log('\nTW/TX real Postgres: ' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
