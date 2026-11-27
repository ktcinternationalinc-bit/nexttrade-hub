// v55.83-ZD rev3 — REAL Postgres 16 proof of sql/v55-83-ZD-payroll-bank-lines.sql (installed AFTER sql/v55-83-ZD-payroll-bills.sql) and its
// EMERGENCY ROLLBACK (Max, 26 Nov 2026: "Yes, hide them"). Same live shapes as the bills proof, plus bank_transactions (with its live
// private-accounts rule), bank_transaction_splits and the Wave cash history tables. From the BROWSER role: a person without P&L: View
// reads / writes no payroll KTC bank line (by name, bank category, company category, classification, Hub label, split, payroll bill
// payment) and none of its splits; the NextTrade books lines and ordinary lines are unchanged; a P&L user and the super admin see
// everything; an OFF row for P&L wins. wave_cash_payroll_totals is for the server only. Needs EMBEDDED_PG_DIR.
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
console.log('ZD rev3 — payroll bank lines: super admin + P&L only (real Postgres)');
var BILLS_SQL = fs.readFileSync(path.join(root, 'sql/v55-83-ZD-payroll-bills.sql'), 'utf8');
var SQL = fs.readFileSync(path.join(root, 'sql/v55-83-ZD-payroll-bank-lines.sql'), 'utf8');
var ROLLBACK = fs.readFileSync(path.join(root, 'sql/v55-83-ZD-payroll-bank-lines-EMERGENCY-ROLLBACK.sql'), 'utf8');
check('the SQL Max runs has no comment lines and is one transaction', !/^\s*--/m.test(SQL) && /^BEGIN;/.test(SQL.trim()) && /COMMIT;$/.test(SQL.trim()));
check('the SQL removes no data, no table, no column', !/DELETE\s+FROM|\bTRUNCATE\b|DROP\s+TABLE|ALTER\s+TABLE/i.test(SQL));

var SUP = '11111111-1111-4111-8111-111111111111', STAFF = '22222222-2222-4222-8222-222222222222', PNLU = '33333333-3333-4333-8333-333333333333', OFFU = '44444444-4444-4444-8444-444444444444';
var B1 = 'b1000000-0000-4000-8000-000000000001', B2 = 'b2000000-0000-4000-8000-000000000002', B3 = 'b3000000-0000-4000-8000-000000000003', B4 = 'b4000000-0000-4000-8000-000000000004', B5 = 'b5000000-0000-4000-8000-000000000005';
var P1 = 'f1000000-0000-4000-8000-000000000001', P2 = 'f2000000-0000-4000-8000-000000000002';
var L = { T1: 'a1000000-0000-4000-8000-000000000001', T2: 'a2000000-0000-4000-8000-000000000002', T3: 'a3000000-0000-4000-8000-000000000003', T4: 'a4000000-0000-4000-8000-000000000004', T5: 'a5000000-0000-4000-8000-000000000005', T6: 'a6000000-0000-4000-8000-000000000006', T7: 'a7000000-0000-4000-8000-000000000007', N1: 'a8000000-0000-4000-8000-000000000008', O1: 'a9000000-0000-4000-8000-000000000009' };
var dataDir = path.join(dir, 'data-zdl-' + Date.now()); var port = 54000 + Math.floor(Math.random() * 900);
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
  await db.query("INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ('" + PNLU + "', 'p@x', now()), ('" + OFFU + "', 'o@x', now())");
  await db.query("INSERT INTO public.users (id, email, name, role, active) VALUES ('" + PNLU + "', 'p@x', 'Pnl', 'team', true), ('" + OFFU + "', 'o@x', 'Off', 'team', true)");
  await db.query('CREATE TABLE public.module_permissions (id serial primary key, user_id uuid, module_name text, has_access boolean)');
  await db.query('GRANT SELECT ON public.module_permissions TO authenticated, service_role');
  await db.query("INSERT INTO public.module_permissions (user_id, module_name, has_access) VALUES ('" + PNLU + "', 'pnl.view', true), ('" + OFFU + "', 'pnl.view', true), ('" + OFFU + "', 'pnl.view', false), ('" + STAFF + "', 'bank.view', true)");
  await db.query('CREATE TABLE public.plaid_accounts (plaid_account_id text, is_private boolean)');
  await db.query('GRANT SELECT ON public.plaid_accounts TO authenticated, service_role');
  await db.query("CREATE OR REPLACE FUNCTION public.hub_caller_can_view_private() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $f$ SELECT public.hub_caller_is_super_admin() $f$");
  await db.query('GRANT EXECUTE ON FUNCTION public.hub_caller_can_view_private() TO authenticated, service_role');
  await db.query('ALTER TABLE public.vendor_bill_payments ADD COLUMN bank_transaction_id uuid');
  await db.query('ALTER TABLE public.wire_packages ADD COLUMN bank_transaction_id uuid');
  await db.query('CREATE TABLE public.bank_transactions (id uuid primary key, wave_business_id text, account_id text, name text, merchant_name text, category text, hub_category text, company_category text, classification text, wave_category_name text, amount_abs numeric, review_status text)');
  await db.query('CREATE TABLE public.bank_transaction_splits (id serial primary key, bank_transaction_id uuid, category text, split_amount numeric)');
  for (var bt of ['bank_transactions', 'bank_transaction_splits']) {
    await db.query('ALTER TABLE public.' + bt + ' ENABLE ROW LEVEL SECURITY');
    await db.query('CREATE POLICY open_signed_in ON public.' + bt + ' FOR ALL TO authenticated USING (true) WITH CHECK (true)');
    await db.query('GRANT ALL ON TABLE public.' + bt + ' TO authenticated, service_role');
  }
  await db.query('GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role');
  await db.query("CREATE POLICY bt_private_accounts ON public.bank_transactions AS RESTRICTIVE FOR SELECT TO authenticated USING ((account_id IS NULL) OR (NOT (EXISTS (SELECT 1 FROM plaid_accounts pa WHERE pa.plaid_account_id = bank_transactions.account_id AND pa.is_private IS TRUE))) OR hub_caller_can_view_private())");
  await db.query('CREATE VIEW public.bank_transactions_canonical WITH (security_invoker = true) AS SELECT * FROM public.bank_transactions t WHERE coalesce(review_status, \'unreviewed\') <> \'duplicate\'');
  await db.query('GRANT SELECT ON public.bank_transactions_canonical TO authenticated, service_role');
  await db.query("INSERT INTO public.expense_categories VALUES ('staff_k', 'Payroll – staff')");
  var K = 'QnVzaW5lc3M6a3Rj';
  await db.query("INSERT INTO public.bank_transactions VALUES " + [
    "('" + L.T1 + "', '" + K + "', 'A1', 'ACH', null, 'Transfer > Payroll', null, null, null, null, 2959.27, 'unreviewed')",
    "('" + L.T2 + "', '" + K + "', 'A1', 'IRS', null, 'Tax > Payment', null, 'payroll_taxes', null, null, 504.79, 'unreviewed')",
    "('" + L.T3 + "', '" + K + "', 'A1', 'ACH', null, '', null, null, 'payroll', null, 30.01, 'unreviewed')",
    "('" + L.T4 + "', '" + K + "', 'A1', 'GUSTO PAYROLL 1234', null, '', null, null, null, null, 629.11, 'unreviewed')",
    "('" + L.T5 + "', '" + K + "', 'A1', 'ACH', null, '', 'staff_k', null, null, null, 352.85, 'unreviewed')",
    "('" + L.T6 + "', '" + K + "', 'A1', 'ACH', null, '', null, null, null, null, 311.21, 'unreviewed')",
    "('" + L.T7 + "', '" + K + "', 'A1', 'ACH', null, '', null, null, null, null, 2470.65, 'unreviewed')",
    "('" + L.N1 + "', 'NEXTRADE_BOOKS', 'A1', 'ZELLE JOHN', null, '', null, 'warehouse_staff', null, null, 4321.17, 'unreviewed')",
    "('" + L.O1 + "', '" + K + "', 'A1', 'CENTERPOINT', null, '', 'rent', null, null, null, 412.5, 'unreviewed')"].join(', '));
  await db.query("INSERT INTO public.bank_transaction_splits (bank_transaction_id, category, split_amount) VALUES ('" + L.T6 + "', 'Payroll', 311.21), ('" + L.O1 + "', 'rent', 412.5)");
  await db.query("UPDATE public.vendor_bill_payments SET bank_transaction_id = '" + L.T7 + "' WHERE bill_id = '" + B1 + "'");
  await db.query('CREATE SCHEMA wave_history');
  await db.query('CREATE TABLE wave_history.cash_imports (id serial primary key, currency text)');
  await db.query('CREATE TABLE wave_history.cash_entries (import_id int, source_row int, posted_date date, account_key text, account_name text, description text, debit_minor bigint, credit_minor bigint)');
  await db.query("INSERT INTO wave_history.cash_imports (currency) VALUES ('USD')");
  await db.query("INSERT INTO wave_history.cash_entries VALUES (1, 1, '2021-01-05', 'chase', 'Chase', 'Payroll run', 0, 500000), (1, 2, '2021-01-06', 'chase', 'Chase', 'Rent', 0, 100000), (1, 3, '2021-01-05', 'pay', 'Payroll Gross Pay', 'Payroll run', 500000, 0)");
}
async function ids(role, sub, from) { var r = await as(role, sub, 'SELECT id::text AS id FROM ' + from + ' ORDER BY id'); return r.ok ? r.rows.map(function (x) { return Object.keys(L).filter(function (k) { return L[k] === x.id; })[0] || x.id; }).join(',') : 'ERR ' + r.msg; }
try {
  await server.initialise(); await server.start();
  db = new pg.Client({ host: 'localhost', port: port, user: 'postgres', password: 'test-only', database: 'postgres' }); await db.connect();
  await setup();
  var b0 = await ids('authenticated', STAFF, 'public.bank_transactions');
  check('before: someone without P&L reads every bank line, payroll included (the gap)', b0 === 'T1,T2,T3,T4,T5,T6,T7,N1,O1', b0);
  var early = await db.query(SQL).then(function () { return { ok: true }; }, function (e) { return { ok: false, msg: e.message }; });
  await db.query('ROLLBACK').catch(function () {});
  var p0 = await db.query("SELECT count(*)::int AS n FROM pg_policies WHERE policyname = 'hub_payroll_lines_pnl_only'");
  check('run BEFORE the bills step: refused (HUB_GUARD), nothing changed', !early.ok && /HUB_GUARD: run sql\/v55-83-ZD-payroll-bills\.sql first/.test(early.msg) && p0.rows[0].n === 0, early);
  await db.query(BILLS_SQL);
  await db.query(SQL);
  var pol = await db.query("SELECT tablename FROM pg_policies WHERE policyname = 'hub_payroll_lines_pnl_only' AND permissive = 'RESTRICTIVE' ORDER BY tablename");
  check('installed: one RESTRICTIVE rule on bank_transactions and one on bank_transaction_splits', pol.rows.map(function (r) { return r.tablename; }).join(',') === 'bank_transaction_splits,bank_transactions', pol.rows);
  var s1 = await ids('authenticated', STAFF, 'public.bank_transactions');
  check('without P&L: every payroll KTC line is gone (bank category, company category, classification, name, Hub label, split, payroll bill payment); the NextTrade line and the ordinary line stay', s1 === 'N1,O1', s1);
  var s2 = await ids('authenticated', STAFF, 'public.bank_transactions_canonical');
  check('… the same through the de-duplicated view (it reads as the person)', s2 === 'N1,O1', s2);
  var s3 = await as('authenticated', STAFF, 'SELECT bank_transaction_id::text AS b FROM public.bank_transaction_splits');
  check('… and the payroll line\'s splits are gone; the ordinary split stays', s3.ok && s3.count === 1 && s3.rows[0].b === L.O1, s3);
  var a1 = await ids('authenticated', PNLU, 'public.bank_transactions'), a2 = await ids('authenticated', SUP, 'public.bank_transactions'), a3 = await ids('authenticated', OFFU, 'public.bank_transactions');
  check('P&L user and super admin: every line; a person whose P&L switch has an OFF row: no payroll lines', a1.split(',').length === 9 && a2.split(',').length === 9 && a3 === 'N1,O1', { pnl: a1, sup: a2, off: a3 });
  var srv = await db.query('SELECT count(*)::int AS n FROM public.bank_transactions');
  check('the server (owner connection) is not affected', srv.rows[0].n === 9);
  var u1 = await as('authenticated', STAFF, "UPDATE public.bank_transactions SET review_status = 'reviewed' WHERE id = '" + L.T1 + "'");
  check('without P&L: a change aimed at a payroll line reaches nothing', u1.ok && u1.count === 0, u1);
  var u2 = await as('authenticated', STAFF, "UPDATE public.bank_transactions SET hub_category = 'staff_k' WHERE id = '" + L.O1 + "'");
  var u3 = await as('authenticated', STAFF, "UPDATE public.bank_transactions SET company_category = 'payroll' WHERE id = '" + L.O1 + "'");
  check('without P&L: categorizing a line INTO payroll is refused (by category key, by a payroll label)', !u2.ok && !u3.ok && /row-level security/.test(u2.msg + u3.msg), { u2: u2, u3: u3 });
  var u4 = await as('authenticated', STAFF, "UPDATE public.bank_transactions SET review_status = 'reviewed' WHERE id = '" + L.O1 + "'");
  check('without P&L: an ordinary line can still be worked on', u4.ok && u4.count === 1, u4);
  var i1 = await as('authenticated', STAFF, "INSERT INTO public.bank_transaction_splits (bank_transaction_id, category, split_amount) VALUES ('" + L.O1 + "', 'payroll', 1)");
  var i2 = await as('authenticated', STAFF, "INSERT INTO public.bank_transaction_splits (bank_transaction_id, category, split_amount) VALUES ('" + L.T1 + "', 'rent', 1)");
  var i3 = await as('authenticated', STAFF, "INSERT INTO public.bank_transaction_splits (bank_transaction_id, category, split_amount) VALUES ('" + L.O1 + "', 'rent', 1)");
  check('without P&L: a split saying payroll, or a split on a payroll line, is refused by the rule; an ordinary split is fine', !i1.ok && !i2.ok && /row-level security/.test(i1.msg) && /row-level security/.test(i2.msg) && i3.ok, { i1: i1, i2: i2, i3: i3 });
  var mv1 = await as('authenticated', STAFF, "UPDATE public.bank_transactions SET wave_business_id = 'NEXTRADE_BOOKS' WHERE id = '" + L.T1 + "'");
  var mv2 = await as('authenticated', STAFF, "UPDATE public.bank_transactions SET wave_business_id = 'RTM_BOOKS' WHERE account_id = 'A1' RETURNING id::text AS id");
  var t1silo = await db.query("SELECT wave_business_id FROM public.bank_transactions WHERE id = '" + L.T1 + "'");
  check('without P&L: a payroll line cannot be moved into a company (NextTrade / RTM books) straight from the browser — one line or the whole account (only the lines they can see move; the payroll lines stay)',
    mv1.ok && mv1.count === 0 && mv2.ok && mv2.rows.every(function (r) { return [L.N1, L.O1].indexOf(r.id) >= 0; }) && t1silo.rows[0].wave_business_id === 'QnVzaW5lc3M6a3Rj', { mv1: mv1, mv2: mv2 });
  var u5 = await as('authenticated', PNLU, "UPDATE public.bank_transactions SET hub_category = 'staff_k' WHERE id = '" + L.O1 + "'");
  check('P&L user: may categorize a line into payroll', u5.ok && u5.count === 1, u5);
  var n1 = await as('authenticated', STAFF, "UPDATE public.bank_transactions SET review_status = 'reviewed' WHERE id = '" + L.N1 + "'");
  check('the NextTrade books\' payroll line is not touched by this rule (XE\'s own rule applies there)', n1.ok && n1.count === 1, n1);
  var exposed = await db.query("SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE '%payroll%' ORDER BY 1");
  check('only the guard markers and the server\'s cash totals live in public; the rule helpers are in hub_private', exposed.rows.map(function (r) { return r.proname; }).join(',') === 'hub_payroll_bills_guard_installed,hub_payroll_lines_guard_installed,wave_cash_payroll_totals', exposed.rows);
  var ct = await db.query("SELECT public.wave_cash_payroll_totals('2021-01-01', '2021-01-31', 'USD') AS t");
  var chase = (ct.rows[0].t || []).filter(function (x) { return x.account_key === 'chase'; })[0];
  check('cash totals: the payroll rows on each account (Chase: 1 row, credit 5,000.00)', chase && chase.rows === 1 && Number(chase.credit_minor) === 500000 && Number(chase.debit_minor) === 0, ct.rows[0]);
  var ca = await as('authenticated', STAFF, "SELECT public.wave_cash_payroll_totals('2021-01-01', '2021-01-31', 'USD')");
  check('cash totals: a signed-in person cannot call it (server only)', !ca.ok && /permission denied/.test(ca.msg), ca);
  var again = await db.query(SQL).then(function () { return true; }, function () { return false; });
  check('running the step a second time is safe (same result)', again && (await ids('authenticated', STAFF, 'public.bank_transactions')) === 'N1,O1');
  await db.query(ROLLBACK);
  var r1 = await ids('authenticated', STAFF, 'public.bank_transactions');
  var rp = await db.query("SELECT count(*)::int AS n FROM pg_policies WHERE policyname = 'hub_payroll_lines_pnl_only'");
  var rb = await db.query("SELECT count(*)::int AS n FROM pg_policies WHERE policyname LIKE 'hub_payroll%'");
  check('EMERGENCY ROLLBACK: the two rules and helpers are gone, every line readable again, the bills rules stay, no data lost', r1.split(',').length === 9 && rp.rows[0].n === 0 && rb.rows[0].n === 10 && (await db.query('SELECT count(*)::int AS n FROM public.bank_transactions')).rows[0].n === 9, { r1: r1, rp: rp.rows[0], rb: rb.rows[0] });
} catch (e) { failN++; console.log('  ✗ FAIL: unexpected error ' + (e && e.stack)); }
finally { try { await db.end(); } catch (e) {} try { await server.stop(); } catch (e) {} try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) {} }
console.log('\nZD rev3 SQL: ' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
