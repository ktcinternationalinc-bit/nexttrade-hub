// v55.83-WU — REAL Postgres 16 proof of sql/v55-83-WU-anon-containment.sql (and its EMERGENCY-ROLLBACK file), run twice.
// The live shape is rebuilt: RLS on, permissive "allow all" policies for PUBLIC, table grants to anon + authenticated
// (exactly what the live catalogue shows for these 14 tables on 21 Nov). After the SQL:
//   • a caller who is NOT signed in (role anon, the public browser key) can no longer read, add, change or delete rows
//   • a signed-in person (role authenticated) works exactly as before (read + write through the same policies)
//   • the server (service_role) works exactly as before
//   • running it twice changes nothing more; the ROLLBACK file gives anon its old access back
//   • no other table is touched (a table outside the list keeps its anon access)
// Needs EMBEDDED_PG_DIR (embedded-postgres + pg), e.g. D:\GITHUB\_test-tools\epg.
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
var TABLES = ['bank_transactions', 'egypt_bank_transactions', 'egypt_bank_accounts', 'egypt_bank_rules', 'module_permissions', 'open_accounts', 'open_account_entries', 'open_account_invoices', 'open_account_invoice_items', 'warehouse_advances', 'fx_rates', 'inventory_landed_costs', 'inventory_layers', 'attachments'];
var OUTSIDE = 'announcements';
var SQL = fs.readFileSync(path.join(root, 'sql/v55-83-WU-anon-containment.sql'), 'utf8');
var ROLLBACK = fs.readFileSync(path.join(root, 'sql/v55-83-WU-anon-containment-EMERGENCY-ROLLBACK.sql'), 'utf8');
check('the SQL Max runs has no comment lines and is one transaction', !/^\s*--/m.test(SQL) && /^BEGIN;/.test(SQL.trim()) && /COMMIT;$/.test(SQL.trim()));
check('the SQL only takes access away from anon (no DROP, no DELETE, no change for signed-in people)', !/\b(DROP|DELETE|TRUNCATE|ALTER|authenticated|service_role)\b/i.test(SQL) && /FROM anon;/.test(SQL));
var listed = (SQL.match(/public\.[a-z_]+/g) || []).map(function (x) { return x.replace('public.', ''); });
check('the SQL names exactly the 14 money / permission tables', listed.length === TABLES.length && TABLES.every(function (t) { return listed.indexOf(t) >= 0; }), listed);

var dataDir = path.join(dir, 'data-wu-' + Date.now()); var port = 54000 + Math.floor(Math.random() * 900);
var server = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'test-only', port: port, persistent: false, initdbFlags: ['--encoding=UTF8', '--locale=C'] });
var db;
async function as(role, sql) {
  await db.query('BEGIN');
  try { await db.query('SET LOCAL ROLE ' + role); var r = await db.query(sql); await db.query('ROLLBACK'); return { ok: true, rows: r.rows, count: r.rowCount }; }
  catch (e) { await db.query('ROLLBACK'); return { ok: false, code: e.code, msg: e.message }; }
}
async function setup() {
  await db.query("DO $x$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF; END $x$;");
  await db.query('GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role');
  var all = TABLES.concat([OUTSIDE]);
  for (var i = 0; i < all.length; i++) {
    var t = all[i];
    await db.query('CREATE TABLE public.' + t + ' (id serial primary key, note text)');
    await db.query('ALTER TABLE public.' + t + ' ENABLE ROW LEVEL SECURITY');
    await db.query('CREATE POLICY "allow_all_' + t + '" ON public.' + t + ' FOR ALL USING (true) WITH CHECK (true)');
    await db.query('GRANT ALL ON TABLE public.' + t + ' TO anon, authenticated, service_role');
    await db.query('GRANT USAGE ON SEQUENCE public.' + t + '_id_seq TO anon, authenticated, service_role');
    await db.query("INSERT INTO public." + t + " (note) VALUES ('a'), ('b')");
  }
}
async function anonBlocked(t) {
  var s = await as('anon', 'SELECT * FROM public.' + t); var i = await as('anon', "INSERT INTO public." + t + " (note) VALUES ('x')");
  var u = await as('anon', "UPDATE public." + t + " SET note = 'x'"); var d = await as('anon', 'DELETE FROM public.' + t);
  return !s.ok && s.code === '42501' && !i.ok && i.code === '42501' && !u.ok && u.code === '42501' && !d.ok && d.code === '42501';
}
async function anonOpen(t) { var s = await as('anon', 'SELECT * FROM public.' + t); return s.ok && s.rows.length === 2; }
async function signedInWorks(t) {
  var s = await as('authenticated', 'SELECT * FROM public.' + t); var i = await as('authenticated', "INSERT INTO public." + t + " (note) VALUES ('x')");
  var u = await as('authenticated', "UPDATE public." + t + " SET note = 'y'");
  return s.ok && s.rows.length === 2 && i.ok && i.count === 1 && u.ok && u.count === 2;
}
async function serverWorks(t) { var s = await as('service_role', 'SELECT * FROM public.' + t); var i = await as('service_role', "INSERT INTO public." + t + " (note) VALUES ('x')"); return s.ok && s.rows.length === 2 && i.ok; }

try {
  await server.initialise(); await server.start();
  db = new pg.Client({ host: 'localhost', port: port, user: 'postgres', password: 'test-only', database: 'postgres' }); await db.connect();
  await setup();
  var before = true; for (var a = 0; a < TABLES.length; a++) { if (!(await anonOpen(TABLES[a]))) { before = false; } }
  check('BEFORE (live today): every one of the 14 tables is readable without signing in', before);

  for (var run = 1; run <= 2; run++) {
    await db.query(SQL);
    var blocked = [], openStill = [], signed = [], srv = [];
    for (var k = 0; k < TABLES.length; k++) {
      var t = TABLES[k];
      if (!(await anonBlocked(t))) { openStill.push(t); } else { blocked.push(t); }
      if (!(await signedInWorks(t))) { signed.push(t); }
      if (!(await serverWorks(t))) { srv.push(t); }
    }
    check('run ' + run + ': not signed in → read / add / change / delete refused (permission denied) on all 14 tables', openStill.length === 0, openStill);
    check('run ' + run + ': signed-in people read and write exactly as before on all 14 tables', signed.length === 0, signed);
    check('run ' + run + ': the server (service key) works exactly as before on all 14 tables', srv.length === 0, srv);
    check('run ' + run + ': a table NOT in the list keeps its anon access (nothing else is touched)', await anonOpen(OUTSIDE));
  }
  var rows = await db.query('SELECT count(*)::int AS n FROM public.bank_transactions');
  check('no data is removed or changed by the SQL (the rows are all still there)', rows.rows[0].n === 2, rows.rows);

  await db.query(ROLLBACK);
  var back = true; for (var b = 0; b < TABLES.length; b++) { if (!(await anonOpen(TABLES[b]))) { back = false; } }
  check('EMERGENCY ROLLBACK file (reopens the exposure; only if something breaks): the exact old access comes back on all 14 tables (undo is possible)', back);
  await db.query(SQL);
  check('… and the SQL can be applied again after a rollback', await anonBlocked('module_permissions'));
} catch (e) {
  failN++; console.log('CRASH ' + (e && e.stack));
} finally {
  try { await db.end(); } catch (e1) { }
  try { await server.stop(); } catch (e2) { }
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e3) { }
}
console.log('');
console.log('WU: ' + pass + ' passed, ' + failN + ' failed');
process.exit(failN > 0 ? 1 : 0);
