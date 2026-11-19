// v55.83-VA — the READ-ONLY query for Max's shipping questions, RUN on a real Postgres (PGlite) with the report's own table
// SQL, then its one JSON is fed to the REAL engine (scripts/va-explain-shipping.js). Never Supabase.
// Needs @electric-sql/pglite: set PGLITE_DIR to a folder whose node_modules has it (it is NOT a project dependency).
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
var X = cjs(path.join(root, 'scripts/va-explain-shipping.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 1200))); }
function sql(f) { return fs.readFileSync(path.join(root, 'sql', f), 'utf8'); }
console.log('VA — read-only shipping questions query (real Postgres)');
var KTC = 'QnVzaW5lc3M6NWRkNzI3MDctOTExNC00NjQwLTg4MGQtMjYzNmI3YzM4YTdk';
var db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create table public.accounting_customers (id uuid primary key, company_name text, contact_name text, business_tag text);
  create table public.accounting_invoices (id uuid primary key, invoice_number text, accounting_customer_id uuid, invoice_date date, total_amount numeric, record_status text, currency text, source text, wave_invoice_id text, wave_business_id text, release_number text);
  create table public.accounting_invoice_items (id uuid primary key, invoice_id uuid, description text, quantity numeric, unit_price numeric, wave_product_name text);
  create table public.vendor_bills (id uuid primary key, vendor_name text, bill_number text, bill_date date, total_amount numeric, record_status text, bill_type text, shipment_direction text, release_number text);
`);
for (var f of ['v55-83-SY-profitability.sql', 'v55-83-TG-warehouse-shipping.sql', 'v55-83-TG2-invoice-shipping-terms.sql', 'v55-83-TL-trucking-freight.sql']) { await db.exec(sql(f)); }
var n = 0; function U() { n++; return '00000000-0000-4000-8000-' + String(n).padStart(12, '0'); }
var cFadi = U(), cEg = U(), cElite = U(), cMou = U(), cOther = U();
var iFadi = U(), iEg = U(), i1160 = U(), i1158 = U(), iElite = U(), iShare = U(), iOther = U(), iEgOther = U();
await db.exec(`
  insert into accounting_customers values ('${cFadi}','FADI TRADING',null,null), ('${cEg}','KTC EGYPT FOR IMPORT AND EXPORT',null,null), ('${cElite}','ELITE PAPER',null,null), ('${cMou}',null,'Moustafa Ali',null), ('${cOther}','SOMEBODY ELSE',null,null);
  insert into accounting_invoices values
   ('${iFadi}','FADI 2001','${cFadi}','2026-07-01',10000,'active','USD','wave_import','w1','${KTC}','1002-1164'),
   ('${iEg}','AMERICA 1771','${cEg}','2026-06-20',20000,'active','USD','wave_import','w2','${KTC}',null),
   ('${i1160}','AMERICA 1780','${cEg}','2026-06-26',30000,'active','USD','wave_import','w3','${KTC}','1002-1160'),
   ('${i1158}','AMERICA 1779','${cEg}','2026-06-26',30000,'active','USD','wave_import','w4','${KTC}','1002-1158 / 1002-1160'),
   ('${iElite}','ELITE 500','${cElite}','2026-08-01',5000,'active','USD','wave_import','w5','${KTC}','1002-1200'),
   ('${iShare}','OTHER 9','${cOther}','2026-08-01',5000,'active','USD','wave_import','w6','${KTC}','1002-1200'),
   ('${iOther}','UNRELATED 1','${cOther}','2026-08-02',5000,'active','USD','wave_import','w7','${KTC}','1002-4444'),
   ('${iEgOther}','EG-LOCAL 1','${cEg}','2026-08-02',5000,'active','USD',null,null,null,null);
  insert into accounting_invoice_items values
   ('${U()}','${iFadi}','Stock lot fabric',40000,0.25,null),
   ('${U()}','${iEg}','Stock lot fabric',40000,0.5,null),
   ('${U()}','${i1160}','Stock lot fabric',30000,1,null),
   ('${U()}','${i1158}','Stock lot fabric',30000,1,null),
   ('${U()}','${iElite}','desc','10000',0.4,'Paper rolls'), ('${U()}','${iElite}',null,1,150,'Overweight surcharge'),
   ('${U()}','${iShare}','Paper rolls',30000,0.1,null),
   ('${U()}','${iOther}','FOAM laminated velvet',100,3,null), ('${U()}','${iOther}','with foam backing',50,3,'Laminated Fabric');
  insert into pl_name_units (name_key, raw_name, unit) values ('stock lot fabric','Stock lot fabric','lb'), ('paper rolls','Paper rolls','lb'), ('foam laminated velvet','FOAM laminated velvet','yd'), ('zzz not asked','zzz','lb');
  insert into pl_customer_terms (customer_id, customer_name, basis) values ('${cFadi}','FADI TRADING','EXW');
  insert into pl_release_part_estimates (release_key, part, amount, note) values ('10021164','trucking',2126.67,'from Wires Sent.xlsx: AMB () 2126.67'), ('10021160','trucking',2150,'from Wires Sent.xlsx: AMB () 2150'), ('10024444','trucking',1,'unrelated');
  insert into vendor_bills values ('${U()}','ONTREK','IN-12958','2026-09-22',723,'active','shipping','outbound','1002-1160'),
   ('${U()}','ELITE TRUCKER','T-1','2026-08-01',1000,'active','trucking','outbound','1002-1200'), ('${U()}','X','T-2','2026-08-01',5,'active','trucking','outbound','1002-4444');
`);
var q = sql('v55-83-VA-readonly-shipping-questions.sql');
check('the query only reads (no insert / update / delete / create / alter / drop / grant / truncate)', !/\b(insert|update|delete|create|alter|drop|grant|truncate|revoke)\b/i.test(q.replace(/--.*$/gm, '')));
var before = (await db.query("select (select count(*) from accounting_invoices)::int a, (select count(*) from pl_release_part_estimates)::int b")).rows[0];
var res = await db.query(q);
check('ONE row with ONE cell', res.rows.length === 1 && Object.keys(res.rows[0]).length === 1 && !!res.rows[0].copy_this_cell_to_claude);
var j = res.rows[0].copy_this_cell_to_claude;
var after = (await db.query("select (select count(*) from accounting_invoices)::int a, (select count(*) from pl_release_part_estimates)::int b")).rows[0];
check('nothing changed in the database', before.a === after.a && before.b === after.b);
var nums = j.invoices.map(function (i) { return i.invoice_number; }).sort();
check('brings 1002-1164, AMERICA 1771, both 1002-1160 invoices, Elite + the invoice sharing its release; not the unrelated one', JSON.stringify(nums) === JSON.stringify(['AMERICA 1771', 'AMERICA 1779', 'AMERICA 1780', 'ELITE 500', 'FADI 2001', 'OTHER 9']), nums);
check('a release written as "1002-1158 / 1002-1160" is read as two releases', j.release_keys.indexOf('10021158') >= 0 && j.release_keys.indexOf('10021160') >= 0 && j.release_keys.indexOf('10021200') >= 0 && j.release_keys.indexOf('10024444') < 0, j.release_keys);
check('estimates and bills only for the releases asked about', j.partEstimates.length === 2 && j.bills.length === 2, [j.partEstimates, j.bills]);
check('units only for the names on those invoices', j.nameUnits.length === 2, j.nameUnits);
var eg = j.egypt_moustafa_customers;
check('question 3: lists KTC EGYPT (3 in KTC books, 1 with no company set) and Moustafa (0 invoices); nobody else', eg.length === 2 && eg[0].name === 'KTC EGYPT FOR IMPORT AND EXPORT' && Number(eg[0].invoices) === 4 && Number(eg[0].in_ktc_books) === 3 && Number(eg[0].no_company_set) === 1 && eg[1].name === 'Moustafa Ali' && Number(eg[1].invoices) === 0, eg);
check('question 1: both foam lines are listed, with the unit of the name and "foam only in the description"', j.foam_lines.length === 2 && j.foam_lines.some(function (x) { return x.name === 'FOAM laminated velvet' && x.unit_of_name === 'yd' && x.foam_only_in_description === false; }) && j.foam_lines.some(function (x) { return x.name === 'Laminated Fabric' && x.foam_only_in_description === true; }), j.foam_lines);

// the same JSON through the REAL engine
var e = X.explain(JSON.parse(JSON.stringify(j)));
function row(nm) { return e.rows.filter(function (r) { return r.invoice === nm; })[0]; }
check('1002-1164 (Fadi, EXW): our cost $2,126.67 = the trucking figure imported from Wires Sent; nothing charged to him', row('FADI 2001').our_shipping_cost === 2126.67 && row('FADI 2001').shipping_charged === 0 && /Wires Sent/.test(row('FADI 2001').cost_from.join(' ')) && row('FADI 2001').basis === 'EXW' && row('FADI 2001').basis_from === 'customer', row('FADI 2001'));
check('AMERICA 1771: no release → release_missing, shipping cost unknown', row('AMERICA 1771').releases.length === 0 && row('AMERICA 1771').our_cost_unknown === true && row('AMERICA 1771').flags.indexOf('release_missing') >= 0, row('AMERICA 1771'));
check('1002-1160: freight bill IN-12958 $723 + typed trucking $2,150 are both named as the sources', /IN-12958/.test(row('AMERICA 1780').cost_from.join(' ')) && /Wires Sent/.test(row('AMERICA 1780').cost_from.join(' ')), row('AMERICA 1780'));
check('Elite: the surcharge line is the shipping charged; the container bill T-1 is split by pounds with the other invoice (10,000 : 30,000 → $250)', row('ELITE 500').shipping_charged === 150 && row('ELITE 500').our_shipping_cost === 250 && /T-1/.test(row('ELITE 500').cost_from.join(' ')), row('ELITE 500'));
console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
