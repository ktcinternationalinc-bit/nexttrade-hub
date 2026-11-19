// v55.83-UQ (Codex 23:01 P1) — REAL Postgres 16: sql/v55-83-UQ-exact-duplicate-bills.sql (run twice). The database refuses the exact
// same bill a second time — also when two sessions insert it at the same moment — with the SAME meaning of "same" as the Hub code
// (bill-dup-scan.js normVendor / normNum), while copies already on file stay editable and voidable.
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
var rq = createRequire(import.meta.url); rq(path.join(root, 'node_modules/sucrase/register'));
var D = rq(path.join(root, 'src/lib/bill-dup-scan.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra))); }
var dataDir = path.join(dir, 'data-uq-' + Date.now()); var port = 54000 + Math.floor(Math.random() * 900);
var server = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'test-only', port: port, persistent: false, initdbFlags: ['--encoding=UTF8', '--locale=C'] });
var db, db2;
function client() { return new pg.Client({ host: 'localhost', port: port, user: 'postgres', password: 'test-only', database: 'postgres' }); }
async function q(c, sql, p) { try { var r = await c.query(sql, p || []); return { rows: r.rows, count: r.rowCount }; } catch (e) { return { error: e.message }; } }
var INS = "INSERT INTO public.vendor_bills (vendor_name, bill_number, bill_date, total_amount) VALUES ($1, $2, $3, $4) RETURNING id";
try {
  console.log('UQ — exact duplicate bills refused by the database (real Postgres 16)');
  await server.initialise(); await server.start();
  db = client(); await db.connect(); db2 = client(); await db2.connect();
  await db.query(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
    CREATE TABLE public.vendor_bills (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vendor_name text, bill_number text, bill_date date, total_amount numeric(14,2), record_status text DEFAULT 'active', notes text);`);
  // copies that already exist BEFORE the guard (like NexPac #14481 ×3 in the Hub)
  for (var i = 0; i < 3; i++) { await db.query(INS, ['NexPac Corporation', '14481', '2026-06-02', 2831]); }
  var sql = fs.readFileSync(path.join(root, 'sql/v55-83-UQ-exact-duplicate-bills.sql'), 'utf8');
  await db.query(sql); var r2 = await db.query(sql);
  var out = (Array.isArray(r2) ? r2[r2.length - 1] : r2).rows;
  check('UQ SQL run twice (with 3 copies already on file — it does not fail): guard OK, and it lists the existing copies', out[0].result === 'OK' && out.some(function (r) { return /NexPac Corporation #14481/.test(r.check_item) && r.result === '3 copies'; }), out);

  // same meaning of "same" as the Hub code
  var cases = [['NexPac Corporation', '14481'], ['NEXPAC CORP.', 'inv 14481'], ['Smith & Sons, Inc.', 'A-1/2'], ['The Port Co LLC', ' 00-77 '], ['Ontrek', 'IN-12958'], ['A.B.C. Trucking Ltd', 'x'], ['Inc Inc Freight', '9']];
  var same = true; var diffs = [];
  for (var c of cases) {
    var k = (await db.query("SELECT public.hub_bill_exact_key($1, $2, '2026-06-02', 10.5) AS k", c)).rows[0].k;
    var js = D.normVendor(c[0]) + '|' + D.normNum(c[1]) + '|2026-06-02|1050';
    if (k !== js) { same = false; diffs.push([c, k, js]); }
  }
  check('the database key equals the Hub code\'s key for every sample (vendor spelling, Inc / Corp / & / dots, number dashes)', same, diffs);
  check('"INV-14481" and "14481" are DIFFERENT numbers (letters are kept — unrelated bills are never merged)', (await db.query("SELECT public.hub_bill_exact_key('X', 'INV-14481', '2026-06-02', 1) <> public.hub_bill_exact_key('X', '14481', '2026-06-02', 1) AS d")).rows[0].d === true && D.exactSameBill({ vendor_name: 'X', bill_number: 'INV-14481', bill_date: '2026-06-02', total_amount: 1 }, [{ id: 'z', vendor_name: 'X', bill_number: '14481', bill_date: '2026-06-02', total_amount: 1, record_status: 'active' }]) === null);
  check('no bill number / no date → no key (never called exact)', (await db.query("SELECT public.hub_bill_exact_key('X', ' - ', '2026-06-02', 1) IS NULL AND public.hub_bill_exact_key('X', '1', NULL, 1) IS NULL AS n")).rows[0].n === true);

  // refusing
  var a1 = await q(db, INS, ['NEXPAC CORP', 'INV 14481', '2026-06-02', 2831]);
  var a0 = await q(db, INS, ['NexPac Corp.', '14481', '2026-06-02', '2831.00']);
  check('a 4th copy of NexPac #14481 (spelled "NexPac Corp.") is refused with the plain message', /HUB_EXACT_DUPLICATE: This exact bill is already in the Hub — NexPac Corporation #14481 dated 2026-06-02 for \$2831\.00\. It was NOT added again\./.test(a0.error || ''), a0);
  check('a different number ("INV 14481"), total, date or vendor is accepted', !a1.error && !(await q(db, INS, ['NexPac Corporation', '14481', '2026-06-02', 2831.01])).error && !(await q(db, INS, ['NexPac Corporation', '14481', '2026-06-03', 2831])).error && !(await q(db, INS, ['Ontrek', '14481', '2026-06-02', 2831])).error, a1);
  // copies already on file stay editable / voidable; turning a bill INTO an exact copy is refused
  var e1 = await q(db, "UPDATE public.vendor_bills SET notes = 'checked' WHERE bill_number = '14481' AND total_amount = 2831 AND bill_date = '2026-06-02' AND vendor_name = 'NexPac Corporation'");
  check('the 3 copies already on file can still be edited (other fields)', !e1.error && e1.count === 3, e1);
  var e2 = await q(db, "UPDATE public.vendor_bills SET record_status = 'void' WHERE id IN (SELECT id FROM public.vendor_bills WHERE bill_number = '14481' AND total_amount = 2831 AND bill_date = '2026-06-02' AND vendor_name = 'NexPac Corporation' LIMIT 2)");
  check('… and voided (2 of them)', !e2.error && e2.count === 2, e2);
  var e3 = await q(db, "UPDATE public.vendor_bills SET total_amount = 2831 WHERE total_amount = 2831.01");
  check('editing another bill INTO an exact copy of a live one is refused', /HUB_EXACT_DUPLICATE/.test(e3.error || ''), e3);
  var e4 = await q(db, "UPDATE public.vendor_bills SET record_status = 'active' WHERE id = (SELECT id FROM public.vendor_bills WHERE record_status = 'void' LIMIT 1)");
  check('restoring a voided copy while a live one exists is refused', /HUB_EXACT_DUPLICATE/.test(e4.error || ''), e4);
  await db.query("UPDATE public.vendor_bills SET record_status = 'void' WHERE bill_number = '14481' AND vendor_name = 'NexPac Corporation' AND total_amount = 2831 AND bill_date = '2026-06-02'");
  check('once every copy is voided, the bill can be entered again', !(await q(db, INS, ['NexPac Corporation', '14481', '2026-06-02', 2831])).error);
  // more than 200 unrelated bills with the same date and total do not hide the copy
  await db.query("INSERT INTO public.vendor_bills (vendor_name, bill_number, bill_date, total_amount) SELECT 'Vendor ' || g, 'N' || g, '2026-09-09', 500 FROM generate_series(1, 450) g");
  await db.query(INS, ['Late Vendor', 'Z-1', '2026-09-09', 500]);
  check('450 other bills with the same date and total do not hide the copy (no cutoff)', /HUB_EXACT_DUPLICATE/.test((await q(db, INS, ['Late Vendor', 'Z-1', '2026-09-09', 500])).error || ''));

  // two sessions at the same moment
  await db.query('BEGIN'); var s1 = await q(db, INS, ['Race Vendor', 'R-1', '2026-10-01', 99.5]);
  var pending = q(db2, INS, ['RACE VENDOR INC', 'r 1', '2026-10-01', 99.5]);
  await new Promise(function (r) { setTimeout(r, 400); });
  await db.query('COMMIT'); var s2 = await pending;
  var n = (await db.query("SELECT count(*)::int AS n FROM public.vendor_bills WHERE bill_date = '2026-10-01'")).rows[0].n;
  check('race: two sessions insert the same bill at once → one row, the other gets the plain duplicate message', !s1.error && /HUB_EXACT_DUPLICATE/.test(s2.error || '') && n === 1, [s1, s2, n]);
  await db.query('BEGIN'); var t1 = await q(db, INS, ['Roll Vendor', 'R-2', '2026-10-02', 5]);
  var pend2 = q(db2, INS, ['Roll Vendor', 'R-2', '2026-10-02', 5]);
  await new Promise(function (r) { setTimeout(r, 400); });
  await db.query('ROLLBACK'); var t2 = await pend2;
  check('race where the first insert is rolled back → the second one is accepted (nothing lost)', !t1.error && !t2.error && (await db.query("SELECT count(*)::int AS n FROM public.vendor_bills WHERE bill_date = '2026-10-02'")).rows[0].n === 1, [t1, t2]);
} catch (e) { failN++; console.error('  ✗ crashed:', e.message); }
finally {
  try { if (db2) { await db2.end(); } } catch (e) {}
  try { if (db) { await db.end(); } } catch (e) {}
  try { await server.stop(); } catch (e) {}
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) {}
}
console.log('\nUQ exact duplicate SQL: ' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
