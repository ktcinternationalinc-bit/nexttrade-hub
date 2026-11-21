// v55.83-XN — Max, 21 Nov 2026: "JUST ONE BUTTON TO IGNORE ALL OF THEM FROM CREATING KTC BILLS PRIOR TO JUNE 1 2026".
// REAL Postgres (PGlite): loads the real TO, TV, TW, TX, UB, UD, VK and XN scripts on __tests__/pg/stub-schema.sql and RUNS
// hub_company_bill_cutoff (the button) and hub_company_categorize / _if_open around it. Needs PGLITE_DIR.
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
var ACTOR = '11111111-1111-1111-1111-111111111111'; var US = 'QnVzaW5lc3M6NWRkNzI3MDctOTExNC00NjQwLTg4MGQtMjYzNmI3YzM4YTdk';
var NT = 'NextTrade Industries';
var db = new PGlite();
console.log('XN — one button: no KTC bills from Nextrade lines before 1 June 2026 (real Postgres)');
await db.exec(fs.readFileSync(path.join(here, 'pg/stub-schema.sql'), 'utf8'));
await db.exec("do $x$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $x$");
var base = ['v55-83-TO-payment-guards.sql', 'v55-83-TV-repeating-bills.sql', 'v55-83-TW-company-books.sql', 'v55-83-TX-advances-fees.sql', 'v55-83-UB-company-transfers.sql', 'v55-83-UD-pay-nextrade.sql', 'v55-83-VK-rule-apply-guard.sql'];
for (var f of base) {
  var e = null; try { await db.exec(fs.readFileSync(path.join(root, 'sql', f), 'utf8')); } catch (x) { e = String(x.message || x); }
  check('script ' + f + ' runs', !e, e);
}
async function one(sql, params) { return (await db.query(sql, params || [])).rows[0]; }
async function err(sql, params) { try { await db.query(sql, params || []); return null; } catch (x) { return String(x.message || x); } }
// the categorize function as UD installed it, before XN — XN must change ONLY the two marked lines
var udDef = (await one("select pg_get_functiondef('public.hub_company_categorize(jsonb)'::regprocedure) d")).d;
for (var g of ['v55-83-XN-nextrade-june-cutoff.sql', 'v55-83-XN-nextrade-june-cutoff.sql']) {
  var e2 = null; try { await db.exec(fs.readFileSync(path.join(root, 'sql', g), 'utf8')); } catch (x) { e2 = String(x.message || x); }
  check('script ' + g + ' runs (twice: safe to re-run)', !e2, e2);
}
var xnDef = (await one("select pg_get_functiondef('public.hub_company_categorize(jsonb)'::regprocedure) d")).d;
var udL = udDef.split('\n'); var xnL = xnDef.split('\n'); var extra = xnL.filter(function (l) { return udL.indexOf(l) < 0; }); var lost = udL.filter(function (l) { return xnL.indexOf(l) < 0; });
check('hub_company_categorize is the UD function with ONLY the XN change (line date read + the cut-off check)', lost.length === 1 && /transfer_group_id INTO v_line/.test(lost[0]) && extra.length === 4 && /transfer_group_id, date INTO v_line/.test(extra.join('\n')) && /company_ktc_bill_cutoff/.test(extra.join('\n')), { lost: lost, extra: extra });

await db.exec("insert into plaid_accounts values ('NCHK','Nextrade checking','1795','depository','NEXTRADE_BOOKS',false)");
async function nline(amt, date) { return (await one("insert into bank_transactions (wave_business_id, account_id, direction, amount_abs, date, name) values ('NEXTRADE_BOOKS','NCHK','out',$1,$2,'SUPPLIES CO') returning id", [amt, date])).id; }
function payload(id, key, date) { return { line_id: id, company_id: 'NEXTRADE_BOOKS', category_key: key, actor: ACTOR, ktc_category: 'warehouse_supplies', party: NT, source: 'manual', bill: { wave_business_id: US, vendor_name: 'SUPPLIES CO', bill_number: 'NXT-' + String(id).substring(0, 8), bill_date: date, due_date: date, notes: 'Created from Nextrade' } }; }
async function cat(id, key, date) { return (await one('select public.hub_company_categorize($1::jsonb) as r', [JSON.stringify(payload(id, key, date))])).r; }
async function catRule(id, key, date) { return (await one('select public.hub_company_categorize_if_open($1::jsonb) as r', [JSON.stringify(payload(id, key, date))])).r; }
async function cutoff(on, extra) { return (await one('select public.hub_company_bill_cutoff($1::jsonb) as r', [JSON.stringify(Object.assign({ actor: ACTOR, company_id: 'NEXTRADE_BOOKS', on: on, cutoff_date: '2026-06-01' }, extra || {}))])).r; }
async function cutoffE(o) { return err('select public.hub_company_bill_cutoff($1::jsonb)', [JSON.stringify(o)]); }
async function st(billId) { return (await one('select record_status from vendor_bills where id=$1', [billId])).record_status; }
async function link(lineId) { return one('select status, cutoff_voided, bill_id from company_bill_links where source_bank_transaction_id=$1', [lineId]); }

await db.exec("insert into company_categories (company_id, key, label, kind, direction) values ('NEXTRADE_BOOKS','supplies','Supplies','expense','out') on conflict do nothing");
var L1 = await nline(100, '2026-05-20'); var L2 = await nline(200, '2026-06-01'); var L3 = await nline(300, '2026-05-02'); var L4 = await nline(400, '2026-04-11'); var L6 = await nline(600, '2026-03-03');
var b1 = (await cat(L1, 'supplies', '2026-05-20')).bill_id; var b2 = (await cat(L2, 'supplies', '2026-06-01')).bill_id;
var b3 = (await cat(L3, 'supplies', '2026-05-02')).bill_id; var b4 = (await cat(L4, 'supplies', '2026-04-11')).bill_id; var b6 = (await cat(L6, 'supplies', '2026-03-03')).bill_id;
check('before the button: every expense line made its KTC bill (as today)', [b1, b2, b3, b4, b6].every(function (x) { return !!x; }));
await db.query("insert into vendor_bill_payments (bill_id, amount, paid_date, method) values ($1, 50, '2026-05-25', 'rtm')", [b3]);
var hasWires = !!(await one("select to_regclass('public.wire_package_lines') t")).t;
if (hasWires) { try { await db.query('insert into wire_package_lines (bill_id, amount, is_open) values ($1, 400, true)', [b4]); } catch (x) { hasWires = false; } }

check('the button refuses without a signed-in person, for RTM, and without ON / OFF', /no signed-in person/.test(await cutoffE({ company_id: 'NEXTRADE_BOOKS', on: true, cutoff_date: '2026-06-01' }) || '')
  && /Nextrade only/.test(await cutoffE({ actor: ACTOR, company_id: 'RTM_BOOKS', on: true, cutoff_date: '2026-06-01' }) || '') && /ON or OFF/.test(await cutoffE({ actor: ACTOR, company_id: 'NEXTRADE_BOOKS', cutoff_date: '2026-06-01' }) || ''));
var on1 = await cutoff(true);
var expected = hasWires ? 2 : 3;
check('ON (1 June 2026): the pre-June bills with nothing on them are voided — 100 and 600' + (hasWires ? '' : ' and 400 (no wire table in this stub)'), on1.ok && on1.count === expected && (await st(b1)) === 'void' && (await st(b6)) === 'void' && (await link(L1)).status === 'void' && (await link(L1)).cutoff_voided === true, on1);
check('… the line dated exactly 1 June keeps its bill (the cut-off is "before 1 June")', (await st(b2)) === 'active' && (await link(L2)).status === 'active');
check('… a bill with money recorded on it is NOT voided and is named back', (await st(b3)) === 'active' && on1.kept.some(function (k) { return k.bill_id === b3 && /money/.test(k.why); }), on1.kept);
if (hasWires) { check('… a bill on an open wire is NOT voided and is named back', (await st(b4)) === 'active' && on1.kept.some(function (k) { return k.bill_id === b4 && /wire/.test(k.why); })); }
check('… nothing is deleted: every bill and link row is still there', (await one('select count(*)::int n from vendor_bills where id = any($1::uuid[])', [[b1, b2, b3, b4, b6]])).n === 5 && (await one("select count(*)::int n from company_bill_links where company_id='NEXTRADE_BOOKS'")).n === 5);
check('… one audit row with the bills and the total', (await one("select count(*)::int n from hub_audit_log where action='nextrade_bill_cutoff_on'")).n === 1 && Number(on1.total) === (hasWires ? 700 : 1100));
var on2 = await cutoff(true);
check('pressing ON again voids nothing new', on2.count === 0 && (await st(b1)) === 'void');

var L5 = await nline(500, '2026-05-15');
var r5 = await cat(L5, 'supplies', '2026-05-15');
check('while ON: categorizing a NEW pre-June line works but makes NO KTC bill', r5.ok && r5.action === 'none' && !(await link(L5)) && (await one('select company_category from bank_transactions where id=$1', [L5])).company_category === 'supplies', r5);
var L7 = await nline(700, '2026-05-16'); var r7 = await catRule(L7, 'supplies', '2026-05-16');
check('while ON: a RULE categorizing a pre-June line makes no KTC bill either', r7.ok && r7.action === 'none' && !(await link(L7)), r7);
var r1 = await cat(L1, 'supplies', '2026-05-20');
check('while ON: re-categorizing a voided pre-June line does NOT bring its bill back', r1.action === 'none' && (await st(b1)) === 'void', r1);
var L8 = await nline(800, '2026-06-10'); var r8 = await cat(L8, 'supplies', '2026-06-10');
check('while ON: a line from June on still makes its KTC bill', r8.action === 'created' && (await st(r8.bill_id)) === 'active', r8);
var e3 = await err('select public.hub_company_categorize($1::jsonb)', [JSON.stringify(payload(L3, 'supplies', '2026-05-02'))]);
check('while ON: re-categorizing the PAID pre-June line is refused with the existing "money recorded" message (nothing changes)', /already has money recorded on it/.test(e3 || '') && (await st(b3)) === 'active', e3);

var off = await cutoff(false);
check('OFF: exactly the bills the button voided come back (100 and 600' + (hasWires ? ')' : ' and 400)'), off.ok && off.count === expected && (await st(b1)) === 'active' && (await st(b6)) === 'active' && (await link(L1)).status === 'active' && (await link(L1)).cutoff_voided === false, off);
check('… the line categorized while ON still has no bill until it is categorized again (nothing is invented)', !(await link(L5)));
var r5b = await cat(L5, 'supplies', '2026-05-15');
check('… and after OFF, categorizing it makes its bill as before', r5b.action === 'created');
check('… one OFF audit row', (await one("select count(*)::int n from hub_audit_log where action='nextrade_bill_cutoff_off'")).n === 1);
// a bill voided by re-categorizing (not by the button) is NOT revived by OFF
await db.exec("insert into company_categories (company_id, key, label, kind, direction, makes_ktc_bill) values ('NEXTRADE_BOOKS','owner_draw','Owner draw','expense','out',false) on conflict do nothing");
var on3 = await cutoff(true); var rv = await cat(L6, 'owner_draw', '2026-03-03');
var off2 = await cutoff(false);
check('OFF never revives a bill whose line was moved to a "KTC does not pay" category in between', (await st(b6)) === 'void' || (await link(L6)).status === 'void' ? (await st(b6)) === 'void' : false, { on3: on3, rv: rv, off2: off2, st: await st(b6), link: await link(L6) });
check('cut-off row: Nextrade only (RTM cannot be stored)', /violates check constraint/.test(await err("insert into company_ktc_bill_cutoff (company_id, cutoff_date) values ('RTM_BOOKS','2026-06-01')") || ''));
check('the button and the table are closed to the browser roles (service role only)', (await one("select has_function_privilege('anon','public.hub_company_bill_cutoff(jsonb)','execute') a, has_function_privilege('authenticated','public.hub_company_bill_cutoff(jsonb)','execute') b")).a === false);
console.log('\nXN SQL: ' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
