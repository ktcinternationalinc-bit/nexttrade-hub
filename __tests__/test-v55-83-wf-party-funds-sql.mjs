// ═══════════════════════════════════════════════════════════════════════════
// v55.83-WF — sql/v55-83-WF-party-funds.sql on a REAL Postgres 16 with TWO connections (Max, 20 Nov 2026; Codex GO 17:07).
// The real stack is loaded first (stub schema, RH, RI, RL, RZ, SP, TO, TV, TW, TX, UB, UD, US), then WF twice.
// Acceptance: Max's $10,000 walk-through; Codex's legacy wire fee (800 stays 800), 900 + 100 reservation, reserve → send with
// other reservations present, fee then old-path request, reversal capped by its own fee, retired pool moves refused in the
// database, a pre-existing un-sourced entry kept, closed month, two people at once.
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
var dataDir = path.join(dir, 'data-wf-' + Date.now()); var port = 54000 + Math.floor(Math.random() * 900);
var server = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'test-only', port: port, persistent: false, initdbFlags: ['--encoding=UTF8', '--locale=C'] });
function client() { return new pg.Client({ host: 'localhost', port: port, user: 'postgres', password: 'test-only', database: 'postgres' }); }
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 1100))); }
async function q(c, sql, params) { try { var r = await c.query(sql, params || []); return { rows: (Array.isArray(r) ? r[r.length - 1] : r).rows }; } catch (e) { return { error: String(e.message || e) }; } }
var ACTOR = '11111111-1111-1111-1111-111111111111', S1 = '22222222-2222-4222-8222-222222222222', S2 = '33333333-3333-4333-8333-333333333333';
var NT = 'NextTrade Industries', RTM = 'RTM Capital';
var db, db2; var seq = 0;
try {
  console.log('WF — funds with RTM / NextTrade, the database step (real Postgres 16, two connections)');
  await server.initialise(); await server.start();
  db = client(); await db.connect(); db2 = client(); await db2.connect();
  var loaded = [];
  async function load(f) { var r = await q(db, fs.readFileSync(path.join(root, f), 'utf8')); loaded.push([f, r.error || 'ok']); }
  await load('__tests__/pg/stub-schema.sql');
  await db.query('DROP TABLE IF EXISTS public.wire_package_lines, public.wire_packages CASCADE');
  for (var role of ['service_role', 'anon', 'authenticated']) { await q(db, 'CREATE ROLE ' + role + ' NOLOGIN'); }
  for (var f of ['RH-wire-packages', 'RI-wire-simple', 'RL-wire-override-delete-reference', 'RZ-wire-ready-sent-paid', 'SP-funded-requests', 'TO-payment-guards', 'TV-repeating-bills', 'TW-company-books', 'TX-advances-fees', 'UB-company-transfers', 'UD-pay-nextrade', 'US-partial-wires']) { await load('sql/v55-83-' + f + '.sql'); }
  check('the stack under it loads (stub, RH … US)', loaded.every(function (x) { return x[1] === 'ok'; }), loaded);

  // a ledger row and a sent request that exist BEFORE WF (nothing already entered may be dropped or re-counted)
  async function transfer(amount, party, date) { seq++; var r = await db.query("INSERT INTO public.bank_transactions (wave_business_id, account_id, direction, amount_abs, date, posted_date, pending, third_party_payer, name) VALUES ('KTC', 'A1', 'out', $1, $2, $2, false, $3, $4) RETURNING id", [amount, date || '2026-09-02', party, 'TRANSFER ' + seq]); return r.rows[0].id; }
  async function bill(total, via, date) { seq++; var r = await db.query("INSERT INTO public.vendor_bills (vendor_name, bill_number, bill_date, total_amount, record_status, paid_via) VALUES ($1, $2, $3, $4, 'active', $5) RETURNING id", ['Vendor ' + seq, 'B-' + seq, date || '2026-09-05', total, via || null]); return r.rows[0].id; }
  async function request(txn, party, fee, lines, signed) { var r = await q(db, "INSERT INTO public.wire_packages (payee_kind, payee_name, fee_amount, status, funding_txn_id, created_by" + (signed === false ? '' : ', signoff1_by, signoff1_at, signoff2_by, signoff2_at') + ") VALUES ($1, $2, $3, 'draft', $4, $5" + (signed === false ? '' : ", '" + S1 + "', now(), '" + S2 + "', now()") + ") RETURNING id", [party === RTM ? 'service_provider' : 'affiliate', party, fee || 0, txn, ACTOR]); if (r.error) { return { error: r.error }; } var id = r.rows[0].id; for (var l of (lines || [])) { var e = await q(db, 'INSERT INTO public.wire_package_lines (package_id, bill_id, amount) VALUES ($1, $2, $3)', [id, l[0], l[1]]); if (e.error) { return { id: id, error: e.error }; } } return { id: id }; }
  function send(c, id, date) { return q(c, 'SELECT public.wire_request_send($1, $2, $3) AS r', [id, ACTOR, date || '2026-09-15']); }
  async function st(txn, except) { return (await db.query('SELECT public.hub_party_transfer_state($1, $2) AS s', [txn, except || null])).rows[0].s; }
  var click = 0;
  function feeCall(c, p) { click++; return q(c, 'SELECT public.hub_party_fee($1::jsonb) AS r', [JSON.stringify(Object.assign({ actor: ACTOR, request_id: 'click-' + click, reason: 'services rendered' }, p))]); }
  function confirm(c, txn, party, state) { return q(c, 'SELECT public.hub_party_transfer_set_state($1::jsonb) AS r', [JSON.stringify({ bank_transaction_id: txn, party: party, state: state || 'confirmed', actor: ACTOR, note: 'test' })]); }
  function pay(c, billId, amount, txn, date) { return q(c, 'INSERT INTO public.vendor_bill_payments (bill_id, amount, paid_date, bank_transaction_id, method, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id', [billId, amount, date || '2026-09-11', txn, 'rtm', ACTOR]); }

  var LT = await transfer(1000, RTM, '2026-08-01'); var LB = await bill(300, RTM, '2026-08-02');
  var lreq = await request(LT, RTM, 200, [[LB, 300]]); var lsend = await send(db, lreq.id, '2026-08-03');
  await db.query("INSERT INTO public.party_money_entries (party, bucket, amount, kind, action_id, reason, created_by) VALUES ($1, 'advance', 75, 'opening_balance', gen_random_uuid(), 'before the Hub', $2)", [NT, ACTOR]);
  var oldSummary = (await db.query('SELECT public.wire_funding_summary($1, NULL) AS s', [LT])).rows[0].s;
  check('BEFORE WF: a request with a $200 fee is sent from a $1,000 transfer (old SP path) — the old summary says 500 left', lsend.rows && lsend.rows[0].r.ok === true && Number(oldSummary.remaining) === 500, [lreq, lsend, oldSummary]);
  var defsBefore = (await db.query("SELECT p.proname, md5(pg_get_functiondef(p.oid)) AS d FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('hub_party_allocate', 'hub_party_money', 'hub_party_opening', 'hub_wire_line_pay', 'hub_bill_payment_cap', 'hub_bill_payment_final', 'wpkg_lock') ORDER BY 1")).rows;
  var entriesBefore = (await db.query('SELECT md5(string_agg(e::text, \'|\' ORDER BY e.id)) AS h, count(*)::int AS n FROM (SELECT id, party, bucket, amount, kind, bank_transaction_id, bill_id, entry_date, reason FROM public.party_money_entries) e')).rows[0];

  var wf = fs.readFileSync(path.join(root, 'sql/v55-83-WF-party-funds.sql'), 'utf8');
  var run1 = await q(db, wf); var run2 = await q(db, wf);
  check('the WF script runs, and runs again; its check says OK on every line (5)', !run1.error && !run2.error && run2.rows.length === 5 && run2.rows.every(function (r) { return r.result === 'OK'; }), [run1.error, run2.error, run2.rows]);
  var defsAfter = (await db.query("SELECT p.proname, md5(pg_get_functiondef(p.oid)) AS d FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('hub_party_allocate', 'hub_party_money', 'hub_party_opening', 'hub_wire_line_pay', 'hub_bill_payment_cap', 'hub_bill_payment_final', 'wpkg_lock') ORDER BY 1")).rows;
  check('existing money functions are NOT redefined (allocate, money, opening, line pay, the bill caps, the wire lock: same definitions)', JSON.stringify(defsBefore) === JSON.stringify(defsAfter) && defsBefore.length === 7, [defsBefore, defsAfter]);
  var entriesAfter = (await db.query('SELECT md5(string_agg(e::text, \'|\' ORDER BY e.id)) AS h, count(*)::int AS n FROM (SELECT id, party, bucket, amount, kind, bank_transaction_id, bill_id, entry_date, reason FROM public.party_money_entries) e')).rows[0];
  check('no existing ledger entry was changed or removed by the script', entriesBefore.h === entriesAfter.h && entriesAfter.n === 1);
  var privs = (await db.query("SELECT has_function_privilege('authenticated', 'public.hub_party_fee(jsonb)', 'EXECUTE') AS a, has_function_privilege('anon', 'public.hub_party_transfer_set_state(jsonb)', 'EXECUTE') AS b, has_function_privilege('authenticated', 'public.hub_party_transfer_state(uuid,uuid)', 'EXECUTE') AS c, has_function_privilege('service_role', 'public.hub_party_fee(jsonb)', 'EXECUTE') AS s")).rows[0];
  check('browser roles cannot run the new functions; the Hub server can', privs.a === false && privs.b === false && privs.c === false && privs.s === true, privs);

  // ── (Codex 17:07) the LEGACY sent request's fee keeps counting, exactly once ──
  var l1 = await st(LT);
  check('legacy: 1,000 transfer, 300 to bills, sent request fee 200 with NO fee entry → held 500 (the 200 is not made available again)', Number(l1.bills) === 300 && Number(l1.wire_fees) === 200 && Number(l1.held) === 500 && l1.status === 'needs_reconciliation' && Number(l1.available) === 0, l1);
  await confirm(db, LT, RTM);
  check('… once confirmed: available 500', Number((await st(LT)).available) === 500);
  await db.query("INSERT INTO public.party_money_entries (party, bucket, amount, kind, source_bank_transaction_id, wire_package_id, action_id, reason, created_by) VALUES ($1, 'fee', 200, 'fee_from_transfer', $2, $3, gen_random_uuid(), 'the fee of the sent request, noted', $4)", [RTM, LT, lreq.id, ACTOR]);
  var l2 = await st(LT);
  check('… creating / linking an entry for that SAME fee still leaves 500 — not 300 (counted twice) and not 700 (dropped)', Number(l2.available) === 500 && Number(l2.fees) === 200, l2);
  var lf = await q(db, 'SELECT public.wire_request_fee_change($1, $2, $3) AS r', [lreq.id, 250, ACTOR]);
  check('… the existing "change the fee of a sent request" still works and uses the same number (fee 250 → available 450)', lf.rows && lf.rows[0].r.ok === true && Number((await st(LT)).available) === 450, lf);
  var lf2 = await q(db, 'SELECT public.wire_request_fee_change($1, $2, $3) AS r', [lreq.id, 800, ACTOR]);
  check('… and refuses a fee that does not fit (800 > 700 free)', lf2.rows && lf2.rows[0].r.ok === false && Number((await st(LT)).fees) === 250, lf2);

  // ── Max's $10,000 walk-through (NextTrade), RTM untouched ──
  var N1 = await transfer(10000, NT, '2026-09-02'); var R9 = await transfer(4000, RTM, '2026-09-03');
  var B6 = await bill(6000, NT, '2026-09-10'); var B12 = await bill(1200, NT, '2026-10-12');
  var w0 = await st(N1);
  check('a transfer that nobody confirmed is "needs reconciliation": held 10,000, available 0', w0.status === 'needs_reconciliation' && Number(w0.held) === 10000 && Number(w0.available) === 0 && w0.party === NT, w0);
  var early = await feeCall(db, { action: 'mark', party: NT, bank_transaction_id: N1, amount: 500, entry_date: '2026-09-20' });
  check('services rendered cannot be marked on an unconfirmed transfer', /not confirmed/.test(early.error || ''), early);
  var rq0 = await request(N1, NT, 0, [[B6, 6000]]); var s0 = await send(db, rq0.id, '2026-09-11');
  check('a request cannot be sent from an unconfirmed transfer (plain message, nothing recorded)', s0.rows && s0.rows[0].r.ok === false && /not confirmed/.test(s0.rows[0].r.why) && Number((await st(N1)).bills) === 0, s0);
  var cf = await confirm(db, N1, NT);
  check('confirm the transfer → available 10,000 minus the 6,000 the draft request reserves = 4,000', cf.rows && cf.rows[0].r.ok === true && Number((await st(N1)).reserved) === 6000 && Number((await st(N1)).available) === 4000, [cf, await st(N1)]);
  var s1 = await send(db, rq0.id, '2026-09-11'); var a1 = await st(N1);
  check('send the request (its OWN reservation is left out of its check): 6,000 to bills, nothing reserved, 4,000 available', s1.rows && s1.rows[0].r.ok === true && Number(a1.bills) === 6000 && Number(a1.reserved) === 0 && Number(a1.available) === 4000, [s1, a1]);
  var f1 = await feeCall(db, { action: 'mark', party: NT, bank_transaction_id: N1, amount: 500, entry_date: '2026-09-20' }); var a2 = await st(N1);
  check('mark 500 services rendered → fees 500, available 3,500; no payment row was created', f1.rows && f1.rows[0].r.ok === true && Number(a2.fees) === 500 && Number(a2.available) === 3500 && Number((await db.query('SELECT count(*)::int AS n FROM public.vendor_bill_payments WHERE bank_transaction_id = $1', [N1])).rows[0].n) === 1, [f1, a2]);
  var rq1 = await request(N1, NT, 0, [[B12, 1200]]); var s2 = await send(db, rq1.id, '2026-10-15'); var a3 = await st(N1);
  check('later: a 1,200 bill paid from the SAME transfer → to bills 7,200, available 2,300; the payment sits on the original transfer line (no new withdrawal)', s2.rows && s2.rows[0].r.ok === true && Number(a3.bills) === 7200 && Number(a3.available) === 2300 && Number((await db.query('SELECT count(*)::int AS n FROM public.bank_transactions')).rows[0].n) === 3 && Number((await db.query('SELECT count(*)::int AS n FROM public.vendor_bill_payments WHERE bank_transaction_id = $1 AND bill_id = $2', [N1, B12])).rows[0].n) === 1, [s2, a3]);
  var f2 = await feeCall(db, { action: 'mark', party: NT, bank_transaction_id: N1, amount: 300, entry_date: '2026-11-03' }); var a4 = await st(N1);
  check('reclassify 300 as services rendered → available 2,000, fees 800', f2.rows && Number(a4.available) === 2000 && Number(a4.fees) === 800, [f2, a4]);
  var f3 = await feeCall(db, { action: 'reverse', party: NT, bank_transaction_id: N1, amount: 300, fee_id: f2.rows[0].r.entry_id, entry_date: '2026-11-04' }); var a5 = await st(N1);
  check('reverse that 300 → available 2,300, fees 500; transfers and bill payments unchanged', f3.rows && f3.rows[0].r.ok === true && Number(a5.available) === 2300 && Number(a5.fees) === 500 && Number(a5.bills) === 7200 && Number(a5.amount) === 10000, [f3, a5]);
  var r9 = await st(R9);
  check('RTM\'s transfer is untouched by all of it (4,000 held)', Number(r9.held) === 4000 && Number(r9.bills) === 0 && Number(r9.fees) === 0);
  var f4 = await feeCall(db, { action: 'reverse', party: NT, bank_transaction_id: N1, amount: 1, fee_id: f2.rows[0].r.entry_id, entry_date: '2026-11-05' });
  check('a fee already fully reversed cannot be reversed again', /left to reverse/.test(f4.error || ''), f4);
  var f5 = await feeCall(db, { action: 'reverse', party: NT, bank_transaction_id: N1, amount: 600, fee_id: f1.rows[0].r.entry_id, entry_date: '2026-11-05' });
  check('a reversal is capped by ITS OWN fee (600 against the 500 fee is refused), although the transfer has 800 of fees in history', /left to reverse/.test(f5.error || '') && Number((await st(N1)).fees) === 500, f5);
  var f6 = await feeCall(db, { action: 'reverse', party: RTM, bank_transaction_id: R9, amount: 100, fee_id: f1.rows[0].r.entry_id, entry_date: '2026-11-05' });
  check('a fee of one transfer cannot be reversed against another company\'s transfer', !!f6.error && Number((await st(R9)).held) === 4000, f6);
  var f7 = await feeCall(db, { action: 'mark', party: NT, bank_transaction_id: N1, amount: 2300.01, entry_date: '2026-11-06' });
  check('a fee above what is free is refused (2,300.01 > 2,300)', /is free/.test(f7.error || '') && Number((await st(N1)).available) === 2300, f7);
  // same click twice
  var same = { action: 'mark', party: NT, bank_transaction_id: N1, amount: 50, entry_date: '2026-11-06', request_id: 'dbl-1', actor: ACTOR, reason: 'x' };
  var d1 = await q(db, 'SELECT public.hub_party_fee($1::jsonb) AS r', [JSON.stringify(same)]); var d2 = await q(db, 'SELECT public.hub_party_fee($1::jsonb) AS r', [JSON.stringify(same)]);
  check('the same click twice marks the fee ONCE (second answer says repeat)', d1.rows && d2.rows && d2.rows[0].r.repeat === true && d2.rows[0].r.entry_id === d1.rows[0].r.entry_id && Number((await st(N1)).fees) === 550, [d1, d2]);
  var d3 = await q(db, 'SELECT public.hub_party_fee($1::jsonb) AS r', [JSON.stringify(Object.assign({}, same, { amount: 60 }))]);
  check('the same click id for a different amount is refused', /already used/.test(d3.error || '') && Number((await st(N1)).fees) === 550, d3);

  // ── reservations: the WHOLE commitment (Codex 12:36 item 2) ──
  var K = await transfer(1000, RTM, '2026-09-05'); await confirm(db, K, RTM); var KB = await bill(900, RTM); var KB2 = await bill(400, RTM);
  var dr = await request(K, RTM, 100, [[KB, 900]]); var k1 = await st(K);
  check('a draft of 900 bills + 100 fee on a 1,000 transfer reserves ALL 1,000: available 0', !dr.error && Number(k1.reserved) === 1000 && Number(k1.available) === 0, [dr, k1]);
  var dr2 = await request(K, RTM, 0, [[KB2, 50]]);
  check('a second draft on that transfer is refused (even 50) — nothing can slip in before the first is sent', /HUB_GUARD/.test(dr2.error || '') && Number((await st(K)).reserved) === 1000, dr2);
  var kf = await feeCall(db, { action: 'mark', party: RTM, bank_transaction_id: K, amount: 10, entry_date: '2026-09-06' });
  check('money reserved for a request is not available for a services fee', /is free/.test(kf.error || ''), kf);
  var kp = await pay(db, KB2, 10, K);
  check('… nor for an independent bill payment written straight onto the transfer', /HUB_GUARD/.test(kp.error || '') && Number((await st(K)).bills) === 0, kp);
  var ks = await send(db, dr.id); var k2 = await st(K);
  check('the reserved request is sent: it passes its own check, 900 to bills, fee 100, nothing reserved, available 0', ks.rows && ks.rows[0].r.ok === true && Number(k2.bills) === 900 && Number(k2.wire_fees) === 100 && Number(k2.reserved) === 0 && Number(k2.available) === 0, [ks, k2]);
  // reserve → send while ANOTHER reservation exists
  var M = await transfer(1000, RTM, '2026-09-06'); await confirm(db, M, RTM); var MB1 = await bill(600, RTM); var MB2 = await bill(400, RTM); var MB3 = await bill(100, RTM);
  var m1 = await request(M, RTM, 0, [[MB1, 600]]); var m2 = await request(M, RTM, 0, [[MB2, 400]]);
  var ms = await send(db, m1.id); var mst = await st(M);
  check('two drafts 600 + 400 fill the transfer; sending the first keeps the OTHER reservation: bills 600, reserved 400, available 0', !m1.error && !m2.error && ms.rows && ms.rows[0].r.ok === true && Number(mst.bills) === 600 && Number(mst.reserved) === 400 && Number(mst.available) === 0, [m1, m2, ms, mst]);
  var m3 = await request(M, RTM, 0, [[MB3, 100]]);
  check('a third draft cannot take what the second still reserves', /HUB_GUARD/.test(m3.error || ''), m3);
  await db.query("UPDATE public.wire_packages SET status = 'cancelled', cancelled_by = $2, cancelled_at = now() WHERE id = $1", [m2.id, ACTOR]); await db.query('UPDATE public.wire_package_lines SET is_open = false WHERE package_id = $1', [m2.id]);
  check('cancelling the second draft releases its reservation: available 400', Number((await st(M)).available) === 400 && Number((await st(M)).reserved) === 0);

  // ── a fee, then the OLD wire path sees the same number (Codex 12:36 item 1) ──
  var O = await transfer(1000, RTM, '2026-09-07'); await confirm(db, O, RTM); var OB = await bill(900, RTM);
  await feeCall(db, { action: 'mark', party: RTM, bank_transaction_id: O, amount: 200, entry_date: '2026-09-08' });
  var os = (await db.query('SELECT public.wire_funding_summary($1, NULL) AS s', [O])).rows[0].s;
  check('transfer 1,000 with a 200 services fee: the Wires summary says 800, not 1,000', Number(os.remaining) === 800 && Number(os.fees) === 200, os);
  var o1 = await request(O, RTM, 0, [[OB, 900]]);
  check('… and a request for 900 on it is refused by the database', /HUB_GUARD/.test(o1.error || ''), o1);
  var o2 = await request(O, RTM, 0, [[OB, 800]]); var o2s = await send(db, o2.id);
  check('… a request for 800 fits and is sent', !o2.error && o2s.rows && o2s.rows[0].r.ok === true && Number((await st(O)).available) === 0, [o2, o2s]);
  // the older "one step" allocate, with a REAL KTC bank account behind the line so it reaches the availability check
  await db.query("INSERT INTO public.plaid_accounts (plaid_account_id, name, mask, type, wave_business_id, is_private) VALUES ('A1', 'KTC checking', '0001', 'depository', 'KTC', false) ON CONFLICT DO NOTHING");
  var O2 = await transfer(1000, RTM, '2026-09-07'); await confirm(db, O2, RTM); await feeCall(db, { action: 'mark', party: RTM, bank_transaction_id: O2, amount: 900, entry_date: '2026-09-08' });
  var oaOk = await q(db, 'SELECT public.hub_party_allocate($1::jsonb) AS r', [JSON.stringify({ party: RTM, actor: ACTOR, request_id: 'alloc-ok', ktc_business: 'KTC', bank_transaction_id: O2, bills: [], fee: 100, advance: 0, reason: 'fits' })]);
  check('old allocate, valid KTC account: a 100 fee that FITS (1,000 − 900) is saved by the old function, unchanged', !oaOk.error && Number((await st(O2)).fees) === 1000 && Number((await st(O2)).held) === 0, [oaOk, await st(O2)]);
  var O3 = await transfer(1000, RTM, '2026-09-07'); await confirm(db, O3, RTM); await feeCall(db, { action: 'mark', party: RTM, bank_transaction_id: O3, amount: 900, entry_date: '2026-09-08' });
  var oa = await q(db, 'SELECT public.hub_party_allocate($1::jsonb) AS r', [JSON.stringify({ party: RTM, actor: ACTOR, request_id: 'alloc-1', ktc_business: 'KTC', bank_transaction_id: O3, bills: [], fee: 150, advance: 0, reason: 'too much' })]);
  check('old allocate, valid KTC account: a 150 fee the transfer no longer holds is refused BY THE AVAILABILITY GUARD (old function does not know the new fee entries), nothing saved', /would use more than/.test(oa.error || '') && Number((await st(O3)).fees) === 900, oa);
  var oaAdv = await q(db, 'SELECT public.hub_party_allocate($1::jsonb) AS r', [JSON.stringify({ party: RTM, actor: ACTOR, request_id: 'alloc-adv', ktc_business: 'KTC', bank_transaction_id: O3, bills: [], fee: 0, advance: 50, reason: 'old advance' })]);
  check('old allocate asking for an "advance" split is refused (retired), nothing saved', /no longer used/.test(oaAdv.error || '') && Number((await st(O3)).held) === 100, oaAdv);

  // an ORDINARY wire to the company (its own bank line, no earlier transfer), with WF loaded
  var OW = await transfer(1000, RTM, '2026-09-09'); var OWB = await bill(900, RTM);
  var owp = (await db.query("INSERT INTO public.wire_packages (payee_kind, payee_name, fee_amount, status, created_by) VALUES ('service_provider', $1, 100, 'draft', $2) RETURNING id", [RTM, ACTOR])).rows[0].id;
  var owl = (await db.query('INSERT INTO public.wire_package_lines (package_id, bill_id, amount) VALUES ($1, $2, 900) RETURNING id', [owp, OWB])).rows[0].id;
  check('an ordinary wire NOT sent yet reserves nothing on any transfer', Number((await st(OW)).reserved) === 0 && Number((await st(OW)).held) === 1000);
  var ow1 = await q(db, "UPDATE public.wire_packages SET status = 'sent', signoff1_by = $2, signoff1_at = now(), signoff2_by = $3, signoff2_at = now(), sent_by = $4, sent_at = now(), sent_date = '2026-09-09', approved_total = 1000, bank_reference = 'W1' WHERE id = $1", [owp, S1, S2, ACTOR]);
  var ow2 = await q(db, 'SELECT public.hub_wire_line_pay($1::jsonb) AS r', [JSON.stringify({ line_id: owl, bank_transaction_id: OW, paid_date: '2026-09-09', method: 'wire', actor: ACTOR })]);
  var ow3 = await q(db, "UPDATE public.wire_packages SET status = 'attached', bank_transaction_id = $2, attached_by = $3, attached_at = now() WHERE id = $1", [owp, OW, ACTOR]);
  var ows = await st(OW);
  check('ordinary wire within its own bank line (900 bills + 100 fee = 1,000): pays its line and attaches with WF loaded; held 0', !ow1.error && !ow2.error && !ow3.error && Number(ows.bills) === 900 && Number(ows.wire_fees) === 100 && Number(ows.held) === 0, [ow1, ow2, ow3, ows]);

  // ── retired pool moves are refused IN THE DATABASE; old rows stay ──
  for (var k of [['advance', 'advance_to_fee', -10], ['fee', 'advance_to_fee', 10], ['advance', 'fee_to_advance', 10], ['advance', 'apply_to_bill', -10], ['advance', 'payment_split', 10]]) {
    var rr = await q(db, "INSERT INTO public.party_money_entries (party, bucket, amount, kind, action_id, reason, created_by) VALUES ($1, $2, $3, $4, gen_random_uuid(), 'old path', $5)", [NT, k[0], k[2], k[1], ACTOR]);
    check('retired: a new "' + k[1] + '" entry in the ' + k[0] + ' bucket is refused', /no longer used/.test(rr.error || ''), rr);
  }
  var noSrc = await q(db, "INSERT INTO public.party_money_entries (party, bucket, amount, kind, action_id, reason, created_by) VALUES ($1, 'fee', 10, 'fee_from_transfer', gen_random_uuid(), 'x', $2)", [NT, ACTOR]);
  check('a services-rendered entry that names no transfer is refused', /which transfer/.test(noSrc.error || ''), noSrc);
  check('the entry that existed before WF (a starting balance with no transfer) is still there, untouched, and is in no transfer\'s figures', Number((await db.query("SELECT count(*)::int AS n FROM public.party_money_entries WHERE kind = 'opening_balance' AND amount = 75")).rows[0].n) === 1 && Number((await st(N1)).held) === 2250);
  var upd = await q(db, 'UPDATE public.party_money_entries SET amount = 1 WHERE kind = \'fee_from_transfer\'');
  check('ledger entries still cannot be edited', /never changed or deleted/.test(upd.error || ''));

  // ── reconciliation of an unconfirmed transfer: bills it ALREADY paid can be linked, never beyond what it sent ──
  var H = await transfer(500, RTM, '2026-07-01'); var HB = await bill(300, RTM, '2026-07-02'); var HB2 = await bill(300, RTM, '2026-07-03');
  var h1 = await pay(db, HB, 300, H, '2026-07-05'); var h2 = await pay(db, HB2, 300, H, '2026-07-06'); var hs = await st(H);
  check('an unconfirmed (historical) transfer: linking a 300 bill it paid is allowed; a second 300 (over the 500 sent) is refused', !h1.error && /HUB_GUARD/.test(h2.error || '') && Number(hs.bills) === 300 && Number(hs.held) === 200 && hs.status === 'needs_reconciliation' && Number(hs.available) === 0, [h1, h2, hs]);
  var plain = await transfer(100, null, '2026-07-10'); var PB = await bill(100, null, '2026-07-11'); var pp = await pay(db, PB, 100, plain, '2026-07-12');
  check('an ordinary bank line (not sent to a company) is not affected by any of this', !pp.error && (await st(plain)).status === 'not_a_company_transfer');

  // ── confirming ──
  var cBad = await confirm(db, plain, RTM);
  check('a line not marked for the company cannot be confirmed as its funds', /not marked as sent to/.test(cBad.error || ''), cBad);
  var cBack = await confirm(db, H, RTM, 'needs_reconciliation');
  check('a transfer can be put back to "needs reconciliation"; every change is in the audit log', cBack.rows && cBack.rows[0].r.to === 'needs_reconciliation' && Number((await db.query("SELECT count(*)::int AS n FROM public.hub_audit_log WHERE action = 'party_transfer_state'")).rows[0].n) >= 6, cBack);

  // ── (Codex 17:24 P1) OLD FUNDS PAY A NEW BILL AFTER MONTH-END — the real write path fed through the real report helper ──
  var P = await transfer(10000, NT, '2026-09-02'); await confirm(db, P, NT);
  var PB6 = await bill(6000, NT, '2026-09-10'); var PB12 = await bill(1200, NT, '2026-10-12'); var PB1 = await bill(100, NT, '2026-09-22'); var PB2 = await bill(100, NT, '2026-08-20');
  var pr1 = await request(P, NT, 0, [[PB6, 6000]]); var ps1 = await send(db, pr1.id, '2026-09-11');
  var pf1 = await feeCall(db, { action: 'mark', party: NT, bank_transaction_id: P, amount: 500, entry_date: '2026-09-20' });
  await db.query("CREATE SCHEMA IF NOT EXISTS clickbooks_us; CREATE TABLE IF NOT EXISTS clickbooks_us.books (code text PRIMARY KEY, locked_through date); INSERT INTO clickbooks_us.books VALUES ('KTC_US', '2026-09-30') ON CONFLICT (code) DO UPDATE SET locked_through = EXCLUDED.locked_through;");
  var linesBefore = Number((await db.query('SELECT count(*)::int AS n FROM public.bank_transactions')).rows[0].n);
  var pr2 = await request(P, NT, 0, [[PB12, 1200]]); var ps2 = await send(db, pr2.id, '2026-10-15');
  check('September is CLOSED; the September transfer still holds 3,500; an October bill of 1,200 is paid from it with two approvals — it succeeds, no month reopened', ps1.rows && ps1.rows[0].r.ok === true && pf1.rows && ps2.rows && ps2.rows[0].r.ok === true && ps2.rows[0].r.paid_date === '2026-10-15' && ps2.rows[0].r.transfer_date === '2026-09-02', [ps1, pf1, ps2]);
  var stored = (await db.query('SELECT p.paid_date::text AS paid_date, p.bank_transaction_id, p.amount::float AS amount FROM public.vendor_bill_payments p WHERE p.bill_id = ANY($1) ORDER BY p.paid_date', [[PB6, PB12]])).rows;
  check('stored dates: the September use is dated 11 Sep, the October use 15 Oct — both on the ORIGINAL transfer line; the transfer row is unchanged and no bank line was added', stored.length === 2 && stored[0].paid_date === '2026-09-11' && stored[1].paid_date === '2026-10-15' && stored.every(function (r) { return r.bank_transaction_id === P; }) && Number((await db.query('SELECT count(*)::int AS n FROM public.bank_transactions')).rows[0].n) === linesBefore && (await db.query("SELECT date::text AS d, amount_abs::float AS a FROM public.bank_transactions WHERE id = $1", [P])).rows[0].d === '2026-09-02', stored);
  var pr3 = await request(P, NT, 0, [[PB1, 100]]); var ps3 = await send(db, pr3.id, '2026-09-25');
  check('a use genuinely dated inside the CLOSED month is refused (nothing recorded)', ps3.rows && ps3.rows[0].r.ok === false && ps3.rows[0].r.blocked_by === 'closed month' && Number((await db.query('SELECT count(*)::int AS n FROM public.vendor_bill_payments WHERE bill_id = $1', [PB1])).rows[0].n) === 0, ps3);
  var ps3b = await send(db, pr3.id, '2026-10-20');
  check('… the same request sent with a date in the open month goes through', ps3b.rows && ps3b.rows[0].r.ok === true, ps3b);
  var pr4 = await request(P, NT, 0, [[PB2, 100]]); var ps4 = await send(db, pr4.id, '2026-08-25');
  check('funds cannot be used on a date BEFORE the transfer was made', ps4.rows && ps4.rows[0].r.ok === false && ps4.rows[0].r.blocked_by === 'before the transfer', ps4);
  await db.query("UPDATE public.wire_packages SET status = 'cancelled', cancelled_by = $2, cancelled_at = now() WHERE id = $1", [pr4.id, ACTOR]); await db.query('UPDATE public.wire_package_lines SET is_open = false WHERE package_id = $1', [pr4.id]);
  // the ACTUAL rows the database now holds, through the ACTUAL report helper
  req(path.join(root, 'node_modules/sucrase/register'));
  var PF = req(path.join(root, 'src/lib/party-funds.js'));
  async function funds(from, to) {
    var bl = (await db.query("SELECT id, date::text AS date, amount_abs::float AS amount_abs, third_party_payer, direction, name FROM public.bank_transactions WHERE id = $1", [P])).rows;
    var pys = (await db.query("SELECT id, bill_id, amount::float AS amount, paid_date::text AS paid_date, bank_transaction_id, voided, method FROM public.vendor_bill_payments WHERE bank_transaction_id = $1", [P])).rows;
    var bls = (await db.query("SELECT id, vendor_name, bill_number, bill_date::text AS bill_date, category, total_amount::float AS total_amount, paid_via FROM public.vendor_bills WHERE id = ANY($1)", [[PB6, PB12, PB1, PB2]])).rows;
    var wps = (await db.query("SELECT id, status, funding_txn_id, bank_transaction_id, fee_amount::float AS fee_amount, sent_date::text AS sent_date FROM public.wire_packages WHERE funding_txn_id = $1", [P])).rows;
    for (var w of wps) { w.lines = (await db.query('SELECT bill_id, amount::float AS amount, is_open FROM public.wire_package_lines WHERE package_id = $1', [w.id])).rows; }
    var ens = (await db.query("SELECT id, party, bucket, kind, amount::float AS amount, bank_transaction_id, source_bank_transaction_id, wire_package_id, entry_date::text AS entry_date, reason FROM public.party_money_entries WHERE source_bank_transaction_id = $1", [P])).rows;
    return PF.partyFundsBreakdown({ parties: [{ name: NT }], bankLines: bl, pays: pys, bills: bls, requests: wps, entries: ens, from: from, to: to })[0];
  }
  var rSep = await funds('2026-09-01', '2026-09-30'); var rOct = await funds('2026-10-01', '2026-10-31');
  check('REPORT from the real rows — September: sent 10,000, to bills 6,000, explicit fee 500, closing held 3,500; tax line 10,000', rSep.period.funds_sent === 10000 && rSep.period.applied_to_bills === 6000 && rSep.period.fee_deduction === 500 && rSep.period.closing_held === 3500 && rSep.period.tax_professional_fees === 10000 && rSep.arithmetic_ok && !rSep.needs_reconciliation, rSep.period);
  check('REPORT from the real rows — October: opening 3,500 − bills 1,300 (the 1,200 bill and the 100 one) = closing 2,200; no new funding, NO second tax deduction, no fee', rOct.period.opening_held === 3500 && rOct.period.funds_sent === 0 && rOct.period.applied_to_bills === 1300 && rOct.period.closing_held === 2200 && rOct.period.tax_professional_fees === 0 && rOct.period.fee_deduction === 0 && rOct.arithmetic_ok, rOct.period);
  check('REPORT: the October rows name the ORIGINAL September transfer, and September\'s figures did not change when October was paid', rOct.period.applied_rows.every(function (r) { return r.transfer_id === P && r.transfer_date === '2026-09-02'; }) && rOct.period.applied_rows.length === 2 && rSep.period.applied_rows.length === 1);
  check('REPORT and DATABASE agree on what the transfer holds today (2,200)', rOct.current.unused === 2200 && Number((await st(P)).available) === 2200);

  // ── (WF B2) MONEY BACK from the company: hub_party_refund ──
  async function incoming(amount, date, extra) { seq++; var e = extra || {}; var r = await db.query("INSERT INTO public.bank_transactions (wave_business_id, account_id, direction, amount_abs, date, posted_date, pending, name) VALUES ($1, 'A1', $2, $3, $4, $4, false, $5) RETURNING id", [e.biz || 'KTC', e.dir || 'in', amount, date, 'MONEY BACK ' + seq]); return r.rows[0].id; }
  function refund(c, p) { click++; return q(c, 'SELECT public.hub_party_refund($1::jsonb) AS r', [JSON.stringify(Object.assign({ actor: ACTOR, request_id: 'rf-' + click, reason: 'money returned by the company' }, p))]); }
  var RT = await transfer(1000, RTM, '2026-10-01'); await confirm(db, RT, RTM); var RB = await bill(400, RTM, '2026-10-02');
  var rrq = await request(RT, RTM, 0, [[RB, 400]]); var rrs = await send(db, rrq.id, '2026-10-05');
  var IN1 = await incoming(300, '2026-10-10');
  var rf1 = await refund(db, { party: RTM, bank_transaction_id: RT, incoming_bank_transaction_id: IN1, amount: 300 });
  var rs1 = await st(RT);
  check('refund: 300 back on a money-in line — recorded against ITS transfer: refunds 300, held 300 (1,000 − 400 bills − 300), dated the day the money arrived', rrs.rows && rrs.rows[0].r.ok === true && rf1.rows && rf1.rows[0].r.ok === true && rf1.rows[0].r.entry_date === '2026-10-10' && Number(rs1.refunds) === 300 && Number(rs1.held) === 300 && Number(rs1.available) === 300, [rf1, rs1]);
  check('refund: it is not a fee and creates no payment', Number(rs1.fees) === 0 && Number((await db.query('SELECT count(*)::int AS n FROM public.vendor_bill_payments WHERE bank_transaction_id = $1', [RT])).rows[0].n) === 1);
  var IN2 = await incoming(500, '2026-10-11');
  var rf2 = await refund(db, { party: RTM, bank_transaction_id: RT, incoming_bank_transaction_id: IN1, amount: 10 });
  check('refund: the same money-in line cannot be used for a second refund', /already recorded as a refund/.test(rf2.error || ''), rf2);
  var rf3 = await refund(db, { party: RTM, bank_transaction_id: RT, incoming_bank_transaction_id: IN2, amount: 400 });
  check('refund: more than the transfer still holds (400 > 300) is refused', /more than this transfer still holds/.test(rf3.error || '') && Number((await st(RT)).refunds) === 300, rf3);
  var OUTL = await incoming(50, '2026-10-12', { dir: 'out' });
  var rf4 = await refund(db, { party: RTM, bank_transaction_id: RT, incoming_bank_transaction_id: OUTL, amount: 50 });
  check('refund: a money-OUT line cannot be the money coming back', /money-IN line/.test(rf4.error || ''), rf4);
  var EGL = await incoming(50, '2026-10-12', { biz: 'OTHER_BOOKS' });
  var rf5 = await refund(db, { party: RTM, bank_transaction_id: RT, incoming_bank_transaction_id: EGL, amount: 50 });
  check('refund: money that came back into the books of another company is refused', /different company/.test(rf5.error || ''), rf5);
  var INV = await incoming(80, '2026-10-12'); await db.query('INSERT INTO public.accounting_invoice_payments (bank_transaction_id, amount, voided) VALUES ($1, 80, false)', [INV]);
  var rf6 = await refund(db, { party: RTM, bank_transaction_id: RT, incoming_bank_transaction_id: INV, amount: 80 });
  check('refund: a money-in line already used for a customer payment is refused', /customer payment/.test(rf6.error || ''), rf6);
  var rf7 = await refund(db, { party: RTM, bank_transaction_id: RT, incoming_bank_transaction_id: IN2, amount: 100, entry_date: '2026-10-05' });
  check('refund: cannot be dated before the money arrived', /before the money arrived/.test(rf7.error || ''), rf7);
  var rf8 = await refund(db, { party: NT, bank_transaction_id: RT, incoming_bank_transaction_id: IN2, amount: 100 });
  check('refund: against a transfer of the other company is refused', /not a transfer marked as sent to/.test(rf8.error || ''), rf8);
  var sameR = { party: RTM, bank_transaction_id: RT, incoming_bank_transaction_id: IN2, amount: 100, request_id: 'rf-same', actor: ACTOR, reason: 'part back' };
  var rr1 = await q(db, 'SELECT public.hub_party_refund($1::jsonb) AS r', [JSON.stringify(sameR)]); var rr2 = await q(db, 'SELECT public.hub_party_refund($1::jsonb) AS r', [JSON.stringify(sameR)]);
  check('refund: the same click twice records it ONCE (second answer says repeat)', rr1.rows && rr2.rows && rr2.rows[0].r.repeat === true && Number((await st(RT)).refunds) === 400 && Number((await st(RT)).held) === 200, [rr1, rr2, await st(RT)]);
  var rfOld = await refund(db, { party: RTM, bank_transaction_id: RT, incoming_bank_transaction_id: await incoming(5, '2026-09-20'), amount: 5 });
  check('refund: money that came back inside a CLOSED month is refused for an ordinary permitted person', /closed month/.test(rfOld.error || ''), rfOld);
  // the helper and the database agree after the refunds
  var rfE = (await db.query("SELECT id, party, bucket, kind, amount::float AS amount, bank_transaction_id, source_bank_transaction_id, entry_date::text AS entry_date FROM public.party_money_entries WHERE source_bank_transaction_id = $1", [RT])).rows;
  var rfP = (await db.query('SELECT id, bill_id, amount::float AS amount, paid_date::text AS paid_date, bank_transaction_id, voided FROM public.vendor_bill_payments WHERE bank_transaction_id = $1', [RT])).rows;
  var rfL = (await db.query('SELECT id, date::text AS date, amount_abs::float AS amount_abs, third_party_payer, direction, name FROM public.bank_transactions WHERE id = $1', [RT])).rows;
  var rfH = PF.partyFundsBreakdown({ parties: [{ name: RTM }], bankLines: rfL, pays: rfP, bills: [], requests: [], entries: rfE, from: '2026-10-01', to: '2026-10-31' })[0];
  check('refund: the REPORT from the real rows agrees with the database — refunds 400, held 200; October: sent 1,000 − refunds 400 − bills 400 = closing 200', rfH.current.refunds === 400 && rfH.current.unused === 200 && rfH.period.refunds === 400 && rfH.period.closing_held === 200 && rfH.period.fee_deduction === 0 && rfH.arithmetic_ok, rfH.period);
  // ── closed month ──
  await db.query("CREATE SCHEMA IF NOT EXISTS clickbooks_us; CREATE TABLE IF NOT EXISTS clickbooks_us.books (code text PRIMARY KEY, locked_through date); INSERT INTO clickbooks_us.books VALUES ('KTC_US', '2026-10-31') ON CONFLICT (code) DO UPDATE SET locked_through = EXCLUDED.locked_through;");
  var cm1 = await feeCall(db, { action: 'mark', party: NT, bank_transaction_id: N1, amount: 20, entry_date: '2026-10-20' });
  check('a fee dated inside a closed month is refused for an ordinary permitted person', /closed month/.test(cm1.error || '') && Number((await st(N1)).fees) === 550, cm1);
  var cm2 = await feeCall(db, { action: 'mark', party: NT, bank_transaction_id: N1, amount: 20, entry_date: '2026-10-20', allow_closed: true });
  check('… and allowed when the Hub server says this person may correct closed months (audited as such)', cm2.rows && cm2.rows[0].r.ok === true && Number((await st(N1)).fees) === 570 && Number((await db.query("SELECT count(*)::int AS n FROM public.hub_audit_log WHERE action = 'party_services_rendered' AND (details->>'closed_month_allowed')::boolean")).rows[0].n) === 1, cm2);
  var cm3 = await feeCall(db, { action: 'mark', party: NT, bank_transaction_id: N1, amount: 20, entry_date: '2026-11-10' });
  check('a fee dated in an open month is not affected by the lock', cm3.rows && cm3.rows[0].r.ok === true);
  var fut = await feeCall(db, { action: 'mark', party: NT, bank_transaction_id: N1, amount: 1, entry_date: '2999-01-01' });
  check('a fee cannot be dated in the future', /future/.test(fut.error || ''));

  // ── TWO PEOPLE AT ONCE ──
  var X = await transfer(1000, RTM, '2026-11-12'); await confirm(db, X, RTM);
  async function race(firstFn, secondFn) {
    await db.query('BEGIN'); var a = await firstFn(db);
    var done = false; var b = null; var pb = secondFn(db2).then(function (r) { done = true; b = r; });
    await new Promise(function (r) { setTimeout(r, 700); }); var waited = !done;
    var cmt = await q(db, 'COMMIT'); if (cmt.error) { await q(db, 'ROLLBACK'); } await pb; return { a: a, b: b, waited: waited, commitError: cmt.error || null };
  }
  var r1 = await race(function (c) { return feeCall(c, { action: 'mark', party: RTM, bank_transaction_id: X, amount: 700, entry_date: '2026-11-13' }); }, function (c) { return feeCall(c, { action: 'mark', party: RTM, bank_transaction_id: X, amount: 700, entry_date: '2026-11-13' }); });
  check('two people each mark 700 on a 1,000 transfer at the same moment: the second WAITS, then is refused; fees 700, never 1,400', !r1.a.error && r1.waited && /is free/.test(r1.b.error || '') && Number((await st(X)).fees) === 700, [r1, await st(X)]);
  var XB = await bill(300, RTM); var XB2 = await bill(300, RTM);
  var r2 = await race(function (c) { return q(c, "INSERT INTO public.wire_packages (payee_kind, payee_name, fee_amount, status, funding_txn_id, created_by) VALUES ('service_provider', $1, 300, 'draft', $2, $3) RETURNING id", [RTM, X, ACTOR]); }, function (c) { return feeCall(c, { action: 'mark', party: RTM, bank_transaction_id: X, amount: 300, entry_date: '2026-11-13' }); });
  check('a draft request reserving the last 300 while someone marks a 300 fee: one waits, only ONE succeeds, the transfer never goes below zero', r2.waited && ((!r2.a.error && !r2.commitError && /is free/.test(r2.b.error || '')) || (!!(r2.a.error || r2.commitError) && !r2.b.error)) && Number((await st(X)).held) - Number((await st(X)).reserved) >= 0, [r2, await st(X)]);
  var Y = await transfer(1000, RTM, '2026-11-14'); await confirm(db, Y, RTM); var YB = await bill(800, RTM); var YB2 = await bill(800, RTM);
  var r3 = await race(function (c) { return pay(c, YB, 800, Y, '2026-11-15'); }, function (c) { return pay(c, YB2, 800, Y, '2026-11-15'); });
  check('two bill payments of 800 written onto one 1,000 transfer at once: the second waits and is refused; 800 to bills', !r3.a.error && r3.waited && !!r3.b.error && Number((await st(Y)).bills) === 800, [r3, await st(Y)]);
} catch (e) { failN++; console.log('CRASHED: ' + (e && e.stack || e)); }
finally { try { await db.end(); } catch (e) {} try { await db2.end(); } catch (e) {} try { await server.stop(); } catch (e) {} try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) {} }
console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
