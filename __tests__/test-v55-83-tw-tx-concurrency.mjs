// ═══════════════════════════════════════════════════════════════════════════
// v55.83-TW / TX — TWO SESSIONS AT ONCE on a real, disposable Postgres 16 (Codex recheck 17 Nov). Never Supabase.
// Loads the real scripts (TO, TV, TW, TX) on __tests__/pg/stub-schema.sql, then opens TWO separate connections and makes
// them collide: session A starts the action inside a transaction and holds it open; session B starts the SAME action
// and must wait on A's locks; then A commits and B finishes. Checks the outcome a real double-click / two people produce.
// Needs EMBEDDED_PG_DIR = a folder with embedded-postgres + pg installed (not a project dependency). Data dir is created
// under that folder and removed at the end.
// ═══════════════════════════════════════════════════════════════════════════
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
var here = path.dirname(fileURLToPath(import.meta.url)); var root = path.join(here, '..');
var dir = process.env.EMBEDDED_PG_DIR;
if (!dir) { console.log('SKIPPED — set EMBEDDED_PG_DIR. Nothing was checked.'); process.exit(2); }
var req = createRequire(path.join(dir, 'package.json'));
var EmbeddedPostgres = (await import('file://' + req.resolve('embedded-postgres').replace(/\\/g, '/'))).default;
var pg = req('pg');
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra))); }
var dataDir = path.join(dir, 'data-' + Date.now()); var port = 54000 + Math.floor(Math.random() * 900);
var server = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'test-only', port: port, persistent: false, initdbFlags: ['--encoding=UTF8', '--locale=C'] });
var ACTOR = '11111111-1111-1111-1111-111111111111'; var US = 'QnVzaW5lc3M6NWRkNzI3MDctOTExNC00NjQwLTg4MGQtMjYzNmI3YzM4YTdk';
function client() { return new pg.Client({ host: 'localhost', port: port, user: 'postgres', password: 'test-only', database: 'postgres' }); }
var A, B, X;
try {
  await server.initialise(); await server.start();
  console.log('TW / TX — two sessions at once (real Postgres 16, disposable)');
  X = client(); await X.connect();
  await X.query(fs.readFileSync(path.join(here, 'pg/stub-schema.sql'), 'utf8'));
  for (var f of ['v55-83-TO-payment-guards.sql', 'v55-83-TV-repeating-bills.sql', 'v55-83-TW-company-books.sql', 'v55-83-TX-advances-fees.sql', 'v55-83-UB-company-transfers.sql', 'v55-83-UD-pay-nextrade.sql']) { await X.query(fs.readFileSync(path.join(root, 'sql', f), 'utf8')); }
  await X.query("insert into company_categories (company_id, key, label, kind) values ('NEXTRADE_BOOKS','elec','Electricity','expense')");
  A = client(); B = client(); await A.connect(); await B.connect();
  async function one(c, sql, params) { return (await c.query(sql, params || [])).rows[0]; }
  function payload(lineId, extra) { return JSON.stringify(Object.assign({ line_id: lineId, company_id: 'NEXTRADE_BOOKS', category_key: 'elec', actor: ACTOR, ktc_category: 'utilities', party: 'NextTrade Industries', source: 'manual', bill: { wave_business_id: US, vendor_name: 'Power Co', bill_number: 'NXT-' + String(lineId).substring(0, 6), bill_date: '2026-11-17', due_date: '2026-11-30', notes: 'Created from Nextrade' } }, extra || {})); }
  async function collide(sqlA, pa, sqlB, pb) {
    // A holds its transaction open; B must wait; then A commits
    await A.query('BEGIN'); var ra = await A.query(sqlA, pa);
    var bDone = false; var rb = null; var eb = null;
    var bp = B.query(sqlB, pb).then(function (r) { bDone = true; rb = r; }, function (e) { bDone = true; eb = e; });
    await new Promise(function (r) { setTimeout(r, 700); });
    var waited = !bDone;
    await A.query('COMMIT'); await bp;
    return { a: ra.rows[0], b: rb ? rb.rows[0] : null, bErr: eb ? String(eb.message) : null, waited: waited };
  }

  // 1. two people categorize the SAME Nextrade line as an expense at the same moment
  var L1 = (await one(X, "insert into bank_transactions (wave_business_id, account_id, direction, amount_abs, date, name) values ('NEXTRADE_BOOKS','A1','out',412.5,'2026-11-17','POWER') returning id")).id;
  var c1 = await collide('select public.hub_company_categorize($1::jsonb) as r', [payload(L1)], 'select public.hub_company_categorize($1::jsonb) as r', [payload(L1)]);
  check('same line, two sessions: the second WAITED for the first (lock held)', c1.waited === true);
  check('… exactly ONE KTC bill and ONE link; the second saw the first\'s bill (updated, not created)', (await one(X, 'select count(*)::int n from company_bill_links where source_bank_transaction_id=$1', [L1])).n === 1 && (await one(X, "select count(*)::int n from vendor_bills where notes='Created from Nextrade'")).n === 1 && c1.a.r.action === 'created' && c1.b && c1.b.r.action === 'updated', c1);

  // 2. two DIFFERENT lines both proposing to attach the SAME open bill
  var RENT = (await one(X, "insert into vendor_bills (wave_business_id, vendor_name, bill_number, bill_date, total_amount) values ($1,'Rent Co','AUTO-RENT','2026-11-15',3000) returning id", [US])).id;
  var L2 = (await one(X, "insert into bank_transactions (wave_business_id, account_id, direction, amount_abs, date, name) values ('NEXTRADE_BOOKS','A1','out',3000,'2026-11-17','RENT') returning id")).id;
  var L3 = (await one(X, "insert into bank_transactions (wave_business_id, account_id, direction, amount_abs, date, name) values ('NEXTRADE_BOOKS','A1','out',3000,'2026-11-17','RENT') returning id")).id;
  var c2 = await collide('select public.hub_company_categorize($1::jsonb) as r', [payload(L2, { attach_bill_id: RENT })], 'select public.hub_company_categorize($1::jsonb) as r', [payload(L3, { attach_bill_id: RENT })]);
  var actions = [c2.a && c2.a.r.action, c2.b && c2.b.r.action].sort().join(',');
  check('two lines racing for the same open bill: one attaches it, the other gets its own new bill (never both on one bill)', actions === 'attached,created' && (await one(X, "select count(*)::int n from company_bill_links where bill_id=$1 and status='active'", [RENT])).n === 1, c2);

  // 3. two people paying different bills from the same 1,000 advance at once (800 each)
  var W = (await one(X, "insert into bank_transactions (wave_business_id, account_id, direction, amount_abs, date, name, third_party_payer) values ($1,'K','out',1000,'2026-11-20','WIRE','NextTrade Industries') returning id", [US])).id;
  await X.query("select public.hub_party_money('split','NextTrade Industries',1000,0,$1,null,null,$2,'r-split')", [W, ACTOR]);
  var B1 = (await one(X, "insert into vendor_bills (wave_business_id, vendor_name, bill_number, bill_date, total_amount, paid_via) values ($1,'V1','V1','2026-11-20',800,'NextTrade Industries') returning id", [US])).id;
  var B2 = (await one(X, "insert into vendor_bills (wave_business_id, vendor_name, bill_number, bill_date, total_amount, paid_via) values ($1,'V2','V2','2026-11-20',800,'NextTrade Industries') returning id", [US])).id;
  var sqlApply = "select public.hub_party_money('apply','NextTrade Industries',800,0,null,$1,null,$2,$3) as r";
  var c3 = await collide(sqlApply, [B1, ACTOR, 'r-a1'], sqlApply, [B2, ACTOR, 'r-a2']);
  var adv = (await one(X, "select coalesce(sum(amount),0)::float a from party_money_entries where party='NextTrade Industries' and bucket='advance'")).a;
  check('two people spend the same advance at once: the second WAITED, then was refused; advance 200, never below zero', c3.waited === true && !!c3.bErr && /advance is only/.test(c3.bErr) && adv === 200, { c3: c3, adv: adv });
  check('… only ONE bill was paid from the advance', (await one(X, "select count(*)::int n from vendor_bill_payments where method='advance'")).n === 1);

  // 4. the same click arriving twice from two sessions at once
  var B3 = (await one(X, "insert into vendor_bills (wave_business_id, vendor_name, bill_number, bill_date, total_amount, paid_via) values ($1,'V3','V3','2026-11-20',100,'NextTrade Industries') returning id", [US])).id;
  var sqlSame = "select public.hub_party_money('apply','NextTrade Industries',100,0,null,$1,null,$2,'r-same') as r";
  var c4 = await collide(sqlSame, [B3, ACTOR], sqlSame, [B3, ACTOR]);
  check('the same click from two sessions at once: money moves ONCE (the second is a repeat or refused, never a second payment)', (await one(X, 'select count(*)::int n from vendor_bill_payments where bill_id=$1', [B3])).n === 1 && (await one(X, "select coalesce(sum(amount),0)::float a from party_money_entries where party='NextTrade Industries' and bucket='advance'")).a === 100, c4);
  // 5. while session A is adding money from a PRIVATE account (lock held), session B — who may not see that account — tries
  //    to turn part of the pool into a fee: B waits, then is refused (the check runs inside the move, after A's commit)
  await X.query("insert into paid_through_parties values ('Test Co','affiliate',null) on conflict do nothing");
  var Wpub = (await one(X, "insert into bank_transactions (wave_business_id, account_id, direction, amount_abs, date, name, third_party_payer) values ($1,'PUB','out',500,'2026-11-20','PUB','Test Co') returning id", [US])).id;
  var Wpriv = (await one(X, "insert into bank_transactions (wave_business_id, account_id, direction, amount_abs, date, name, third_party_payer) values ($1,'PRIV','out',500,'2026-11-20','PRIV','Test Co') returning id", [US])).id;
  await X.query("select public.hub_party_money('split','Test Co',500,0,$1,null,null,$2,'r-pub',NULL)", [Wpub, ACTOR]);
  var c5 = await collide("select public.hub_party_money('split','Test Co',500,0,$1,null,null,$2,'r-priv',NULL) as r", [Wpriv, ACTOR],
    "select public.hub_party_money('to_fee','Test Co',100,0,null,null,'why',$1,'r-tofee',ARRAY['PRIV']) as r", [ACTOR]);
  check('private money added by A while restricted B tries to move the pool: B waited, then was refused; no fee moved', c5.waited === true && !!c5.bErr && /private account/.test(c5.bErr) && (await one(X, "select coalesce(sum(amount),0)::float f from party_money_entries where party='Test Co' and bucket='fee'")).f === 0, c5);
  // 6. (UB) two people pair the SAME line with two different other lines at the same moment: one pair only
  await X.query("insert into plaid_accounts values ('CHK2','chk','1','depository','NEXTRADE_BOOKS'), ('SAV2','sav','2','depository','NEXTRADE_BOOKS'), ('CC2','cc','3','credit','NEXTRADE_BOOKS') on conflict do nothing");
  var PA = (await one(X, "insert into bank_transactions (wave_business_id, account_id, direction, amount_abs, date, name) values ('NEXTRADE_BOOKS','CHK2','out',250,'2026-11-20','OUT') returning id")).id;
  var PB = (await one(X, "insert into bank_transactions (wave_business_id, account_id, direction, amount_abs, date, name) values ('NEXTRADE_BOOKS','SAV2','in',250,'2026-11-20','IN1') returning id")).id;
  var PC = (await one(X, "insert into bank_transactions (wave_business_id, account_id, direction, amount_abs, date, name) values ('NEXTRADE_BOOKS','CC2','in',250,'2026-11-20','IN2') returning id")).id;
  var c6 = await collide('select public.hub_company_pair_transfer($1::jsonb) as r', [JSON.stringify({ a: PA, b: PB, company_id: 'NEXTRADE_BOOKS', actor: ACTOR })], 'select public.hub_company_pair_transfer($1::jsonb) as r', [JSON.stringify({ a: PA, b: PC, company_id: 'NEXTRADE_BOOKS', actor: ACTOR })]);
  var gA = (await one(X, 'select transfer_group_id g from bank_transactions where id=$1', [PA])).g;
  check('(UB) the same line paired twice at once: the second WAITED and was refused; the line is in ONE pair only', c6.waited === true && !!c6.bErr && /already paired/.test(c6.bErr) && (await one(X, 'select count(*)::int n from bank_transactions where transfer_group_id=$1', [gA])).n === 2 && (await one(X, 'select transfer_group_id g from bank_transactions where id=$1', [PC])).g === null, c6);
  // 7. (UB, Codex 22:50) unpair racing a category change on one of its lines, and unpair racing a new pair: one lock order → no
  //    deadlock; each finishes or is refused whole
  async function mkPair(amt) {
    var x = (await one(X, "insert into bank_transactions (wave_business_id, account_id, direction, amount_abs, date, name) values ('NEXTRADE_BOOKS','CHK2','out',$1,'2026-11-21','O') returning id", [amt])).id;
    var y = (await one(X, "insert into bank_transactions (wave_business_id, account_id, direction, amount_abs, date, name) values ('NEXTRADE_BOOKS','SAV2','in',$1,'2026-11-21','I') returning id", [amt])).id;
    var g = (await one(X, 'select public.hub_company_pair_transfer($1::jsonb) as r', [JSON.stringify({ a: x, b: y, company_id: 'NEXTRADE_BOOKS', actor: ACTOR })])).r.transfer_group_id;
    return { x: x, y: y, g: g };
  }
  var U1 = await mkPair(61);
  var c7 = await collide('select public.hub_company_unpair_transfer($1::jsonb) as r', [JSON.stringify({ transfer_group_id: U1.g, company_id: 'NEXTRADE_BOOKS', actor: ACTOR })],
    'select public.hub_company_categorize($1::jsonb) as r', [JSON.stringify({ line_id: U1.y, company_id: 'NEXTRADE_BOOKS', category_key: 'elec', actor: ACTOR })]);
  var y7 = await one(X, 'select transfer_group_id g, company_category c from bank_transactions where id=$1', [U1.y]);
  check('(UB) unpair vs a category change on the same line at once: no deadlock; B waited, then ran on the unpaired line', c7.waited === true && !(c7.bErr && /deadlock/i.test(c7.bErr)) && y7.g === null && (await one(X, 'select transfer_group_id g from bank_transactions where id=$1', [U1.x])).g === null, { c7: c7, y7: y7 });
  var U2 = await mkPair(62);
  var Z = (await one(X, "insert into bank_transactions (wave_business_id, account_id, direction, amount_abs, date, name) values ('NEXTRADE_BOOKS','CC2','in',62,'2026-11-21','I2') returning id")).id;
  var c8 = await collide('select public.hub_company_unpair_transfer($1::jsonb) as r', [JSON.stringify({ transfer_group_id: U2.g, company_id: 'NEXTRADE_BOOKS', actor: ACTOR })],
    'select public.hub_company_pair_transfer($1::jsonb) as r', [JSON.stringify({ a: U2.x, b: Z, company_id: 'NEXTRADE_BOOKS', actor: ACTOR })]);
  var gx = (await one(X, 'select transfer_group_id g from bank_transactions where id=$1', [U2.x])).g;
  check('(UB) unpair vs pairing one of its lines elsewhere at once: no deadlock; B waited, then paired it with the new line (never in two pairs)', c8.waited === true && !(c8.bErr && /deadlock/i.test(c8.bErr)) && gx !== null && gx !== U2.g && (await one(X, 'select transfer_group_id g from bank_transactions where id=$1', [Z])).g === gx && (await one(X, 'select transfer_group_id g from bank_transactions where id=$1', [U2.y])).g === null, c8);
  // 8. (UB, Codex 23:10) PRIVACY FLIP racing a restricted pair / unpair. Session A (an admin) makes an account private and holds
  //    its transaction open; session B (no private permission) pairs / unpairs a line in that account. B must WAIT on A's lock on
  //    the account row (FOR SHARE vs UPDATE), then — after A commits — see the account as private and be refused.
  await X.query("insert into plaid_accounts (plaid_account_id, name, mask, type, wave_business_id) values ('PCHK','p chk','11','depository','NEXTRADE_BOOKS'), ('PSAV','p sav','22','depository','NEXTRADE_BOOKS') on conflict do nothing");
  var Q1 = (await one(X, "insert into bank_transactions (wave_business_id, account_id, direction, amount_abs, date, name) values ('NEXTRADE_BOOKS','PCHK','out',71,'2026-11-22','O') returning id")).id;
  var Q2 = (await one(X, "insert into bank_transactions (wave_business_id, account_id, direction, amount_abs, date, name) values ('NEXTRADE_BOOKS','PSAV','in',71,'2026-11-22','I') returning id")).id;
  var c9 = await collide("update plaid_accounts set is_private = true where plaid_account_id = 'PSAV'", [],
    'select public.hub_company_pair_transfer($1::jsonb) as r', [JSON.stringify({ a: Q1, b: Q2, company_id: 'NEXTRADE_BOOKS', actor: ACTOR, hidden_accounts: [], restricted: true })]);
  check('(UB) account made private WHILE a restricted person pairs it: the pair WAITED for the change, then was refused; nothing paired', c9.waited === true && !!c9.bErr && /private account/.test(c9.bErr) && (await one(X, 'select transfer_group_id g from bank_transactions where id=$1', [Q1])).g === null, c9);
  await X.query("update plaid_accounts set is_private = false where plaid_account_id = 'PSAV'");
  var gQ = (await one(X, 'select public.hub_company_pair_transfer($1::jsonb) as r', [JSON.stringify({ a: Q1, b: Q2, company_id: 'NEXTRADE_BOOKS', actor: ACTOR })])).r.transfer_group_id;
  var c10 = await collide("update plaid_accounts set is_private = true where plaid_account_id = 'PSAV'", [],
    'select public.hub_company_unpair_transfer($1::jsonb) as r', [JSON.stringify({ transfer_group_id: gQ, company_id: 'NEXTRADE_BOOKS', actor: ACTOR, hidden_accounts: [], restricted: true })]);
  check('(UB) account made private WHILE a restricted person unpairs it: the unpair WAITED, then was refused; the pair stays', c10.waited === true && !!c10.bErr && /private account/.test(c10.bErr) && (await one(X, 'select transfer_group_id g from bank_transactions where id=$1', [Q2])).g === gQ, c10);
  // 9. (UD) two people use the SAME payment to NextTrade at once: one lock on the payment → the second waits, then sees what
  //    the first used and is refused if it would spend the payment twice; nothing partial
  await X.query("insert into plaid_accounts (plaid_account_id, name, mask, type, wave_business_id) values ('KOPS9','KTC ops','99','depository',$1) on conflict do nothing", [US]);
  async function ntPay(amt) { return (await one(X, "insert into bank_transactions (wave_business_id, account_id, direction, amount_abs, date, name, third_party_payer) values ($1,'KOPS9','out',$2,'2026-11-18','WIRE NEXTRADE','NextTrade Industries') returning id", [US, amt])).id; }
  async function ntBill(n, amt) { return (await one(X, "insert into vendor_bills (wave_business_id, vendor_name, bill_number, bill_date, total_amount, paid_via) values ($1,'V',$2,'2026-11-18',$3,'NextTrade Industries') returning id", [US, n, amt])).id; }
  function al(o) { return [JSON.stringify(Object.assign({ party: 'NextTrade Industries', actor: ACTOR, ktc_business: US }, o))]; }
  var P9 = await ntPay(500);
  var c11 = await collide('select public.hub_party_allocate($1::jsonb) as r', al({ bank_transaction_id: P9, advance: 400, request_id: 'ud-c1a' }), 'select public.hub_party_allocate($1::jsonb) as r', al({ bank_transaction_id: P9, fee: 200, request_id: 'ud-c1b' }));
  check('(UD) same payment, two people at once: the second WAITED, then was refused (over by 100); only the first stands', c11.waited === true && !!c11.bErr && /over by 100/.test(c11.bErr) && (await one(X, "select count(*)::int n from party_money_entries where bank_transaction_id=$1", [P9])).n === 1, c11);
  // 10. a bill paid from a payment AND from the advance at the same moment: one of them only
  var B10 = await ntBill('UD-B10', 100); var P10 = await ntPay(300);
  var c12 = await collide('select public.hub_party_allocate($1::jsonb) as r', al({ bank_transaction_id: P10, bills: [{ bill_id: B10, amount: 100 }], request_id: 'ud-c2a' }),
    "select public.hub_party_money('apply','NextTrade Industries',100,0,null,$1,null,$2,'ud-c2b',NULL) as r", [B10, ACTOR]);
  check('(UD) the same bill paid from a payment and from the advance at once: the second WAITED and was refused; the bill is paid once', c12.waited === true && !!c12.bErr && Number((await one(X, 'select coalesce(sum(amount),0) s from vendor_bill_payments where bill_id=$1 and voided is not true', [B10])).s) === 100, c12);
  // 11. two payments ticking the same two bills in OPPOSITE order: no deadlock; together they never overpay a bill
  var BX = await ntBill('UD-BX', 50); var BY = await ntBill('UD-BY', 50); var PA = await ntPay(100); var PB = await ntPay(100);
  var c13 = await collide('select public.hub_party_allocate($1::jsonb) as r', al({ bank_transaction_id: PA, bills: [{ bill_id: BX, amount: 30 }, { bill_id: BY, amount: 30 }], request_id: 'ud-c3a' }),
    'select public.hub_party_allocate($1::jsonb) as r', al({ bank_transaction_id: PB, bills: [{ bill_id: BY, amount: 30 }, { bill_id: BX, amount: 30 }], request_id: 'ud-c3b' }));
  var sx = Number((await one(X, 'select coalesce(sum(amount),0) s from vendor_bill_payments where bill_id=$1', [BX])).s); var sy = Number((await one(X, 'select coalesce(sum(amount),0) s from vendor_bill_payments where bill_id=$1', [BY])).s);
  check('(UD) opposite bill order at once: no deadlock; B waited, then refused whole (only 20 left on each bill); each bill paid 30', c13.waited === true && !(c13.bErr && /deadlock/i.test(c13.bErr)) && !!c13.bErr && /still open/.test(c13.bErr) && sx === 30 && sy === 30, { c13: c13, sx: sx, sy: sy });
  // 12. (UD, Codex 11:40) the payment is re-marked to RTM while a NextTrade step runs on it: the row lock makes one wait for the other
  var P12 = await ntPay(100);
  var c14 = await collide('select public.hub_party_allocate($1::jsonb) as r', al({ bank_transaction_id: P12, advance: 50, request_id: 'ud-c4a' }), "update bank_transactions set third_party_payer = 'RTM Capital' where id = $1", [P12]);
  check('(UD) re-marking a payment while a NextTrade step runs on it WAITED for the step; the step stands whole', c14.waited === true && (await one(X, "select count(*)::int n from party_money_entries where request_id='ud-c4a'")).n === 1, c14);
  var c15 = await collide("update bank_transactions set third_party_payer = 'RTM Capital' where id = $1", [P12 = await ntPay(100)], 'select public.hub_party_allocate($1::jsonb) as r', al({ bank_transaction_id: P12, advance: 50, request_id: 'ud-c5b' }));
  check('(UD) the other order: re-marked to RTM first → the NextTrade step waited, then was refused; nothing written', c15.waited === true && !!c15.bErr && /not marked as a payment to NextTrade/.test(c15.bErr) && (await one(X, "select count(*)::int n from party_money_entries where request_id='ud-c5b'")).n === 0, c15);
  // 13. a legacy bill payment (record_payment / pay_bills_from_bank) on the same payment line at the same moment: never over-spent
  var P13 = await ntPay(100); var B13 = await ntBill('UD-B13', 80); var B13b = await ntBill('UD-B13b', 80);
  var c16 = await collide('select public.hub_party_allocate($1::jsonb) as r', al({ bank_transaction_id: P13, bills: [{ bill_id: B13, amount: 80 }], request_id: 'ud-c6a' }),
    "insert into vendor_bill_payments (bill_id, amount, paid_date, bank_transaction_id, method, created_by) values ($1, 80, '2026-11-18', $2, 'bank', $3) returning id", [B13b, P13, ACTOR]);
  check('(UD) a legacy bill payment on the same payment at once: it WAITED, then the database refused it (the payment is only 100)', c16.waited === true && !!c16.bErr && /over by/.test(c16.bErr) && Number((await one(X, 'select coalesce(sum(amount),0) s from vendor_bill_payments where bank_transaction_id=$1 and voided is not true', [P13])).s) === 80, c16);
  // 14. the payment's account turns private while a restricted person is paying from it
  await X.query("insert into plaid_accounts (plaid_account_id, name, mask, type, wave_business_id) values ('KOPS14','KTC ops 14','14','depository',$1) on conflict do nothing", [US]);
  var P14 = (await one(X, "insert into bank_transactions (wave_business_id, account_id, direction, amount_abs, date, name, third_party_payer) values ($1,'KOPS14','out',100,'2026-11-18','W','NextTrade Industries') returning id", [US])).id; var B14 = await ntBill('UD-B14', 50);
  var c17 = await collide("update plaid_accounts set is_private = true where plaid_account_id = 'KOPS14'", [], 'select public.hub_party_allocate($1::jsonb) as r', al({ bank_transaction_id: P14, bills: [{ bill_id: B14, amount: 50 }], request_id: 'ud-c7b', hidden_accounts: [], restricted: true }));
  check('(UD) account made private WHILE a restricted person pays from it: they WAITED, then were refused; nothing paid', c17.waited === true && !!c17.bErr && /private account/.test(c17.bErr) && Number((await one(X, 'select coalesce(sum(amount),0) s from vendor_bill_payments where bill_id=$1', [B14])).s) === 0, c17);
} catch (e) {
  failN++; console.log('  ✗ FAIL: the run itself errored: ' + (e && e.message));
} finally {
  try { if (A) { await A.end(); } if (B) { await B.end(); } if (X) { await X.end(); } } catch (e2) { /* closing */ }
  try { await server.stop(); } catch (e3) { /* stopped */ }
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e4) { /* cleanup */ }
}
console.log('\nTW/TX two sessions: ' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
