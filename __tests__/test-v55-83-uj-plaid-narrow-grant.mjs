// v55.83-UJ (Codex 17:25 UTC) — REAL Postgres 16: reproduces the 18 Nov outage (bank lines 0 for everyone) and the leak of the
// emergency whole-table grant (balances readable by every signed-in user), then proves the narrow fix:
// staff see their non-private bank lines, super admin sees all lines, nobody signed-in can read balances, anon reads nothing.
// Needs EMBEDDED_PG_DIR = a folder with embedded-postgres + pg installed. Data dir is created and removed there.
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
var dataDir = path.join(dir, 'data-uj-' + Date.now()); var port = 54000 + Math.floor(Math.random() * 900);
var server = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'test-only', port: port, persistent: false, initdbFlags: ['--encoding=UTF8', '--locale=C'] });
var db;
var STAFF = '11111111-1111-1111-1111-111111111111', SUPER = '22222222-2222-2222-2222-222222222222';
// run a query AS a signed-in person (Supabase style: role authenticated + jwt claims), in a transaction that is rolled back
async function as(who, sql) {
  await db.query('BEGIN');
  try {
    if (who === 'anon') { await db.query('SET LOCAL ROLE anon'); }
    else { await db.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: who, role: 'authenticated' })]); await db.query('SET LOCAL ROLE authenticated'); }
    var r = await db.query(sql); return { rows: r.rows };
  } catch (e) { return { error: e.message }; } finally { await db.query('ROLLBACK'); }
}
var LINES = 'SELECT count(*)::int AS n FROM public.bank_transactions';
var BAL = 'SELECT current_balance FROM public.plaid_accounts';
var META = 'SELECT id, plaid_account_id, name, mask, wave_business_id, is_private FROM public.plaid_accounts';
try {
  console.log('UJ — plaid_accounts narrow grant on real Postgres 16');
  await server.initialise(); await server.start();
  db = new pg.Client({ host: 'localhost', port: port, user: 'postgres', password: 'test-only', database: 'postgres' }); await db.connect();
  // ── Supabase-like stand-ins: roles, auth.uid(), the identity → profile → super admin chain, the two tables
  await db.query(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid $f$;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    CREATE TABLE public.users (id uuid PRIMARY KEY, auth_id uuid, role text);
    INSERT INTO public.users VALUES ('aaaaaaaa-0000-0000-0000-000000000001', '${STAFF}', 'staff'), ('aaaaaaaa-0000-0000-0000-000000000002', '${SUPER}', 'super_admin');
    CREATE FUNCTION public.hub_caller_can_view_private() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
      SELECT EXISTS (SELECT 1 FROM public.users u WHERE u.auth_id = auth.uid() AND u.role = 'super_admin') $f$;
    GRANT EXECUTE ON FUNCTION public.hub_caller_can_view_private() TO authenticated;
    CREATE TABLE public.plaid_accounts (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, connection_id uuid, business_id uuid, plaid_account_id text, name text, official_name text, mask text, type text, subtype text,
      iso_currency text, current_balance numeric(14,2), available_balance numeric(14,2), is_read_only boolean, updated_at timestamptz, wave_business_id text, assigned_by uuid, assigned_at timestamptz,
      assignment_source text, is_private boolean NOT NULL DEFAULT false);
    INSERT INTO public.plaid_accounts (plaid_account_id, name, mask, current_balance, available_balance, is_private) VALUES ('acc-ops', 'KTC Operating', '1234', 250000, 240000, false), ('acc-priv', 'Owner private', '9999', 90000, 90000, true);
    CREATE TABLE public.bank_transactions (id serial PRIMARY KEY, account_id text, amount_abs numeric);
    INSERT INTO public.bank_transactions (account_id, amount_abs) SELECT 'acc-ops', g FROM generate_series(1, 5) g;
    INSERT INTO public.bank_transactions (account_id, amount_abs) SELECT 'acc-priv', g FROM generate_series(1, 3) g;
    INSERT INTO public.bank_transactions (account_id, amount_abs) VALUES (NULL, 7);
    GRANT SELECT ON public.bank_transactions TO authenticated;
    ALTER TABLE public.bank_transactions ENABLE ROW LEVEL SECURITY;
    CREATE POLICY bt_open_signed_in ON public.bank_transactions FOR ALL TO authenticated USING (true) WITH CHECK (true);
    -- exactly the v55.83-TP rule
    CREATE POLICY bt_private_accounts ON public.bank_transactions AS RESTRICTIVE FOR SELECT TO authenticated USING (
      account_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.plaid_accounts pa WHERE pa.plaid_account_id = bank_transactions.account_id AND pa.is_private IS TRUE) OR public.hub_caller_can_view_private());`);
  // ── production state from sql/bank-balance-visibility.sql (the real block, run as written)
  var bbv = fs.readFileSync(path.join(root, 'sql/bank-balance-visibility.sql'), 'utf8');
  var i0 = bbv.indexOf('do $$\ndeclare table_name text; columns_sql text; policy_name text;'); if (i0 < 0) { i0 = bbv.replace(/\r\n/g, '\n').indexOf('do $$\ndeclare table_name text; columns_sql text; policy_name text;'); bbv = bbv.replace(/\r\n/g, '\n'); }
  var i1 = bbv.indexOf('end;\n$$;', i0);
  check('setup: the real column-grant block of bank-balance-visibility.sql was found', i0 >= 0 && i1 > i0);
  await db.query(bbv.substring(i0, i1 + 'end;\n$$;'.length));

  // 1. the outage, reproduced
  var o1 = await as(STAFF, LINES); var o2 = await as(SUPER, LINES);
  check('BEFORE (outage): staff reading bank lines → "permission denied for table plaid_accounts"', /permission denied for table plaid_accounts/.test(o1.error || ''), o1);
  check('BEFORE (outage): the SUPER ADMIN gets the same error (the check never reaches the super-admin test)', /permission denied for table plaid_accounts/.test(o2.error || ''), o2);
  check('BEFORE: balances were hidden from staff', /permission denied/.test((await as(STAFF, BAL)).error || ''));

  // 2. the emergency grant: screens back, but the leak
  await db.query('GRANT SELECT ON public.plaid_accounts TO authenticated');
  var e1 = await as(STAFF, LINES); var e2 = await as(STAFF, BAL);
  check('EMERGENCY GRANT: staff bank lines back (6 = 5 operating + 1 without account; private hidden)', e1.rows && e1.rows[0].n === 6, e1);
  check('EMERGENCY GRANT: LEAK reproduced — staff can read current_balance', e2.rows && e2.rows.length === 2, e2);

  // 3. the fix, run twice (safe to re-run)
  var fixSql = fs.readFileSync(path.join(root, 'sql/v55-83-UJ-plaid-accounts-narrow-grant.sql'), 'utf8');
  var r1 = await db.query(fixSql); var r2 = await db.query(fixSql);
  var checks = (Array.isArray(r2) ? r2[r2.length - 1] : r2).rows;
  check('FIX: its own check list says OK on every line (6 lines), second run included', checks.length === 6 && checks.every(function (c) { return c.result === 'OK'; }), checks);
  var f1 = await as(STAFF, LINES); var f2 = await as(SUPER, LINES);
  check('AFTER: staff see their bank lines (6), private account still hidden', f1.rows && f1.rows[0].n === 6, f1);
  check('AFTER: super admin sees ALL bank lines (9, private included)', f2.rows && f2.rows[0].n === 9, f2);
  var b1 = await as(STAFF, BAL); var b2 = await as(SUPER, BAL); var b3 = await as(STAFF, 'SELECT available_balance FROM public.plaid_accounts'); var b4 = await as(STAFF, 'SELECT * FROM public.plaid_accounts');
  check('AFTER: staff CANNOT read current_balance', /permission denied/.test(b1.error || ''), b1);
  check('AFTER: available_balance hidden too, and select * refused', /permission denied/.test(b3.error || '') && /permission denied/.test(b4.error || ''), [b3, b4]);
  check('AFTER: super admin through the browser role cannot read balances either (balances come only from the server, as before the outage)', /permission denied/.test(b2.error || ''), b2);
  var m1 = await as(STAFF, META);
  check('AFTER: the account list the screens use still loads (metadata + is_private)', m1.rows && m1.rows.length === 2, m1);
  var bankTabCols = 'SELECT id,connection_id,business_id,plaid_account_id,name,official_name,mask,type,subtype,iso_currency,is_read_only,updated_at,wave_business_id FROM public.plaid_accounts';
  check('AFTER: the exact column list of BankTab / BankReviewTab works', !!(await as(STAFF, bankTabCols)).rows);
  var a1 = await as('anon', META); var a2 = await as('anon', LINES);
  check('AFTER: an anonymous visitor reads neither accounts nor bank lines', !!a1.error && !!a2.error, [a1, a2]);
  var sr = await db.query("SET ROLE service_role; SELECT count(*)::int AS n FROM public.plaid_accounts WHERE current_balance IS NOT NULL; RESET ROLE;");
  check('AFTER: the Hub server (service role) still reads balances', sr[1].rows[0].n === 2, sr[1].rows);
} catch (e) { failN++; console.error('  ✗ crashed:', e.message); }
finally {
  try { if (db) { await db.end(); } } catch (e) {}
  try { await server.stop(); } catch (e) {}
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) {}
}
console.log('\nUJ plaid narrow grant: ' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
