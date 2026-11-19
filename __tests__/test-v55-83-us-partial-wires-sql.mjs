// v55.83-US — REAL Postgres 16: sql/v55-83-US-partial-wires.sql (run twice). A bill may be on several open wires while
// paid + open wire amounts ≤ total; never more (also when two sessions race); a bill is never paid more than its total; the
// wire's own attach order (payment first, then the line closes) still works; the old one-open-line index is gone.
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
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra))); }
var dataDir = path.join(dir, 'data-us-' + Date.now()); var port = 54000 + Math.floor(Math.random() * 900);
var server = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'test-only', port: port, persistent: false, initdbFlags: ['--encoding=UTF8', '--locale=C'] });
var db, db2;
function client() { return new pg.Client({ host: 'localhost', port: port, user: 'postgres', password: 'test-only', database: 'postgres' }); }
async function q(c, sql, p) { try { var r = await c.query(sql, p || []); return { rows: r.rows, count: r.rowCount }; } catch (e) { return { error: e.message }; } }
var B = '00000000-0000-0000-0000-0000000014a7', P1 = '00000000-0000-0000-0000-0000000000a1', P2 = '00000000-0000-0000-0000-0000000000a2', P3 = '00000000-0000-0000-0000-0000000000a3';
function line(pkg, amt) { return "INSERT INTO public.wire_package_lines (package_id, bill_id, amount) VALUES ('" + pkg + "', '" + B + "', " + amt + ") RETURNING id"; }
async function reset() {
  await db.query('TRUNCATE public.wire_package_lines, public.vendor_bill_payments, public.wire_packages, public.vendor_bills');
  await db.query("INSERT INTO public.wire_packages (id) VALUES ('" + P1 + "'), ('" + P2 + "'), ('" + P3 + "')");
  await db.query("INSERT INTO public.vendor_bills (id, vendor_name, bill_number, total_amount, record_status) VALUES ('" + B + "', 'NexPac Corporation', '14277', 45250, 'active')");
}
try {
  console.log('US — partial wires on real Postgres 16');
  await server.initialise(); await server.start();
  db = client(); await db.connect(); db2 = client(); await db2.connect();
  await db.query(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
    CREATE TABLE public.vendor_bills (id uuid PRIMARY KEY, vendor_name text, bill_number text, total_amount numeric(14,2), record_status text DEFAULT 'active');
    CREATE TABLE public.vendor_bill_payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bill_id uuid REFERENCES public.vendor_bills(id), amount numeric(14,2), voided boolean, paid_date date, bank_transaction_id uuid);
    CREATE TABLE public.wire_packages (id uuid PRIMARY KEY, status text DEFAULT 'draft', bank_transaction_id uuid, funding_txn_id uuid);
    CREATE TABLE public.wire_package_lines (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), package_id uuid, bill_id uuid REFERENCES public.vendor_bills(id), amount numeric(14,2), is_open boolean NOT NULL DEFAULT true, payment_id uuid, created_at timestamptz DEFAULT now());
    CREATE UNIQUE INDEX uq_wpkg_line_open_bill ON public.wire_package_lines (bill_id) WHERE is_open;`);
  await reset();
  await q(db, line(P1, 27885.78));
  var b0 = await q(db, line(P2, 17364.22));
  check('BEFORE: the rest of a partly wired bill could NOT go on a second wire (one-open-line index)', /uq_wpkg_line_open_bill/.test(b0.error || ''), b0);

  var sql = fs.readFileSync(path.join(root, 'sql/v55-83-US-partial-wires.sql'), 'utf8');
  await db.query(sql); var r2 = await db.query(sql);
  var checks = (Array.isArray(r2) ? r2[r2.length - 1] : r2).rows;
  check('US SQL run twice: its check list says OK on every line (4)', checks.length === 4 && checks.every(function (c) { return c.result === 'OK'; }), checks);

  // the 14277 case: $45,250 bill, $27,885.78 on wire 1, the remaining $17,364.22 on wire 2
  await reset();
  var a1 = await q(db, line(P1, 27885.78)); var a2 = await q(db, line(P2, 17364.22));
  check('a $45,250 bill: $27,885.78 on wire 1 and the remaining $17,364.22 on wire 2 — both accepted', !a1.error && !a2.error, [a1, a2]);
  var a3 = await q(db, line(P3, 0.01));
  check('… one more cent on a third wire → refused, saying how much is left ($0.00)', /HUB_GUARD: only \$0\.00 is left on this bill \(total \$45,250\.00, paid \$0\.00, on other open wires \$45,250\.00\)/.test(a3.error || ''), a3);
  var up1 = await q(db, "UPDATE public.wire_package_lines SET amount = 17364.23 WHERE package_id = '" + P2 + "'");
  check('… raising a wire line above what is left → refused', /HUB_GUARD/.test(up1.error || ''), up1);
  var up2 = await q(db, "UPDATE public.wire_package_lines SET amount = 17000 WHERE package_id = '" + P2 + "'");
  check('… lowering a wire line → always fine', !up2.error && up2.count === 1, up2);

  // a wire is sent: its payment is recorded FIRST, then its line closes (the SP attach order) — must work
  var T1 = '00000000-0000-0000-0000-0000000000f1';
  var early = await q(db, "INSERT INTO public.vendor_bill_payments (bill_id, amount, paid_date) VALUES ('" + B + "', 27885.78, '2026-08-05')");
  check('a payment NOT tied to the wire\'s bank line, while the wires hold the whole bill, is refused (it says how much is held)', /HUB_GUARD: \$44,885\.78 of this bill is held on an open wire — only \$364\.22 can be paid now/.test(early.error || ''), early);
  await db.query("UPDATE public.wire_packages SET status = 'sent', bank_transaction_id = '" + T1 + "' WHERE id = '" + P1 + "'"); // the wire claims its bank line (attachWire does this first)
  var pay1 = await q(db, "INSERT INTO public.vendor_bill_payments (bill_id, amount, paid_date, bank_transaction_id) VALUES ('" + B + "', 27885.78, '2026-08-05', '" + T1 + "')");
  var close1 = await q(db, "UPDATE public.wire_package_lines SET is_open = false WHERE package_id = '" + P1 + "'");
  check('the wire\'s OWN payment (same bank line), recorded while its line is still open, then the line closes — works, in separate steps too', !pay1.error && !close1.error, [pay1, close1]);
  var a4 = await q(db, line(P3, 364.22));
  check('after wire 1 is paid: $27,885.78 paid + $17,000 open → $364.22 more fits on a third wire', !a4.error, a4);
  var a5 = await q(db, line(P3, 0.01));
  check('… and not a cent more', /HUB_GUARD/.test(a5.error || ''), a5);

  // payments never exceed the bill
  await reset();
  var p1 = await q(db, "INSERT INTO public.vendor_bill_payments (bill_id, amount) VALUES ('" + B + "', 45000)");
  var p2 = await q(db, "INSERT INTO public.vendor_bill_payments (bill_id, amount) VALUES ('" + B + "', 250.01)");
  var p3 = await q(db, "INSERT INTO public.vendor_bill_payments (bill_id, amount) VALUES ('" + B + "', 250)");
  check('payments: $45,000 + $250.01 on a $45,250 bill → refused; + $250 → accepted', !p1.error && /HUB_GUARD: this payment of \$250\.01 would pay the bill more than its total/.test(p2.error || '') && !p3.error, [p1, p2, p3]);
  var p4 = await q(db, "INSERT INTO public.vendor_bill_payments (bill_id, amount, voided) VALUES ('" + B + "', 999, true)");
  var p5 = await q(db, "UPDATE public.vendor_bill_payments SET voided = true WHERE amount = 250");
  check('a voided payment never counts, and undoing a payment is always allowed', !p4.error && !p5.error, [p4, p5]);
  var p6 = await q(db, "INSERT INTO public.vendor_bill_payments (bill_id, amount, voided) VALUES ('" + B + "', 250, NULL)");
  check('a payment with a blank voided flag counts as live (still capped)', !p6.error && /HUB_GUARD/.test((await q(db, "INSERT INTO public.vendor_bill_payments (bill_id, amount) VALUES ('" + B + "', 0.01)")).error || ''));

  // a void bill cannot go on a wire
  await reset();
  await db.query("UPDATE public.vendor_bills SET record_status = 'void' WHERE id = '" + B + "'");
  check('a VOID bill cannot be put on a wire', /HUB_GUARD: this bill is void/.test((await q(db, line(P1, 10))).error || ''));

  // two people at once: both try to put $30,000 of the $45,250 bill on two different wires
  await reset();
  await db.query('BEGIN'); var s1 = await q(db, line(P1, 30000));
  var pending = q(db2, line(P2, 30000));
  await new Promise(function (r) { setTimeout(r, 400); });
  await db.query('COMMIT');
  var s2 = await pending;
  var held = (await db.query("SELECT coalesce(sum(amount),0)::numeric AS s FROM public.wire_package_lines WHERE bill_id = '" + B + "' AND is_open")).rows[0].s;
  check('race: two wires each asking $30,000 of a $45,250 bill — the second waits for the bill lock, then is refused; never over-allocated', !s1.error && /HUB_GUARD: only \$15,250\.00 is left/.test(s2.error || '') && Number(held) === 30000, [s1, s2, held]);

  // ── Codex 05:38 P1-4 — a payment beside an open wire reservation, in BOTH orders
  var BB1 = '00000000-0000-0000-0000-0000000000b1';
  async function small() { await reset(); await db.query("INSERT INTO public.vendor_bills (id, vendor_name, bill_number, total_amount) VALUES ('" + BB1 + "', 'V', 'S-1', 100)"); }
  function sline(pkg, amt) { return "INSERT INTO public.wire_package_lines (package_id, bill_id, amount) VALUES ('" + pkg + "', '" + BB1 + "', " + amt + ")"; }
  function spay(amt, txn) { return "INSERT INTO public.vendor_bill_payments (bill_id, amount" + (txn ? ', bank_transaction_id' : '') + ") VALUES ('" + BB1 + "', " + amt + (txn ? ", '" + txn + "'" : '') + ")"; }
  await small(); await q(db, sline(P1, 80));
  var c1 = await q(db, spay(50)); var c2 = await q(db, spay(20));
  check('$100 bill, $80 on an open wire: a $50 payment is REFUSED (was accepted → $130 committed); $20 is accepted', /HUB_GUARD: \$80\.00 of this bill is held on an open wire — only \$20\.00 can be paid now/.test(c1.error || '') && !c2.error, [c1, c2]);
  await small(); await q(db, spay(50));
  var c3 = await q(db, sline(P1, 80)); var c4 = await q(db, sline(P1, 50));
  check('the other order: $50 paid first → an $80 wire line is refused, $50 accepted', /HUB_GUARD: only \$50\.00 is left/.test(c3.error || '') && !c4.error, [c3, c4]);
  // the transfer a funded request draws from (funding_txn_id) counts as the wire's own bank line too
  await small(); var F1 = '00000000-0000-0000-0000-0000000000f9';
  await db.query("UPDATE public.wire_packages SET funding_txn_id = '" + F1 + "' WHERE id = '" + P2 + "'"); await q(db, sline(P2, 100));
  var c5 = await q(db, spay(100, '00000000-0000-0000-0000-0000000000aa')); var c6 = await q(db, spay(100, F1));
  check('a funded request: a payment from ANOTHER bank line is refused; the payment from its own transfer is accepted', /HUB_GUARD/.test(c5.error || '') && !c6.error, [c5, c6]);
  // race: a payment and a wire line for the same bill at the same moment
  await small();
  await db.query('BEGIN'); var rc1 = await q(db, sline(P1, 80));
  var pend3 = q(db2, spay(50)); await new Promise(function (r) { setTimeout(r, 400); }); await db.query('COMMIT'); var rc2 = await pend3;
  check('race, wire line first: the payment waits for the bill lock, then is refused', !rc1.error && /HUB_GUARD/.test(rc2.error || ''), [rc1, rc2]);
  await small();
  await db.query('BEGIN'); var rc3 = await q(db, spay(50));
  var pend4 = q(db2, sline(P1, 80)); await new Promise(function (r) { setTimeout(r, 400); }); await db.query('COMMIT'); var rc4 = await pend4;
  check('race, payment first: the wire line waits, then is refused — paid + held never exceeds the bill', !rc3.error && /HUB_GUARD/.test(rc4.error || '') && Number((await db.query("SELECT (SELECT coalesce(sum(amount),0) FROM public.vendor_bill_payments WHERE bill_id = '" + BB1 + "' AND voided IS NOT TRUE) + (SELECT coalesce(sum(amount),0) FROM public.wire_package_lines WHERE bill_id = '" + BB1 + "' AND is_open) AS s")).rows[0].s) === 50, [rc3, rc4]);

  // ── Codex 05:38 P1-5 — void / delete versus a payment
  await small(); await db.query("UPDATE public.vendor_bills SET record_status = 'void' WHERE id = '" + BB1 + "'");
  var v1 = await q(db, spay(10));
  check('a VOID bill takes no new payment (was accepted)', /HUB_GUARD: this bill is void — it cannot take a payment/.test(v1.error || ''), v1);
  await small(); await q(db, spay(10));
  var v2 = await q(db, "UPDATE public.vendor_bills SET record_status = 'void' WHERE id = '" + BB1 + "'");
  var v3 = await q(db, "UPDATE public.vendor_bills SET record_status = 'deleted' WHERE id = '" + BB1 + "'");
  check('a bill with a payment that is not undone cannot be voided or deleted — at the database, whoever asks', /HUB_GUARD: this bill has 1 payment\(s\) totalling \$10\.00 that are not undone/.test(v2.error || '') && /HUB_GUARD/.test(v3.error || ''), [v2, v3]);
  await db.query("UPDATE public.vendor_bill_payments SET voided = true WHERE bill_id = '" + BB1 + "'");
  check('once the payment is undone, the bill can be voided', !(await q(db, "UPDATE public.vendor_bills SET record_status = 'void' WHERE id = '" + BB1 + "'")).error);
  await small(); await q(db, sline(P1, 10));
  check('a bill on an open wire cannot be voided', /HUB_GUARD: this bill is on an open wire/.test((await q(db, "UPDATE public.vendor_bills SET record_status = 'void' WHERE id = '" + BB1 + "'")).error || ''));
  await small();
  await db.query('BEGIN'); var vr1 = await q(db, "UPDATE public.vendor_bills SET record_status = 'void' WHERE id = '" + BB1 + "'");
  var pend5 = q(db2, spay(10)); await new Promise(function (r) { setTimeout(r, 400); }); await db.query('COMMIT'); var vr2 = await pend5;
  check('race, void first: the payment waits, then is refused (the bill is void)', !vr1.error && /HUB_GUARD: this bill is void/.test(vr2.error || ''), [vr1, vr2]);
  await small();
  await db.query('BEGIN'); var vr3 = await q(db, spay(10));
  var pend6 = q(db2, "UPDATE public.vendor_bills SET record_status = 'void' WHERE id = '" + BB1 + "'"); await new Promise(function (r) { setTimeout(r, 400); }); await db.query('COMMIT'); var vr4 = await pend6;
  var endSt = (await db.query("SELECT record_status FROM public.vendor_bills WHERE id = '" + BB1 + "'")).rows[0].record_status;
  check('race, payment first: the void waits, then is refused — never a void bill with a live payment', !vr3.error && /HUB_GUARD: this bill has 1 payment/.test(vr4.error || '') && endSt === 'active', [vr3, vr4, endSt]);
  check('editing other fields of a paid bill (not its status) is not blocked', !(await q(db, "UPDATE public.vendor_bills SET vendor_name = 'V2' WHERE id = '" + BB1 + "'")).error);
} catch (e) { failN++; console.error('  ✗ crashed:', e.message); }
finally {
  try { if (db2) { await db2.end(); } } catch (e) {}
  try { if (db) { await db.end(); } } catch (e) {}
  try { await server.stop(); } catch (e) {}
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) {}
}
console.log('\nUS partial wires SQL: ' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
