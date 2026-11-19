// v55.83-UY (Codex 05:51 / 06:07) — REAL Postgres 16 with the REAL stack loaded together: the stub schema, RH wire packages, RL, RZ,
// SP funded requests (wire_request_send), TO payment guards and US partial wires. Proves the US rules work WITH the real functions:
// the funded-request step pays its own lines, two requests on one transfer, an independent payment from that transfer, and that
// the bank-then-bill lock order holds when a request and a direct payment collide (no deadlock, never over the bill).
// Needs EMBEDDED_PG_DIR (embedded-postgres + pg).
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
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 900))); }
var dataDir = path.join(dir, 'data-usst-' + Date.now()); var port = 54000 + Math.floor(Math.random() * 900);
var server = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'test-only', port: port, persistent: false, initdbFlags: ['--encoding=UTF8', '--locale=C'] });
var db, db2;
function client() { return new pg.Client({ host: 'localhost', port: port, user: 'postgres', password: 'test-only', database: 'postgres' }); }
async function q(c, sql, p) { try { var r = await c.query(sql, p || []); return { rows: r.rows, count: r.rowCount }; } catch (e) { return { error: e.message }; } }
var ACTOR = '11111111-1111-4111-8111-111111111111';
var T = '70000000-0000-4000-8000-000000000001', BILL = 'b0000000-0000-4000-8000-000000000001';
var R1 = 'a0000000-0000-4000-8000-000000000001', R2 = 'a0000000-0000-4000-8000-000000000002';
try {
  console.log('US + the real wire / payment stack (real Postgres 16)');
  await server.initialise(); await server.start();
  db = client(); await db.connect(); db2 = client(); await db2.connect();
  var loaded = [];
  async function load(f) { var r = await q(db, fs.readFileSync(path.join(root, f), 'utf8')); loaded.push([f, r.error || 'ok']); return !r.error; }
  await load('__tests__/pg/stub-schema.sql');
  // the stub's simplified wire tables give way to the REAL ones (RH); roles the scripts grant to
  await db.query('DROP TABLE IF EXISTS public.wire_package_lines, public.wire_packages CASCADE');
  for (var role of ['service_role', 'anon', 'authenticated']) { await q(db, 'CREATE ROLE ' + role + ' NOLOGIN'); } // an "already exists" error is fine
  for (var f of ['sql/v55-83-RH-wire-packages.sql', 'sql/v55-83-RI-wire-simple.sql', 'sql/v55-83-RL-wire-override-delete-reference.sql', 'sql/v55-83-RZ-wire-ready-sent-paid.sql', 'sql/v55-83-SP-funded-requests.sql', 'sql/v55-83-TO-payment-guards.sql', 'sql/v55-83-TV-repeating-bills.sql', 'sql/v55-83-TW-company-books.sql', 'sql/v55-83-TX-advances-fees.sql', 'sql/v55-83-UB-company-transfers.sql', 'sql/v55-83-UD-pay-nextrade.sql', 'sql/v55-83-US-partial-wires.sql']) { await load(f); }
  check('the whole stack loads together: stub schema, RH, RI, RL, RZ, SP, TO, TV, TW, TX, UB, UD, US', loaded.every(function (x) { return x[1] === 'ok'; }), loaded);
  var S1 = '22222222-2222-4222-8222-222222222222', S2 = '33333333-3333-4333-8333-333333333333';
  async function setup(billTotal) {
    await db.query('TRUNCATE public.wire_package_lines, public.wire_packages, public.vendor_bill_payments CASCADE');
    await db.query("DELETE FROM public.vendor_bills WHERE id = '" + BILL + "'; DELETE FROM public.bank_transactions WHERE id = '" + T + "'");
    var e1 = await q(db, "INSERT INTO public.bank_transactions (id, direction, amount_abs, date, posted_date, pending, third_party_payer, name) VALUES ('" + T + "', 'out', 1000, '2026-08-01', '2026-08-01', false, 'RTM Capital', 'TRANSFER TO RTM')");
    var e2 = await q(db, "INSERT INTO public.vendor_bills (id, vendor_name, bill_number, bill_date, total_amount, record_status, paid_via) VALUES ('" + BILL + "', 'Fast Trucking', 'T-1', '2026-07-20', " + billTotal + ", 'active', 'RTM Capital')");
    return [e1.error, e2.error];
  }
  async function request(id, amount) {
    var e1 = await q(db, "INSERT INTO public.wire_packages (id, payee_kind, payee_name, fee_amount, status, funding_txn_id, created_by, signoff1_by, signoff1_at, signoff2_by, signoff2_at) VALUES ('" + id + "', 'service_provider', 'RTM Capital', 0, 'draft', '" + T + "', '" + ACTOR + "', '" + S1 + "', now(), '" + S2 + "', now())");
    var e2 = await q(db, "INSERT INTO public.wire_package_lines (package_id, bill_id, amount) VALUES ('" + id + "', '" + BILL + "', " + amount + ")");
    return [e1.error, e2.error];
  }
  function send(c, id) { return q(c, "SELECT public.wire_request_send('" + id + "', '" + ACTOR + "', '2026-08-02') AS r"); }
  function pay(c, amount, bank) { return q(c, "INSERT INTO public.vendor_bill_payments (bill_id, amount, paid_date" + (bank ? ', bank_transaction_id' : '') + ") VALUES ('" + BILL + "', " + amount + ", '2026-08-03'" + (bank ? ", '" + T + "'" : '') + ")"); }
  async function totals() { return (await db.query("SELECT (SELECT coalesce(sum(amount),0) FROM public.vendor_bill_payments WHERE bill_id = '" + BILL + "' AND voided IS NOT TRUE)::float AS paid, (SELECT coalesce(sum(amount),0) FROM public.wire_package_lines WHERE bill_id = '" + BILL + "' AND is_open)::float AS held")).rows[0]; }

  // 1. the REAL funded-request step pays its own line (payment, then the line closes, one transaction) with US installed
  var s0 = await setup(100); var rq0 = await request(R1, 100);
  check('setup: transfer, bill and a signed request for the whole $100 bill are created in the real tables', s0.concat(rq0).every(function (x) { return !x; }), s0.concat(rq0));
  var g1 = await send(db, R1); var t1 = await totals();
  check('wire_request_send (the real SP function) with the US rules installed: bill paid $100, nothing held, request attached', !g1.error && g1.rows[0].r.ok === true && t1.paid === 100 && t1.held === 0, [g1, t1]);

  // 2. two requests on ONE transfer, $40 + $60 of the same bill; an independent payment from that transfer in between
  await setup(100); await request(R1, 40); await request(R2, 60);
  var h1 = await send(db, R1); var h2 = await pay(db, 10, true); var h2b = await pay(db, 10, false); var h3 = await send(db, R2); var t2 = await totals();
  check('two requests on one transfer: request 1 sent ($40 paid, $60 still held); an independent $10 payment — from the SAME transfer or with no bank line — is refused; request 2 sent → $100 paid, nothing held', !h1.error && h1.rows[0].r.ok === true && /HUB_GUARD/.test(h2.error || '') && /HUB_GUARD/.test(h2b.error || '') && !h3.error && h3.rows[0].r.ok === true && t2.paid === 100 && t2.held === 0, [h1, h2, h2b, h3, t2]);

  // 3. collisions with the real functions: no deadlock, never over the bill
  async function collide(firstFn, secondFn) {
    await db.query('BEGIN'); var a = await firstFn(db);
    var done = false; var b = null; var pb = secondFn(db2).then(function (r) { done = true; b = r; });
    await new Promise(function (r) { setTimeout(r, 600); }); var waited = !done;
    var cm = await q(db, 'COMMIT'); if (cm.error) { await q(db, 'ROLLBACK'); } await pb; return { a: a, b: b, waited: waited, commitError: cm.error || null };
  }
  await setup(100); await request(R1, 80);
  var c1 = await collide(function (c) { return send(c, R1); }, function (c) { return pay(c, 50, true); }); var t3 = await totals();
  check('request being sent ($80) while a $50 payment from the same transfer arrives: the payment waits, then is refused; $80 paid, no deadlock', !c1.a.error && c1.a.rows[0].r.ok === true && c1.waited && /HUB_GUARD|more than|overpa/i.test(c1.b.error || '') && t3.paid === 80 && t3.held === 0, [c1, t3]);
  await setup(100); await request(R1, 80);
  var c2 = await collide(function (c) { return pay(c, 50, true); }, function (c) { return send(c, R1); }); var t4 = await totals();
  var sentOk = c2.b && c2.b.rows && c2.b.rows[0].r.ok === true;
  check('the other order: a $50 payment is being recorded while the $80 request is sent: one of them loses, cleanly — never $130 against $100, no deadlock', c2.waited && !(c2.b && /deadlock/i.test(c2.b.error || '')) && (t4.paid + t4.held) <= 100.005 && (c2.commitError ? /HUB_GUARD/.test(c2.commitError) && sentOk && t4.paid === 80 : !sentOk && t4.paid === 50), [c2, t4]);
  console.log('     (payment-first outcome: payment ' + (c2.a.error || c2.commitError ? 'refused at the final check' : 'kept') + ', request ' + (sentOk ? 'sent' : 'refused: ' + JSON.stringify(c2.b && (c2.b.error || c2.b.rows[0].r.why))) + ', paid ' + t4.paid + ', held ' + t4.held + ')');
  await setup(100); await request(R1, 60);
  var c3 = await collide(function (c) { return q(c, "INSERT INTO public.wire_package_lines (package_id, bill_id, amount) SELECT '" + R1 + "', '" + BILL + "', 0.01 WHERE false"); }, function (c) { return pay(c, 40, true); }); var t5 = await totals();
  check('a payment that fits beside the reservation ($60 held + $40 paid = $100) is accepted', !c3.b.error && t5.paid === 40 && t5.held === 60, [c3, t5]);

  // ── Codex 06:18 P2 — the REAL wire_request_send (SP) against the REAL hub_party_allocate (UD) on the SAME transfer, both orders.
  // A fixture-only trigger pauses the first function inside its payment insert until the second one has started.
  var US_BIZ = 'QnVzaW5lc3M6NWRkNzI3MDctOTExNC00NjQwLTg4MGQtMjYzNmI3YzM4YTdk';
  var gate = client(); await gate.connect();
  await db.query("CREATE FUNCTION public.aaa_qa_pause() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN IF current_setting(''qa.pause'', true) = ''on'' THEN PERFORM pg_advisory_xact_lock(424242); END IF; RETURN NEW; END'; CREATE TRIGGER aaa_qa_pause BEFORE INSERT ON public.vendor_bill_payments FOR EACH ROW EXECUTE FUNCTION public.aaa_qa_pause();");
  function allocSql() { return "SELECT public.hub_party_allocate('" + JSON.stringify({ party: 'RTM Capital', actor: ACTOR, ktc_business: US_BIZ, bank_transaction_id: T, bills: [{ bill_id: BILL, amount: 10 }], request_id: 'qa-' + Math.random() }) + "'::jsonb) AS r"; }
  async function udSetup() {
    var s = await setup(100); var rq = await request(R1, 80);
    await q(db, "insert into plaid_accounts values ('KOPS','KTC ops','1111','depository','" + US_BIZ + "',false)"); // 'already there' on later calls is fine
    await db.query("UPDATE public.bank_transactions SET wave_business_id = '" + US_BIZ + "', account_id = 'KOPS' WHERE id = '" + T + "'");
    await db.query("UPDATE public.vendor_bills SET wave_business_id = '" + US_BIZ + "' WHERE id = '" + BILL + "'");
    return s.concat(rq);
  }
  var u0 = await udSetup();
  var plain = await q(db, allocSql());
  check('the REAL hub_party_allocate works in this stack ($10 beside the $80 reservation on a $100 bill)', u0.every(function (x) { return !x; }) && !plain.error && (await totals()).paid === 10, [u0, plain]);
  async function interleave(firstSql, secondSql) {
    await gate.query('SELECT pg_advisory_lock(424242)');
    await db.query("SET qa.pause = 'on'");
    var a = null, b = null; var pa = q(db, firstSql).then(function (r) { a = r; });
    await new Promise(function (r) { setTimeout(r, 500); });            // the first function is now paused inside its payment insert
    var pb = q(db2, secondSql).then(function (r) { b = r; });
    await new Promise(function (r) { setTimeout(r, 700); });            // the second one has started and is waiting
    var bWaiting = b === null;
    await gate.query('SELECT pg_advisory_unlock(424242)');
    await Promise.all([pa, pb]); await db.query("SET qa.pause = 'off'");
    return { a: a, b: b, bWaiting: bWaiting };
  }
  await udSetup();
  var i1 = await interleave("SELECT public.wire_request_send('" + R1 + "', '" + ACTOR + "', '2026-08-02') AS r", allocSql()); var ti1 = await totals();
  check('SP send paused mid-way, then UD allocate on the same transfer: NO deadlock — the allocate waits, both finish: $90 paid, nothing held', !i1.a.error && i1.a.rows[0].r.ok === true && !i1.b.error && i1.bWaiting && !/deadlock/i.test(JSON.stringify(i1)) && ti1.paid === 90 && ti1.held === 0, [i1, ti1]);
  await udSetup();
  var i2 = await interleave(allocSql(), "SELECT public.wire_request_send('" + R1 + "', '" + ACTOR + "', '2026-08-02') AS r"); var ti2 = await totals();
  check('the reverse order (UD allocate paused, then SP send): NO deadlock — the send waits, both finish: $90 paid, nothing held', !i2.a.error && !i2.b.error && i2.b.rows[0].r.ok === true && i2.bWaiting && !/deadlock/i.test(JSON.stringify(i2)) && ti2.paid === 90 && ti2.held === 0, [i2, ti2]);
  await db.query('DROP TRIGGER aaa_qa_pause ON public.vendor_bill_payments; DROP FUNCTION public.aaa_qa_pause();'); await gate.end();
} catch (e) { failN++; console.error('  ✗ crashed:', e.message); }
finally {
  try { if (db2) { await db2.end(); } } catch (e) {}
  try { if (db) { await db.end(); } } catch (e) {}
  try { await server.stop(); } catch (e) {}
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) {}
}
console.log('\nUS wire stack SQL: ' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
