// v55.83-VA — the "KTC Egypt / Moustafa are CNF" SQL, RUN on a real Postgres (PGlite) with the report's own table SQL, then the
// result read by the REAL engine. Never Supabase. Needs PGLITE_DIR (a folder whose node_modules has @electric-sql/pglite).
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
var here = path.dirname(fileURLToPath(import.meta.url)); var root = path.join(here, '..');
var req = createRequire(path.join(process.env.PGLITE_DIR || root, 'package.json'));
var PGlite;
try { PGlite = (await import('file://' + req.resolve('@electric-sql/pglite').replace(/\\/g, '/'))).PGlite; }
catch (e) { console.log('SKIPPED — @electric-sql/pglite not found (set PGLITE_DIR). Nothing was checked.'); process.exit(2); }
var cjs = createRequire(import.meta.url);
cjs(path.join(root, 'node_modules/sucrase/register'));
var M = cjs(path.join(root, 'scripts/va-make-cnf-sql.js'));
var A = cjs(path.join(root, 'src/lib/profitability-assemble.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 1200))); }
function sql(f) { return fs.readFileSync(path.join(root, 'sql', f), 'utf8'); }
console.log('VA — KTC Egypt / Moustafa customers become CNF (real Postgres)');
var KTC = 'QnVzaW5lc3M6NWRkNzI3MDctOTExNC00NjQwLTg4MGQtMjYzNmI3YzM4YTdk';
var n = 0; function U() { n++; return '00000000-0000-4000-8000-' + String(n).padStart(12, '0'); }
var cEg = U(), cMou = U(), cOther = U(), cEg2 = U();
var iIn = U(), iFr = U(), iSur = U(), iOwn = U(), iHeld = U(), iNoRel = U(), iOther = U(), iVoid = U();
async function fresh() {
  var db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.accounting_customers (id uuid primary key, company_name text, contact_name text, business_tag text);
    create table public.accounting_invoices (id uuid primary key, invoice_number text, accounting_customer_id uuid, invoice_date date, total_amount numeric, record_status text, currency text, source text, wave_invoice_id text, wave_business_id text, release_number text);
    create table public.accounting_invoice_items (id uuid primary key, invoice_id uuid, description text, quantity numeric, unit_price numeric, wave_product_name text);
  `);
  for (var f of ['v55-83-SY-profitability.sql', 'v55-83-TG2-invoice-shipping-terms.sql']) { await db.exec(sql(f)); }
  await db.exec(`
    insert into accounting_customers values ('${cEg}','KTC EGYPT FOR IMPORT AND EXPORT',null,null), ('${cMou}',null,'Moustafa''s Trading',null), ('${cOther}','ELITE PAPER',null,null), ('${cEg2}','EGYPT SOMETHING NOT APPROVED',null,null);
    insert into accounting_invoices values
     ('${iIn}','AMERICA 1','${cEg}','2026-06-01',10000,'active','USD','wave_import','w','${KTC}','1002-2001'),
     ('${iFr}','AMERICA 2','${cEg}','2026-06-02',12000,'active','USD','wave_import','w','${KTC}','1002-2002'),
     ('${iSur}','AMERICA 3','${cMou}','2026-06-03',10150,'active','USD','wave_import','w','${KTC}','1002-2003'),
     ('${iOwn}','AMERICA 4','${cEg}','2026-06-04',10000,'active','USD','wave_import','w','${KTC}','1002-2004'),
     ('${iHeld}','AMERICA 5','${cEg}','2026-06-05',10000,'active','USD',null,null,null,'1002-2005'),
     ('${iNoRel}','AMERICA 1771','${cEg}','2026-06-06',10000,'active','USD','wave_import','w','${KTC}',null),
     ('${iOther}','ELITE 1','${cOther}','2026-06-07',10000,'active','USD','wave_import','w','${KTC}','1002-2007'),
     ('${iVoid}','AMERICA 9','${cEg}','2026-06-08',10000,'void','USD','wave_import','w','${KTC}','1002-2009');
    insert into accounting_invoice_items values
     ('${U()}','${iIn}','Stock lot',20000,0.5,null),
     ('${U()}','${iFr}','Stock lot',20000,0.5,null), ('${U()}','${iFr}','Ocean freight',1,2000,null),
     ('${U()}','${iSur}','Stock lot',20000,0.5,null), ('${U()}','${iSur}','Overweight surcharge',1,150,null),
     ('${U()}','${iOwn}','Stock lot',20000,0.5,null), ('${U()}','${iHeld}','Stock lot',20000,0.5,null), ('${U()}','${iNoRel}','Stock lot',20000,0.5,null), ('${U()}','${iOther}','Stock lot',20000,0.5,null);
    insert into pl_name_units (name_key, raw_name, unit) values ('stock lot','Stock lot','lb');
    insert into pl_invoice_terms (invoice_id, basis, shipping_terms) values ('${iOwn}','EXW','EXW');
    insert into pl_customer_terms (customer_id, customer_name, basis) values ('${cMou}','Moustafa''s Trading','EXW'), ('${cOther}','ELITE PAPER','EXW');
  `);
  return db;
}
var approved = [{ id: cEg, name: 'KTC EGYPT FOR IMPORT AND EXPORT' }, { id: cMou, name: "Moustafa's Trading" }];
var full = M.make(approved);
check('the written SQL has no template marker left and names both customers (apostrophe doubled)', full.indexOf('/*APPROVED*/') < 0 && full.indexOf("'Moustafa''s Trading'") > 0 && full.split(cEg).length === 4);
check('the generator refuses a bad id, an empty list, a missing name and a customer listed twice', [[{ id: 'x', name: 'a' }], [], [{ id: cEg, name: ' ' }], [approved[0], approved[0]]].every(function (bad) { try { M.make(bad); return false; } catch (e) { return true; } }));
check('no DELETE / DROP / TRUNCATE anywhere; the only tables written are pl_customer_terms and the backup', !/\b(delete\s+from|drop\s+table|truncate)\b/i.test(full) && (full.match(/INSERT INTO public\.(\w+)/g) || []).every(function (x) { return /pl_customer_terms|hub_backup_va_customer_terms/.test(x); }) && !/UPDATE public\./.test(full));
var i1 = full.indexOf('-- ── STEP 2'); var i2 = full.indexOf('-- ── STEP 3');
var step1 = full.substring(0, i1), step2 = full.substring(i1, i2), step3 = full.substring(i2);

var db = await fresh();
var before = JSON.stringify((await db.query('select * from pl_customer_terms order by customer_id')).rows);
var p = (await db.query(step1)).rows[0].copy_this_cell_to_claude;
check('step 1 changes nothing', before === JSON.stringify((await db.query('select * from pl_customer_terms order by customer_id')).rows));
function pv(num) { return p.invoices.filter(function (x) { return x.invoice_number === num; })[0]; }
check('preview: both customers found with the confirmed name; Moustafa shows usual basis EXW now', p.customers.length === 2 && p.customers.every(function (c) { return c.found_with_that_name === true; }) && p.customers.filter(function (c) { return c.id === cMou; })[0].usual_basis_now === 'EXW', p.customers);
check('preview: 6 live invoices of the two customers (void and other customers left out)', p.invoices.length === 6 && !pv('ELITE 1') && !pv('AMERICA 9'), p.invoices.map(function (x) { return x.invoice_number; }));
check('preview says: in the price / own line (real freight) / surcharge stays in the price / own setting kept / no company set / no release', /in the price — its share/.test(pv('AMERICA 1').after_the_change) && /own line/.test(pv('AMERICA 2').after_the_change) && /in the price — its share/.test(pv('AMERICA 3').after_the_change) && /keeps its own setting \(EXW\)/.test(pv('AMERICA 4').after_the_change) && pv('AMERICA 5').books === 'no company set' && /NO release number/.test(pv('AMERICA 1771').after_the_change), p.invoices);

await db.exec(step2);
var ct = (await db.query('select customer_id, basis, customer_name from pl_customer_terms order by customer_name')).rows;
check('step 2: exactly the two customers are CNF; Elite stays EXW; the unapproved "EGYPT SOMETHING" has no row', ct.length === 3 && ct.filter(function (r) { return r.basis === 'CNF'; }).length === 2 && ct.filter(function (r) { return r.customer_id === cOther; })[0].basis === 'EXW', ct);
var bk = (await db.query('select customer_id, had_row, row_data from hub_backup_va_customer_terms order by had_row')).rows;
check('copies saved first: KTC Egypt (had no row) and Moustafa (had EXW — kept in the copy)', bk.length === 2 && bk[0].had_row === false && bk[0].customer_id === cEg && bk[1].had_row === true && bk[1].row_data.basis === 'EXW', bk);
check('no invoice and no invoice setting was touched', (await db.query('select count(*)::int n from pl_invoice_terms')).rows[0].n === 1 && (await db.query("select count(*)::int n from accounting_invoices")).rows[0].n === 8);
var priv = (await db.query("select has_table_privilege('authenticated','public.hub_backup_va_customer_terms','select') a, has_table_privilege('anon','public.hub_backup_va_customer_terms','select') b, (select relrowsecurity from pg_class where relname='hub_backup_va_customer_terms') c")).rows[0];
check('the backup table is protected (row security on, no access for signed-in / anonymous users)', priv.a === false && priv.b === false && priv.c === true, priv);
await db.exec(step2);
check('run again: nothing changes and no second copy is saved', (await db.query('select count(*)::int n from hub_backup_va_customer_terms')).rows[0].n === 2 && (await db.query("select count(*)::int n from pl_customer_terms where basis='CNF'")).rows[0].n === 2);
var s3 = (await db.query(step3)).rows;
check('step 3: both customers show OK', s3.length === 2 && s3.every(function (r) { return r.result === 'OK' && r.usual_basis === 'CNF'; }), s3);
await db.exec(full);
check('the WHOLE file pasted at once runs too (and still changes nothing more)', (await db.query('select count(*)::int n from hub_backup_va_customer_terms')).rows[0].n === 2);

// guards — each on a fresh database
var d2 = await fresh(); await d2.exec("update accounting_customers set company_name = 'KTC EGYPT RENAMED' where id = '" + cEg + "'");
var stopped = false; try { await d2.exec(step2); } catch (e) { stopped = /STOPPED/.test(String(e.message)); }
check('a customer whose name changed since Max confirmed → STOPPED, nothing changed (Moustafa still EXW, no copies)', stopped && (await d2.query("select basis from pl_customer_terms where customer_id = '" + cMou + "'")).rows[0].basis === 'EXW' && (await d2.query("select count(*)::int n from pg_class where relname = 'hub_backup_va_customer_terms'")).rows[0].n === 0); // the whole paste rolled back, backup table included
var d3 = await fresh(); var missing = M.make([approved[0], { id: U(), name: 'GHOST' }]);
stopped = false; try { await d3.exec(missing.substring(missing.indexOf('-- ── STEP 2'), missing.indexOf('-- ── STEP 3'))); } catch (e) { stopped = /STOPPED/.test(String(e.message)); }
check('a listed customer that does not exist → STOPPED, nothing changed', stopped && (await d3.query("select count(*)::int n from pl_customer_terms where basis='CNF'")).rows[0].n === 0);

// the REAL engine on the changed data: container shipping bill $800 on every release
var rows = async function (q) { return (await db.query(q)).rows; };
var invs = (await rows('select * from accounting_invoices')).map(function (i) { i.invoice_date = new Date(i.invoice_date).toISOString().substring(0, 10); return i; }).filter(function (i) { return !!i.wave_business_id; });
var items = (await rows('select * from accounting_invoice_items')).map(function (x) { x.quantity = Number(x.quantity); x.unit_price = Number(x.unit_price); return x; });
var bills = ['1002-2001', '1002-2002', '1002-2003', '1002-2004', '1002-2007'].map(function (r, ix) { return { id: 'b' + ix, bill_number: 'T-' + ix, vendor_name: 'Trucker', bill_type: 'trucking', shipment_direction: 'outbound', release_number: r, total_amount: 800, record_status: 'active', bill_date: '2026-06-01' }; });
var rep = A.assembleProfitability({ date_from: '', date_to: '', windowDays: 90, warehouseOn: false, invoices: invs, items: items, customerNames: {}, customerTerms: await rows('select customer_id, customer_name, basis from pl_customer_terms'),
  terms: await rows('select invoice_id, basis, embedded_transport, shipping_terms, shipping_cost_estimate from pl_invoice_terms'), nameUnits: await rows('select name_key, unit from pl_name_units'), bills: bills, billLines: [], warehouseRows: [] });
function r(num) { return rep.by_invoice.filter(function (x) { return x.label === num; })[0]; }
check('engine — KTC Egypt, no shipping line: $800 comes out of the goods price (10,000 → 9,200), shipping charged 800, shipping profit 0', r('AMERICA 1').goods_revenue === 9200 && r('AMERICA 1').transport_revenue === 800 && r('AMERICA 1').transport_profit === 0, r('AMERICA 1'));
check('engine — KTC Egypt WITH an "Ocean freight" line: price stays goods only (10,000), shipping charged = the line (2,000)', r('AMERICA 2').goods_revenue === 10000 && r('AMERICA 2').transport_revenue === 2000, r('AMERICA 2'));
check('engine — Moustafa with a surcharge: still CNF in the price: goods 9,200, shipping charged 800 + 150', r('AMERICA 3').goods_revenue === 9200 && r('AMERICA 3').transport_revenue === 950, r('AMERICA 3'));
check('engine — the invoice a person set to EXW keeps EXW (goods 10,000)', r('AMERICA 4').invoice.basis === 'EXW' && r('AMERICA 4').goods_revenue === 10000, r('AMERICA 4').invoice);
check('engine — AMERICA 1771 (no release): CNF but nothing can be taken out; goods revenue not confirmed', r('AMERICA 1771').invoice.basis === 'CNF' && r('AMERICA 1771').unknown_fields.indexOf('outbound_cost') >= 0 && rep.cells.filter(function (c) { return c.invoice === 'AMERICA 1771'; })[0].goods_price_confirmed === false, r('AMERICA 1771'));
check('engine — Elite (not listed) is unchanged: EXW, goods 10,000', r('ELITE 1').invoice.basis === 'EXW' && r('ELITE 1').goods_revenue === 10000);
console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
