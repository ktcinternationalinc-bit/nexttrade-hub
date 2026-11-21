// v55.83-XC — REAL Postgres 16: sql/v55-83-XC-wire-confirmation-inbox.sql (run twice). A bank confirmation is never deleted, its
// file never changes, a linked / dismissed decision is final and complete; one note per discrepancy (dedupe key); a note is never
// deleted or rewritten, and only says "sent" with real counts; browsers (anon / authenticated) cannot read or write either table.
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
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 500))); }
var dataDir = path.join(dir, 'data-xc-' + Date.now()); var port = 54000 + Math.floor(Math.random() * 900);
var server = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'test-only', port: port, persistent: false, initdbFlags: ['--encoding=UTF8', '--locale=C'] });
var db;
async function q(sql, p) { try { var r = await db.query(sql, p || []); return { rows: r.rows, count: r.rowCount }; } catch (e) { return { error: e.message }; } }
var W1 = '00000000-0000-0000-0000-0000000000c1'; var U1 = '00000000-0000-0000-0000-0000000000d1';
try {
  console.log('XC — wire confirmation inbox on real Postgres 16');
  await server.initialise(); await server.start();
  db = new pg.Client({ host: 'localhost', port: port, user: 'postgres', password: 'test-only', database: 'postgres' }); await db.connect();
  await db.query("CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS; GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;"
    + " CREATE TABLE public.wire_packages (id uuid PRIMARY KEY, status text DEFAULT 'draft');"
    + " ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;" // like Supabase: new tables are open to browsers unless revoked
    + " INSERT INTO public.wire_packages (id) VALUES ('" + W1 + "');");
  var sql = fs.readFileSync(path.join(root, 'sql/v55-83-XC-wire-confirmation-inbox.sql'), 'utf8');
  await db.query(sql); var r2 = await db.query(sql);
  var checks = (Array.isArray(r2) ? r2[r2.length - 1] : r2).rows;
  check('SQL run twice: its check list says OK on every line (6)', checks.length === 6 && checks.every(function (c) { return c.result === 'OK'; }), checks);

  var a = await q("INSERT INTO public.wire_confirmation_inbox (path, file_name, file_sha256, uploaded_by) VALUES ('pv/wire-inbox-1-a.pdf', 'a.pdf', 'aa', '" + U1 + "') RETURNING id");
  check('a confirmation in the private inbox folder is added', !a.error && a.rows.length === 1, a);
  var id = a.rows && a.rows[0].id;
  check('a path outside pv/wire-inbox- is refused', !!(await q("INSERT INTO public.wire_confirmation_inbox (path) VALUES ('public/x.pdf')")).error, null);
  check('a path with .. is refused', !!(await q("INSERT INTO public.wire_confirmation_inbox (path) VALUES ('pv/wire-inbox-../x.pdf')")).error, null);
  check('the same file twice (same path, or same SHA-256) is refused', !!(await q("INSERT INTO public.wire_confirmation_inbox (path) VALUES ('pv/wire-inbox-1-a.pdf')")).error && !!(await q("INSERT INTO public.wire_confirmation_inbox (path, file_sha256) VALUES ('pv/wire-inbox-2-a.pdf', 'aa')")).error, null);
  var del = await q("DELETE FROM public.wire_confirmation_inbox WHERE id = '" + id + "'");
  check('DELETE is refused: "never deleted — dismiss it with a reason"', /never deleted/.test(del.error || ''), del);
  check('the file of a confirmation cannot change', /cannot change/.test((await q("UPDATE public.wire_confirmation_inbox SET path = 'pv/wire-inbox-9-b.pdf' WHERE id = '" + id + "'")).error || ''), null);
  check('"linked" without who / when / which wire → refused', !!(await q("UPDATE public.wire_confirmation_inbox SET status = 'linked' WHERE id = '" + id + "'")).error, null);
  check('"dismissed" without a reason of 5+ characters → refused', !!(await q("UPDATE public.wire_confirmation_inbox SET status = 'dismissed', dismissed_by = '" + U1 + "', dismissed_at = now(), dismiss_reason = 'no' WHERE id = '" + id + "'")).error, null);
  var ln = await q("UPDATE public.wire_confirmation_inbox SET status = 'linked', linked_package_id = '" + W1 + "', linked_by = '" + U1 + "', linked_at = now() WHERE id = '" + id + "'");
  check('linked with the wire, who and when → saved', !ln.error && ln.count === 1, ln);
  var re = await q("UPDATE public.wire_confirmation_inbox SET status = 'dismissed', dismissed_by = '" + U1 + "', dismissed_at = now(), dismiss_reason = 'changed my mind' WHERE id = '" + id + "'");
  var re2 = await q("UPDATE public.wire_confirmation_inbox SET linked_package_id = NULL WHERE id = '" + id + "'");
  check('a linked decision is final: no switch to dismissed, no un-linking', /already linked/.test(re.error || '') && /already linked/.test(re2.error || ''), [re, re2]);
  check('… a note can still be added to it', !(await q("UPDATE public.wire_confirmation_inbox SET note = 'checked' WHERE id = '" + id + "'")).error, null);

  var n1 = await q("INSERT INTO public.wire_discrepancy_notices (dedupe_key, kind, package_id, note) VALUES ('missing_confirmation:" + W1 + "', 'missing_confirmation', '" + W1 + "', 'no file') RETURNING id");
  var n2 = await q("INSERT INTO public.wire_discrepancy_notices (dedupe_key, kind, package_id, note) VALUES ('missing_confirmation:" + W1 + "', 'missing_confirmation', '" + W1 + "', 'again')");
  check('one note per discrepancy: the same dedupe key a second time is refused', !n1.error && /uq_wdn_dedupe|duplicate/.test(n2.error || ''), [n1, n2]);
  var nid = n1.rows && n1.rows[0].id;
  check('a note cannot be deleted', /never deleted/.test((await q("DELETE FROM public.wire_discrepancy_notices WHERE id = '" + nid + "'")).error || ''), null);
  check('a note\'s words cannot be rewritten', /cannot change/.test((await q("UPDATE public.wire_discrepancy_notices SET note = 'other' WHERE id = '" + nid + "'")).error || ''), null);
  check('"sent" without a real count and time → refused', !!(await q("UPDATE public.wire_discrepancy_notices SET mail_status = 'sent' WHERE id = '" + nid + "'")).error && !!(await q("UPDATE public.wire_discrepancy_notices SET mail_status = 'sent', mail_sent = 0, mail_at = now() WHERE id = '" + nid + "'")).error, null);
  check('"not_sent" with the reason is recorded', !(await q("UPDATE public.wire_discrepancy_notices SET mail_status = 'not_sent', mail_sent = 0, mail_error = 'mail service not set up' WHERE id = '" + nid + "'")).error, null);
  check('… then "sent" with 6 mails and the time is recorded', !(await q("UPDATE public.wire_discrepancy_notices SET mail_status = 'sent', mail_sent = 6, mail_recipients = 6, mail_at = now() WHERE id = '" + nid + "'")).error, null);
  check('once e-mailed, its mail status cannot be changed back', /already e-mailed/.test((await q("UPDATE public.wire_discrepancy_notices SET mail_status = 'not_sent' WHERE id = '" + nid + "'")).error || ''), null);
  check('an unknown kind is refused', !!(await q("INSERT INTO public.wire_discrepancy_notices (dedupe_key, kind, note) VALUES ('x', 'whatever', 'n')")).error, null);

  for (var role of ['anon', 'authenticated']) {
    await db.query('SET ROLE ' + role);
    var s1 = await q('SELECT count(*) FROM public.wire_confirmation_inbox'); var s2 = await q('SELECT count(*) FROM public.wire_discrepancy_notices');
    var i1 = await q("INSERT INTO public.wire_confirmation_inbox (path) VALUES ('pv/wire-inbox-7-z.pdf')");
    await db.query('RESET ROLE');
    check(role + ' (a browser) cannot read either table or add a file', /permission denied/.test(s1.error || '') && /permission denied/.test(s2.error || '') && /permission denied/.test(i1.error || ''), [s1, s2, i1]);
  }
  await db.query('SET ROLE service_role');
  var sv = await q('SELECT count(*)::int AS n FROM public.wire_confirmation_inbox'); var sd = await q("DELETE FROM public.wire_confirmation_inbox");
  await db.query('RESET ROLE');
  check('the Hub\'s server (service role) reads; even it cannot delete', !sv.error && sv.rows[0].n === 1 && !!sd.error, [sv, sd]);
} catch (e) { failN++; console.log('  ✗ FAIL: crashed — ' + e.message); }
finally { try { await db.end(); } catch (e) { /* closed */ } try { await server.stop(); } catch (e) { /* stopped */ } try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) { /* left */ } }
console.log('\nXC wire inbox SQL: ' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
