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
    + " CREATE TABLE public.wire_packages (id uuid PRIMARY KEY, status text DEFAULT 'draft', funding_txn_id text);"
    + " CREATE TABLE public.wire_package_files (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), package_id uuid NOT NULL REFERENCES public.wire_packages(id), kind text NOT NULL CHECK (kind IN ('bank_confirmation', 'rtm_proof', 'other')), path text NOT NULL, file_name text, uploaded_by uuid, uploaded_at timestamptz NOT NULL DEFAULT now());"
    + " ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;" // like Supabase: new tables are open to browsers unless revoked
    + " INSERT INTO public.wire_packages (id) VALUES ('" + W1 + "');");
  var sql = fs.readFileSync(path.join(root, 'sql/v55-83-XC-wire-confirmation-inbox.sql'), 'utf8');
  await db.query(sql); var r2 = await db.query(sql);
  var checks = (Array.isArray(r2) ? r2[r2.length - 1] : r2).rows;
  check('SQL run twice: its check list says OK on every line (8)', checks.length === 8 && checks.every(function (c) { return c.result === 'OK'; }), checks);

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
  check('rev3: a result straight from "pending" (no claim) is refused', /claim the note/.test((await q("UPDATE public.wire_discrepancy_notices SET mail_status = 'not_sent', mail_sent = 0, mail_error = 'x' WHERE id = '" + nid + "'")).error || ''), null);
  var c1 = await q("UPDATE public.wire_discrepancy_notices SET mail_status = 'sending', mail_claimed_at = now(), mail_claimed_by = '" + U1 + "' WHERE id = '" + nid + "' AND mail_status = 'pending' RETURNING id");
  var c2 = await q("UPDATE public.wire_discrepancy_notices SET mail_status = 'sending', mail_claimed_at = now(), mail_claimed_by = '" + U1 + "' WHERE id = '" + nid + "' AND mail_status = 'pending' RETURNING id");
  check('rev3: the claim (pending → sending) succeeds once; a second claim gets nothing', !c1.error && c1.count === 1 && !c2.error && c2.count === 0, [c1, c2]);
  check('rev3: "sending" cannot go back to "pending"', /put back to pending/.test((await q("UPDATE public.wire_discrepancy_notices SET mail_status = 'pending' WHERE id = '" + nid + "'")).error || ''), null);
  check('rev3: who claimed it cannot change', /cannot change/.test((await q("UPDATE public.wire_discrepancy_notices SET mail_claimed_by = '00000000-0000-0000-0000-0000000000d9' WHERE id = '" + nid + "'")).error || ''), null);
  check('"not_sent" with the reason is recorded (after the claim)', !(await q("UPDATE public.wire_discrepancy_notices SET mail_status = 'not_sent', mail_sent = 0, mail_error = 'mail service not set up' WHERE id = '" + nid + "' AND mail_status = 'sending'")).error, null);
  check('rev3: a note with a result cannot be claimed again', /already has its result/.test((await q("UPDATE public.wire_discrepancy_notices SET mail_status = 'sending' WHERE id = '" + nid + "'")).error || ''), null);
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
  // ── rev2 (Codex 22 Nov 08:26 P2): attaching = ONE step — file on the wire + notes + "linked" saved together or not at all
  var W2 = '00000000-0000-0000-0000-0000000000c2'; var W3 = '00000000-0000-0000-0000-0000000000c3';
  await db.query("INSERT INTO public.wire_packages (id, status) VALUES ('" + W2 + "', 'draft'), ('" + W3 + "', 'cancelled')");
  var b = (await q("INSERT INTO public.wire_confirmation_inbox (path, file_name, file_sha256, status) VALUES ('pv/wire-inbox-3-boom.pdf', 'boom.pdf', 'bb', 'proposed') RETURNING id")).rows[0].id;
  var NOTES = JSON.stringify([{ dedupe_key: 'link:' + b + ':amount', kind: 'amount', note: 'WP: amount differs' }, { dedupe_key: 'link:' + b + ':recipient', kind: 'recipient', note: 'WP: recipient differs' }]);
  var link = function (inbox, wire) { return q("SELECT public.hub_wire_inbox_link($1, $2, $3, 'differs', $4::jsonb) AS r", [inbox, wire, U1, NOTES]); };
  var state = async function () { var r = await q("SELECT (SELECT status FROM public.wire_confirmation_inbox WHERE id = $1) AS st, (SELECT count(*)::int FROM public.wire_package_files WHERE path = 'pv/wire-inbox-3-boom.pdf') AS files, (SELECT count(*)::int FROM public.wire_discrepancy_notices WHERE inbox_id = $1) AS notes", [b]); return r.rows[0]; };
  await db.query("CREATE FUNCTION public.t_fail_file() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'disk full'; END $f$; CREATE TRIGGER t_fail_file BEFORE INSERT ON public.wire_package_files FOR EACH ROW EXECUTE FUNCTION public.t_fail_file();");
  var f1 = await link(b, W2); var s1x = await state();
  check('rev2: the wire-file save fails → the whole step is undone: still "proposed", no file, no note', /disk full/.test(f1.error || '') && s1x.st === 'proposed' && s1x.files === 0 && s1x.notes === 0, [f1, s1x]);
  await db.query('DROP TRIGGER t_fail_file ON public.wire_package_files');
  var ok1 = await link(b, W2); var r1 = ok1.rows && ok1.rows[0].r; var s2x = await state();
  check('rev2: the retry attaches: linked, ONE file, both notes (pending), their ids returned for e-mailing', r1 && r1.ok === true && r1.resumed === false && r1.file_added === true && r1.notice_ids.length === 2 && s2x.st === 'linked' && s2x.files === 1 && s2x.notes === 2, [ok1, s2x]);
  var ok2 = await link(b, W2); var r2x = ok2.rows && ok2.rows[0].r; var s3x = await state();
  check('rev2: the same attach again (answer lost) → ok "resumed": no second file, no second note, nothing to e-mail', r2x && r2x.ok === true && r2x.resumed === true && r2x.file_added === false && r2x.notice_ids.length === 0 && s3x.files === 1 && s3x.notes === 2, [ok2, s3x]);
  var el = await link(b, W1); var rel = el.rows && el.rows[0].r;
  var w1files = (await q("SELECT count(*)::int AS n FROM public.wire_package_files WHERE package_id = $1 AND path = 'pv/wire-inbox-3-boom.pdf'", [W1])).rows[0].n;
  check('rev2: attaching it to ANOTHER wire → refused (linked_elsewhere), nothing put on that wire', rel && rel.ok === false && rel.code === 'linked_elsewhere' && w1files === 0, [el, w1files]);
  var c = (await q("INSERT INTO public.wire_confirmation_inbox (path, file_sha256) VALUES ('pv/wire-inbox-4-c.pdf', 'cc') RETURNING id")).rows[0].id;
  var cx = await q("SELECT public.hub_wire_inbox_link($1, $2, $3, NULL, '[]'::jsonb) AS r", [c, W3, U1]);
  var cst = (await q('SELECT status FROM public.wire_confirmation_inbox WHERE id = $1', [c])).rows[0].status;
  check('rev2: a cancelled wire → refused (wire_not_eligible), the confirmation stays open', !!(cx.rows && cx.rows[0].r.code === 'wire_not_eligible') && cst === 'new', [cx, cst]);
  await db.query('SET ROLE authenticated'); var ax = await q("SELECT public.hub_wire_inbox_link($1, $2, $3, NULL, '[]'::jsonb)", [c, W2, U1]); await db.query('RESET ROLE');
  check('rev2: a browser cannot run the attach step', /permission denied/.test(ax.error || ''), ax);
  // ── rev3: two connections claim the same pending note at the same moment → exactly one gets it (the other waits, then gets 0 rows)
  var rk = (await q("INSERT INTO public.wire_discrepancy_notices (dedupe_key, kind, note) VALUES ('race:1', 'amount', 'race') RETURNING id")).rows[0].id;
  var db2 = new pg.Client({ host: 'localhost', port: port, user: 'postgres', password: 'test-only', database: 'postgres' }); await db2.connect();
  var claimSql = "UPDATE public.wire_discrepancy_notices SET mail_status = 'sending', mail_claimed_at = now(), mail_claimed_by = '" + U1 + "' WHERE id = '" + rk + "' AND mail_status = 'pending' RETURNING id";
  await db.query('BEGIN'); var a1 = await db.query(claimSql);
  var p2 = db2.query(claimSql); // blocks on the row lock until the first commits
  await new Promise(function (r) { setTimeout(r, 300); });
  await db.query('COMMIT'); var a2 = await p2; await db2.end();
  check('rev3: two connections claim at once → the first gets the note, the second gets nothing after the first commits', a1.rowCount === 1 && a2.rowCount === 0, [a1.rowCount, a2.rowCount]);
} catch (e) { failN++; console.log('  ✗ FAIL: crashed — ' + e.message); }
finally { try { await db.end(); } catch (e) { /* closed */ } try { await server.stop(); } catch (e) { /* stopped */ } try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) { /* left */ } }
console.log('\nXC wire inbox SQL: ' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
