// v55.83-ZD — REAL Postgres 16 proof of sql/v55-83-ZD-payroll-bills.sql (and its EMERGENCY ROLLBACK).
// Live shapes rebuilt: auth.users + users + module_permissions, the live hub_caller_profile / hub_caller_is_super_admin, the bill and
// wire tables with row security ON and their live "any signed-in person" policies, storage.objects with the bills-private rules.
// After the SQL, from the BROWSER role: a non-super-admin reads / writes no payroll bill, line, payment, event, Nextrade link, payroll
// repeating bill, no wire package that pays one (header, lines, files) and no payroll file in bills-private; everything else unchanged.
// The super admin and the server (service_role) see everything. Needs EMBEDDED_PG_DIR.
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
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 500))); }
console.log('ZD — payroll bills: super admin only (real Postgres)');
var SQL = fs.readFileSync(path.join(root, 'sql/v55-83-ZD-payroll-bills.sql'), 'utf8');
var ROLLBACK = fs.readFileSync(path.join(root, 'sql/v55-83-ZD-payroll-bills-EMERGENCY-ROLLBACK.sql'), 'utf8');
check('the SQL Max runs has no comment lines and is one transaction', !/^\s*--/m.test(SQL) && /^BEGIN;/.test(SQL.trim()) && /COMMIT;$/.test(SQL.trim()));
check('the SQL removes no data, no table, no column', !/DELETE\s+FROM|\bTRUNCATE\b|DROP\s+TABLE|ALTER\s+TABLE/i.test(SQL));

var SUP = '11111111-1111-4111-8111-111111111111', STAFF = '22222222-2222-4222-8222-222222222222';
var B1 = 'b1000000-0000-4000-8000-000000000001', B2 = 'b2000000-0000-4000-8000-000000000002', B3 = 'b3000000-0000-4000-8000-000000000003', B4 = 'b4000000-0000-4000-8000-000000000004', B5 = 'b5000000-0000-4000-8000-000000000005';
var P1 = 'f1000000-0000-4000-8000-000000000001', P2 = 'f2000000-0000-4000-8000-000000000002';
var dataDir = path.join(dir, 'data-zd-' + Date.now()); var port = 54000 + Math.floor(Math.random() * 900);
var server = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'test-only', port: port, persistent: false, initdbFlags: ['--encoding=UTF8', '--locale=C'] });
var db;
async function as(role, sub, sql) {
  await db.query('BEGIN');
  try {
    await db.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify(role === 'authenticated' ? { sub: sub, role: 'authenticated' } : { role: role })]);
    await db.query('SET LOCAL ROLE ' + role); var r = await db.query(sql); await db.query('ROLLBACK'); return { ok: true, rows: r.rows, count: r.rowCount };
  } catch (e) { await db.query('ROLLBACK'); return { ok: false, code: e.code, msg: e.message }; }
}
var T = ['vendor_bills', 'vendor_bill_lines', 'vendor_bill_payments', 'vendor_bill_events', 'company_bill_links', 'recurring_bills', 'wire_packages', 'wire_package_lines', 'wire_package_files'];
async function setup() {
  await db.query("DO $x$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF; END $x$");
  await db.query('GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role');
  await db.query('CREATE SCHEMA IF NOT EXISTS auth');
  await db.query("CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid $f$");
  await db.query('GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role');
  await db.query('CREATE TABLE auth.users (id uuid primary key, email text, email_confirmed_at timestamptz, deleted_at timestamptz, banned_until timestamptz, is_anonymous boolean default false)');
  await db.query('CREATE TABLE public.users (id uuid primary key, email text, name text, role text, active boolean)');
  await db.query("CREATE OR REPLACE FUNCTION public.bank_visibility_identity_map() RETURNS TABLE(profile_id uuid, auth_user_id uuid, name text, email text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $f$ with candidates as (select p.id as profile_id, a.id as auth_user_id, p.name::text as name, a.email::text as email, p.active as profile_active, count(*) over (partition by p.id) as profile_matches, count(*) over (partition by a.id) as auth_matches from public.users p join auth.users a on a.id = p.id or (a.email_confirmed_at is not null and nullif(btrim(a.email), '') is not null and lower(btrim(a.email)) = lower(btrim(p.email))) where a.deleted_at is null and (a.banned_until is null or a.banned_until <= now()) and coalesce((to_jsonb(a)->>'is_anonymous')::boolean, false) = false) select c.profile_id, c.auth_user_id, c.name, c.email from candidates c where c.profile_matches = 1 and c.auth_matches = 1 and c.profile_active is true; $f$");
  await db.query("CREATE OR REPLACE FUNCTION public.hub_caller_profile() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $f$ SELECT CASE WHEN count(*) = 1 THEN min(m.profile_id::text)::uuid END FROM public.bank_visibility_identity_map() m WHERE m.auth_user_id = auth.uid(); $f$");
  await db.query("CREATE OR REPLACE FUNCTION public.hub_caller_is_super_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $f$ SELECT EXISTS (SELECT 1 FROM public.users u WHERE u.id = public.hub_caller_profile() AND u.role = 'super_admin'); $f$");
  await db.query('GRANT EXECUTE ON FUNCTION public.hub_caller_profile(), public.hub_caller_is_super_admin() TO authenticated, service_role');
  await db.query('CREATE TABLE public.expense_categories (key text primary key, label text)');
  await db.query('CREATE TABLE public.company_categories (company_id text, key text, is_payroll boolean)');
  await db.query('CREATE TABLE public.vendor_bills (id uuid primary key, vendor_name text, category text, total_amount numeric, attachment_path text, validation_attachment_path text)');
  await db.query('CREATE TABLE public.vendor_bill_lines (id serial primary key, bill_id uuid, description text, amount numeric)');
  await db.query('CREATE TABLE public.vendor_bill_payments (id serial primary key, bill_id uuid, amount numeric)');
  await db.query('CREATE TABLE public.vendor_bill_events (id serial primary key, bill_id uuid, kind text)');
  await db.query('CREATE TABLE public.company_bill_links (id serial primary key, bill_id uuid, company_id text, category_key text, status text)');
  await db.query('CREATE TABLE public.recurring_bills (id serial primary key, vendor_name text, category text, amount numeric)');
  await db.query('CREATE TABLE public.wire_packages (id uuid primary key, payee_name text, approved_total numeric)');
  await db.query('CREATE TABLE public.wire_package_lines (id serial primary key, package_id uuid, bill_id uuid, amount numeric)');
  await db.query('CREATE TABLE public.wire_package_files (id serial primary key, package_id uuid, path text)');
  for (var i = 0; i < T.length; i++) {
    await db.query('ALTER TABLE public.' + T[i] + ' ENABLE ROW LEVEL SECURITY');
    await db.query('CREATE POLICY open_signed_in ON public.' + T[i] + ' FOR ALL TO authenticated USING (true) WITH CHECK (true)');
    await db.query('GRANT ALL ON TABLE public.' + T[i] + ' TO authenticated, service_role');
  }
  await db.query('GRANT SELECT ON public.expense_categories, public.company_categories TO authenticated, service_role');
  await db.query('GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role');
  // storage
  await db.query('CREATE SCHEMA storage'); await db.query('GRANT USAGE ON SCHEMA storage TO authenticated, service_role, anon');
  await db.query('CREATE TABLE storage.objects (id serial primary key, bucket_id text, name text)');
  await db.query('ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY');
  await db.query("CREATE POLICY bills_private_read ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'bills-private')");
  await db.query("CREATE POLICY other_read ON storage.objects FOR SELECT TO authenticated USING (bucket_id <> 'bills-private')");
  await db.query('GRANT SELECT ON storage.objects TO authenticated, service_role');
  // people
  await db.query("INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ('" + SUP + "', 's@x', now()), ('" + STAFF + "', 't@x', now())");
  await db.query("INSERT INTO public.users (id, email, name, role, active) VALUES ('" + SUP + "', 's@x', 'Owner', 'super_admin', true), ('" + STAFF + "', 't@x', 'Staff', 'admin', true)");
  // data: B1 vendor 'ADP Payroll'; B2 normal; B3 payroll by a LINE; B4 payroll by a Nextrade payroll LINK; B5 payroll by category LABEL
  await db.query("INSERT INTO public.expense_categories VALUES ('rent', 'Rent'), ('wages_k', 'Payroll taxes')");
  await db.query("INSERT INTO public.company_categories VALUES ('NEXTRADE_BOOKS', 'warehouse_staff', true), ('NEXTRADE_BOOKS', 'electricity', false)");
  await db.query("INSERT INTO public.vendor_bills VALUES ('" + B1 + "', 'ADP Payroll', 'rent', 4321.17, 'pv/b1.pdf', null), ('" + B2 + "', 'Acme Supplies', 'rent', 999.5, 'pv/b2.pdf', null), ('" + B3 + "', 'Acme Staffing', 'rent', 777.77, null, 'pv/b3v.pdf'), ('" + B4 + "', 'NextTrade Industries', null, 555.55, null, null), ('" + B5 + "', 'County', 'wages_k', 333.33, null, null)");
  await db.query("INSERT INTO public.vendor_bill_lines (bill_id, description, amount) VALUES ('" + B1 + "', 'Nov', 4321.17), ('" + B2 + "', 'Paper', 999.5), ('" + B3 + "', 'PAYROLL for November', 777.77)");
  await db.query("INSERT INTO public.vendor_bill_payments (bill_id, amount) VALUES ('" + B1 + "', 1000), ('" + B2 + "', 500)");
  await db.query("INSERT INTO public.vendor_bill_events (bill_id, kind) VALUES ('" + B1 + "', 'created'), ('" + B2 + "', 'created')");
  await db.query("INSERT INTO public.company_bill_links (bill_id, company_id, category_key, status) VALUES ('" + B4 + "', 'NEXTRADE_BOOKS', 'warehouse_staff', 'active'), ('" + B2 + "', 'NEXTRADE_BOOKS', 'electricity', 'active')");
  await db.query("INSERT INTO public.recurring_bills (vendor_name, category, amount) VALUES ('Gusto payroll', null, 9000), ('Landlord', 'rent', 3000), ('City Utilities', null, 120)");
  await db.query("INSERT INTO public.wire_packages VALUES ('" + P1 + "', 'Mixed wire', 5320.67), ('" + P2 + "', 'Acme only', 999.5)");
  await db.query("INSERT INTO public.wire_package_lines (package_id, bill_id, amount) VALUES ('" + P1 + "', '" + B1 + "', 4321.17), ('" + P1 + "', '" + B2 + "', 999.5), ('" + P2 + "', '" + B2 + "', 999.5)");
  await db.query("INSERT INTO public.wire_package_files (package_id, path) VALUES ('" + P1 + "', 'pv/w1.pdf'), ('" + P2 + "', 'pv/w2.pdf')");
  await db.query("INSERT INTO storage.objects (bucket_id, name) VALUES ('bills-private', 'pv/b1.pdf'), ('bills-private', 'pv/b2.pdf'), ('bills-private', 'pv/b3v.pdf'), ('bills-private', 'pv/w1.pdf'), ('bills-private', 'pv/w2.pdf'), ('logos', 'pv/b1.pdf')");
}
async function counts(role, sub) { var o = {}; for (var i = 0; i < T.length; i++) { var r = await as(role, sub, 'SELECT count(*)::int AS n FROM public.' + T[i]); o[T[i]] = r.ok ? r.rows[0].n : 'ERR ' + r.msg; } var s = await as(role, sub, "SELECT count(*)::int AS n FROM storage.objects WHERE bucket_id = 'bills-private'"); o.private_files = s.ok ? s.rows[0].n : 'ERR ' + s.msg; return o; }
var ALL = { vendor_bills: 5, vendor_bill_lines: 3, vendor_bill_payments: 2, vendor_bill_events: 2, company_bill_links: 2, recurring_bills: 3, wire_packages: 2, wire_package_lines: 3, wire_package_files: 2, private_files: 5 };
var STAFF_AFTER = { vendor_bills: 1, vendor_bill_lines: 1, vendor_bill_payments: 1, vendor_bill_events: 1, company_bill_links: 1, recurring_bills: 2, wire_packages: 1, wire_package_lines: 1, wire_package_files: 1, private_files: 2 };
function same(a, b) { return Object.keys(b).every(function (k) { return a[k] === b[k]; }); }

try {
  await server.initialise(); await server.start();
  db = new pg.Client({ host: 'localhost', port: port, user: 'postgres', password: 'test-only', database: 'postgres' }); await db.connect();
  await setup();
  var before = await counts('authenticated', STAFF);
  check('before: a non-super-admin (here an ADMIN) reads every bill, line, payment, wire and file (the gap)', same(before, ALL), before);
  await db.query('ALTER TABLE public.wire_package_files RENAME TO wire_package_files_x');
  var bad = await db.query(SQL).then(function () { return { ok: true }; }, function (e) { return { ok: false, msg: e.message }; });
  await db.query('ROLLBACK').catch(function () {});
  var pol0 = await db.query("SELECT count(*)::int AS n FROM pg_policies WHERE policyname LIKE 'hub_payroll%'");
  var fn0 = await db.query("SELECT count(*)::int AS n FROM pg_namespace WHERE nspname = 'hub_private'");
  check('a missing table: the SQL stops (Postgres refuses a function naming it, or HUB_GUARD) and NOTHING is changed — no rule, no schema', !bad.ok && /does not exist|HUB_GUARD/.test(bad.msg) && pol0.rows[0].n === 0 && fn0.rows[0].n === 0, { bad: bad, pol: pol0.rows[0].n, schema: fn0.rows[0].n });
  await db.query('ALTER TABLE public.wire_package_files_x RENAME TO wire_package_files');

  await db.query(SQL);
  var pol = await db.query("SELECT count(*)::int AS n FROM pg_policies WHERE policyname LIKE 'hub_payroll%' AND permissive = 'RESTRICTIVE'");
  check('installed: one RESTRICTIVE rule on each of the 9 tables + the file rule', pol.rows[0].n === 10, pol.rows[0]);
  var exposed = await db.query("SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE '%payroll%' AND p.proname <> 'hub_payroll_bills_guard_installed'");
  check('the helper functions live in hub_private (not the browser-reachable public schema); search_path pinned', exposed.rows[0].n === 0 && /SET search_path = ''/.test(SQL));
  var st = await counts('authenticated', STAFF);
  check('non-super-admin: payroll bills gone (by vendor, by a LINE, by a Nextrade payroll LINK, by category LABEL) — only the normal bill', same(st, STAFF_AFTER), st);
  var st2 = await as('authenticated', STAFF, 'SELECT vendor_name FROM public.vendor_bills');
  check('… the one bill left is the normal one', st2.ok && st2.count === 1 && st2.rows[0].vendor_name === 'Acme Supplies', st2);
  var wp = await as('authenticated', STAFF, 'SELECT payee_name, approved_total FROM public.wire_packages');
  check('the WHOLE wire package that pays a payroll bill is hidden (header and its total), the normal one stays', wp.ok && wp.count === 1 && wp.rows[0].payee_name === 'Acme only', wp);
  var wl = await as('authenticated', STAFF, "SELECT bill_id FROM public.wire_package_lines");
  check('… its lines are hidden too — even the NORMAL bill’s line on that package', wl.ok && wl.count === 1, wl);
  var fl = await as('authenticated', STAFF, "SELECT name FROM storage.objects WHERE bucket_id = 'bills-private' ORDER BY name");
  check('files: the payroll bill’s file, its validation file and the payroll wire’s file are hidden; the normal ones stay', fl.ok && fl.rows.map(function (r) { return r.name; }).join(',') === 'pv/b2.pdf,pv/w2.pdf', fl);
  var ob = await as('authenticated', STAFF, "SELECT count(*)::int AS n FROM storage.objects WHERE bucket_id = 'logos'");
  check('files in other buckets are not touched (same file name in another bucket still readable)', ob.ok && ob.rows[0].n === 1, ob);
  var up = await as('authenticated', STAFF, "UPDATE public.vendor_bills SET vendor_name = 'ADP' WHERE id = '" + B1 + "'");
  check('non-super-admin: cannot change a payroll bill (to take “payroll” out of its name) — nothing updated', up.ok && up.count === 0, up);
  var dl = await as('authenticated', STAFF, "DELETE FROM public.vendor_bill_lines WHERE bill_id = '" + B3 + "'");
  check('non-super-admin: cannot remove the “payroll” line that makes a bill payroll', dl.ok && dl.count === 0, dl);
  var ul = await as('authenticated', STAFF, "UPDATE public.company_bill_links SET status = 'voided' WHERE bill_id = '" + B4 + "'");
  check('non-super-admin: cannot unlink a bill from its Nextrade payroll category', ul.ok && ul.count === 0, ul);
  var ins = await as('authenticated', STAFF, "INSERT INTO public.wire_package_lines (package_id, bill_id, amount) VALUES ('" + P2 + "', '" + B1 + "', 1)");
  check('non-super-admin: cannot put a payroll bill on a wire', !ins.ok, ins);
  // Codex 25 Nov — an ordinary repeating bill with NO category stays visible (the rule answers false, never null)
  var rb = await as('authenticated', STAFF, "SELECT vendor_name FROM public.recurring_bills ORDER BY vendor_name");
  check('a normal repeating bill with no category (City Utilities) is still shown to a non-super-admin', rb.ok && rb.rows.map(function (r) { return r.vendor_name; }).join(',') === 'City Utilities,Landlord', rb);
  // Codex 25 Nov — WRITES are checked on the values being written: a non-super-admin cannot turn a bill INTO payroll either
  var t1 = await as('authenticated', STAFF, "INSERT INTO public.vendor_bills (id, vendor_name, category, total_amount) VALUES ('b6000000-0000-4000-8000-000000000006', 'Gusto Payroll', 'rent', 1)");
  var t2 = await as('authenticated', STAFF, "UPDATE public.vendor_bills SET vendor_name = 'Acme Payroll' WHERE id = '" + B2 + "'");
  var t3 = await as('authenticated', STAFF, "UPDATE public.vendor_bills SET category = 'wages_k' WHERE id = '" + B2 + "'");
  var t4 = await as('authenticated', STAFF, "INSERT INTO public.vendor_bill_lines (bill_id, description, amount) VALUES ('" + B2 + "', 'payroll Nov', 1)");
  var t5 = await as('authenticated', STAFF, "INSERT INTO public.company_bill_links (bill_id, company_id, category_key, status) VALUES ('" + B2 + "', 'NEXTRADE_BOOKS', 'warehouse_staff', 'active')");
  var t6 = await as('authenticated', STAFF, "UPDATE public.company_bill_links SET category_key = 'warehouse_staff' WHERE bill_id = '" + B2 + "'");
  var t7 = await as('authenticated', STAFF, "INSERT INTO public.recurring_bills (vendor_name, category, amount) VALUES ('ADP payroll', null, 1)");
  check('non-super-admin: cannot ADD a payroll bill, rename a bill to payroll, give it a payroll category (by its label), add a payroll line, link it to a Nextrade payroll category (new or changed link), or add a payroll repeating bill', [t1, t2, t3, t4, t5, t6, t7].every(function (t) { return !t.ok; }), [t1, t2, t3, t4, t5, t6, t7].map(function (t) { return t.ok ? 'ALLOWED' : 'refused'; }));
  var t8 = await as('authenticated', STAFF, "UPDATE public.vendor_bills SET total_amount = 1000 WHERE id = '" + B2 + "'");
  var t9 = await as('authenticated', STAFF, "INSERT INTO public.vendor_bill_lines (bill_id, description, amount) VALUES ('" + B2 + "', 'Toner', 1)");
  check('non-super-admin: ordinary changes to an ordinary bill still work (amount, a normal line)', t8.ok && t8.count === 1 && t9.ok && t9.count === 1, [t8, t9]);
  var s1 = await as('authenticated', SUP, "INSERT INTO public.vendor_bills (id, vendor_name, category, total_amount) VALUES ('b6000000-0000-4000-8000-000000000006', 'Gusto Payroll', 'rent', 1)");
  var s2 = await as('authenticated', SUP, "UPDATE public.vendor_bills SET vendor_name = 'ADP' WHERE id = '" + B1 + "'");
  check('super admin: may add a payroll bill and may take a bill out of payroll', s1.ok && s2.ok && s2.count === 1, [s1, s2]);
  var sp = await counts('authenticated', SUP);
  check('super admin: everything, unchanged', same(sp, ALL), sp);
  var sv = await counts('service_role', null);
  check('the server (service_role): everything (the server filters for the person itself)', same(sv, ALL), sv);
  var gi = await as('service_role', null, 'SELECT public.hub_payroll_bills_guard_installed() AS ok');
  check('the server can see that the database step is installed', gi.ok && gi.rows[0].ok === true, gi);
  var again = await db.query(SQL).then(function () { return true; }, function () { return false; });
  var pol2 = await db.query("SELECT count(*)::int AS n FROM pg_policies WHERE policyname LIKE 'hub_payroll%'");
  check('running the SQL twice is safe', again && pol2.rows[0].n === 10);
  await db.query(ROLLBACK);
  var rb = await counts('authenticated', STAFF);
  var pol3 = await db.query("SELECT count(*)::int AS n FROM pg_policies WHERE policyname LIKE 'hub_payroll%'");
  var other = await db.query("SELECT count(*)::int AS n FROM pg_policies WHERE policyname IN ('open_signed_in', 'bills_private_read', 'other_read')");
  check('EMERGENCY ROLLBACK: rules and functions gone, everything readable as before, the other rules untouched', pol3.rows[0].n === 0 && same(rb, ALL) && other.rows[0].n === T.length + 2, { rb: rb, other: other.rows[0] });
} catch (e) { failN++; console.log('  ✗ FAIL: test error ' + (e && e.stack)); }
finally { try { await db.end(); } catch (e) {} try { await server.stop(); } catch (e) {} }
console.log('\nZD SQL: ' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
