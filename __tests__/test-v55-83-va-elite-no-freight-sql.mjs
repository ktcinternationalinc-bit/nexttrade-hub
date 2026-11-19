// v55.83-VA — "remove freight from elite keep trucking and any surcharge" (Max, Nov 19 2026): the REAL sql file run on a real
// Postgres (PGlite) with the report's own table SQL, then read by the REAL engine. Never Supabase. Needs PGLITE_DIR.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';
var here = path.dirname(fileURLToPath(import.meta.url)); var root = path.join(here, '..');
var req = createRequire(path.join(process.env.PGLITE_DIR || root, 'package.json'));
var PGlite;
try { PGlite = (await import(pathToFileURL(req.resolve('@electric-sql/pglite')).href)).PGlite; }
catch (e) { console.log('SKIPPED — @electric-sql/pglite not found (set PGLITE_DIR). Nothing was checked.'); process.exit(2); }
var cjs = createRequire(import.meta.url);
cjs(path.join(root, 'node_modules/sucrase/register'));
var A = cjs(path.join(root, 'src/lib/profitability-assemble.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 1200))); }
function sql(f) { return fs.readFileSync(path.join(root, 'sql', f), 'utf8'); }
console.log('VA — Elite pays its own freight (real Postgres)');
var KTC = 'QnVzaW5lc3M6NWRkNzI3MDctOTExNC00NjQwLTg4MGQtMjYzNmI3YzM4YTdk';
var ELITE = '1430a750-6d34-4609-8ed0-d4e5c5054a3c'; var OTHER = '00000000-0000-4000-8000-00000000aaaa';
var KEYS = ['10011541', '10011627', '10021036', '10021059', '10021125', '10021129', '10021130', '10021133', '10021138', '10021144', '10021146', '10021152', '10021154', '10021168', '10021178', '10021183', '10021184', '10021188', '10021195', '10021202', '10021203', '10021204', '10021207', '10021211', '10021212'];
var full = sql('v55-83-VA-elite-no-freight.sql');
var i1 = full.indexOf('-- ── STEP 2'); var i2 = full.indexOf('-- ── STEP 3');
var step1 = full.substring(0, i1), step2 = full.substring(i1, i2), step3 = full.substring(i2);
check('the file names exactly the 25 releases, three times (preview, change, check), and no other release', KEYS.every(function (k) { return full.split("'" + k + "'").length === 4; }) && (full.match(/'100[0-9]{4,5}'/g) || []).length === 75);
check('no DELETE / DROP TABLE / TRUNCATE; the only tables written are pl_release_part_estimates and the backup', !/\b(delete\s+from|drop\s+table|truncate)\b/i.test(full) && (full.match(/INSERT INTO public\.(\w+)/g) || []).every(function (x) { return /pl_release_part_estimates|hub_backup_va_part_estimates/.test(x); }) && !/UPDATE public\./.test(full));
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
  await db.query('insert into accounting_customers (id, company_name) values ($1, $2), ($3, $4)', [ELITE, 'ELITE PAPER', OTHER, 'AL MOUSTAFA CO.']);
  for (var k of KEYS) {
    var id = U();
    await db.query("insert into accounting_invoices values ($1, $2, $3, '2026-08-01', 6549.2, 'active', 'USD', 'hub', null, $4, $5)", [id, 'AMERICA ' + k, ELITE, KTC, rel(k)]);
    await db.query('insert into accounting_invoice_items values ($1, $2, $3, 23.39, 280, null), ($4, $2, $5, 1, 150, null)', [U(), id, 'Paper per Ton', U(), 'Overweight surcharge']);
  }
  var oid = U();
  await db.query("insert into accounting_invoices values ($1, 'America 1749', $2, '2026-06-24', 31623.2, 'active', 'USD', 'hub', null, $3, '1002-1160')", [oid, OTHER, KTC]);
  await db.exec("insert into pl_name_units (name_key, raw_name, unit) values ('paper per ton', 'Paper per Ton', 't');" +
    " insert into pl_release_part_estimates (release_key, part, amount, note) values ('10021178', 'freight', 1672, 'MasterReport FF wire'), ('10021178', 'trucking', 1671.67, 'from Wires Sent.xlsx: AMB'), ('10021183', 'freight', 1450, 'MasterReport FF wire'), ('10021183', 'trucking', 1450, 'from Wires Sent.xlsx: AMB'), ('10021160', 'freight', 723, 'MasterReport FF wire'), ('10021160', 'trucking', 2150, 'from Wires Sent.xlsx: AMB');");
  return db;
}
var db = await fresh();
var before = JSON.stringify((await db.query('select * from pl_release_part_estimates order by release_key, part')).rows);
var p = (await db.query(step1)).rows[0].copy_this_cell_to_claude;
check('step 1 changes nothing', before === JSON.stringify((await db.query('select * from pl_release_part_estimates order by release_key, part')).rows));
check('preview: customer found; 25 releases; 1002-1178 shows freight 1,672 now and trucking 1,671.67 kept; nothing of another customer', p.customer.found_with_that_name === true && p.releases.length === 25 && p.releases.every(function (r) { return r.elite_invoices.length === 1 && r.invoices_of_other_customers === null && r.step2_does === 'freight becomes 0'; }) && Number(p.releases.filter(function (r) { return r.release_key === '10021178'; })[0].freight_typed_now) === 1672 && Number(p.releases.filter(function (r) { return r.release_key === '10021178'; })[0].trucking_typed_kept) === 1671.67, p.releases[14]);
await db.exec(step2);
var fr = (await db.query("select release_key, amount::float a from pl_release_part_estimates where part = 'freight' order by release_key")).rows;
check('step 2: freight is 0 on exactly the 25 Elite releases; 1002-1160 (another customer) keeps 723', fr.length === 26 && fr.filter(function (r) { return r.a === 0; }).length === 25 && fr.filter(function (r) { return r.release_key === '10021160'; })[0].a === 723, fr);
var tr = (await db.query("select release_key, amount::float a from pl_release_part_estimates where part = 'trucking' order by release_key")).rows;
check('trucking untouched (1,671.67 / 1,450 / 2,150) and none added', JSON.stringify(tr) === JSON.stringify([{ release_key: '10021160', a: 2150 }, { release_key: '10021178', a: 1671.67 }, { release_key: '10021183', a: 1450 }]), tr);
var bk = (await db.query('select release_key, had_row, row_data from hub_backup_va_part_estimates order by release_key')).rows;
check('copies saved first: 25, and the two that had a figure keep it (1,672 and 1,450)', bk.length === 25 && bk.filter(function (b) { return b.had_row; }).length === 2 && Number(bk.filter(function (b) { return b.release_key === '10021178'; })[0].row_data.amount) === 1672 && Number(bk.filter(function (b) { return b.release_key === '10021183'; })[0].row_data.amount) === 1450, bk.filter(function (b) { return b.had_row; }));
check('no invoice or invoice line touched', (await db.query('select count(*)::int n from accounting_invoices')).rows[0].n === 26 && (await db.query('select count(*)::int n from accounting_invoice_items')).rows[0].n === 50);
var priv = (await db.query("select has_table_privilege('authenticated','public.hub_backup_va_part_estimates','select') a, has_table_privilege('anon','public.hub_backup_va_part_estimates','select') b, (select relrowsecurity from pg_class where relname='hub_backup_va_part_estimates') c")).rows[0];
check('the backup table is protected', priv.a === false && priv.b === false && priv.c === true, priv);
await db.exec(step2);
check('run again: nothing changes, no second copy', (await db.query('select count(*)::int n from hub_backup_va_part_estimates')).rows[0].n === 25);
var s3 = (await db.query(step3)).rows;
check('step 3: 25 rows, all OK', s3.length === 25 && s3.every(function (r) { return r.result === 'OK'; }));
await db.exec(full);
check('the WHOLE file pasted at once runs too and changes nothing more', (await db.query('select count(*)::int n from hub_backup_va_part_estimates')).rows[0].n === 25);

// the REAL engine: 1002-1178 before = trucking 1,671.67 + freight 1,672; after = trucking only; the surcharge stays as shipping charged
async function engine(d) {
  var rows = async function (q) { return (await d.query(q)).rows; };
  var invs = (await rows('select * from accounting_invoices')).map(function (i) { i.invoice_date = new Date(i.invoice_date).toISOString().substring(0, 10); return i; });
  var items = (await rows('select * from accounting_invoice_items')).map(function (x) { x.quantity = Number(x.quantity); x.unit_price = Number(x.unit_price); return x; });
  var r = A.assembleProfitability({ date_from: '', date_to: '', windowDays: 90, warehouseOn: true, invoices: invs, items: items, customerNames: {}, nameUnits: await rows('select name_key, unit from pl_name_units'), bills: [], billLines: [],
    partEstimates: await rows('select release_key, part, amount, note from pl_release_part_estimates'),
    warehouseRows: [{ id: 'w1', section: 'main', superseded: false, conflict: false, flags: [], release_key: '10021146', cost_status: 'provisional', freight_used: 2050, freight_kind: 'estimate', trucking_used: 1450, trucking_kind: 'estimate', manual_freight: null, manual_trucking: null }] });
  return function (num) { return r.by_invoice.filter(function (x) { return x.label === num; })[0]; };
}
var b4 = await engine(await fresh()); var af = await engine(db);
check('engine BEFORE: 1002-1178 our shipping cost 3,343.67 (trucking 1,671.67 + "freight" 1,672)', b4('AMERICA 10021178').outbound_cost === 3343.67, b4('AMERICA 10021178'));
check('engine AFTER: 1002-1178 our shipping cost 1,671.67 = trucking only; freight 0', af('AMERICA 10021178').outbound_cost === 1671.67 && af('AMERICA 10021178').trucking_cost === 1671.67 && af('AMERICA 10021178').freight_cost === 0, af('AMERICA 10021178'));
check('engine AFTER: the $150 surcharge is still the shipping charged; goods revenue unchanged (6,549.20)', af('AMERICA 10021178').transport_revenue === 150 && af('AMERICA 10021178').goods_revenue === 6549.2 && b4('AMERICA 10021178').transport_revenue === 150);
check('engine: a Nextrade freight estimate (1002-1146: 2,050) is used BEFORE and replaced by the typed 0 AFTER — trucking 1,450 from Nextrade stays', b4('AMERICA 10021146').outbound_cost === 3500 && af('AMERICA 10021146').outbound_cost === 1450 && af('AMERICA 10021146').freight_cost === 0, [b4('AMERICA 10021146').outbound_cost, af('AMERICA 10021146')]);

// guards — each on a fresh database
var d2 = await fresh(); await d2.query("update accounting_customers set company_name = 'ELITE PAPER LLC' where id = $1", [ELITE]);
var stopped = false; try { await d2.exec(step2); } catch (e) { stopped = /STOPPED/.test(String(e.message)); }
check('the customer was renamed → STOPPED, nothing changed', stopped && (await d2.query("select amount::float a from pl_release_part_estimates where release_key = '10021178' and part = 'freight'")).rows[0].a === 1672);
var d3 = await fresh(); await d3.query("insert into accounting_invoices values ($1, 'SHARED 1', $2, '2026-08-02', 1, 'active', 'USD', 'hub', null, $3, '1002-1183 / 1002-9999')", [U(), OTHER, KTC]);
stopped = false; var msg = ''; try { await d3.exec(step2); } catch (e) { msg = String(e.message); stopped = /STOPPED/.test(msg) && /10021183/.test(msg); }
check('another customer now has an invoice on a listed release (1002-1183) → STOPPED naming it, nothing changed', stopped && (await d3.query("select amount::float a from pl_release_part_estimates where release_key = '10021183' and part = 'freight'")).rows[0].a === 1450, msg);
var d4 = await fresh(); await d4.exec("update accounting_invoices set record_status = 'void' where release_number = '1002-1212'");
stopped = false; try { await d4.exec(step2); } catch (e) { stopped = /STOPPED/.test(String(e.message)) && /10021212/.test(String(e.message)); }
check('a listed release no longer has a live Elite invoice → STOPPED naming it', stopped);
console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
