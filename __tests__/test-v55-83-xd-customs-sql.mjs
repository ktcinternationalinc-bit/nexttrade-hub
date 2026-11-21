// v55.83-XD — REAL Postgres (PGlite) proof of sql/v55-83-XD-customs-invoices.sql, run twice:
//  • two new tables, RLS on, closed to the browser roles (anon / authenticated): no read, no write, no step call; the Hub server role can
//  • make = paper + version 1 in ONE step (a bad version leaves nothing); save = a NEW version only on top of the newest one;
//    a voided paper cannot be saved again or voided twice; versions are never changed / deleted; a paper is never deleted
//  • ZERO effect: every invoice figure the reports use (totals, open balances per customer, sales per month, invoice numbers,
//    releases with / without an invoice, payments) is identical before and after customs papers are made, saved and voided;
//    an invoice can still be deleted exactly as before (no foreign key) and its customs paper stays on record
// Needs PGLITE_DIR (not a project dependency). Exit 2 = skipped, nothing checked.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
var here = path.dirname(fileURLToPath(import.meta.url)); var root = path.join(here, '..');
var req = createRequire(path.join(process.env.PGLITE_DIR || root, 'package.json'));
var PGlite;
try { PGlite = (await import('file://' + req.resolve('@electric-sql/pglite').replace(/\\/g, '/'))).PGlite; }
catch (e) { console.log('SKIPPED — @electric-sql/pglite not found (set PGLITE_DIR). Nothing was checked.'); process.exit(2); }
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra))); }
var db = new PGlite();
console.log('XD — customs invoices SQL (real Postgres)');
var text = fs.readFileSync(path.join(root, 'sql', 'v55-83-XD-customs-invoices.sql'), 'utf8');
check('the script has no comment lines', !/^\s*--/m.test(text) && text.indexOf('/*') < 0);
check('the script never drops a table, deletes rows or changes the invoice / line / payment tables', !/DROP TABLE|DELETE FROM|TRUNCATE TABLE|ALTER TABLE public\.accounting_invoice|UPDATE public\.accounting_invoice|INSERT INTO public\.accounting_invoice/i.test(text));
check('no foreign key to the invoice table', !/REFERENCES public\.accounting_invoices/i.test(text));
await db.exec(`
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  CREATE TABLE public.accounting_invoices (id uuid PRIMARY KEY, invoice_number text, invoice_date date, accounting_customer_id uuid, business_id uuid, total_amount numeric, amount_paid numeric, balance_due numeric, payment_status text, record_status text DEFAULT 'active', release_number text, currency text DEFAULT 'USD');
  CREATE TABLE public.accounting_invoice_items (id serial PRIMARY KEY, invoice_id uuid REFERENCES public.accounting_invoices(id) ON DELETE CASCADE, description text, quantity numeric, unit_price numeric, line_total numeric);
  CREATE TABLE public.accounting_invoice_payments (id serial PRIMARY KEY, accounting_invoice_id uuid, amount numeric, payment_date date, voided boolean DEFAULT false);
  CREATE SEQUENCE public.some_invoice_counter;
`);
var CA = '00000000-0000-0000-0000-0000000000c1', CB = '00000000-0000-0000-0000-0000000000c2', B1 = '00000000-0000-0000-0000-0000000000d1', B2 = '00000000-0000-0000-0000-0000000000d2';
var I1 = '00000000-0000-0000-0000-0000000000b1', I2 = '00000000-0000-0000-0000-0000000000b2', I3 = '00000000-0000-0000-0000-0000000000b3', I4 = '00000000-0000-0000-0000-0000000000b4', I5 = '00000000-0000-0000-0000-0000000000b5';
await db.query(`INSERT INTO public.accounting_invoices (id, invoice_number, invoice_date, accounting_customer_id, business_id, total_amount, amount_paid, balance_due, payment_status, record_status, release_number) VALUES
  ($1,'INV-100','2026-10-01',$6,$8,1200,0,1200,'unpaid','active','1002-111'),
  ($2,'INV-101','2026-10-05',$6,$8,2000,500,1500,'partial','active','1002-112'),
  ($3,'INV-102','2026-09-15',$6,$8,800,800,0,'paid','active',NULL),
  ($4,'INV-103','2026-09-20',$6,$8,300,0,300,'unpaid','void','1002-114'),
  ($5,'INV-100','2026-10-02',$7,$9,950,0,950,'unpaid','active','1001-115')`, [I1, I2, I3, I4, I5, CA, CB, B1, B2]);
await db.query(`INSERT INTO public.accounting_invoice_items (invoice_id, description, quantity, unit_price, line_total) VALUES ($1,'Kraft',1000,1.2,1200),($2,'Liner',4000,0.5,2000),($3,'Freight',1,800,800),($4,'Pallets',3,100,300),($5,'Sack',950,1,950)`, [I1, I2, I3, I4, I5]);
await db.query(`INSERT INTO public.accounting_invoice_payments (accounting_invoice_id, amount, payment_date) VALUES ($1,500,'2026-10-10'),($2,800,'2026-09-20')`, [I2, I3]);
await db.query("SELECT nextval('public.some_invoice_counter')");

for (var n = 1; n <= 2; n++) { var e = null; try { await db.exec(text); } catch (x) { e = String(x.message || x); } check('the script runs (time ' + n + ')', !e, e); }
async function q(sql, params) { try { var r = await db.query(sql, params || []); return { rows: r.rows, count: r.affectedRows }; } catch (x) { return { error: String(x.message || x) }; } }
async function as(role, sql, params) { await db.exec('SET ROLE ' + role); var r = await q(sql, params); await db.exec('RESET ROLE'); return r; }
var closing = text.substring(text.lastIndexOf('\nSELECT'));
var v = (await q(closing)).rows[0];
check('the closing check row says everything is in place', v && v.customs_table === 'OK' && v.versions_table === 'OK' && v.guards === 'OK' && v.steps === 'OK' && v.browser_access === 'OK closed to browsers', v);

// every invoice figure a report uses — taken before anything customs exists
var FIGURES = `SELECT json_build_object(
  'invoices', (SELECT json_agg(row_to_json(i) ORDER BY i.id) FROM public.accounting_invoices i),
  'items', (SELECT json_agg(row_to_json(x) ORDER BY x.id) FROM public.accounting_invoice_items x),
  'payments', (SELECT json_agg(row_to_json(p) ORDER BY p.id) FROM public.accounting_invoice_payments p),
  'total_live', (SELECT sum(total_amount) FROM public.accounting_invoices WHERE record_status = 'active'),
  'open_by_customer', (SELECT json_object_agg(c, o) FROM (SELECT i.accounting_customer_id AS c, sum(i.total_amount - coalesce((SELECT sum(amount) FROM public.accounting_invoice_payments p WHERE p.accounting_invoice_id = i.id AND NOT p.voided), 0)) AS o FROM public.accounting_invoices i WHERE i.record_status = 'active' GROUP BY 1) t),
  'sales_by_month', (SELECT json_object_agg(m, s) FROM (SELECT to_char(invoice_date, 'YYYY-MM') AS m, sum(total_amount) AS s FROM public.accounting_invoices WHERE record_status = 'active' GROUP BY 1) t),
  'numbers', (SELECT json_agg(invoice_number ORDER BY invoice_number) FROM public.accounting_invoices),
  'releases_no_invoice', (SELECT json_agg(r ORDER BY r) FROM unnest(ARRAY['1002-111','1002-112','1002-999','1001-115']) r WHERE NOT EXISTS (SELECT 1 FROM public.accounting_invoices i WHERE i.release_number = r AND i.record_status = 'active')),
  'counter', (SELECT last_value FROM public.some_invoice_counter),
  'invoice_tables', (SELECT json_agg(table_name ORDER BY table_name) FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'accounting_invoice%')
) AS f`;
var before = JSON.stringify((await q(FIGURES)).rows[0].f);

// ── the browser roles: nothing
for (var role of ['anon', 'authenticated']) {
  var r1 = await as(role, 'SELECT * FROM public.accounting_customs_invoices');
  var r2 = await as(role, 'SELECT * FROM public.accounting_customs_invoice_versions');
  var r3 = await as(role, "INSERT INTO public.accounting_customs_invoices (invoice_id, seq) VALUES ($1, 1)", [I1]);
  var r4 = await as(role, "SELECT public.hub_customs_invoice_create(jsonb_build_object('invoice_id', $1::text, 'doc', '{}'::jsonb))", [I1]);
  check(role + ' cannot read, write or call the customs steps', /permission denied/.test(r1.error || '') && /permission denied/.test(r2.error || '') && /permission denied/.test(r3.error || '') && /permission denied/.test(r4.error || ''), [r1.error, r2.error, r3.error, r4.error]);
}

// ── make / save / void as the Hub server
function mk(inv, num, price) { return as('service_role', "SELECT public.hub_customs_invoice_create($1::jsonb) AS r", [JSON.stringify({ invoice_id: inv, invoice_number: num, invoice_date: '2026-10-01', accounting_customer_id: CA, business_id: B1, doc: { printed_number: num, lines: [{ description: 'Kraft', quantity: 1000, unit_price: price, amount: 1000 * price }] }, total: 1000 * price, currency: 'USD', note: 'first', actor_id: CA, actor_name: 'Eddie' })]); }
var m1 = await mk(I1, 'INV-100', 0.4);
check('the server makes Customs #1 with version 1 in one step', !m1.error && m1.rows[0].r.seq === 1 && m1.rows[0].r.version === 1, m1);
var C1 = m1.rows[0].r.id;
var m2 = await mk(I1, 'INV-100', 0.5);
check('a second one under the same invoice = Customs #2', !m2.error && m2.rows[0].r.seq === 2, m2);
var m3 = await mk(I5, 'INV-100', 2);
check('another business invoice with the same number gets its own Customs #1 (no clash)', !m3.error && m3.rows[0].r.seq === 1, m3);
var m4 = await mk(I3, 'INV-102', 1);
var m5 = await mk(I2, 'INV-101', 1);
check('papers under the paid and the part-paid invoice', !m4.error && !m5.error);
var bad = await as('service_role', "SELECT public.hub_customs_invoice_create($1::jsonb)", [JSON.stringify({ invoice_id: I2, doc: [] })]);
var badCount = (await q('SELECT count(*)::int AS n FROM public.accounting_customs_invoices WHERE invoice_id = $1', [I2])).rows[0].n;
check('a make with no document is refused and leaves nothing behind', /HUB_INPUT/.test(bad.error || '') && badCount === 1, [bad, badCount]);
var badV = await as('service_role', "SELECT public.hub_customs_invoice_create($1::jsonb)", [JSON.stringify({ invoice_id: I4, doc: { a: 1 }, total: 'not a number' })]);
var badV2 = (await q('SELECT count(*)::int AS n FROM public.accounting_customs_invoices WHERE invoice_id = $1', [I4])).rows[0].n;
check('when version 1 cannot be written, the paper is not left behind either (one step: all or nothing)', !!badV.error && badV2 === 0, [badV, badV2]);
function sv(id, base, price) { return as('service_role', "SELECT public.hub_customs_invoice_save($1::jsonb) AS r", [JSON.stringify({ customs_invoice_id: id, base_version: base, doc: { printed_number: 'INV-100', lines: [{ description: 'Kraft', quantity: 1, unit_price: price }] }, total: price, currency: 'USD', actor_name: 'Ella' })]); }
var s2 = await sv(C1, 1, 9);
check('save on the newest version = version 2', !s2.error && s2.rows[0].r.version === 2, s2);
var s2b = await sv(C1, 1, 10);
check('save on an older version = refused (HUB_STALE), nothing added', /HUB_STALE/.test(s2b.error || '') && (await q('SELECT count(*)::int AS n FROM public.accounting_customs_invoice_versions WHERE customs_invoice_id = $1', [C1])).rows[0].n === 2, s2b);
var s3 = await sv(C1, 2, 11);
check('save on version 2 = version 3', !s3.error && s3.rows[0].r.version === 3, s3);
var vers = (await q('SELECT version, (doc->\'lines\'->0->>\'unit_price\') AS p FROM public.accounting_customs_invoice_versions WHERE customs_invoice_id = $1 ORDER BY version', [C1])).rows;
check('every version is kept with what it said', vers.length === 3 && vers[0].p === '0.4' && vers[1].p === '9' && vers[2].p === '11', vers);
var vd = await as('service_role', "SELECT public.hub_customs_invoice_void($1::jsonb) AS r", [JSON.stringify({ customs_invoice_id: m2.rows[0].r.id, reason: 'made in error', actor_name: 'Eddie' })]);
check('void works', !vd.error, vd);
var vd2 = await as('service_role', "SELECT public.hub_customs_invoice_void($1::jsonb)", [JSON.stringify({ customs_invoice_id: m2.rows[0].r.id, reason: 'again' })]);
check('void twice = refused', /HUB_VOIDED/.test(vd2.error || ''), vd2);
var sVoid = await sv(m2.rows[0].r.id, 1, 3);
check('a voided paper cannot be saved again', /HUB_VOIDED/.test(sVoid.error || ''), sVoid);
var nf = await sv('00000000-0000-0000-0000-00000000dead', 1, 3);
check('save on a paper that does not exist = HUB_NOT_FOUND', /HUB_NOT_FOUND/.test(nf.error || ''), nf);

// ── the guards (even the server role cannot rewrite history)
var g1 = await as('service_role', 'UPDATE public.accounting_customs_invoice_versions SET total = 1 WHERE customs_invoice_id = $1', [C1]);
var g2 = await as('service_role', 'DELETE FROM public.accounting_customs_invoice_versions WHERE customs_invoice_id = $1', [C1]);
var g3 = await as('service_role', 'DELETE FROM public.accounting_customs_invoices WHERE id = $1', [C1]);
var g4 = await q('TRUNCATE public.accounting_customs_invoice_versions');
var g5 = await q('TRUNCATE public.accounting_customs_invoices CASCADE');
check('a version cannot be changed, deleted or truncated; a paper cannot be deleted or truncated', [g1, g2, g3, g4, g5].every(function (x) { return /HUB_GUARD|permission denied/.test(x.error || ''); }), [g1.error, g2.error, g3.error, g4.error, g5.error]);
var g6 = await q("UPDATE public.accounting_customs_invoices SET invoice_id = $2, voided_at = now() WHERE id = $1", [C1, I2]);
check('what a paper is saved under cannot be changed (not even while voiding)', /HUB_GUARD/.test(g6.error || ''), g6);
var g7 = await q("UPDATE public.accounting_customs_invoices SET void_reason = 'x' WHERE id = $1", [C1]);
check('the only change allowed is voiding it', /HUB_GUARD/.test(g7.error || ''), g7);
var g8 = await q("UPDATE public.accounting_customs_invoices SET void_reason = 'changed' WHERE id = $1", [m2.rows[0].r.id]);
check('a voided paper is history: its void reason cannot be rewritten', /HUB_GUARD/.test(g8.error || ''), g8);

// ── ZERO effect on every invoice figure
var after = JSON.stringify((await q(FIGURES)).rows[0].f);
check('every invoice figure (rows, totals, open per customer, sales per month, numbers, releases without invoice, counters) is identical after customs papers were made, saved and voided', before === after, { before: before.substring(0, 300), after: after.substring(0, 300) });
// an invoice is deleted later: exactly as before (no foreign key), its customs paper stays
var del = await q('DELETE FROM public.accounting_invoices WHERE id = $1', [I3]);
check('a parent invoice can still be deleted exactly as before (no foreign key from customs)', !del.error && del.count === 1, del);
var keep = (await q('SELECT c.seq, c.invoice_number_at_creation, (SELECT count(*)::int FROM public.accounting_customs_invoice_versions v WHERE v.customs_invoice_id = c.id) AS n FROM public.accounting_customs_invoices c WHERE c.invoice_id = $1', [I3])).rows;
check('its customs paper stays on record with its version', keep.length === 1 && keep[0].invoice_number_at_creation === 'INV-102' && keep[0].n === 1, keep);
var vd3 = await q("UPDATE public.accounting_invoices SET record_status = 'void' WHERE id = $1", [I1]);
check('a parent invoice can still be voided exactly as before', !vd3.error && vd3.count === 1, vd3);

console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
