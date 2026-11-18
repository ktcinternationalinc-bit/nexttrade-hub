// ═══════════════════════════════════════════════════════════════════════════
// v55.83-UD — Paying NextTrade / RTM in one step (bills + fee + advance), a starting balance held at NextTrade, and
// warehouse-staff payroll making a KTC bill (Max, Nov 18 2026).
// REAL Postgres (PGlite): loads the real TO, TV, TW, TX, UB and UD scripts on __tests__/pg/stub-schema.sql and RUNS
// hub_party_allocate / hub_party_opening / hub_company_categorize. Needs PGLITE_DIR. Plus wiring checks on route and screens.
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
var NT = 'NextTrade Industries';
var db = new PGlite();
console.log('UD — paying NextTrade in one step, starting balance, warehouse staff bills (real Postgres)');
await db.exec(fs.readFileSync(path.join(here, 'pg/stub-schema.sql'), 'utf8'));
for (var f of ['v55-83-TO-payment-guards.sql', 'v55-83-TV-repeating-bills.sql', 'v55-83-TW-company-books.sql', 'v55-83-TX-advances-fees.sql', 'v55-83-UB-company-transfers.sql', 'v55-83-UD-pay-nextrade.sql', 'v55-83-UD-pay-nextrade.sql']) {
  var e = null; try { await db.exec(fs.readFileSync(path.join(root, 'sql', f), 'utf8')); } catch (x) { e = String(x.message || x); }
  check('script ' + f + ' runs', !e, e);
}
async function one(sql, params) { return (await db.query(sql, params || [])).rows[0]; }
async function err(sql, params) { try { await db.query(sql, params || []); return null; } catch (x) { return String(x.message || x); } }
async function alloc(o) { return (await one('select public.hub_party_allocate($1::jsonb) as r', [JSON.stringify(Object.assign({ party: NT, actor: ACTOR, ktc_business: US }, o))])).r; }
async function allocE(o) { return err('select public.hub_party_allocate($1::jsonb)', [JSON.stringify(Object.assign({ party: NT, actor: ACTOR, ktc_business: US }, o))]); }
async function opening(o) { return (await one('select public.hub_party_opening($1::jsonb) as r', [JSON.stringify(Object.assign({ party: NT, actor: ACTOR, visible_to_staff: true }, o))])).r; }
async function openingE(o) { return err('select public.hub_party_opening($1::jsonb)', [JSON.stringify(Object.assign({ party: NT, actor: ACTOR, visible_to_staff: true }, o))]); }
async function bill(num, amt, via) { return (await one("insert into vendor_bills (wave_business_id, vendor_name, bill_number, bill_date, total_amount, paid_via) values ($1,'V',$2,'2026-11-10',$3,$4) returning id", [US, num, amt, via === undefined ? NT : via])).id; }
async function pay(acct, amt, payer) { return (await one("insert into bank_transactions (wave_business_id, account_id, direction, amount_abs, date, name, third_party_payer) values ($1,$2,'out',$3,'2026-11-15','WIRE NEXTRADE',$4) returning id", [US, acct, amt, payer === undefined ? NT : payer])).id; }
async function bal() { return one("select coalesce(sum(amount) filter (where bucket='advance'),0)::float adv, coalesce(sum(amount) filter (where bucket='fee'),0)::float fee from party_money_entries where party=$1", [NT]); }
async function paidOn(b) { return Number((await one('select coalesce(sum(amount),0) s from vendor_bill_payments where bill_id=$1 and voided is not true', [b])).s); }
async function counts() { return { p: (await one('select count(*)::int n from vendor_bill_payments')).n, e: (await one('select count(*)::int n from party_money_entries')).n, a: (await one('select count(*)::int n from hub_audit_log')).n }; }
function same(x, y) { return x.p === y.p && x.e === y.e && x.a === y.a; }

await db.exec("insert into plaid_accounts values ('KOPS','KTC ops','1111','depository','" + US + "',false), ('KPRIV','KTC private','2222','depository','" + US + "',true)");
check('UD installed check is true', (await one('select public.hub_party_ud_installed() as ok')).ok === true);

// ── 1. one step: bills + fee + advance ──
var B1 = await bill('NXT-1', 300); var B2 = await bill('NXT-2', 200); var BX = await bill('OTHER-1', 50, 'RTM Capital'); var BN = await bill('KTC-1', 70, null);
var W = await pay('KOPS', 1000);
var r = await alloc({ bank_transaction_id: W, bills: [{ bill_id: B1, amount: 300 }, { bill_id: B2, amount: 150 }], fee: 100, advance: 250, request_id: 'req-a1' });
var b0 = await bal();
check('one step: two bills paid (300 + 150), fee 100, advance 250; 200 left on the 1,000 payment', r.ok && r.bills_paid === 2 && Number(r.bills_amount) === 450 && Number(r.left_on_payment) === 200 && (await paidOn(B1)) === 300 && (await paidOn(B2)) === 150 && b0.adv === 250 && b0.fee === 100, r);
var pm = await one("select method, paid_date::text d, bank_transaction_id from vendor_bill_payments where bill_id=$1", [B1]);
check('… the bill payments are "paid via NextTrade" from that payment, dated the payment’s date', pm.method === 'rtm' && pm.d === '2026-11-15' && pm.bank_transaction_id === W, pm);
check('… one audit row for the step', (await one("select count(*)::int n from hub_audit_log where action='party_payment_allocated'")).n === 1);
var c1 = await counts();
check('the same click again → nothing new (first result stands)', (await alloc({ bank_transaction_id: W, bills: [{ bill_id: B2, amount: 150 }, { bill_id: B1, amount: 300 }], fee: 100, advance: 250, request_id: 'req-a1' })).repeat === true && same(c1, await counts()));
check('the same click id for a DIFFERENT step is refused', /already used for a different move/.test(await allocE({ bank_transaction_id: W, bills: [{ bill_id: B1, amount: 300 }], fee: 100, advance: 250, request_id: 'req-a1' }) || '') && same(c1, await counts()));
check('over-spending the payment is refused WHOLE (200 left; 50 bill + 160 advance)', /over by 10/.test(await allocE({ bank_transaction_id: W, bills: [{ bill_id: B2, amount: 50 }], advance: 160, request_id: 'req-a2' }) || '') && (await paidOn(B2)) === 150 && same(c1, await counts()));
var e60 = await allocE({ bank_transaction_id: W, bills: [{ bill_id: B2, amount: 60 }], request_id: 'req-a3x' }); console.log('    msg: ' + e60);
check('paying a bill beyond what is still open is refused', /only 50(.00)? still open/.test(await allocE({ bank_transaction_id: W, bills: [{ bill_id: B2, amount: 60 }], request_id: 'req-a3' }) || '') && same(c1, await counts()));
check('a bill paid via ANOTHER company is refused', /not paid via NextTrade/.test(await allocE({ bank_transaction_id: W, bills: [{ bill_id: BX, amount: 10 }], request_id: 'req-a4' }) || ''));
check('a KTC bill not paid via NextTrade is refused', /not paid via NextTrade/.test(await allocE({ bank_transaction_id: W, bills: [{ bill_id: BN, amount: 10 }], request_id: 'req-a5' }) || ''));
check('a bill listed twice is refused', /listed twice/.test(await allocE({ bank_transaction_id: W, bills: [{ bill_id: B2, amount: 10 }, { bill_id: B2, amount: 10 }], request_id: 'req-a6' }) || ''));
check('nothing ticked and no fee / advance is refused', /tick a bill/.test(await allocE({ bank_transaction_id: W, bills: [], request_id: 'req-a7' }) || ''));
check('a negative fee is refused', /cannot be below zero/.test(await allocE({ bank_transaction_id: W, fee: -5, advance: 10, request_id: 'req-a8' }) || ''));
var WR = await pay('KOPS', 500, 'RTM Capital');
check('a payment marked to RTM cannot pay NextTrade bills', /not marked as a payment to NextTrade/.test(await allocE({ bank_transaction_id: WR, bills: [{ bill_id: B2, amount: 10 }], request_id: 'req-a9' }) || ''));
var WU = await pay('KOPS', 500, null);
check('an unmarked payment cannot be used', /not marked as a payment/.test(await allocE({ bank_transaction_id: WU, advance: 10, request_id: 'req-a10' }) || ''));
var WI = (await one("insert into bank_transactions (wave_business_id, account_id, direction, amount_abs, date, name, third_party_payer) values ($1,'KOPS','in',500,'2026-11-15','IN',$2) returning id", [US, NT])).id;
check('money IN cannot pay bills', /settled money-out/.test(await allocE({ bank_transaction_id: WI, advance: 10, request_id: 'req-a11' }) || ''));
var WP = (await one("insert into bank_transactions (wave_business_id, account_id, direction, amount_abs, date, name, third_party_payer, pending) values ($1,'KOPS','out',500,'2026-11-15','P',$2,true) returning id", [US, NT])).id;
check('a pending payment cannot be used yet', /settled money-out/.test(await allocE({ bank_transaction_id: WP, advance: 10, request_id: 'req-a12' }) || ''));
check('the rest of the payment (200) can be used later: the last 50 of bill 2 + 150 advance', (await alloc({ bank_transaction_id: W, bills: [{ bill_id: B2, amount: 50 }], advance: 150, request_id: 'req-a13' })).left_on_payment == 0 && (await paidOn(B2)) === 200 && (await bal()).adv === 400);
check('… and then the payment is fully used: even 1 cent more is refused', /over by 0.01/.test(await allocE({ bank_transaction_id: W, advance: 0.01, request_id: 'req-a14' }) || ''));
// the TX split and TO bill payments share the same limit
var W2 = await pay('KOPS', 100);
await db.query("select public.hub_party_money('split',$1,60,0,$2,null,null,$3,'req-tx-1',NULL)", [NT, W2, ACTOR]);
check('an earlier TX split on the same payment counts (60 of 100 used → 50 more is over)', /over by 10/.test(await allocE({ bank_transaction_id: W2, fee: 50, request_id: 'req-a15' }) || ''));

// ── private money ──
var WPV = await pay('KPRIV', 300);
check('restricted person: a payment from a PRIVATE account (live flag) is refused', /private account/.test(await allocE({ bank_transaction_id: WPV, advance: 10, request_id: 'req-p1', hidden_accounts: [], restricted: true }) || ''));
check('… allowed for someone who may see private accounts', (await alloc({ bank_transaction_id: WPV, advance: 10, request_id: 'req-p2' })).ok === true);
var WGH = await pay('NO-SUCH-ACCOUNT', 300);
check('restricted person: a payment whose account record is missing is refused (fails closed)', /private account|KTC's own bank accounts/.test(await allocE({ bank_transaction_id: WGH, bills: [], advance: 5, request_id: 'req-p3', hidden_accounts: [], restricted: true }) || ''));
var W3 = await pay('KOPS', 300);
check('restricted person: adding to an advance that already holds private money is refused', /includes money from a private account/.test(await allocE({ bank_transaction_id: W3, advance: 5, request_id: 'req-p4', hidden_accounts: [], restricted: true }) || ''));
var B3 = await bill('NXT-3', 40);
var rP5 = await alloc({ bank_transaction_id: W3, bills: [{ bill_id: B3, amount: 40 }], request_id: 'req-p5', hidden_accounts: [], restricted: true });
check('… but paying bills from a public payment is fine for them — and the answer carries NO totals of the private-funded pool (Codex 11:40/12:00 P1)', rP5.bills_paid === 1 && rP5.balance_hidden === true && rP5.advance_balance === undefined && rP5.fee_total === undefined, rP5);
check('… the same click again (repeat) also carries no totals', (function (x) { return x.repeat === true && x.advance_balance === undefined && x.fee_total === undefined; })(await alloc({ bank_transaction_id: W3, bills: [{ bill_id: B3, amount: 40 }], request_id: 'req-p5', hidden_accounts: [], restricted: true })));
// ── Codex 12:00 P1: company ownership for everyone (payment, its account, every bill) ──
var BNX = (await one("insert into vendor_bills (wave_business_id, vendor_name, bill_number, bill_date, total_amount, paid_via) values ('NEXTRADE_BOOKS','V','NXB-1','2026-11-10',30,$1) returning id", [NT])).id;
var W4 = await pay('KOPS', 300);
check('OWNERSHIP: a Nextrade-books bill cannot be paid from a KTC payment', /not a KTC bill/.test(await allocE({ bank_transaction_id: W4, bills: [{ bill_id: BNX, amount: 30 }], request_id: 'req-own1' }) || ''));
var WNL = (await one("insert into bank_transactions (wave_business_id, account_id, direction, amount_abs, date, name, third_party_payer) values ('NEXTRADE_BOOKS','KOPS','out',300,'2026-11-15','N',$1) returning id", [NT])).id;
var B5 = await bill('NXT-5', 30);
check('OWNERSHIP: a Nextrade bank line cannot pay a KTC bill', /not a KTC line/.test(await allocE({ bank_transaction_id: WNL, bills: [{ bill_id: B5, amount: 30 }], request_id: 'req-own2' }) || ''));
await db.exec("insert into plaid_accounts values ('NACC','Nextrade acct','9','depository','NEXTRADE_BOOKS',false)");
var WNA = await pay('NACC', 300);
check('OWNERSHIP: a KTC line sitting in another company’s account is refused (even for the super admin)', /KTC's own bank accounts/.test(await allocE({ bank_transaction_id: WNA, bills: [{ bill_id: B5, amount: 30 }], request_id: 'req-own3' }) || ''));
check('OWNERSHIP: an unresolved account is refused for everyone', /KTC's own bank accounts/.test(await allocE({ bank_transaction_id: WGH, bills: [{ bill_id: B5, amount: 30 }], request_id: 'req-own4' }) || ''));
check('OWNERSHIP: no KTC business id from the server → refused', /KTC business is not known/.test(await err('select public.hub_party_allocate($1::jsonb)', [JSON.stringify({ party: NT, actor: ACTOR, bank_transaction_id: W4, advance: 1, request_id: 'req-own5' })]) || ''));
// ── Codex 12:00 P2: the click id remembers the WHOLE step, the company included ──
var WRr = await pay('KOPS', 300, 'RTM Capital'); var BRr = await bill('RTM-B', 20, 'RTM Capital');
await alloc({ party: 'RTM Capital', bank_transaction_id: WRr, bills: [{ bill_id: BRr, amount: 20 }], request_id: 'req-rp1' });
check('REPLAY: the same click id with ANOTHER company (bills-only) is refused, not reported as saved', /different move/.test(await allocE({ party: NT, bank_transaction_id: WRr, bills: [{ bill_id: BRr, amount: 20 }], request_id: 'req-rp1' }) || ''));
check('REPLAY: a click id used by a payment step cannot be reused for a starting balance', /different move/.test(await openingE({ party: 'RTM Capital', amount: 5, as_of: '2026-01-01', reason: 'trying to reuse a click id', request_id: 'req-rp1' }) || ''));
await db.exec("update vendor_bill_payments set voided = true where request_id = 'req-rp1'");
check('REPLAY: after that payment is voided, the same click still only returns the first result (never pays again)', (await alloc({ party: 'RTM Capital', bank_transaction_id: WRr, bills: [{ bill_id: BRr, amount: 20 }], request_id: 'req-rp1' })).repeat === true && (await one("select count(*)::int n from vendor_bill_payments where request_id='req-rp1'")).n === 1);

// ── 2. starting balance held at NextTrade ──
var RTM0 = (await one("select coalesce(sum(amount),0)::float s from party_money_entries where party='RTM Capital'")).s;
var o1 = await opening({ party: 'RTM Capital', amount: 5000, as_of: '2026-11-01', reason: 'Balance RTM held for KTC on 1 Nov', request_id: 'req-o1' });
check('starting balance: RTM advance +5,000 with no bank line, dated as of 1 Nov', o1.ok && Number(o1.advance_balance) === RTM0 + 5000 && (await one("select entry_date::text d, bank_transaction_id from party_money_entries where request_id='req-o1'")).d === '2026-11-01');
check('… the same click again → nothing new', (await opening({ party: 'RTM Capital', amount: 5000, as_of: '2026-11-01', reason: 'Balance RTM held for KTC on 1 Nov', request_id: 'req-o1' })).repeat === true && (await one("select count(*)::int n from party_money_entries where request_id='req-o1'")).n === 1);
check('… the same click id with another amount is refused', /different move/.test(await openingE({ party: 'RTM Capital', amount: 4000, as_of: '2026-11-01', reason: 'Balance RTM held for KTC on 1 Nov', request_id: 'req-o1' }) || ''));
check('… a short reason is refused', /say where this balance comes from/.test(await openingE({ party: 'RTM Capital', amount: 10, reason: 'x', request_id: 'req-o2' }) || ''));
check('… a future date is refused', /cannot be in the future/.test(await openingE({ party: 'RTM Capital', amount: 10, as_of: '2099-01-01', reason: 'Balance from the future?', request_id: 'req-o3' }) || ''));
var O1 = (await one("select id from party_money_entries where request_id='req-o1'")).id;
check('… a minus amount must name the starting balance it corrects', /must name the starting balance/.test(await openingE({ party: 'RTM Capital', amount: -1000, reason: 'Corrected after their statement', request_id: 'req-o4a' }) || ''));
check('… a correction (−1,000) is a new entry linked to the original; the original stays', Number((await opening({ party: 'RTM Capital', amount: -1000, corrects: O1, reason: 'Corrected after their statement', request_id: 'req-o4' })).advance_balance) === RTM0 + 4000 && (await one("select count(*)::int n from party_money_entries where kind='opening_balance' and party='RTM Capital'")).n === 2 && (await one("select corrects_id from party_money_entries where request_id='req-o4'")).corrects_id === O1);
check('… a correction bigger than what is left of that starting balance is refused', /cannot be more than that starting balance/.test(await openingE({ party: 'RTM Capital', amount: -4001, corrects: O1, reason: 'Too big a correction', request_id: 'req-o5' }) || ''));
var BR = await bill('RTM-1', 900, 'RTM Capital');
await db.query("select public.hub_party_money('apply','RTM Capital',900,0,null,$1,null,$2,'req-o6',NULL)", [BR, ACTOR]);
check('… their bill paid from it (existing "Pay from the advance"): advance 4,000 → 3,100', (await paidOn(BR)) === 900 && (await one("select coalesce(sum(amount),0)::float s from party_money_entries where party='RTM Capital' and bucket='advance'")).s === RTM0 + 3100);
check('… once the advance is spent, a correction cannot take the advance below zero', /below zero/.test(await openingE({ party: 'RTM Capital', amount: -3500, corrects: O1, reason: 'Would leave the advance negative', request_id: 'req-o7' }) || ''));
check('STARTING BALANCE: staff visibility must be chosen', /say whether staff may see/.test(await err('select public.hub_party_opening($1::jsonb)', [JSON.stringify({ party: 'RTM Capital', actor: ACTOR, amount: 5, as_of: '2026-01-01', reason: 'no visibility choice', request_id: 'req-o8' })]) || ''));
check('STARTING BALANCE: cut-off — NextTrade already has payments split into its advance from 15 Nov, so an as-of date on/after it is refused', /must be as of a date before that/.test(await openingE({ amount: 100, as_of: '2026-11-16', reason: 'would count the same money twice', request_id: 'req-o9' }) || ''));
var oP = await opening({ party: 'RTM Capital', amount: 100, as_of: '2026-10-01', reason: 'held for KTC, private to the owner', visible_to_staff: false, request_id: 'req-o10' });
check('STARTING BALANCE: marked private → the RTM pool is now restricted for staff without the private permission', oP.ok && (await one("select public.hub_party_pool_restricted('RTM Capital', ARRAY[]::text[]) as r")).r === true && (await one("select is_private from party_money_entries where request_id='req-o10'")).is_private === true);
var c2 = await counts();
check('… entries can never be edited or deleted', /never changed or deleted/.test(await err("update party_money_entries set amount = 1 where request_id='req-o1'") || '') && /never changed or deleted/.test(await err("delete from party_money_entries where request_id='req-o1'") || '') && same(c2, await counts()));

// ── 3. warehouse staff payroll makes a KTC bill ──
check('Nextrade "Payroll (Warehouse staff)" is set to make a KTC bill', (await one("select makes_ktc_bill from company_categories where company_id='NEXTRADE_BOOKS' and key='payroll'")).makes_ktc_bill === true);
await db.exec("insert into plaid_accounts values ('NCHK','Nextrade checking','1795','depository','NEXTRADE_BOOKS',false)");
async function nline(amt) { return (await one("insert into bank_transactions (wave_business_id, account_id, direction, amount_abs, date, name) values ('NEXTRADE_BOOKS','NCHK','out',$1,'2026-11-14','ADP PAYROLL') returning id", [amt])).id; }
async function cat(id, key) { return (await one('select public.hub_company_categorize($1::jsonb) as r', [JSON.stringify({ line_id: id, company_id: 'NEXTRADE_BOOKS', category_key: key, actor: ACTOR, ktc_category: 'warehouse_labor', party: NT, source: 'manual', bill: { wave_business_id: US, vendor_name: 'ADP PAYROLL', bill_number: 'NXT-' + String(id).substring(0, 6), bill_date: '2026-11-14', due_date: '2026-11-30', notes: 'Created from Nextrade' } })])).r; }
var PL = await nline(4321);
var rc = await cat(PL, 'payroll');
var pb = await one("select total_amount::float t, paid_via, record_status, category from vendor_bills where id=$1", [rc.bill_id]);
check('a warehouse-staff payroll line now makes ONE KTC bill (full amount, paid via NextTrade)', rc.action === 'created' && pb.t === 4321 && pb.paid_via === NT && pb.record_status === 'active' && pb.category === 'warehouse_labor', { rc: rc, pb: pb });
var rc2 = await cat(PL, 'payroll');
check('… categorizing it again never makes a second bill', rc2.action === 'updated' && rc2.bill_id === rc.bill_id && (await one("select count(*)::int n from company_bill_links where source_bank_transaction_id=$1", [PL])).n === 1);
await db.exec("insert into company_categories (company_id, key, label, kind, direction, makes_ktc_bill) values ('NEXTRADE_BOOKS','owner_draw','Owner draw','expense','out',false)");
var rc3 = await cat(PL, 'owner_draw');
check('… moved to a category that says "KTC does not pay this" → the bill is VOIDED (kept, never deleted)', rc3.action === 'voided' && (await one('select record_status from vendor_bills where id=$1', [rc.bill_id])).record_status === 'void');
var rc4 = await cat(PL, 'payroll');
check('… and back → the SAME bill is restored', rc4.action === 'restored' && rc4.bill_id === rc.bill_id);
var OL = await nline(55);
check('a category left unset (NULL) keeps the old rule: an ordinary expense still makes a bill', (await cat(OL, 'other_expense')).action === 'created');

// ── wiring ──
var aroute = fs.readFileSync(path.join(root, 'src/app/api/accounting/advances/route.js'), 'utf8');
var panel = fs.readFileSync(path.join(root, 'src/components/AdvancesPanel.jsx'), 'utf8');
var croute = fs.readFileSync(path.join(root, 'src/app/api/accounting/company-books/route.js'), 'utf8');
var ctab = fs.readFileSync(path.join(root, 'src/components/CompanyBooksTab.jsx'), 'utf8');
var nbp = fs.readFileSync(path.join(root, 'src/components/NextradeBillsPanel.jsx'), 'utf8');
var lib = fs.readFileSync(path.join(root, 'src/lib/nextrade-bills-server.js'), 'utf8');
check('route: the one-step payment goes only through hub_party_allocate, with the server’s hidden list and restricted flag', /(db\.rpc\(|rpcOnceMore\(db, )'hub_party_allocate'/.test(aroute) && /restricted: !scope\.all/.test(aroute) && /hidden_accounts: hiddenArr/.test(aroute));
check('route: the starting balance is super-admin only and goes through hub_party_opening', /(db\.rpc\(|rpcOnceMore\(db, )'hub_party_opening'/.test(aroute) && /isSuper/.test(aroute) && /action === 'opening' && !isSuper/.test(aroute));
check('route: marking a bank line as a payment to NextTrade re-checks it is KTC money out, not private, not already marked', /action === 'mark_payment'/.test(aroute) && /isPrivateRow\(/.test(aroute) && /third_party_payer/.test(aroute));
check('route SWC-safe', aroute.indexOf('`') < 0 && !/=>/.test(aroute));
check('route: the KTC business id comes from the server, never the request; the starting balance needs a staff-visibility choice', /ktc_business: US_WAVE_BUSINESS_ID/.test(aroute) && /visible_to_staff: body\.visible_to_staff === true/.test(aroute));
var broute = fs.readFileSync(path.join(root, 'src/app/api/accounting/bills/route.js'), 'utf8');
check('bills route rtm_flag: checks privacy and KTC ownership on the server (not just the screen list)', /scopeRF = await privateScope/.test(broute) && /isPrivateRow\(txR\.data, scopeRF\)/.test(broute) && /not in one of KTC/.test(broute));
var proutes = ['pnl', 'profitability', 'sales-report'].map(function (r) { return fs.readFileSync(path.join(root, 'src/app/api/accounting/' + r + '/route.js'), 'utf8'); });
check('P&L, Profitability and Sales Report clamp the start date to the employee history window on the server (fails closed)', proutes.every(function (t) { return /windowFloorFor\(db, /.test(t) && /body\.date_from = clampFrom\(body\.date_from, vwin\.floor\)/.test(t) && /if \(vwin\.error\)/.test(t); }));
check('lib: payroll lines never carry a name onto the KTC bill', /Warehouse staff \(Nextrade payroll\)/.test(lib));
check('panel: Pay NextTrade form ticks bills + fee + advance and shows what is left', /Pay bills \/ fee \/ advance/.test(panel) && /left after this/.test(panel) && /'allocate'/.test(panel));
check('panel: possible payments to mark, and the starting balance form', /This is a payment to/.test(panel) && /Starting balance/.test(panel));
check('Nextrade bills panel: a Pay ▸ button on each open bill', /Pay ▸/.test(nbp));
check('lib: wantsBill honours "KTC pays this" before the payroll rule', /typeof cat\.makes_ktc_bill === 'boolean'/.test(lib));
check('company books: categories carry makes_ktc_bill; the form has the "KTC pays this" tick', /makes_ktc_bill/.test(croute) && /KTC pays this/.test(ctab));
check('company books: earlier lines in a KTC-pays category with no bill can be billed in one click', /action === 'make_missing_bills'/.test(croute) && /missing_bills/.test(croute));
console.log('\nUD pay NextTrade: ' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
