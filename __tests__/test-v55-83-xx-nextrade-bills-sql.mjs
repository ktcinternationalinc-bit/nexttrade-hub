// ═══════════════════════════════════════════════════════════════════════════
// v55.83-XX — Nextrade bills through the REAL database guards (Postgres 16), with NO SQL change (Max, 23 Nov 2026: "no need to validate
// these bills / will be available for only Nextrade payments wires / also will be able to use available balance for nextrade that we enter
// in the beginning"). Codex 23 Nov 18:56: "prove one unvalidated linked NextTrade bill goes through BOTH complete payment paths with real
// installed database guards, while an ordinary unvalidated bill, RTM source, insufficient/fully reserved source, and already-reserved bill
// are refused ... don't disable existing database guards".
// The stack is loaded exactly as the WF / XO tests do (stub, RH … US, WF, XO). Nothing here changes a database function.
//   • the validation exemption is a SERVER-ROUTE rule (wire-packages open_bills / save_draft / auditPackage): no database money function
//     reads validation_status — checked below on the real definitions. The ordinary unvalidated bill is therefore refused by the route
//     (test-v55-83-xx-nextrade-bills.js 30 / 31), not here.
//   • path 1: a request drawn from a confirmed KTC transfer to NextTrade pays an UNVALIDATED Nextrade bill (wire_request_send);
//   • path 2: the NextTrade starting balance pays another UNVALIDATED Nextrade bill (hub_party_opening_pay);
//   • refused by the database: more than the transfer has left, a transfer fully reserved by another request, a bill already reserved on an
//     open wire, a bill paid through NextTrade from RTM's starting balance.
// Needs embedded-postgres + pg: EMBEDDED_PG_DIR = a folder whose node_modules has them. Never touches Supabase.
// ═══════════════════════════════════════════════════════════════════════════
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
var here = path.dirname(fileURLToPath(import.meta.url)); var root = path.join(here, '..');
var dir = process.env.EMBEDDED_PG_DIR;
if (!dir) { console.log('SKIPPED — set EMBEDDED_PG_DIR. Nothing was checked.'); process.exit(2); }
var req = createRequire(path.join(dir, 'package.json'));
var EmbeddedPostgres, pg;
try { EmbeddedPostgres = (await import('file://' + req.resolve('embedded-postgres').replace(/\\/g, '/'))).default; pg = req('pg'); }
catch (e) { console.log('SKIPPED — embedded-postgres / pg not found in EMBEDDED_PG_DIR. Nothing was checked.'); process.exit(2); }
var dataDir = path.join(dir, 'data-xx-' + Date.now()); var port = 54000 + Math.floor(Math.random() * 900);
var server = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'test-only', port: port, persistent: false, initdbFlags: ['--encoding=UTF8', '--locale=C'] });
function client() { return new pg.Client({ host: 'localhost', port: port, user: 'postgres', password: 'test-only', database: 'postgres' }); }
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 1100))); }
async function q(c, sql, params) { try { var r = await c.query(sql, params || []); return { rows: (Array.isArray(r) ? r[r.length - 1] : r).rows }; } catch (e) { return { error: String(e.message || e) }; } }
var ACTOR = '11111111-1111-1111-1111-111111111111', S1 = '22222222-2222-4222-8222-222222222222', S2 = '33333333-3333-4333-8333-333333333333';
var NT = 'NextTrade Industries', RTM = 'RTM Capital';
var db; var seq = 0; var click = 0;
try {
  console.log('XX — Nextrade bills through the real database guards (real Postgres 16, no SQL changed)');
  await server.initialise(); await server.start();
  db = client(); await db.connect();
  var loaded = [];
  async function load(f) { var r = await q(db, fs.readFileSync(path.join(root, f), 'utf8')); loaded.push([f, r.error || 'ok']); return r; }
  await load('__tests__/pg/stub-schema.sql');
  await db.query('DROP TABLE IF EXISTS public.wire_package_lines, public.wire_packages CASCADE');
  for (var role of ['service_role', 'anon', 'authenticated']) { await q(db, 'CREATE ROLE ' + role + ' NOLOGIN'); }
  for (var f of ['RH-wire-packages', 'RI-wire-simple', 'RL-wire-override-delete-reference', 'RZ-wire-ready-sent-paid', 'SP-funded-requests', 'TO-payment-guards', 'TV-repeating-bills', 'TW-company-books', 'TX-advances-fees', 'UB-company-transfers', 'UD-pay-nextrade', 'US-partial-wires']) { await load('sql/v55-83-' + f + '.sql'); }
  await q(db, 'ALTER TABLE public.bank_transactions ADD COLUMN IF NOT EXISTS matched_invoice_id uuid, ADD COLUMN IF NOT EXISTS transfer_group_id uuid');
  var wfRun = await load('sql/v55-83-WF-party-funds.sql'); var xoRun = await load('sql/v55-83-XO-starting-balance.sql');
  // the live column (sql/v55-83-PE-bills-register.sql) — the stub has none; every bill below is created NOT validated
  await q(db, "ALTER TABLE public.vendor_bills ADD COLUMN IF NOT EXISTS validation_status text NOT NULL DEFAULT 'pending'");
  check('the stack loads (stub, RH … US, WF, XO) — the same scripts as live, none edited by this build', loaded.every(function (x) { return x[1] === 'ok'; }) && wfRun.rows && xoRun.rows, loaded);
  var noSql = !fs.existsSync(path.join(root, 'sql/v55-83-XX-nextrade-bills.sql'));
  var money = ['wire_request_send', 'hub_party_opening_pay', 'hub_party_record_paid', 'hub_wire_line_pay', 'hub_wire_line_cap', 'hub_bill_payment_cap', 'hub_bill_payment_final', 'hub_guard_bill_payment', 'wire_funding_summary', 'hub_party_transfer_state'];
  var defs = (await db.query("SELECT p.proname, pg_get_functiondef(p.oid) AS d FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = ANY($1)", [money])).rows;
  check('no SQL file for XX, and no database money function reads validation_status (' + defs.length + ' real definitions) — the exemption lives in the server route only', noSql && defs.length >= 8 && defs.every(function (r) { return !/validation_status/.test(r.d); }), defs.map(function (r) { return r.proname; }));

  async function transfer(amount, party, date) { seq++; var r = await db.query("INSERT INTO public.bank_transactions (wave_business_id, account_id, direction, amount_abs, date, posted_date, pending, third_party_payer, name) VALUES ('KTC', 'A1', 'out', $1, $2, $2, false, $3, $4) RETURNING id", [amount, date || '2026-09-02', party, 'TRANSFER ' + seq]); return r.rows[0].id; }
  async function bill(total, via, date) { seq++; var r = await db.query("INSERT INTO public.vendor_bills (vendor_name, bill_number, bill_date, total_amount, record_status, paid_via, currency) VALUES ($1, $2, $3, $4, 'active', $5, 'USD') RETURNING id", ['Nextrade vendor ' + seq, 'NXT-' + seq, date || '2026-09-05', total, via || null]); return r.rows[0].id; }
  async function link(billId) { var r = await q(db, "INSERT INTO public.company_bill_links (source_bank_transaction_id, company_id, bill_id, mode, status) VALUES (gen_random_uuid(), 'NEXTRADE_BOOKS', $1, 'created', 'active') RETURNING id", [billId]); return r; }
  async function request(txn, party, lines, signed) {
    var r = await q(db, "INSERT INTO public.wire_packages (payee_kind, payee_name, fee_amount, status, funding_txn_id, created_by" + (signed === false ? '' : ', signoff1_by, signoff1_at, signoff2_by, signoff2_at') + ") VALUES ($1, $2, 0, 'draft', $3, $4" + (signed === false ? '' : ", '" + S1 + "', now(), '" + S2 + "', now()") + ") RETURNING id", [party === RTM ? 'service_provider' : 'affiliate', party, txn, ACTOR]);
    if (r.error) { return { error: r.error }; }
    var id = r.rows[0].id;
    for (var l of (lines || [])) { var e = await q(db, 'INSERT INTO public.wire_package_lines (package_id, bill_id, amount) VALUES ($1, $2, $3)', [id, l[0], l[1]]); if (e.error) { return { id: id, error: e.error }; } }
    return { id: id };
  }
  function send(id, date) { return q(db, 'SELECT public.wire_request_send($1, $2, $3) AS r', [id, ACTOR, date || '2026-09-15']); }
  function confirm(txn, party) { return q(db, 'SELECT public.hub_party_transfer_set_state($1::jsonb) AS r', [JSON.stringify({ bank_transaction_id: txn, party: party, state: 'confirmed', actor: ACTOR, note: 'XX test' })]); }
  function addCall(p) { click++; return q(db, 'SELECT public.hub_party_opening_add($1::jsonb) AS r', [JSON.stringify(Object.assign({ actor: ACTOR, request_id: 'xx-ob-' + click, reason: 'NextTrade statement of 31 May 2026', visible_to_staff: false }, p))]); }
  function payCall(p) { click++; return q(db, 'SELECT public.hub_party_opening_pay($1::jsonb) AS r', [JSON.stringify(Object.assign({ actor: ACTOR, request_id: 'xx-op-' + click, reference: 'NextTrade payment list 3', reason: 'paid from the old balance' }, p))]); }
  async function paid(billId) { return Number((await db.query('SELECT coalesce(sum(amount), 0) AS s FROM public.vendor_bill_payments WHERE bill_id = $1 AND voided IS NOT TRUE', [billId])).rows[0].s); }
  async function vstatus(billId) { return (await db.query('SELECT validation_status FROM public.vendor_bills WHERE id = $1', [billId])).rows[0].validation_status; }

  // ── path 1: a confirmed KTC transfer to NextTrade → a signed request → sent = the unvalidated Nextrade bill is PAID ──
  var N1 = await transfer(1000, NT, '2026-09-02'); var cf = await confirm(N1, NT);
  var NB1 = await bill(600, NT, '2026-09-05'); var lk1 = await link(NB1);
  check('a Nextrade bill: ACTIVE NextTrade company_bill_links row, NOT validated', !lk1.error && await vstatus(NB1) === 'pending' && cf.rows && cf.rows[0].r.ok === true, [lk1, cf]);
  var rq1 = await request(N1, NT, [[NB1, 600]]); var s1 = await send(rq1.id, '2026-09-15');
  check('PATH 1 — a signed request from the confirmed transfer to NextTrade pays the UNVALIDATED Nextrade bill in full (wire_request_send)', !rq1.error && s1.rows && s1.rows[0].r.ok === true && await paid(NB1) === 600, [rq1, s1]);
  var unsigned = await request(N1, NT, [[await bill(10, NT), 10]], false); var sU = await send(unsigned.id);
  check('… the two signatures are still required by the database (an unsigned request is refused)', sU.rows && sU.rows[0].r.ok === false && /Both signatures/.test(sU.rows[0].r.why), sU);
  await q(db, "UPDATE public.wire_packages SET status = 'cancelled' WHERE id = $1", [unsigned.id]); await q(db, 'UPDATE public.wire_package_lines SET is_open = false WHERE package_id = $1', [unsigned.id]);
  // insufficient source: 400 left, a 500 bill
  var NB2 = await bill(500, NT, '2026-09-06'); await link(NB2);
  var rq2 = await request(N1, NT, [[NB2, 500]]); var s2 = await send(rq2.id);
  check('refused: more than the transfer has left ($500 asked, $400 left) — nothing recorded', s2.rows && s2.rows[0].r.ok === false && await paid(NB2) === 0, s2);
  await q(db, "UPDATE public.wire_packages SET status = 'cancelled' WHERE id = $1", [rq2.id]); await q(db, 'UPDATE public.wire_package_lines SET is_open = false WHERE package_id = $1', [rq2.id]);
  // fully reserved source: another draft request holds the last 400
  var NB3 = await bill(400, NT, '2026-09-07'); await link(NB3); var NB4 = await bill(50, NT, '2026-09-08'); await link(NB4);
  var hold = await request(N1, NT, [[NB3, 400]], false); var rq4 = await request(N1, NT, [[NB4, 50]]); var s4 = await send(rq4.id);
  check('refused: a transfer fully reserved by another request (its $400 is held by a draft) — nothing recorded', !hold.error && s4.rows && s4.rows[0].r.ok === false && await paid(NB4) === 0, [hold, s4]);

  // ── path 2: the NextTrade starting balance pays an unvalidated Nextrade bill ──
  var ob = await addCall({ party: NT, amount: 2000, as_of: '2026-05-31', reason: 'NextTrade statement of 31 May 2026: funds held for KTC', visible_to_staff: false });
  var O1 = ob.rows && ob.rows[0].r.id;
  var NB5 = await bill(700, NT, '2026-06-10'); await link(NB5);
  var p1 = await payCall({ party: NT, opening_id: O1, bills: [{ bill_id: NB5, amount: 700 }], paid_date: '2026-06-20' });
  check('PATH 2 — the NextTrade starting balance pays the UNVALIDATED Nextrade bill in full (hub_party_opening_pay)', !!O1 && p1.rows && p1.rows[0].r.ok === true && await paid(NB5) === 700 && await vstatus(NB5) === 'pending', [ob, p1]);
  // already reserved: NB3 is wholly on the open draft request above
  var p2 = await payCall({ party: NT, opening_id: O1, bills: [{ bill_id: NB3, amount: 400 }], paid_date: '2026-06-21' });
  check('refused: a bill already reserved on an open wire (its whole amount is on the draft request) — nothing recorded', /only \$0\.00 open/.test(p2.error || '') && await paid(NB3) === 0, p2);
  var dupLine = await request(N1, NT, [[NB3, 1]], false);
  check('refused: the same bill on a second wire for more than is left (the database line cap)', !!dupLine.error, dupLine);
  // RTM source
  var obR = await addCall({ party: RTM, amount: 3000, as_of: '2026-05-31', reason: 'RTM statement of 31 May 2026: funds held for KTC', visible_to_staff: false });
  var NB6 = await bill(100, NT, '2026-06-11'); await link(NB6);
  var p3 = await payCall({ party: RTM, opening_id: obR.rows && obR.rows[0].r.id, bills: [{ bill_id: NB6, amount: 100 }], paid_date: '2026-06-22' });
  check('refused: RTM’s starting balance cannot pay a bill paid through NextTrade — nothing recorded', /marked as paid through NextTrade Industries/.test(p3.error || '') && await paid(NB6) === 0, p3);
  var R9 = await transfer(800, RTM, '2026-09-03'); await confirm(R9, RTM);
  var rq5 = await request(R9, RTM, [[NB6, 100]]); var s5 = await send(rq5.id);
  var rtmMarked = (await db.query('SELECT paid_via FROM public.vendor_bills WHERE id = $1', [NB6])).rows[0].paid_via;
  check('(database alone) an RTM request carrying a NextTrade-paid bill: ' + (s5.rows && s5.rows[0].r.ok ? 'the database does NOT refuse it — the route refuses it first (save_draft 409, check NEXTRADE_BILL_ONLY / PAYEE_MISMATCH)' : 'refused') + '; the bill keeps paid via NextTrade', rtmMarked === NT, [s5, rtmMarked]);
  check('over-payment of a Nextrade bill is refused by the database like any bill (starting balance asks more than is open)', /only \$0\.00 open/.test((await payCall({ party: NT, opening_id: O1, bills: [{ bill_id: NB5, amount: 1 }], paid_date: '2026-06-23' })).error || ''));
} catch (e) { failN++; console.log('CRASHED: ' + (e && e.stack || e)); }
finally { try { await db.end(); } catch (e) {} try { await server.stop(); } catch (e) {} try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) {} }
console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
