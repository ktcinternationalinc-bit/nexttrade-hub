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
  await db.query('TRUNCATE public.wire_package_lines, public.vendor_bill_payments, public.vendor_bills');
  await db.query("INSERT INTO public.vendor_bills (id, vendor_name, bill_number, total_amount, record_status) VALUES ('" + B + "', 'NexPac Corporation', '14277', 45250, 'active')");
}
try {
  console.log('US — partial wires on real Postgres 16');
  await server.initialise(); await server.start();
  db = client(); await db.connect(); db2 = client(); await db2.connect();
  await db.query(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
    CREATE TABLE public.vendor_bills (id uuid PRIMARY KEY, vendor_name text, bill_number text, total_amount numeric(14,2), record_status text DEFAULT 'active');
    CREATE TABLE public.vendor_bill_payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bill_id uuid REFERENCES public.vendor_bills(id), amount numeric(14,2), voided boolean, paid_date date);
    CREATE TABLE public.wire_package_lines (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), package_id uuid, bill_id uuid REFERENCES public.vendor_bills(id), amount numeric(14,2), is_open boolean NOT NULL DEFAULT true, payment_id uuid, created_at timestamptz DEFAULT now());
    CREATE UNIQUE INDEX uq_wpkg_line_open_bill ON public.wire_package_lines (bill_id) WHERE is_open;`);
  await reset();
  await q(db, line(P1, 27885.78));
  var b0 = await q(db, line(P2, 17364.22));
  check('BEFORE: the rest of a partly wired bill could NOT go on a second wire (one-open-line index)', /uq_wpkg_line_open_bill/.test(b0.error || ''), b0);

  var sql = fs.readFileSync(path.join(root, 'sql/v55-83-US-partial-wires.sql'), 'utf8');
  await db.query(sql); var r2 = await db.query(sql);
  var checks = (Array.isArray(r2) ? r2[r2.length - 1] : r2).rows;
  check('US SQL run twice: its check list says OK on every line (3)', checks.length === 3 && checks.every(function (c) { return c.result === 'OK'; }), checks);

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
  await db.query('BEGIN');
  var pay1 = await q(db, "INSERT INTO public.vendor_bill_payments (bill_id, amount, paid_date) VALUES ('" + B + "', 27885.78, '2026-08-05')");
  var close1 = await q(db, "UPDATE public.wire_package_lines SET is_open = false WHERE package_id = '" + P1 + "'");
  await db.query('COMMIT');
  check('attach order (payment first, then the line closes) still works', !pay1.error && !close1.error, [pay1, close1]);
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
} catch (e) { failN++; console.error('  ✗ crashed:', e.message); }
finally {
  try { if (db2) { await db2.end(); } } catch (e) {}
  try { if (db) { await db.end(); } } catch (e) {}
  try { await server.stop(); } catch (e) {}
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) {}
}
console.log('\nUS partial wires SQL: ' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
