// The read-only "which scripts are installed" check for Max, RUN on a real Postgres (PGlite). Codex 19 Nov 13:06 (P2): the UM row
// must not say RUN for an old / partial install. Fixtures: nothing installed, old UM without the check-only function, guard
// switched off, guard on the wrong table only, complete. Also: the two UZ data scripts flip their own rows. Needs PGLITE_DIR.
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
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 900))); }
function sql(f) { return fs.readFileSync(path.join(root, 'sql', f), 'utf8'); }
var q = sql('CHECK-which-scripts-are-installed-18-19-Nov.sql');
console.log('Installed-scripts check (real Postgres)');
check('the check only reads', !/\b(insert|update|delete|create|alter|drop|grant|truncate|revoke)\b/i.test(q.replace(/--.*$/gm, '').replace(/'[^']*'/g, "''")));
async function fresh() {
  var db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role;" +
    " create table public.plaid_accounts (id uuid, is_private boolean, balance numeric); grant select (id, is_private) on public.plaid_accounts to authenticated;" +
    " create table public.accounting_customers (id uuid primary key, company_name text, contact_name text, business_tag text);" +
    " create table public.accounting_invoices (id uuid primary key, invoice_number text, accounting_customer_id uuid, invoice_date date, total_amount numeric, record_status text, currency text, source text, wave_invoice_id text, wave_business_id text, release_number text);" +
    " create table public.accounting_proformas (id uuid primary key, record_status text);" +
    " create table public.accounting_invoice_items (id uuid primary key, invoice_id uuid, description text, quantity numeric, unit_price numeric, wave_product_name text);" +
    " create table public.vendor_bills (id uuid primary key, vendor_name text, bill_number text, bill_date date, total_amount numeric, record_status text, bill_type text, shipment_direction text, release_number text);");
  for (var f of ['v55-83-SY-profitability.sql', 'v55-83-TG2-invoice-shipping-terms.sql', 'v55-83-TL-trucking-freight.sql']) { await db.exec(sql(f)); }
  return db;
}
async function row(db, n) { return (await db.query(q)).rows.filter(function (x) { return x['#'] === n; })[0]; }
var LIFE = "create function public.hub_invoice_lifecycle(p jsonb) returns jsonb language sql as $f$ select '{}'::jsonb $f$;";
var CHK = "create function public.hub_invoice_lifecycle_check(p jsonb) returns jsonb language sql as $f$ select '{}'::jsonb $f$;";
var GUARDFN = "create function public.hub_guard_invoice_status() returns trigger language plpgsql as $f$ begin return new; end $f$;";
var TRG = "create trigger hub_guard_invoice_status before update on public.accounting_invoices for each row execute function public.hub_guard_invoice_status();";

var d0 = await fresh(); var r = await row(d0, 3);
check('UM — nothing installed → NOT RUN, "not installed"', r.status === 'NOT RUN' && /^not installed/.test(r.what_to_do), r);
var d1 = await fresh(); await d1.exec(LIFE + GUARDFN + TRG); r = await row(d1, 3);
check('UM — OLD copy (function + guard, NO check-only function: Codex reproduction) → NOT RUN, says older / partial', r.status === 'NOT RUN' && /OLDER \/ partial/.test(r.what_to_do), r);
var d2 = await fresh(); await d2.exec(LIFE + CHK + GUARDFN + TRG + " alter table public.accounting_invoices disable trigger hub_guard_invoice_status;"); r = await row(d2, 3);
check('UM — both functions but the guard is switched OFF → NOT RUN, says so', r.status === 'NOT RUN' && /switched OFF/.test(r.what_to_do), r);
var d3 = await fresh(); await d3.exec(LIFE + CHK + GUARDFN + " create trigger hub_guard_invoice_status before update on public.accounting_proformas for each row execute function public.hub_guard_invoice_status();"); r = await row(d3, 3);
check('UM — guard only on the proforma table, not on invoices → NOT RUN', r.status === 'NOT RUN' && /partly/.test(r.what_to_do), r);
var d4 = await fresh(); await d4.exec("create function public.hub_invoice_lifecycle(p text) returns jsonb language sql as $f$ select '{}'::jsonb $f$;" + CHK + GUARDFN + TRG); r = await row(d4, 3);
check('UM — a function with the right name but the WRONG signature (text) → NOT RUN', r.status === 'NOT RUN', r);
var d5 = await fresh(); await d5.exec(LIFE + CHK + GUARDFN + TRG); r = await row(d5, 3);
check('UM — complete → RUN', r.status === 'RUN' && r.what_to_do === '', r);

// the REAL UM file, when it loads on this fixture, must read as RUN (skipped honestly if the fixture lacks what it needs)
var d6 = await fresh(); var loaded = true;
try { await d6.exec(sql('v55-83-UM-invoice-delete.sql')); } catch (e) { loaded = false; console.log('  (the real UM file does not load on this small fixture: ' + String(e.message).substring(0, 90) + ' — its row is covered by the fixtures above)'); }
if (loaded) { r = await row(d6, 3); check('UM — the REAL sql/v55-83-UM-invoice-delete.sql installed → RUN', r.status === 'RUN', r); }

// rows 15 / 16 follow the two UZ data scripts
var d7 = await fresh();
check('before: KTC Egypt / Moustafa CNF and Elite freight both NOT RUN, with a count', (await row(d7, 15)).what_to_do === '0 of 6 customers set — run B2' && (await row(d7, 16)).what_to_do === '0 of 25 releases at 0 — run A2');
var ap = JSON.parse(sql('v55-83-UZ-approved-customers.json'));
for (var a of ap) { await d7.query('insert into accounting_customers (id, company_name) values ($1, $2)', [a.id, a.name]); }
await d7.exec(sql('v55-83-UZ-egypt-moustafa-cnf.sql'));
await d7.query("insert into accounting_customers (id, company_name) values ('1430a750-6d34-4609-8ed0-d4e5c5054a3c', 'ELITE PAPER')");
var keys = ['10011541', '10011627', '10021036', '10021059', '10021125', '10021129', '10021130', '10021133', '10021138', '10021144', '10021146', '10021152', '10021154', '10021168', '10021178', '10021183', '10021184', '10021188', '10021195', '10021202', '10021203', '10021204', '10021207', '10021211', '10021212'];
var n = 0; for (var k of keys) { n++; await d7.query("insert into accounting_invoices (id, invoice_number, accounting_customer_id, record_status, release_number) values ($1, $2, '1430a750-6d34-4609-8ed0-d4e5c5054a3c', 'active', $3)", ['00000000-0000-4000-8000-' + String(n).padStart(12, '0'), 'A' + n, k.substring(0, 4) + '-' + k.substring(4)]); }
await d7.exec(sql('v55-83-UZ-elite-no-freight.sql'));
check('after running the two real UZ files: both rows RUN', (await row(d7, 15)).status === 'RUN' && (await row(d7, 16)).status === 'RUN');
await d7.exec("update pl_release_part_estimates set amount = 1450 where release_key = '10021195' and part = 'freight'");
check('one Elite release put back to a figure (1002-1195) → NOT RUN, "24 of 25"', (await row(d7, 16)).what_to_do === '24 of 25 releases at 0 — run A2');
var all = (await d7.query(q)).rows;
check('16 rows, NOT RUN listed first', all.length === 16 && all.map(function (x) { return x.status; }).join(',').indexOf(',RUN,NOT RUN') < 0 && all[0].status === 'NOT RUN' && all[15].status === 'RUN', all.map(function (x) { return x.status; }));
console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
