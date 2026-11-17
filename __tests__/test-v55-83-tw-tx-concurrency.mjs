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
  for (var f of ['v55-83-TO-payment-guards.sql', 'v55-83-TV-repeating-bills.sql', 'v55-83-TW-company-books.sql', 'v55-83-TX-advances-fees.sql']) { await X.query(fs.readFileSync(path.join(root, 'sql', f), 'utf8')); }
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
} catch (e) {
  failN++; console.log('  ✗ FAIL: the run itself errored: ' + (e && e.message));
} finally {
  try { if (A) { await A.end(); } if (B) { await B.end(); } if (X) { await X.end(); } } catch (e2) { /* closing */ }
  try { await server.stop(); } catch (e3) { /* stopped */ }
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e4) { /* cleanup */ }
}
console.log('\nTW/TX two sessions: ' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
