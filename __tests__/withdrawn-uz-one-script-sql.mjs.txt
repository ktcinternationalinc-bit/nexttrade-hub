// v55.83-UZ — the ONE combined script (Elite freight 0 + six customers CNF), the REAL file run on a real Postgres (PGlite).
// All or nothing: every guard before any write. Compared with the two reviewed single files. Needs PGLITE_DIR.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';
var here = path.dirname(fileURLToPath(import.meta.url)); var root = path.join(here, '..');
var req = createRequire(path.join(process.env.PGLITE_DIR || root, 'package.json'));
var PGlite;
try { PGlite = (await import(pathToFileURL(req.resolve('@electric-sql/pglite')).href)).PGlite; }
catch (e) { console.log('SKIPPED — @electric-sql/pglite not found (set PGLITE_DIR). Nothing was checked.'); process.exit(2); }
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 1000))); }
function sql(f) { return fs.readFileSync(path.join(root, 'sql', f), 'utf8'); }
console.log('UZ — one combined script (real Postgres)');
var one = sql('v55-83-UZ-ONE-SCRIPT-elite-freight-and-cnf.sql');
var KTC = 'QnVzaW5lc3M6NWRkNzI3MDctOTExNC00NjQwLTg4MGQtMjYzNmI3YzM4YTdk';
var ELITE = '1430a750-6d34-4609-8ed0-d4e5c5054a3c'; var OTHER = '00000000-0000-4000-8000-00000000aaaa';
var KEYS = ['10011541', '10011627', '10021036', '10021059', '10021125', '10021129', '10021130', '10021133', '10021138', '10021144', '10021146', '10021152', '10021154', '10021168', '10021178', '10021183', '10021184', '10021188', '10021195', '10021202', '10021203', '10021204', '10021207', '10021211', '10021212'];
var AP = JSON.parse(sql('v55-83-UZ-approved-customers.json'));
check('no BEGIN / COMMIT / ROLLBACK, no DELETE / DROP TABLE / TRUNCATE; ONE DO block; writes only the two report tables and the two backups',
  !/^\s*(begin|commit|rollback)\s*;/im.test(one) && !/\b(delete\s+from|drop\s+table|truncate)\b/i.test(one) && one.split('DO $$').length === 2 && !/UPDATE public\./.test(one) &&
  (one.match(/INSERT INTO public\.(\w+)/g) || []).every(function (x) { return /pl_release_part_estimates|pl_customer_terms|hub_backup_uz_part_estimates|hub_backup_uz_customer_terms/.test(x); }));
check('exactly the 25 release keys (in the change and in the result) and the 6 customer ids — the same as the two reviewed files', KEYS.every(function (k) { return one.split("'" + k + "'").length === 3; }) && (one.match(/'100[0-9]{4,5}'/g) || []).length === 50 && AP.every(function (a) { return one.split(a.id).length === 3; }) && (one.match(/'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/g) || []).length === 13);
var body = one.substring(one.indexOf('DO $$'), one.indexOf('END $$;'));
var firstWrite = body.indexOf('INSERT INTO'); var lastGuard = body.lastIndexOf('RAISE EXCEPTION');
check('every guard (RAISE EXCEPTION) comes before the first write', lastGuard > 0 && firstWrite > lastGuard);
var n = 0; function U() { n++; return '00000000-0000-4000-8000-' + String(n).padStart(12, '0'); }
function rel(k) { return k.substring(0, 4) + '-' + k.substring(4); }
async function fresh() {
  var db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role;" +
    " create table public.accounting_customers (id uuid primary key, company_name text, contact_name text, business_tag text);" +
    " create table public.accounting_invoices (id uuid primary key, invoice_number text, accounting_customer_id uuid, invoice_date date, total_amount numeric, record_status text, currency text, source text, wave_invoice_id text, wave_business_id text, release_number text);" +
    " create table public.accounting_invoice_items (id uuid primary key, invoice_id uuid, description text, quantity numeric, unit_price numeric, wave_product_name text);" +
    " create table public.vendor_bills (id uuid primary key, vendor_name text, bill_number text, bill_date date, total_amount numeric, record_status text, bill_type text, shipment_direction text, release_number text);");
  for (var f of ['v55-83-SY-profitability.sql', 'v55-83-TG2-invoice-shipping-terms.sql', 'v55-83-TL-trucking-freight.sql']) { await db.exec(sql(f)); }
  await db.query('insert into accounting_customers (id, company_name) values ($1, $2), ($3, $4)', [ELITE, 'ELITE PAPER', OTHER, 'SOMEBODY ELSE']);
  for (var a of AP) { await db.query('insert into accounting_customers (id, company_name) values ($1, $2)', [a.id, a.name]); }
  for (var k of KEYS) { await db.query("insert into accounting_invoices values ($1, $2, $3, '2026-08-01', 1, 'active', 'USD', 'hub', null, $4, $5)", [U(), 'A ' + k, ELITE, KTC, rel(k)]); }
  await db.exec("insert into pl_release_part_estimates (release_key, part, amount, note) values ('10021178', 'freight', 1672, 'MasterReport FF wire'), ('10021178', 'trucking', 1671.67, 'AMB'), ('10021160', 'freight', 723, 'MasterReport FF wire');" +
    " insert into pl_customer_terms (customer_id, customer_name, basis) values ('" + AP[2].id + "', 'Moustafa Tosha', 'EXW'), ('" + OTHER + "', 'SOMEBODY ELSE', 'EXW');");
  return db;
}
async function state(db) {
  var has = (await db.query("select count(*)::int n from pg_class where relname in ('hub_backup_uz_part_estimates', 'hub_backup_uz_customer_terms')")).rows[0].n === 2;
  return { est: (await db.query('select release_key, part, amount::float a, note from pl_release_part_estimates order by release_key, part')).rows, terms: (await db.query('select customer_id, basis from pl_customer_terms order by customer_id')).rows,
    b1: has ? (await db.query('select count(*)::int n from hub_backup_uz_part_estimates')).rows[0].n : 0, b2: has ? (await db.query('select count(*)::int n from hub_backup_uz_customer_terms')).rows[0].n : 0 };
}
// the combined script against the two reviewed files run one after the other: identical end state
var dA = await fresh(); var dB = await fresh();
var res = await dA.query(one.substring(one.indexOf('-- ── RESULT'))).catch(function () { return null; });
var out = await dA.exec(one); var last = out[out.length - 1].rows;
await dB.exec(sql('v55-83-UZ-elite-no-freight.sql')); await dB.exec(sql('v55-83-UZ-egypt-moustafa-cnf.sql'));
var sA = await state(dA), sB = await state(dB);
check('result table: 2 rows, both OK ("25 of 25", "6 of 6"), nothing listed as not done', last.length === 2 && last[0].result === 'OK' && last[0].done === '25 of 25' && last[0].not_done_yet === '' && last[1].result === 'OK' && last[1].done === '6 of 6' && last[1].not_done_yet === '', last);
check('same end state as the two reviewed files run separately: every typed figure, every customer basis, the same number of copies (25 + 6)', JSON.stringify(sA.est) === JSON.stringify(sB.est) && JSON.stringify(sA.terms) === JSON.stringify(sB.terms) && sA.b1 === 25 && sA.b2 === 6 && sB.b1 === 25 && sB.b2 === 6, [sA.b1, sA.b2, sB.b1, sB.b2]);
check('trucking 1,671.67 kept; another customer\'s release 1002-1160 keeps freight 723; SOMEBODY ELSE stays EXW; Moustafa Tosha EXW → CNF with EXW kept in the copy', sA.est.filter(function (r) { return r.release_key === '10021178' && r.part === 'trucking'; })[0].a === 1671.67 && sA.est.filter(function (r) { return r.release_key === '10021160'; })[0].a === 723 && sA.terms.filter(function (r) { return r.customer_id === OTHER; })[0].basis === 'EXW' && (await dA.query("select row_data->>'basis' b from hub_backup_uz_customer_terms where had_row")).rows[0].b === 'EXW');
await dA.exec(one); var sA2 = await state(dA);
check('run again: nothing changes, no second copy', JSON.stringify(sA2) === JSON.stringify(sA));
var priv = (await dA.query("select has_table_privilege('authenticated','public.hub_backup_uz_part_estimates','select') a, has_table_privilege('anon','public.hub_backup_uz_customer_terms','select') b")).rows[0];
check('both backup tables protected', priv.a === false && priv.b === false);

// ALL OR NOTHING — a guard of part B fails: part A must NOT have been written; and the other way round
async function stopped(db, mutate, rx) { var before = await state(db); await mutate(db); var b2 = await state(db); var msg = ''; try { await db.exec(one); } catch (e) { msg = String(e.message); } var after = await state(db); return { ok: /STOPPED/.test(msg) && (!rx || rx.test(msg)) && JSON.stringify(after) === JSON.stringify(b2), msg: msg, after: after }; }
var r1 = await stopped(await fresh(), async function (db) { await db.query("update accounting_customers set company_name = 'SAAD EGYPT LLC' where id = $1", [AP[3].id]); }, /5 found/);
check('a CNF customer was renamed (part B guard) → STOPPED and part A was NOT written either (Elite freight 1,672 still there, no zeros, no copies)', r1.ok && r1.after.est.filter(function (r) { return r.a === 0; }).length === 0 && r1.after.b1 === 0 && r1.after.b2 === 0, r1.msg);
var r2 = await stopped(await fresh(), async function (db) { await db.query("insert into accounting_invoices values ($1, 'X', $2, '2026-08-02', 1, 'active', 'USD', 'hub', null, $3, '1002-1183 / 1002-9999')", [U(), OTHER, KTC]); }, /10021183/);
check('another customer has an invoice on a listed Elite release (part A guard) → STOPPED naming it, and part B was NOT written (no customer set to CNF)', r2.ok && r2.after.terms.filter(function (r) { return r.basis === 'CNF'; }).length === 0, r2.msg);
var r3 = await stopped(await fresh(), async function (db) { await db.query("update accounting_customers set company_name = 'ELITE PAPER INC' where id = $1", [ELITE]); }, /ELITE PAPER/);
check('Elite renamed → STOPPED, nothing written', r3.ok && r3.after.terms.filter(function (r) { return r.basis === 'CNF'; }).length === 0);
var r4 = await stopped(await fresh(), async function (db) { await db.exec("update accounting_invoices set record_status = 'void' where release_number = '1002-1212'"); }, /10021212/);
check('a listed release has no live Elite invoice any more → STOPPED naming it', r4.ok);
var r5 = await stopped(await fresh(), async function (db) { await db.query('delete from accounting_customers where id = $1', [AP[5].id]); }, /5 found/);
check('a listed CNF customer no longer exists → STOPPED, nothing written', r5.ok);
// the result part by itself, on an untouched database, must run and say NOT DONE with the exact keys
var d9 = await fresh(); var only = (await d9.query(one.substring(one.indexOf('WITH listed(k)')))).rows;
check('the result part alone on an untouched database: runs, says NOT DONE, 0 of 25 / 0 of 6, and names what is missing', only.length === 2 && only[0].result !== 'OK' && only[0].done === '0 of 25' && only[0].not_done_yet.split(', ').length === 25 && only[1].done === '0 of 6' && only[1].not_done_yet.split(', ').length === 6, only);
console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
