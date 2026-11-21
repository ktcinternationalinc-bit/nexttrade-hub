// v55.83-WW — REAL Postgres 16 proof of sql/v55-83-WW-grant-writes-server-only.sql (and its ROLLBACK), run twice.
// The live shape is rebuilt for users / module_permissions / hub_audit_log (RLS on, the live "any signed-in person may
// write" policies, table grants to anon + authenticated, the live hub_guard_sensitive_grant trigger shape). After the SQL:
//   • a signed-in person can no longer switch on their own permission, add one, delete one, or make themselves super admin
//   • a signed-in person still saves their own preferences (Nadia, phone routing, language access — the columns the screens write)
//   • nobody in the browser can write (forge) audit rows; the server (service_role) still writes all three tables
//   • reading users / module_permissions is unchanged (the app reads them after sign-in)
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
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra))); }
var SQL = fs.readFileSync(path.join(root, 'sql/v55-83-WW-grant-writes-server-only.sql'), 'utf8');
var ROLLBACK = fs.readFileSync(path.join(root, 'sql/v55-83-WW-grant-writes-server-only-ROLLBACK.sql'), 'utf8');
check('the SQL Max runs has no comment lines and is one transaction', !/^\s*--/m.test(SQL) && /^BEGIN;/.test(SQL.trim()) && /COMMIT;$/.test(SQL.trim()));
check('the SQL removes no data and no table (no DROP / DELETE FROM / ALTER)', !/\bDROP\b|DELETE\s+FROM|\bALTER\b/i.test(SQL));
var PREF_COLS = ['language_access', 'ai_memory', 'greeter_personality', 'greeter_language', 'greeter_enabled', 'forwarding_number', 'phone_routing', 'phone_vacation_mode'];

var dataDir = path.join(dir, 'data-wv-' + Date.now()); var port = 54000 + Math.floor(Math.random() * 900);
var server = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'test-only', port: port, persistent: false, initdbFlags: ['--encoding=UTF8', '--locale=C'] });
var db;
var ME = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';
async function as(role, sql) {
  await db.query('BEGIN');
  try {
    await db.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify(role === 'authenticated' ? { sub: ME, role: 'authenticated' } : role === 'service_role' ? { role: 'service_role' } : { role: 'anon' })]);
    await db.query('SET LOCAL ROLE ' + role); var r = await db.query(sql); await db.query('ROLLBACK'); return { ok: true, rows: r.rows, count: r.rowCount };
  } catch (e) { await db.query('ROLLBACK'); return { ok: false, code: e.code, msg: e.message }; }
}
async function setup() {
  await db.query("DO $x$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF; END $x$;");
  await db.query('GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role');
  await db.query('CREATE SCHEMA IF NOT EXISTS auth');
  await db.query("CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid $f$");
  await db.query("CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $f$ SELECT coalesce(current_setting('request.jwt.claims', true)::json->>'role', 'anon') $f$");
  await db.query("CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $f$ SELECT coalesce(current_setting('request.jwt.claims', true), '{}')::jsonb $f$");
  await db.query('GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role');
  await db.query('CREATE TABLE public.users (id uuid primary key, email text, name text, name_ar text, role text, active boolean, created_at timestamptz default now(), updated_at timestamptz, reports_to uuid, language_access jsonb, phone text, ai_memory jsonb, greeter_personality text, greeter_language text, greeter_enabled boolean, forwarding_number text, phone_routing text, phone_vacation_mode boolean)');
  await db.query('CREATE TABLE public.module_permissions (id serial primary key, user_id uuid, module_name text, has_access boolean)');
  await db.query('CREATE TABLE public.hub_audit_log (id serial primary key, at timestamptz default now(), actor_id uuid, action text, entity text, entity_id text, details jsonb)');
  ['users', 'module_permissions', 'hub_audit_log'].forEach(function () {});
  await db.query('ALTER TABLE public.users ENABLE ROW LEVEL SECURITY; ALTER TABLE public.module_permissions ENABLE ROW LEVEL SECURITY; ALTER TABLE public.hub_audit_log ENABLE ROW LEVEL SECURITY');
  await db.query("CREATE POLICY \"Authenticated read\" ON public.users FOR SELECT USING (auth.role() = 'authenticated')");
  await db.query("CREATE POLICY auth_update ON public.users FOR UPDATE USING (auth.role() = 'authenticated')");
  await db.query("CREATE POLICY auth_insert ON public.users FOR INSERT WITH CHECK (auth.role() = 'authenticated')");
  await db.query("CREATE POLICY auth_delete ON public.users FOR DELETE USING (auth.role() = 'authenticated')");
  await db.query("CREATE POLICY allow_all_module_permissions ON public.module_permissions FOR ALL USING (true)");
  await db.query("CREATE POLICY auth_write ON public.module_permissions FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated')");
  await db.query("CREATE POLICY hub_audit_ins ON public.hub_audit_log FOR INSERT TO authenticated WITH CHECK (true)");
  await db.query("CREATE OR REPLACE FUNCTION public.hub_guard_sensitive_grant() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $f$ BEGIN IF NEW.has_access IS TRUE AND NEW.module_name IN ('pnl.view_margin','accounting.view_totals','bank.view_private','permissions.grant_sensitive','bank.add_transactions','invoice.delete','advances.manage') THEN IF auth.uid() IS NULL OR coalesce(auth.jwt() ->> 'role', '') = 'service_role' THEN RETURN NEW; END IF; RAISE EXCEPTION 'HUB_GUARD: only the super admin can switch on %', NEW.module_name; END IF; RETURN NEW; END $f$");
  await db.query('CREATE TRIGGER hub_guard_sensitive_grant BEFORE INSERT OR UPDATE ON public.module_permissions FOR EACH ROW EXECUTE FUNCTION public.hub_guard_sensitive_grant()');
  await db.query('GRANT ALL ON TABLE public.users, public.module_permissions, public.hub_audit_log TO anon, authenticated, service_role');
  await db.query('GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role');
  await db.query("INSERT INTO public.users (id, email, name, role, active) VALUES ('" + ME + "', 'me@x', 'Me', 'team', true), ('" + OTHER + "', 'o@x', 'Other', 'super_admin', true)");
  await db.query("INSERT INTO public.module_permissions (user_id, module_name, has_access) VALUES ('" + ME + "', 'wires.signoff', false), ('" + ME + "', 'bills.view', true)");
}
var selfGrant = "UPDATE public.module_permissions SET has_access = true WHERE user_id = '" + ME + "' AND module_name = 'wires.signoff'";
var selfAdd = "INSERT INTO public.module_permissions (user_id, module_name, has_access) VALUES ('" + ME + "', 'wires.send', true)";
var delOther = "DELETE FROM public.module_permissions WHERE module_name = 'bills.view'";
var promote = "UPDATE public.users SET role = 'super_admin' WHERE id = '" + ME + "'";
var forge = "INSERT INTO public.hub_audit_log (actor_id, action) VALUES ('" + OTHER + "', 'wire_signoff_2')";
var prefs = "UPDATE public.users SET greeter_enabled = true, ai_memory = '{}'::jsonb, phone_routing = 'app', language_access = '[]'::jsonb WHERE id = '" + ME + "'";

try {
  await server.initialise(); await server.start();
  db = new pg.Client({ host: 'localhost', port: port, user: 'postgres', password: 'test-only', database: 'postgres' }); await db.connect();
  await setup();
  var b1 = await as('authenticated', selfGrant), b2 = await as('authenticated', promote), b3 = await as('authenticated', forge), b4 = await as('anon', selfAdd);
  check('BEFORE (live today): a signed-in person can switch on their own wire signature, make themselves super admin, write a fake audit row; not signed in can add a switch', b1.ok && b1.count === 1 && b2.ok && b2.count === 1 && b3.ok && b4.ok, [b1, b2, b3, b4]);

  for (var run = 1; run <= 2; run++) {
    await db.query(SQL);
    var r1 = await as('authenticated', selfGrant), r2 = await as('authenticated', selfAdd), r3 = await as('authenticated', delOther), r4 = await as('authenticated', promote);
    check('run ' + run + ': signed in → switching on your own permission is refused', !r1.ok && r1.code === '42501', r1);
    check('run ' + run + ': signed in → adding a permission row is refused', !r2.ok && r2.code === '42501', r2);
    check('run ' + run + ': signed in → deleting a permission row is refused', !r3.ok && r3.code === '42501', r3);
    check('run ' + run + ': signed in → making yourself super admin is refused', !r4.ok && r4.code === '42501', r4);
    var r5 = await as('authenticated', "UPDATE public.users SET active = false WHERE id = '" + OTHER + "'"), r6 = await as('authenticated', "INSERT INTO public.users (id, role) VALUES ('33333333-3333-4333-8333-333333333333', 'super_admin')"), r7 = await as('authenticated', "DELETE FROM public.users WHERE id = '" + OTHER + "'");
    check('run ' + run + ': signed in → switching off, adding or deleting a person is refused (only the server does that)', !r5.ok && !r6.ok && !r7.ok, [r5, r6, r7]);
    var r8 = await as('authenticated', forge), r9 = await as('anon', forge);
    check('run ' + run + ': nobody in the browser can write an audit row (no forged "who signed")', !r8.ok && r8.code === '42501' && !r9.ok, [r8, r9]);
    var p1 = await as('authenticated', prefs);
    check('run ' + run + ': a signed-in person still saves their own preferences (Nadia, phone routing, language access)', p1.ok && p1.count === 1, p1);
    var okCols = [];
    for (var c = 0; c < PREF_COLS.length; c++) { var pc = await as('authenticated', 'UPDATE public.users SET ' + PREF_COLS[c] + ' = ' + PREF_COLS[c] + " WHERE id = '" + ME + "'"); if (pc.ok) { okCols.push(PREF_COLS[c]); } }
    check('run ' + run + ': each of the 8 preference columns the screens write is still writable', okCols.length === PREF_COLS.length, okCols);
    var rd1 = await as('authenticated', 'SELECT id, role FROM public.users'), rd2 = await as('authenticated', 'SELECT * FROM public.module_permissions');
    check('run ' + run + ': reading people and switches after sign-in is unchanged', rd1.ok && rd1.rows.length === 2 && rd2.ok && rd2.rows.length === 2, [rd1, rd2]);
    var s1 = await as('service_role', selfGrant), s2 = await as('service_role', promote), s3 = await as('service_role', forge), s4 = await as('service_role', selfAdd);
    check('run ' + run + ': the server (service key) still writes switches, roles and audit rows', s1.ok && s1.count === 1 && s2.ok && s3.ok && s4.ok, [s1, s2, s3, s4]);
  }
  var cnt = await db.query('SELECT (SELECT count(*) FROM public.users)::int AS u, (SELECT count(*) FROM public.module_permissions)::int AS m');
  check('no data is removed or changed by the SQL', cnt.rows[0].u === 2 && cnt.rows[0].m === 2, cnt.rows);
  await db.query(ROLLBACK);
  var back = await as('authenticated', selfGrant);
  check('ROLLBACK file: the old access comes back (undo is possible)', back.ok && back.count === 1, back);
  await db.query(SQL);
  check('… and the SQL can be applied again after a rollback', !(await as('authenticated', promote)).ok);
} catch (e) {
  failN++; console.log('CRASH ' + (e && e.stack));
} finally {
  try { await db.end(); } catch (e1) { }
  try { await server.stop(); } catch (e2) { }
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e3) { }
}
console.log('');
console.log('WW-SQL: ' + pass + ' passed, ' + failN + ' failed');
process.exit(failN > 0 ? 1 : 0);
