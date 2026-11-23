// v55.83-XK — REAL Postgres 16 proof of sql/v55-83-XK-revenue-researcher.sql (and its EMERGENCY ROLLBACK).
// The live shape is rebuilt: auth.users + public.users + module_permissions, the live hub_caller_profile /
// hub_caller_is_super_admin, and the 14 sales tables with row security ON and their live "any signed-in person" policies.
// After the SQL: a revenue researcher (pnl.view_revenue OFF) reads and writes NO row of any of them, from the browser role;
// everybody else, the super admin and the server (service_role) are unchanged. A sign-in that matches two profiles, one of
// them a researcher, is hidden too (fails closed). A missing table stops the SQL with nothing changed. Needs EMBEDDED_PG_DIR.
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
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 400))); }
console.log('XK — revenue researcher, real Postgres');
var SQL = fs.readFileSync(path.join(root, 'sql/v55-83-XK-revenue-researcher.sql'), 'utf8');
var ROLLBACK = fs.readFileSync(path.join(root, 'sql/v55-83-XK-revenue-researcher-EMERGENCY-ROLLBACK.sql'), 'utf8');
check('the SQL Max runs has no comment lines and is one transaction', !/^\s*--/m.test(SQL) && /^BEGIN;/.test(SQL.trim()) && /COMMIT;$/.test(SQL.trim()));
check('the SQL removes no data, no table, no column (no DELETE / TRUNCATE / DROP TABLE / ALTER TABLE)', !/DELETE\s+FROM|\bTRUNCATE\b|DROP\s+TABLE|ALTER\s+TABLE/i.test(SQL));
var TABLES = ['accounting_invoices', 'accounting_invoice_items', 'accounting_invoice_payments', 'accounting_proformas', 'accounting_proforma_items', 'invoice_items', 'invoices', 'checks', 'customer_credits', 'open_account_invoices', 'open_account_invoice_items', 'open_account_entries', 'inventory_movements', 'inventory_layers'];
check('rollback lists the same tables', TABLES.every(function (t) { return ROLLBACK.indexOf("'" + t + "'") >= 0 && SQL.indexOf("'" + t + "'") >= 0; }));

var RES = '11111111-1111-4111-8111-111111111111', HOLD = '22222222-2222-4222-8222-222222222222', SUP = '33333333-3333-4333-8333-333333333333';
var TWIN_A = '44444444-4444-4444-8444-444444444444', TWIN_B = '55555555-5555-4555-8555-555555555555', TWIN_AUTH = '66666666-6666-4666-8666-666666666666';
var dataDir = path.join(dir, 'data-xk-' + Date.now()); var port = 54000 + Math.floor(Math.random() * 900);
var server = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'test-only', port: port, persistent: false, initdbFlags: ['--encoding=UTF8', '--locale=C'] });
var db;
async function as(role, sub, sql) {
  await db.query('BEGIN');
  try {
    await db.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify(role === 'authenticated' ? { sub: sub, role: 'authenticated' } : { role: role })]);
    await db.query('SET LOCAL ROLE ' + role); var r = await db.query(sql); await db.query('ROLLBACK'); return { ok: true, rows: r.rows, count: r.rowCount };
  } catch (e) { await db.query('ROLLBACK'); return { ok: false, code: e.code, msg: e.message }; }
}
async function setup() {
  await db.query("DO $x$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF; END $x$");
  await db.query('GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role');
  await db.query('CREATE SCHEMA IF NOT EXISTS auth');
  await db.query("CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid $f$");
  await db.query('GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role');
  await db.query('CREATE TABLE auth.users (id uuid primary key, email text, email_confirmed_at timestamptz, deleted_at timestamptz, banned_until timestamptz, is_anonymous boolean default false)');
  await db.query('CREATE TABLE public.users (id uuid primary key, email text, name text, role text, active boolean)');
  await db.query('CREATE TABLE public.module_permissions (id serial primary key, user_id uuid, module_name text, has_access boolean)');
  // live functions (definitions read from the live database, 23 Nov)
  await db.query("CREATE OR REPLACE FUNCTION public.bank_visibility_identity_map() RETURNS TABLE(profile_id uuid, auth_user_id uuid, name text, email text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $f$ with candidates as (select p.id as profile_id, a.id as auth_user_id, p.name::text as name, a.email::text as email, p.active as profile_active, count(*) over (partition by p.id) as profile_matches, count(*) over (partition by a.id) as auth_matches from public.users p join auth.users a on a.id = p.id or (a.email_confirmed_at is not null and nullif(btrim(a.email), '') is not null and lower(btrim(a.email)) = lower(btrim(p.email))) where a.deleted_at is null and (a.banned_until is null or a.banned_until <= now()) and coalesce((to_jsonb(a)->>'is_anonymous')::boolean, false) = false) select c.profile_id, c.auth_user_id, c.name, c.email from candidates c where c.profile_matches = 1 and c.auth_matches = 1 and c.profile_active is true; $f$");
  await db.query("CREATE OR REPLACE FUNCTION public.hub_caller_profile() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $f$ SELECT CASE WHEN count(*) = 1 THEN min(m.profile_id::text)::uuid END FROM public.bank_visibility_identity_map() m WHERE m.auth_user_id = auth.uid(); $f$");
  await db.query("CREATE OR REPLACE FUNCTION public.hub_caller_is_super_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $f$ SELECT EXISTS (SELECT 1 FROM public.users u WHERE u.id = public.hub_caller_profile() AND u.role = 'super_admin'); $f$");
  await db.query('GRANT EXECUTE ON FUNCTION public.hub_caller_profile(), public.hub_caller_is_super_admin() TO authenticated, service_role');
  for (var i = 0; i < TABLES.length; i++) {
    var t = TABLES[i];
    await db.query('CREATE TABLE public.' + t + ' (id serial primary key, amount numeric)');
    await db.query('ALTER TABLE public.' + t + ' ENABLE ROW LEVEL SECURITY');
    await db.query('CREATE POLICY open_signed_in ON public.' + t + ' FOR ALL TO authenticated USING (true) WITH CHECK (true)');
    await db.query('GRANT ALL ON TABLE public.' + t + ' TO authenticated, service_role');
    await db.query('INSERT INTO public.' + t + ' (amount) VALUES (4321.17), (999.5)');
  }
  await db.query('GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role');
  await db.query("INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ('" + RES + "', 'res@x', now()), ('" + HOLD + "', 'hold@x', now()), ('" + SUP + "', 'sup@x', now()), ('" + TWIN_AUTH + "', 'twin@x', now())");
  await db.query("INSERT INTO public.users (id, email, name, role, active) VALUES ('" + RES + "', 'res@x', 'Researcher', 'team', true), ('" + HOLD + "', 'hold@x', 'Holder', 'team', true), ('" + SUP + "', 'sup@x', 'Owner', 'super_admin', true), ('" + TWIN_A + "', 'twin@x', 'Twin A', 'team', true), ('" + TWIN_B + "', 'TWIN@x ', 'Twin B', 'team', true)");
  await db.query("INSERT INTO public.module_permissions (user_id, module_name, has_access) VALUES ('" + RES + "', 'pnl.view', true), ('" + RES + "', 'pnl.view_revenue', false), ('" + HOLD + "', 'pnl.view', true), ('" + SUP + "', 'pnl.view_revenue', false), ('" + TWIN_B + "', 'pnl.view_revenue', false)");
}
async function rowsEverywhere(role, sub) { var n = {}; for (var i = 0; i < TABLES.length; i++) { var r = await as(role, sub, 'SELECT count(*)::int AS n FROM public.' + TABLES[i]); n[TABLES[i]] = r.ok ? r.rows[0].n : 'ERR ' + r.msg; } return n; }
function all(n, v) { return Object.keys(n).every(function (k) { return n[k] === v; }); }

try {
  await server.initialise(); await server.start();
  db = new pg.Client({ host: 'localhost', port: port, user: 'postgres', password: 'test-only', database: 'postgres' }); await db.connect();
  await setup();
  var before = await rowsEverywhere('authenticated', RES);
  check('before: the researcher reads every sales table (that is the gap)', all(before, 2), before);

  // a missing table stops everything
  await db.query('ALTER TABLE public.checks RENAME TO checks_x');
  var bad = await db.query(SQL).then(function () { return { ok: true }; }, function (e) { return { ok: false, msg: e.message }; });
  await db.query('ROLLBACK').catch(function () {});
  var pol0 = await db.query("SELECT count(*)::int AS n FROM pg_policies WHERE policyname = 'hub_revenue_researcher'");
  var fn0 = await db.query("SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'hub_revenue_guard_installed'");
  check('a missing table: the SQL stops with HUB_GUARD and NOTHING is changed (no rule, no function)', !bad.ok && /HUB_GUARD/.test(bad.msg) && pol0.rows[0].n === 0 && fn0.rows[0].n === 0, { bad: bad, pol: pol0.rows[0].n, fn: fn0.rows[0].n });
  await db.query('ALTER TABLE public.checks_x RENAME TO checks');

  await db.query(SQL);
  var pol = await db.query("SELECT count(*)::int AS n FROM pg_policies WHERE policyname = 'hub_revenue_researcher' AND permissive = 'RESTRICTIVE'");
  check('installed: one RESTRICTIVE rule on each of the ' + TABLES.length + ' tables', pol.rows[0].n === TABLES.length, pol.rows[0]);
  var gi = await as('service_role', null, 'SELECT public.hub_revenue_guard_installed() AS ok');
  check('the server can see that the database step is installed', gi.ok && gi.rows[0].ok === true, gi);

  var r1 = await rowsEverywhere('authenticated', RES);
  check('researcher: NO row of any sales table', all(r1, 0), r1);
  var w1 = await as('authenticated', RES, 'INSERT INTO public.accounting_invoices (amount) VALUES (1)');
  check('researcher: cannot add an invoice either', !w1.ok, w1);
  var u1 = await as('authenticated', RES, 'UPDATE public.invoice_items SET amount = 0');
  check('researcher: an update touches nothing', u1.ok && u1.count === 0, u1);
  var h1 = await rowsEverywhere('authenticated', HOLD);
  check('ordinary person (revenue ON by default): every row, unchanged', all(h1, 2), h1);
  var hw = await as('authenticated', HOLD, 'INSERT INTO public.accounting_invoices (amount) VALUES (1)');
  check('ordinary person: still adds an invoice', hw.ok && hw.count === 1, hw);
  var s1 = await rowsEverywhere('authenticated', SUP);
  check('super admin (even with an OFF row): every row', all(s1, 2), s1);
  var tw = await rowsEverywhere('authenticated', TWIN_AUTH);
  check('a sign-in matching TWO profiles, one a researcher: hidden (fails closed)', all(tw, 0), tw);
  var sv = await rowsEverywhere('service_role', null);
  check('the server (service_role): every row', all(sv, 2), sv);
  var an = await as('authenticated', null, 'SELECT count(*)::int AS n FROM public.invoices');
  check('a signed-in session with no matching profile: unchanged (cannot be a researcher)', an.ok && an.rows[0].n === 2, an);

  // switching revenue back ON gives the rows back at once
  await db.query("UPDATE public.module_permissions SET has_access = true WHERE user_id = '" + RES + "' AND module_name = 'pnl.view_revenue'");
  var r2 = await rowsEverywhere('authenticated', RES);
  check('revenue switched back ON: the researcher reads again', all(r2, 2), r2);
  await db.query("UPDATE public.module_permissions SET has_access = false WHERE user_id = '" + RES + "' AND module_name = 'pnl.view_revenue'");

  var again = await db.query(SQL).then(function () { return true; }, function () { return false; });
  var pol2 = await db.query("SELECT count(*)::int AS n FROM pg_policies WHERE policyname = 'hub_revenue_researcher'");
  check('running the SQL twice is safe (still one rule per table)', again && pol2.rows[0].n === TABLES.length);

  await db.query(ROLLBACK);
  var pol3 = await db.query("SELECT count(*)::int AS n FROM pg_policies WHERE policyname = 'hub_revenue_researcher'");
  var r3 = await rowsEverywhere('authenticated', RES);
  var other = await db.query("SELECT count(*)::int AS n FROM pg_policies WHERE policyname = 'open_signed_in'");
  check('EMERGENCY ROLLBACK: rules and functions gone, the researcher reads as before, the other rules untouched', pol3.rows[0].n === 0 && all(r3, 2) && other.rows[0].n === TABLES.length, { pol: pol3.rows[0], r3: r3 });
  var gi2 = await as('service_role', null, 'SELECT public.hub_revenue_guard_installed() AS ok');
  check('after rollback the server sees the step is NOT installed (researchers cannot be made)', !gi2.ok, gi2);
} catch (e) { failN++; console.log('  ✗ FAIL: test error ' + (e && e.stack)); }
finally { try { await db.end(); } catch (e) {} try { await server.stop(); } catch (e) {} }
console.log('\nXK SQL: ' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
