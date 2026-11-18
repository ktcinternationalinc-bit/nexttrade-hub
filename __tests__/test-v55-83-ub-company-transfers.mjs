// ═══════════════════════════════════════════════════════════════════════════
// v55.83-UB — Nextrade / RTM transfers paired like QuickBooks + categories with a direction (Max, Nov 17 2026).
// REAL Postgres (PGlite): loads the real TO, TV, TW, TX and UB scripts on __tests__/pg/stub-schema.sql and RUNS the pair /
// unpair / categorize functions. Needs PGLITE_DIR (not a project dependency). Plus wiring checks on the route and screen.
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
var ACTOR = '11111111-1111-1111-1111-111111111111'; var US = 'QnVzaW5lc3M6NWRkNzI3MDctOTExNC00NjQwLTg4MGQtMjYzNmI3YzM4YTdk';
var db = new PGlite();
console.log('UB — Nextrade / RTM transfers + category direction (real Postgres)');
await db.exec(fs.readFileSync(path.join(here, 'pg/stub-schema.sql'), 'utf8'));
for (var f of ['v55-83-TO-payment-guards.sql', 'v55-83-TV-repeating-bills.sql', 'v55-83-TW-company-books.sql', 'v55-83-TX-advances-fees.sql', 'v55-83-UB-company-transfers.sql', 'v55-83-UB-company-transfers.sql']) {
  var e = null; try { await db.exec(fs.readFileSync(path.join(root, 'sql', f), 'utf8')); } catch (x) { e = String(x.message || x); }
  check('script ' + f + ' runs', !e, e);
}
async function one(sql, params) { return (await db.query(sql, params || [])).rows[0]; }
async function err(sql, params) { try { await db.query(sql, params || []); return null; } catch (x) { return String(x.message || x); } }
check('starting categories got their direction (money from KTC = in, payroll = out, transfers = both)', (await one("select direction from company_categories where company_id='NEXTRADE_BOOKS' and key='money_from_ktc'")).direction === 'in' && (await one("select direction from company_categories where company_id='NEXTRADE_BOOKS' and key='payroll'")).direction === 'out' && (await one("select direction from company_categories where company_id='NEXTRADE_BOOKS' and key='own_transfer'")).direction === 'any');
await db.exec("insert into plaid_accounts values ('CHK','Nextrade checking','1795','depository','NEXTRADE_BOOKS'), ('SAV','Nextrade savings','6746','depository','NEXTRADE_BOOKS'), ('CC','Nextrade card','0026','credit','NEXTRADE_BOOKS'), ('RCHK','RTM checking','9999','depository','RTM_BOOKS')");
await db.exec("insert into company_categories (company_id, key, label, kind, direction) values ('NEXTRADE_BOOKS','elec','Electricity','expense','out'), ('NEXTRADE_BOOKS','sales_in','Sales','income','in')");
async function line(company, acct, dir, amt, date, name) { return (await one('insert into bank_transactions (wave_business_id, account_id, direction, amount_abs, date, name) values ($1,$2,$3,$4,$5,$6) returning id', [company, acct, dir, amt, date, name])).id; }
async function cat(id, key, company) { return (await one('select public.hub_company_categorize($1::jsonb) as r', [JSON.stringify({ line_id: id, company_id: company || 'NEXTRADE_BOOKS', category_key: key, actor: ACTOR, ktc_category: 'utilities', party: 'NextTrade Industries', source: 'manual', bill: { wave_business_id: US, vendor_name: 'X', bill_number: 'NXT-' + String(id).substring(0, 6), bill_date: '2026-11-10', due_date: '2026-11-30', notes: 'Created from Nextrade' } })])).r; }
async function pairE(a, b, company) { return err('select public.hub_company_pair_transfer($1::jsonb)', [JSON.stringify({ a: a, b: b, company_id: company || 'NEXTRADE_BOOKS', actor: ACTOR })]); }
async function pairR(a, b) { return (await one('select public.hub_company_pair_transfer($1::jsonb) as r', [JSON.stringify({ a: a, b: b, company_id: 'NEXTRADE_BOOKS', actor: ACTOR })])).r; }

// direction
var OUT1 = await line('NEXTRADE_BOOKS', 'CHK', 'out', 50, '2026-11-10', 'POWER');
check('a money-IN category on a money-OUT line is refused', /money in, and this line is money out/.test(await err('select public.hub_company_categorize($1::jsonb)', [JSON.stringify({ line_id: OUT1, company_id: 'NEXTRADE_BOOKS', category_key: 'sales_in', actor: ACTOR })]) || ''));
check('… a matching one is fine', (await cat(OUT1, 'elec')).action === 'created');

// pair checking → savings
var A = await line('NEXTRADE_BOOKS', 'CHK', 'out', 1000, '2026-11-12', 'TRANSFER TO SAV');
var B = await line('NEXTRADE_BOOKS', 'SAV', 'in', 1000, '2026-11-13', 'TRANSFER FROM CHK');
var r = await pairR(A, B);
var la = await one('select company_category, transfer_group_id from bank_transactions where id=$1', [A]); var lb = await one('select company_category, transfer_group_id from bank_transactions where id=$1', [B]);
check('checking → savings paired: both "Transfer between own accounts", linked by one transfer id', r.ok && r.category === 'own_transfer' && la.company_category === 'own_transfer' && lb.company_category === 'own_transfer' && la.transfer_group_id && la.transfer_group_id === lb.transfer_group_id, { la: la, lb: lb });
check('a paired line cannot be re-categorized until unpaired', /unpair it first/.test(await err('select public.hub_company_categorize($1::jsonb)', [JSON.stringify({ line_id: A, company_id: 'NEXTRADE_BOOKS', category_key: 'elec', actor: ACTOR })]) || ''));
var C = await line('NEXTRADE_BOOKS', 'CC', 'in', 1000, '2026-11-13', 'PAYMENT THANK YOU');
check('a line already paired cannot be paired again', /already paired/.test(await pairE(A, C) || ''));
var un = (await one('select public.hub_company_unpair_transfer($1::jsonb) as r', [JSON.stringify({ transfer_group_id: la.transfer_group_id, company_id: 'NEXTRADE_BOOKS', actor: ACTOR })])).r;
var la2 = await one('select company_category, transfer_group_id from bank_transactions where id=$1', [A]);
check('unpair: both lines back to not categorized, no link', un.unpaired === 2 && la2.company_category === null && la2.transfer_group_id === null);

// credit card payment
var r2 = await pairR(A, C);
check('checking → credit card paired as "Credit card payment"', r2.category === 'card_payment' && (await one('select company_category from bank_transactions where id=$1', [C])).company_category === 'card_payment');

// refusals
var D = await line('NEXTRADE_BOOKS', 'SAV', 'in', 999, '2026-11-13', 'X'); var E = await line('NEXTRADE_BOOKS', 'CHK', 'out', 999, '2026-11-13', 'Y');
var F = await line('NEXTRADE_BOOKS', 'CHK', 'in', 999, '2026-11-13', 'Z');
check('different amounts refused', /amounts differ/.test(await pairE(B, E) || ''));
check('same account refused', /same account/.test(await pairE(E, F) || ''));
var G = await line('NEXTRADE_BOOKS', 'SAV', 'out', 999, '2026-11-13', 'W');
check('two money-out lines refused', /one money-out line and one money-in/.test(await pairE(E, G) || ''));
var R1 = await line('RTM_BOOKS', 'RCHK', 'in', 999, '2026-11-13', 'FROM NEXTRADE');
check('a line of another company refused (money between companies is not a transfer)', /both lines must belong to this company/.test(await pairE(E, R1) || ''));

// a Nextrade line that already made a KTC bill: pairing it as a transfer voids that bill in the same step
var H = await line('NEXTRADE_BOOKS', 'CHK', 'out', 300, '2026-11-14', 'TO CARD');
var I = await line('NEXTRADE_BOOKS', 'CC', 'in', 300, '2026-11-14', 'CARD PAYMENT');
var hb = await cat(H, 'elec');
check('(set-up) the line was first wrongly categorized as an expense → KTC bill made', hb.action === 'created');
await pairR(H, I);
check('pairing it as a transfer VOIDS that KTC bill in the same step (kept, not deleted)', (await one('select record_status from vendor_bills where id=$1', [hb.bill_id])).record_status === 'void' && (await one("select status from company_bill_links where source_bank_transaction_id=$1", [H])).status === 'void');
// …but not when money was already recorded on that bill: then NOTHING changes
var J = await line('NEXTRADE_BOOKS', 'CHK', 'out', 400, '2026-11-15', 'TO CARD 2');
var K = await line('NEXTRADE_BOOKS', 'CC', 'in', 400, '2026-11-15', 'CARD PAYMENT 2');
var jb = await cat(J, 'elec');
await db.query("insert into vendor_bill_payments (bill_id, amount, paid_date, method) values ($1, 10, '2026-11-20', 'test')", [jb.bill_id]);
var pe = await pairE(J, K);
check('bill already has money on it → pairing refused and NOTHING changed (both lines unpaired, categories as before)', /undo that payment/.test(pe || '') && (await one('select transfer_group_id, company_category from bank_transactions where id=$1', [J])).transfer_group_id === null && (await one('select company_category from bank_transactions where id=$1', [J])).company_category === 'elec' && (await one('select company_category from bank_transactions where id=$1', [K])).company_category === null, pe);
// ── Codex 22:50: missing / unknown account, private legs ──
async function pairH(a, b, hidden) { return err('select public.hub_company_pair_transfer($1::jsonb)', [JSON.stringify({ a: a, b: b, company_id: 'NEXTRADE_BOOKS', actor: ACTOR, hidden_accounts: hidden })]); }
var N1 = await line('NEXTRADE_BOOKS', 'CHK', 'out', 77, '2026-11-16', 'OUT'); var N2 = (await one("insert into bank_transactions (wave_business_id, account_id, direction, amount_abs, date, name) values ('NEXTRADE_BOOKS', NULL, 'in', 77, '2026-11-16', 'IN NO ACCOUNT') returning id")).id;
check('a line with NO account cannot be the other side of a transfer (either order)', /has no bank account/.test(await pairE(N1, N2) || '') && /has no bank account/.test(await pairE(N2, N1) || ''));
var N3 = await line('NEXTRADE_BOOKS', 'GHOST', 'in', 77, '2026-11-16', 'IN UNKNOWN ACCOUNT');
check('an account that is not one of this company\u2019s own accounts is refused', /this company''?s own accounts|company's own accounts/.test(await pairE(N1, N3) || ''));
await db.exec("insert into plaid_accounts values ('PRIV','Nextrade private','7777','depository','NEXTRADE_BOOKS')");
var P1 = await line('NEXTRADE_BOOKS', 'PRIV', 'in', 77, '2026-11-16', 'TO PRIVATE');
check('pairing with a PRIVATE account is refused for someone not allowed (inside the locked step)', /private account/.test(await pairH(N1, P1, ['PRIV']) || ''));
check('… and allowed for someone who may see private accounts', !(await pairH(N1, P1, null)));
var gP = (await one('select transfer_group_id g from bank_transactions where id=$1', [N1])).g;
var ue = await err('select public.hub_company_unpair_transfer($1::jsonb)', [JSON.stringify({ transfer_group_id: gP, company_id: 'NEXTRADE_BOOKS', actor: ACTOR, hidden_accounts: ['PRIV'] })]);
check('unpairing a transfer with a PRIVATE side is refused for someone not allowed, and nothing changes', /private account/.test(ue || '') && (await one('select transfer_group_id g from bank_transactions where id=$1', [P1])).g === gP && (await one('select transfer_group_id g from bank_transactions where id=$1', [N1])).g === gP, ue);
check('… allowed for someone who may see private accounts', (await one('select public.hub_company_unpair_transfer($1::jsonb) as r', [JSON.stringify({ transfer_group_id: gP, company_id: 'NEXTRADE_BOOKS', actor: ACTOR, hidden_accounts: null })])).r.unpaired === 2);
// ── Codex 23:00: privacy read LIVE inside the step (not the Hub's earlier list), and every unpair leg's account checked ──
async function call(fn, obj) { return err('select public.' + fn + '($1::jsonb)', [JSON.stringify(obj)]); }
await db.exec("insert into plaid_accounts values ('CHK3','Nextrade chk3','3333','depository','NEXTRADE_BOOKS',false), ('SAV3','Nextrade sav3','4444','depository','NEXTRADE_BOOKS',false)");
var T1 = await line('NEXTRADE_BOOKS', 'CHK3', 'out', 88, '2026-11-17', 'O'); var T2 = await line('NEXTRADE_BOOKS', 'SAV3', 'in', 88, '2026-11-17', 'I');
await db.exec("update plaid_accounts set is_private = true where plaid_account_id = 'SAV3'"); // made private AFTER the Hub built its list (the list it sends is empty)
check('PAIR: an account made private after the Hub\u2019s list was read is still refused for a restricted caller', /private account/.test(await call('hub_company_pair_transfer', { a: T1, b: T2, company_id: 'NEXTRADE_BOOKS', actor: ACTOR, hidden_accounts: [], restricted: true }) || ''));
check('… allowed for someone who may see private accounts', !(await call('hub_company_pair_transfer', { a: T1, b: T2, company_id: 'NEXTRADE_BOOKS', actor: ACTOR, hidden_accounts: null })));
var gT = (await one('select transfer_group_id g from bank_transactions where id=$1', [T1])).g;
check('UNPAIR: a side made private after the Hub\u2019s list was read is refused for a restricted caller, nothing changes', /private account/.test(await call('hub_company_unpair_transfer', { transfer_group_id: gT, company_id: 'NEXTRADE_BOOKS', actor: ACTOR, hidden_accounts: [], restricted: true }) || '') && (await one('select transfer_group_id g from bank_transactions where id=$1', [T2])).g === gT);
await db.exec("update plaid_accounts set is_private = false where plaid_account_id = 'SAV3'");
await db.exec("delete from plaid_accounts where plaid_account_id = 'SAV3'"); // test only: the account row is gone (unresolved)
check('UNPAIR: a side whose account no longer resolves is refused (for everyone), nothing changes', /not in one of this company''?s own accounts/.test(await call('hub_company_unpair_transfer', { transfer_group_id: gT, company_id: 'NEXTRADE_BOOKS', actor: ACTOR, hidden_accounts: null }) || '') && (await one('select transfer_group_id g from bank_transactions where id=$1', [T1])).g === gT);
await db.exec("insert into plaid_accounts values ('SAV3','Nextrade sav3','4444','depository','RTM_BOOKS',false)");
check('UNPAIR: a side whose account now belongs to ANOTHER company is refused', /not in one of this company''?s own accounts/.test(await call('hub_company_unpair_transfer', { transfer_group_id: gT, company_id: 'NEXTRADE_BOOKS', actor: ACTOR, hidden_accounts: null }) || ''));
// the same live rule for the NextTrade / RTM advances pool
var WX = (await one("insert into bank_transactions (wave_business_id, account_id, direction, amount_abs, date, name, third_party_payer) values ($1, 'KOPEN', 'out', 500, '2026-11-20', 'WIRE', 'RTM Capital') returning id", [US])).id;
await db.exec("insert into plaid_accounts values ('KOPEN','KTC ops','5555','depository','" + US + "',false)");
await db.query("select public.hub_party_money('split','RTM Capital',500,0,$1,null,null,$2,'req-live-1',NULL)", [WX, ACTOR]);
await db.exec("update plaid_accounts set is_private = true where plaid_account_id = 'KOPEN'");
check('ADVANCES: a source account made private after the Hub\u2019s list was read → a restricted caller cannot move the pool', /private account/.test(await err("select public.hub_party_money('to_fee','RTM Capital',10,0,null,null,'why',$1,'req-live-2',ARRAY[]::text[])", [ACTOR]) || ''));
// ── Codex 23:10: an advance funded from a line whose account has NO plaid_accounts row counts as private (fails closed) ──
await db.exec("insert into paid_through_parties values ('Ghost Co','affiliate',null) on conflict do nothing");
var WG = (await one("insert into bank_transactions (wave_business_id, account_id, direction, amount_abs, date, name, third_party_payer) values ($1, 'NO-SUCH-ACCOUNT', 'out', 500, '2026-11-20', 'WIRE', 'Ghost Co') returning id", [US])).id;
await db.query("select public.hub_party_money('split','Ghost Co',500,0,$1,null,null,$2,'req-ghost-1',NULL)", [WG, ACTOR]);
var GB = (await one("insert into vendor_bills (wave_business_id, vendor_name, bill_number, bill_date, total_amount, paid_via) values ($1,'V','G1','2026-11-21',100,'Ghost Co') returning id", [US])).id;
var before = { e: (await one("select count(*)::int n from party_money_entries where party='Ghost Co'")).n, a: (await one('select count(*)::int n from hub_audit_log')).n, p: (await one('select count(*)::int n from vendor_bill_payments where bill_id=$1', [GB])).n };
var st = (await db.query("select * from public.hub_party_pool_status(ARRAY[]::text[])")).rows.filter(function (r) { return r.party === 'Ghost Co'; })[0];
check('ADVANCES: source account row missing → the pool is RESTRICTED in the summary for a restricted caller', st && st.restricted === true, st);
check('… a restricted advance → fee is refused', /private account/.test(await err("select public.hub_party_money('to_fee','Ghost Co',10,0,null,null,'why',$1,'req-ghost-2',ARRAY[]::text[])", [ACTOR]) || ''));
check('… a restricted pay-a-bill-from-the-advance is refused', /private account/.test(await err("select public.hub_party_money('apply','Ghost Co',100,0,null,$2,null,$1,'req-ghost-3',ARRAY[]::text[])", [ACTOR, GB]) || ''));
check('… and NOTHING was written: no new entry, no bill payment, no audit row; balance still 500', (await one("select count(*)::int n from party_money_entries where party='Ghost Co'")).n === before.e && (await one('select count(*)::int n from vendor_bill_payments where bill_id=$1', [GB])).n === before.p && (await one('select count(*)::int n from hub_audit_log')).n === before.a && (await one("select sum(amount)::float s from party_money_entries where party='Ghost Co' and bucket='advance'")).s === 500);
check('audit rows written for pair and unpair', (await one("select count(*)::int n from hub_audit_log where action in ('company_transfer_paired','company_transfer_unpaired')")).n >= 3);

// ── wiring ──
var route = fs.readFileSync(path.join(root, 'src/app/api/accounting/company-books/route.js'), 'utf8');
var tab = fs.readFileSync(path.join(root, 'src/components/CompanyBooksTab.jsx'), 'utf8');
check('route: candidates use KTC\'s rules (same amount, opposite direction, other REAL account, same company, no duplicates, private hidden)', /action === 'transfer_candidates'/.test(route) && /realKeyOf\(c0\.account_id, realT\) !== realKeyOf\(t0\.account_id, realT\)/.test(route) && /dropPrivate\(cr\.data/.test(route) && /review_status\.neq\.duplicate/.test(route));
check('route: pair / unpair only through the database functions; refused until the UB script is run', /db\.rpc\('hub_company_pair_transfer'/.test(route) && /db\.rpc\('hub_company_unpair_transfer'/.test(route) && /hub_company_transfers_installed/.test(route) && /pair_transfer: 1, unpair_transfer: 1/.test(route));
check('route: categories carry a direction; saved from the screen', /row\.direction = dirC/.test(route) && /sort, direction'\)/.test(route));
check('screen: ➕ New category… inside the category dropdown, saved and applied to that line', /<option value="__new">➕ New category…<\/option>/.test(tab) && /addCategoryForLine\(l, panel\)/.test(tab));
check('screen: each line\'s dropdown only offers categories for its direction', /c\.direction === l\.direction/.test(tab));
check('screen: ↔ finds the other side; paired lines show "with <account>" and Unpair', /openTransfer\(l, false, ''\)/.test(tab) && /Pair as transfer/.test(tab) && /unpair\(l\)/.test(tab) && /l\.transfer_with\.account_label/.test(tab));
check('route: a private partner leg returns nothing about it (no id / date / account)', /if \(isPrivateRow\(o, scope\)\) \{ return \{ private: true \}; \}/.test(route));
check('route: pair and unpair pass the caller\u2019s hidden accounts into the database step', (route.match(/hidden_accounts: scope\.all \? null : Object\.keys\(scope\.hidden \|\| \{\}\)/g) || []).length === 2);
check('route SWC-safe', route.indexOf('`') < 0 && !/=>/.test(route));
console.log('\nUB transfers: ' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
