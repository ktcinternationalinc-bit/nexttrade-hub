// v55.83-UM — REAL Postgres 16 proof of sql/v55-83-UM-invoice-delete.sql (run twice):
//  • "invoice.delete" is a super-admin-only switch in the database guard (advances.manage too)
//  • hub_invoice_lifecycle: one locked step — all of it or none of it; payment records never deleted; the rules (Wave-linked,
//    imported, payments, converted proforma, states); a payment added by someone else at the same moment blocks the delete
//  • the browser roles can neither delete nor change status, nor call the step; editing still works; the server can do it all
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
var dataDir = path.join(dir, 'data-um-' + Date.now()); var port = 54000 + Math.floor(Math.random() * 900);
var server = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'test-only', port: port, persistent: false, initdbFlags: ['--encoding=UTF8', '--locale=C'] });
var db, db2;
var STAFF = '11111111-1111-1111-1111-111111111111', SUPER = '22222222-2222-2222-2222-222222222222';
var ACTOR = 'aaaaaaaa-0000-0000-0000-000000000009';
function client() { return new pg.Client({ host: 'localhost', port: port, user: 'postgres', password: 'test-only', database: 'postgres' }); }
async function as(who, sql, params) {
  await db.query('BEGIN');
  try {
    await db.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: who === 'service' ? null : who, role: who === 'service' ? 'service_role' : 'authenticated' })]);
    await db.query(who === 'service' ? 'SET LOCAL ROLE service_role' : 'SET LOCAL ROLE authenticated');
    var r = await db.query(sql, params || []); await db.query('COMMIT'); return { rows: r.rows, count: r.rowCount };
  } catch (e) { await db.query('ROLLBACK'); return { error: e.message }; }
}
function life(p) { return as('service', 'SELECT public.hub_invoice_lifecycle($1::jsonb) AS r', [JSON.stringify(p)]).then(function (x) { return x.error ? { error: x.error } : x.rows[0].r; }); }
async function one(sql, params) { var r = await db.query(sql, params || []); return r.rows; }
var I = function (n) { return '00000000-0000-0000-0000-00000000000' + n; };
try {
  console.log('UM — invoice delete SQL on real Postgres 16');
  await server.initialise(); await server.start();
  db = client(); await db.connect(); db2 = client(); await db2.connect();
  await db.query(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid $f$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $f$ SELECT coalesce(current_setting('request.jwt.claims', true), '{}')::jsonb $f$;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    CREATE TABLE public.users (id uuid PRIMARY KEY, auth_id uuid, role text);
    INSERT INTO public.users VALUES ('aaaaaaaa-0000-0000-0000-000000000001', '${STAFF}', 'admin'), ('aaaaaaaa-0000-0000-0000-000000000002', '${SUPER}', 'super_admin');
    CREATE FUNCTION public.hub_caller_is_super_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $f$
      SELECT EXISTS (SELECT 1 FROM public.users u WHERE u.auth_id = auth.uid() AND u.role = 'super_admin') $f$;
    GRANT EXECUTE ON FUNCTION public.hub_caller_is_super_admin() TO authenticated;
    CREATE TABLE public.module_permissions (id serial PRIMARY KEY, user_id uuid, module_name text, has_access boolean);
    GRANT SELECT, INSERT, UPDATE ON public.module_permissions TO authenticated; GRANT USAGE ON SEQUENCE public.module_permissions_id_seq TO authenticated;
    CREATE TABLE public.accounting_invoices (id uuid PRIMARY KEY, invoice_number text, record_status text DEFAULT 'active', wave_invoice_id text, wave_sync_status text,
      source text, is_historical boolean, archived_at timestamptz, archived_by uuid, void_reason text, notes text);
    CREATE TABLE public.accounting_invoice_items (id serial PRIMARY KEY, invoice_id uuid REFERENCES public.accounting_invoices(id), description text);
    CREATE TABLE public.accounting_invoice_payments (id serial PRIMARY KEY, accounting_invoice_id uuid REFERENCES public.accounting_invoices(id) ON DELETE CASCADE, amount numeric, voided boolean DEFAULT false, bank_transaction_id uuid);
    CREATE TABLE public.payment_matches (id serial PRIMARY KEY, invoice_id uuid, voided boolean DEFAULT false);
    CREATE TABLE public.bank_transactions (id uuid PRIMARY KEY, matched_invoice_id uuid, review_status text);
    CREATE TABLE public.accounting_proformas (id uuid PRIMARY KEY, proforma_number text, record_status text DEFAULT 'active', status text, converted_invoice_id uuid,
      archived_at timestamptz, archived_by uuid, void_reason text);
    CREATE TABLE public.audit_log (id serial PRIMARY KEY, table_name text, record_id uuid, action text, changed_by uuid, old_values jsonb, new_values jsonb);
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.accounting_invoices, public.accounting_proformas TO anon, authenticated;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role; GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;`);
  var tq = fs.readFileSync(path.join(root, 'sql/v55-83-TQ-add-transactions-permission.sql'), 'utf8').replace(/\r\n/g, '\n');
  await db.query(tq.substring(tq.indexOf('CREATE OR REPLACE FUNCTION public.hub_guard_sensitive_grant()'), tq.indexOf('END $$;') + 'END $$;'.length));
  await db.query('CREATE TRIGGER hub_guard_sensitive BEFORE INSERT OR UPDATE ON public.module_permissions FOR EACH ROW EXECUTE FUNCTION public.hub_guard_sensitive_grant();');
  async function seed() {
    await db.query('TRUNCATE public.accounting_invoice_items, public.accounting_invoice_payments, public.payment_matches, public.bank_transactions, public.audit_log, public.accounting_proformas, public.accounting_invoices CASCADE');
    await db.query(`INSERT INTO public.accounting_invoices (id, invoice_number, wave_invoice_id, source, is_historical) VALUES
      ('${I(1)}', 'INV-1', NULL, NULL, NULL), ('${I(2)}', 'INV-2', 'W2', NULL, NULL), ('${I(3)}', 'INV-3', NULL, 'wave_import', true),
      ('${I(4)}', 'INV-4', NULL, NULL, NULL), ('${I(5)}', 'INV-5', NULL, NULL, NULL), ('${I(6)}', 'INV-6', NULL, NULL, NULL)`);
    await db.query(`INSERT INTO public.accounting_invoice_items (invoice_id, description) VALUES ('${I(1)}', 'line'), ('${I(6)}', 'line')`);
    await db.query(`INSERT INTO public.accounting_invoice_payments (accounting_invoice_id, amount, voided, bank_transaction_id) VALUES ('${I(4)}', 100, true, '${I(7)}')`);
    await db.query(`INSERT INTO public.payment_matches (invoice_id, voided) VALUES ('${I(5)}', false)`);
    await db.query(`INSERT INTO public.bank_transactions VALUES ('${I(7)}', '${I(1)}', 'reviewed'), ('${I(8)}', '${I(4)}', 'reviewed'), ('${I(9)}', NULL, 'reviewed')`);
    await db.query(`INSERT INTO public.accounting_proformas (id, proforma_number, status, converted_invoice_id) VALUES ('${I(1)}', 'PF-1', 'converted', '${I(1)}'), ('${I(2)}', 'PF-2', 'draft', NULL)`);
  }
  // BEFORE the UM SQL
  await seed();
  var b1 = await as(STAFF, "DELETE FROM public.accounting_invoices WHERE id = '" + I(5) + "'");
  check('BEFORE: the browser role could delete an invoice straight away', !b1.error && b1.count === 1, b1);
  var b2 = await as(STAFF, "UPDATE public.accounting_invoices SET record_status = 'void' WHERE id = '" + I(1) + "'");
  check('BEFORE: … and void one', !b2.error && b2.count === 1, b2);

  var sql = fs.readFileSync(path.join(root, 'sql/v55-83-UM-invoice-delete.sql'), 'utf8');
  await db.query(sql); var r2 = await db.query(sql);
  var checks = (Array.isArray(r2) ? r2[r2.length - 1] : r2).rows;
  check('UM SQL run twice: its check list says OK on every line (6)', checks.length === 6 && checks.every(function (c) { return c.result === 'OK'; }), checks);

  // the switch guard
  var ins = "INSERT INTO public.module_permissions (user_id, module_name, has_access) VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'invoice.delete', true)";
  check('switch: an admin can NOT switch "invoice.delete" on (HUB_GUARD); same for advances.manage', /only the super admin can switch on "invoice\.delete"/.test((await as(STAFF, ins)).error || '') && /HUB_GUARD/.test((await as(STAFF, ins.replace('invoice.delete', 'advances.manage'))).error || ''));
  check('switch: the super admin can switch it on; anyone can switch it OFF', !(await as(SUPER, ins)).error && !(await as(STAFF, ins.replace('true)', 'false)'))).error);

  // the browser: no delete, no status change, no direct call of the step — editing still fine
  await seed();
  var c1 = await as(STAFF, "DELETE FROM public.accounting_invoices WHERE id = '" + I(1) + "'");
  var c2 = await as(SUPER, "UPDATE public.accounting_invoices SET record_status = 'void' WHERE id = '" + I(1) + "'");
  var c3 = await as(STAFF, "UPDATE public.accounting_invoices SET archived_at = now() WHERE id = '" + I(1) + "'");
  var c4 = await as(STAFF, "UPDATE public.accounting_invoices SET void_reason = 'x' WHERE id = '" + I(1) + "'");
  var c5 = await as(STAFF, "UPDATE public.accounting_proformas SET record_status = 'archived' WHERE id = '" + I(2) + "'");
  check('browser: DELETE refused (even signed in as the super admin)', /permission denied/.test(c1.error || ''), c1);
  check('browser: status / archived_at / void_reason changes refused by HUB_GUARD (invoices and proformas), even for the super admin', [c2, c3, c4, c5].every(function (x) { return /HUB_GUARD: void, cancel, archive and restore go through the Hub/.test(x.error || ''); }), [c2, c3, c4, c5]);
  var c6 = await as(STAFF, "UPDATE public.accounting_invoices SET notes = 'edited' WHERE id = '" + I(1) + "'");
  check('browser: editing other fields still works', !c6.error && c6.count === 1, c6);
  var c7 = await as(STAFF, "SELECT public.hub_invoice_lifecycle('{\"action\":\"delete\",\"id\":\"" + I(1) + "\"}'::jsonb)");
  check('browser: cannot call the delete / void step itself', /permission denied/.test(c7.error || ''), c7);

  // delete
  await seed();
  var d1 = await life({ kind: 'invoice', action: 'delete', id: I(1), actor: ACTOR });
  var left1 = await one("SELECT (SELECT count(*) FROM public.accounting_invoices WHERE id = '" + I(1) + "')::int AS inv, (SELECT count(*) FROM public.accounting_invoice_items WHERE invoice_id = '" + I(1) + "')::int AS items, (SELECT review_status FROM public.bank_transactions WHERE id = '" + I(7) + "') AS bt7, (SELECT matched_invoice_id FROM public.bank_transactions WHERE id = '" + I(7) + "') AS bt7inv, (SELECT review_status FROM public.bank_transactions WHERE id = '" + I(9) + "') AS bt9");
  check('delete a clean invoice: invoice + items gone, its bank line back to review (unlinked), other lines untouched', d1.ok === true && d1.released === 1 && left1[0].inv === 0 && left1[0].items === 0 && left1[0].bt7 === 'unreviewed' && left1[0].bt7inv === null && left1[0].bt9 === 'reviewed', [d1, left1]);
  check('… recorded in audit_log with the old values and the actor', (await one("SELECT count(*)::int AS n FROM public.audit_log WHERE record_id = '" + I(1) + "' AND action = 'delete' AND changed_by = '" + ACTOR + "' AND old_values->>'invoice_number' = 'INV-1'"))[0].n === 1);
  var d4 = await life({ kind: 'invoice', action: 'delete', id: I(4), actor: ACTOR });
  var left4 = await one("SELECT (SELECT count(*) FROM public.accounting_invoices WHERE id = '" + I(4) + "')::int AS inv, (SELECT count(*) FROM public.accounting_invoice_payments WHERE accounting_invoice_id = '" + I(4) + "')::int AS pays, (SELECT review_status FROM public.bank_transactions WHERE id = '" + I(8) + "') AS bt8");
  check('an invoice with a payment record (even VOIDED) is NOT deleted — payments are never deleted (would cascade); nothing changed', d4.ok === false && d4.code === 'payments' && left4[0].inv === 1 && left4[0].pays === 1 && left4[0].bt8 === 'reviewed', [d4, left4]);
  var d5 = await life({ kind: 'invoice', action: 'delete', id: I(5), actor: ACTOR });
  check('a live payment match blocks the delete', d5.ok === false && d5.code === 'payments', d5);
  var d2 = await life({ kind: 'invoice', action: 'delete', id: I(2), actor: ACTOR });
  var d2b = await life({ kind: 'invoice', action: 'delete', id: I(2), actor: ACTOR, after_wave_delete: true });
  check('Wave-linked: refused, unless the Wave copy was deleted first (after_wave_delete)', d2.ok === false && d2.code === 'wave' && d2b.ok === true, [d2, d2b]);
  var d3 = await life({ kind: 'invoice', action: 'delete', id: I(3), actor: ACTOR, after_wave_delete: true });
  check('imported from Wave: never deleted, even after a Wave delete', d3.ok === false && d3.code === 'historical', d3);
  var d0 = await life({ kind: 'invoice', action: 'delete', id: I(1), actor: ACTOR });
  check('already gone → not_found', d0.ok === false && d0.code === 'not_found', d0);

  // all or nothing: make the bank-line release fail half-way
  await seed();
  await db.query("CREATE FUNCTION public.qa_boom() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'QA injected bank failure'; END $f$; CREATE TRIGGER qa_boom BEFORE UPDATE ON public.bank_transactions FOR EACH ROW EXECUTE FUNCTION public.qa_boom();");
  var f1 = await life({ kind: 'invoice', action: 'delete', id: I(1), actor: ACTOR });
  var leftF = await one("SELECT (SELECT count(*) FROM public.accounting_invoices WHERE id = '" + I(1) + "')::int AS inv, (SELECT count(*) FROM public.accounting_invoice_items WHERE invoice_id = '" + I(1) + "')::int AS items, (SELECT matched_invoice_id FROM public.bank_transactions WHERE id = '" + I(7) + "') AS bt7inv, (SELECT count(*) FROM public.audit_log)::int AS aud");
  check('injected failure half-way: an error, and NOTHING changed (invoice, items, bank link, audit all as before)', /QA injected bank failure/.test(f1.error || '') && leftF[0].inv === 1 && leftF[0].items === 1 && leftF[0].bt7inv === I(1) && leftF[0].aud === 0, [f1, leftF]);
  await db.query('DROP TRIGGER qa_boom ON public.bank_transactions; DROP FUNCTION public.qa_boom();');

  // two people at the same moment: someone records a payment while the delete is waiting for the lock
  await seed();
  await db2.query('BEGIN'); await db2.query("SELECT 1 FROM public.accounting_invoices WHERE id = '" + I(6) + "' FOR UPDATE");
  var pending = life({ kind: 'invoice', action: 'delete', id: I(6), actor: ACTOR });
  await new Promise(function (r) { setTimeout(r, 400); });
  await db2.query("INSERT INTO public.accounting_invoice_payments (accounting_invoice_id, amount) VALUES ('" + I(6) + "', 50)"); await db2.query('COMMIT');
  var race = await pending;
  var leftR = await one("SELECT (SELECT count(*) FROM public.accounting_invoices WHERE id = '" + I(6) + "')::int AS inv, (SELECT count(*) FROM public.accounting_invoice_payments WHERE accounting_invoice_id = '" + I(6) + "')::int AS pays");
  check('race: the delete waits for the lock, then sees the new payment and refuses; invoice and payment kept', race.ok === false && race.code === 'payments' && leftR[0].inv === 1 && leftR[0].pays === 1, [race, leftR]);

  // void / cancel / archive / restore
  await seed();
  var v1 = await life({ kind: 'invoice', action: 'void', id: I(2), actor: ACTOR, reason: 'customer cancelled' });
  var row2 = (await one("SELECT record_status, void_reason, archived_by, wave_invoice_id FROM public.accounting_invoices WHERE id = '" + I(2) + "'"))[0];
  check('void a Wave-linked invoice: void + reason + who, Wave link kept', v1.ok && row2.record_status === 'void' && row2.void_reason === 'customer cancelled' && row2.archived_by === ACTOR && row2.wave_invoice_id === 'W2', [v1, row2]);
  check('void again → refused (state)', (await life({ kind: 'invoice', action: 'void', id: I(2), actor: ACTOR })).code === 'state');
  var v3 = await life({ kind: 'invoice', action: 'restore', id: I(2), actor: ACTOR });
  check('restore → active', v3.ok && (await one("SELECT record_status FROM public.accounting_invoices WHERE id = '" + I(2) + "'"))[0].record_status === 'active', v3);
  check('restore an active invoice → refused (state)', (await life({ kind: 'invoice', action: 'restore', id: I(1), actor: ACTOR })).code === 'state');
  var v5 = await life({ kind: 'invoice', action: 'archive', id: I(4), actor: ACTOR });
  check('archive an invoice WITH payments is allowed (nothing deleted); its payment record kept', v5.ok && (await one("SELECT count(*)::int AS n FROM public.accounting_invoice_payments WHERE accounting_invoice_id = '" + I(4) + "'"))[0].n === 1, v5);
  check('a deleted-state invoice cannot be deleted (archived → state)', (await life({ kind: 'invoice', action: 'delete', id: I(4), actor: ACTOR })).code === 'state');
  var p1 = await life({ kind: 'proforma', action: 'delete', id: I(1), actor: ACTOR }); var p2 = await life({ kind: 'proforma', action: 'delete', id: I(2), actor: ACTOR });
  check('proformas: a converted one is refused, a plain one deleted', p1.code === 'converted' && p2.ok === true, [p1, p2]);
  check('bad request (unknown action) → refused without changes', (await life({ kind: 'invoice', action: 'erase', id: I(1) })).code === 'bad_request');
  // ── Codex 21:35 / 21:50 — business scope, check_only, membership top-up
  var U1 = 'aaaaaaaa-0000-0000-0000-000000000001', U2 = 'aaaaaaaa-0000-0000-0000-000000000002', U3 = 'aaaaaaaa-0000-0000-0000-000000000003';
  var BA = 'bbbbbbbb-0000-0000-0000-00000000000a', BB = 'bbbbbbbb-0000-0000-0000-00000000000b';
  await db.query(`ALTER TABLE public.accounting_invoices ADD COLUMN business_id uuid; ALTER TABLE public.accounting_proformas ADD COLUMN business_id uuid;
    CREATE TABLE public.businesses (id uuid PRIMARY KEY, name text, created_at timestamptz DEFAULT now());
    CREATE TABLE public.user_business_memberships (user_id uuid, business_id uuid, role text, PRIMARY KEY (user_id, business_id));
    GRANT ALL ON public.businesses, public.user_business_memberships TO service_role;
    INSERT INTO public.users VALUES ('${U3}', NULL, 'staff');
    INSERT INTO public.businesses (id, name) VALUES ('${BA}', 'KTC');
    INSERT INTO public.user_business_memberships VALUES ('${U1}', '${BA}', 'member');`);
  await seed();
  await db.query("UPDATE public.accounting_invoices SET business_id = '" + BA + "' WHERE id IN ('" + I(1) + "', '" + I(2) + "'); UPDATE public.accounting_invoices SET business_id = '" + BB + "' WHERE id = '" + I(6) + "'; UPDATE public.accounting_proformas SET business_id = '" + BB + "' WHERE id = '" + I(2) + "'");
  var before = JSON.stringify(await one('SELECT * FROM public.accounting_invoices ORDER BY id')) + JSON.stringify(await one('SELECT * FROM public.bank_transactions ORDER BY id')) + JSON.stringify(await one('SELECT count(*) FROM public.audit_log'));
  var k1 = await life({ kind: 'invoice', action: 'delete', id: I(1), actor: U1, check_only: true });
  var k2 = await life({ kind: 'invoice', action: 'void', id: I(2), actor: U1, check_only: true });
  var k3 = await life({ kind: 'invoice', action: 'delete', id: I(4), actor: U1, check_only: true });
  var k4 = await life({ kind: 'invoice', action: 'delete', id: I(2), actor: U1, check_only: true });
  var k5 = await life({ kind: 'invoice', action: 'delete', id: I(2), actor: U1, check_only: true, after_wave_delete: true });
  var after = JSON.stringify(await one('SELECT * FROM public.accounting_invoices ORDER BY id')) + JSON.stringify(await one('SELECT * FROM public.bank_transactions ORDER BY id')) + JSON.stringify(await one('SELECT count(*) FROM public.audit_log'));
  check('check_only: says yes / no exactly like the real step (clean ok, payments refused, Wave-linked refused unless after a Wave delete) and changes NOTHING', k1.ok === true && k1.check_only === true && k2.ok === true && k3.code === 'payments' && k4.code === 'wave' && k5.ok === true && before === after, [k1, k2, k3, k4, k5]);
  var sc1 = await life({ kind: 'invoice', action: 'delete', id: I(6), actor: U1 });
  var sc2 = await life({ kind: 'invoice', action: 'void', id: I(6), actor: U1 });
  var sc3 = await life({ kind: 'proforma', action: 'archive', id: I(2), actor: U1 });
  var sc4 = await life({ kind: 'invoice', action: 'delete', id: I(6), actor: U1, check_only: true });
  check('scope: a member of business A cannot delete / void / archive (or even pass the check for) a record of business B — invoices and proformas; nothing changed', [sc1, sc2, sc3, sc4].every(function (x) { return x.ok === false && x.code === 'scope'; }) && (await one("SELECT record_status FROM public.accounting_invoices WHERE id = '" + I(6) + "'"))[0].record_status === 'active', [sc1, sc2, sc3, sc4]);
  var sc5 = await life({ kind: 'invoice', action: 'void', id: I(1), actor: U3 });
  check('scope: a person with NO membership is refused on a record that carries a business', sc5.code === 'scope', sc5);
  var sc6 = await life({ kind: 'invoice', action: 'void', id: I(3), actor: U3 });
  check('scope: a record with no business set is not limited', sc6.ok === true, sc6);
  var sc7 = await life({ kind: 'invoice', action: 'void', id: I(6), actor: U2, is_super: true });
  check('scope: the super admin acts on every business', sc7.ok === true, sc7);
  var sc8 = await life({ kind: 'invoice', action: 'void', id: I(1), actor: U1 });
  check('scope: a member acts on their own business', sc8.ok === true, sc8);
  // top-up: ONE business → users without any membership are added; nobody else changes
  var optF = fs.readFileSync(path.join(root, 'sql/v55-83-UM-business-members-OPTIONAL.sql'), 'utf8').replace(/\r\n/g, '\n');
  var topup = optF.substring(optF.indexOf('/*\n') + 3, optF.lastIndexOf('*/'));
  await db.query(sql);
  check('the UM script itself adds NO memberships (an access change needs approval: it is in the OPTIONAL script)', (await one('SELECT count(*)::int AS n FROM public.user_business_memberships'))[0].n === 1);
  await db.query(topup);
  var mem = await one('SELECT user_id::text AS u, business_id::text AS b FROM public.user_business_memberships ORDER BY 1');
  check('top-up with ONE business: every user without a membership is added to it (3 users, all in business A)', mem.length === 3 && mem.every(function (m) { return m.b === BA; }), mem);
  check('… so that person can now act there', (await life({ kind: 'invoice', action: 'void', id: I(2), actor: U3 })).ok === true);
  await db.query("INSERT INTO public.businesses (id, name) VALUES ('" + BB + "', 'Second'); INSERT INTO public.users VALUES ('aaaaaaaa-0000-0000-0000-000000000004', NULL, 'staff');");
  await db.query(topup);
  check('top-up with TWO businesses: nobody is added anywhere (the super admin decides)', (await one('SELECT count(*)::int AS n FROM public.user_business_memberships'))[0].n === 3);
  // ── Codex 05:46 P1 — the check has its OWN name and can never delete
  await seed();
  var ck = await as('service', 'SELECT public.hub_invoice_lifecycle_check($1::jsonb) AS r', [JSON.stringify({ kind: 'invoice', action: 'delete', id: I(1), actor: ACTOR, is_super: true, check_only: false })]);
  check('hub_invoice_lifecycle_check: even when told check_only=false it changes NOTHING (invoice still there) and answers check_only', !ck.error && ck.rows[0].r.ok === true && ck.rows[0].r.check_only === true && (await one("SELECT count(*)::int AS n FROM public.accounting_invoices WHERE id = '" + I(1) + "'"))[0].n === 1, ck);
  check('… and the browser roles cannot call it', /permission denied/.test((await as(STAFF, "SELECT public.hub_invoice_lifecycle_check('{}'::jsonb)")).error || ''));
} catch (e) { failN++; console.error('  ✗ crashed:', e.message); }
finally {
  try { if (db2) { await db2.end(); } } catch (e) {}
  try { if (db) { await db.end(); } } catch (e) {}
  try { await server.stop(); } catch (e) {}
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) {}
}
console.log('\nUM invoice delete SQL: ' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
