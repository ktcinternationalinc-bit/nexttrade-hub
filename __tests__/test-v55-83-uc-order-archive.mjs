// ═══════════════════════════════════════════════════════════════════════════
// v55.83-UC — Orders report: "Non issue" / "Corrected" → archive (never deleted), Archived view, Put back (Max, Nov 18 2026).
// REAL Postgres (PGlite): runs sql/v55-83-UC-order-report-archive.sql (twice) and checks the guard. Needs PGLITE_DIR (not a project
// dependency), e.g. PGLITE_DIR=D:/GITHUB/_test-tools/pglite. Plus wiring checks on the route and the screen.
// Run: PGLITE_DIR=D:/GITHUB/_test-tools/pglite node __tests__/test-v55-83-uc-order-archive.mjs
// ═══════════════════════════════════════════════════════════════════════════
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
var here = path.dirname(fileURLToPath(import.meta.url)); var root = path.join(here, '..');
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra))); }
function read(p) { return fs.readFileSync(path.join(root, p), 'utf8'); }

console.log('UC — the archive table (real Postgres)');
var req = createRequire(path.join(process.env.PGLITE_DIR || root, 'package.json'));
var PGlite = null;
try { PGlite = (await import('file://' + req.resolve('@electric-sql/pglite').replace(/\\/g, '/'))).PGlite; } catch (e) { PGlite = null; }
if (!PGlite) { console.log('  SKIPPED the SQL part — @electric-sql/pglite not found (set PGLITE_DIR). Wiring checks still run.'); }
else {
  var db = new PGlite();
  async function one(sql, params) { return (await db.query(sql, params || [])).rows[0]; }
  async function err(sql, params) { try { await db.query(sql, params || []); return null; } catch (x) { return String(x.message || x); } }
  await db.exec("DO $r$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF; END $r$;"); // Supabase's roles
  var SQL = read('sql/v55-83-UC-order-report-archive.sql');
  var e1 = null; try { await db.exec(SQL); } catch (x) { e1 = String(x.message || x); }
  check('the script runs', !e1, e1);
  var e2 = null; try { await db.exec(SQL); } catch (x) { e2 = String(x.message || x); }
  check('… and runs again safely', !e2, e2);
  var proof = (await db.query("SELECT 'table' AS what, table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'order_report_archive' UNION ALL SELECT 'guard', tgname FROM pg_trigger WHERE tgname = 'order_report_archive_guard'")).rows;
  if (e1) { console.log('  (stopping the SQL part: the script did not run)'); } else {
  check('the table and its guard exist (once)', proof.length === 2, proof);
  var A = (await one("insert into order_report_archive (source, order_id, release_number, choice, note, archived_by, archived_by_name, request_id) values ('nextrade-staging', 1427, '1001-1427', 'non_issue', 'Old order, paid in cash', 'u1', 'Max', 'om-aaaaaaaa') returning *"));
  check('archive a row: who, when, which choice, the note are kept', A && A.choice === 'non_issue' && A.archived_by_name === 'Max' && A.note === 'Old order, paid in cash' && A.archived_at && A.restored_at === null, A);
  check('an unknown choice is refused', /check/i.test(await err("insert into order_report_archive (source, order_id, choice) values ('nextrade-staging', 5, 'whatever')") || ''));
  check('the same order cannot be archived twice at once (one active entry)', /one_active|duplicate/i.test(await err("insert into order_report_archive (source, order_id, choice) values ('nextrade-staging', 1427, 'corrected')") || ''));
  check('… but the same order id on the OTHER warehouse copy is separate', !(await err("insert into order_report_archive (source, order_id, choice) values ('nextrade-live', 1427, 'corrected')")));
  check('the same click twice (same request id) is refused by the database', /duplicate|request_id/i.test(await err("insert into order_report_archive (source, order_id, choice, request_id) values ('nextrade-staging', 999, 'corrected', 'om-aaaaaaaa')") || ''));
  check('DELETE is refused — archived rows are never deleted', /never deleted/.test(await err('delete from order_report_archive where id = $1', [A.id]) || ''));
  check('… nothing was deleted', Number((await one("select count(*)::int as n from order_report_archive")).n) === 2);
  check('editing the choice or note is refused (only put back is allowed)', /cannot be edited/.test(await err("update order_report_archive set choice = 'corrected' where id = $1", [A.id]) || '') && /cannot be edited/.test(await err("update order_report_archive set note = 'x' where id = $1", [A.id]) || ''));
  check('an update that does not put it back is refused', /needs the time/.test(await err("update order_report_archive set restore_note = 'x' where id = $1", [A.id]) || ''));
  var B = await one("update order_report_archive set restored_at = now(), restored_by = 'u2', restored_by_name = 'Jasmine', restore_note = 'still no invoice' where id = $1 and restored_at is null returning *", [A.id]);
  check('put back fills who / when / why, the archive entry stays', B && B.restored_by_name === 'Jasmine' && B.choice === 'non_issue' && B.note === 'Old order, paid in cash');
  check('a put-back entry cannot be changed again (history)', /already put back/.test(await err("update order_report_archive set restored_at = now() where id = $1", [A.id]) || ''));
  check('the route\'s "put back" (… where restored_at is null) finds nothing the second time', (await db.query("update order_report_archive set restored_at = now() where id = $1 and restored_at is null returning id", [A.id])).rows.length === 0);
  check('after put back the order can be archived again (a new entry; the old one is history)', !(await err("insert into order_report_archive (source, order_id, choice, note) values ('nextrade-staging', 1427, 'corrected', 'invoice made')")));
  var hist = (await db.query("select choice, restored_at from order_report_archive where source = 'nextrade-staging' and order_id = 1427 order by archived_at")).rows;
  check('… both entries are there: one put back, one active', hist.length === 2 && hist.filter(function (h) { return h.restored_at === null; }).length === 1, hist);
  var rls = await one("select relrowsecurity from pg_class where relname = 'order_report_archive'");
  check('row security is on (only the Hub server writes it)', rls && rls.relrowsecurity === true);
  }
}

console.log('UC — route wiring');
var R = read('src/app/api/accounting/order-monitor/route.js');
check('archive_row and unarchive_row need Orders: Manage (in the manage-only list)', /'deposit_candidates', 'archive_row', 'unarchive_row'\]\.indexOf\(action\) >= 0\)/.test(R));
check('… and come AFTER verifiedCaller + accounting.view + orders.monitor', R.indexOf("verifiedCaller(req, body, createClient)") < R.indexOf("action === 'archive_row'") && R.indexOf("'orders.monitor'") < R.indexOf("action === 'archive_row'"));
check('only Non issue / Corrected are accepted', /ARCHIVE_CHOICES = \{ non_issue: 'Non issue', corrected: 'Corrected' \}/.test(R) && /hasOwnProperty\.call\(ARCHIVE_CHOICES, choice\)/.test(R));
check('archive inserts (never updates/deletes the order) and is in the audit trail', /from\('order_report_archive'\)\.insert\(/.test(R) && /audit\(db, userId, 'order_report_archived'/.test(R));
check('one click = one entry: request id checked first', /eq\('request_id', reqA\)/.test(R));
check('put back only fills restored_* on an ACTIVE entry of this warehouse copy, audited', /update\(\{ restored_at: [^}]+\}\)\.eq\('id', body\.id\)\.eq\('source', src\)\.is\('restored_at', null\)/.test(R) && /audit\(db, userId, 'order_report_unarchived'/.test(R));
check('nothing in the route deletes from the archive', !/order_report_archive'\)\.delete/.test(R));
check('the report leaves archived rows out of rows (so out of every count) and lists them apart', /var rows = rowsAll\.filter\(function \(r\) \{ return !arch\.map\[String\(r\.id\)\]; \}\);/.test(R) && /rows: rows, archived: archived,[^\n]*archive_ready: arch\.ready/.test(R));
check('a missing archive table does not break the report (says which SQL instead)', /return \{ ready: false, map: \{\} \}/.test(R) && /archive_sql_hint: arch\.ready \? null : ARCHIVE_SQL_HINT/.test(R));
check('the order report shows the archive history', /extra\.archive = ah\.error \? \[\] : \(ah\.data \|\| \[\]\)/.test(R));
check('alerts and the overnight review are not filtered by the archive', !/loadArchive/.test(R.substring(R.indexOf('async function runDeadline'), R.indexOf('export async function GET'))));
var ucCode = R.substring(R.indexOf('var ARCHIVE_CHOICES'), R.indexOf('function rowOf(ev)')) + R.substring(R.indexOf("if (action === 'archive_row')"), R.indexOf("if (action === 'set_deposit_status')")) + R.substring(R.indexOf('var rowsAll ='), R.indexOf('var runs = { deadline'));
check('SWC-safe: no let/const/arrow/template literals in the UC code', ucCode.length > 3000 && !/\b(let|const)\s|=>|`/.test(ucCode.replace(/\/\/[^\n]*/g, '')), ucCode.length);

console.log('UC — screen wiring');
var T = read('src/components/OrderMonitorTab.jsx');
check('two buttons on every row next to Open report: Non issue and ✓ Corrected', />Non issue<\/Btn>/.test(T) && />✓ Corrected<\/Btn>/.test(T) && T.indexOf('>Open report</Btn>') < T.indexOf('>Non issue</Btn>'));
check('… only for Orders: Manage and once the SQL is run', /var canArchive = !!\(data\.can_manage && data\.archive_ready\);/.test(T));
check('optional note, then Archive sends archive_row with a request id', /placeholder="note \(optional\)"/.test(T) && /action: 'archive_row', order_id: r\.id/.test(T) && /payload\.action === 'archive_row'\) && !payload\.request_id/.test(T));
check('the row leaves rows at once, so every count at the top goes down', /rows: \(d\.rows \|\| \[\]\)\.filter\(function \(x\) \{ return x\.id !== r\.id; \}\), archived: \[entry\]/.test(T) && /var k = \{ dead: rows\.filter/.test(T));
check('an Archived filter lists them, with Put back', /\['archived', '🗄 Archived · ' \+ archivedAll\.length\]/.test(T) && /filter === 'archived' && <ArchiveView/.test(T) && /↩ Put back/.test(T) && /action: 'unarchive_row', id: a\.archive\.id/.test(T));
check('Archived shows who, when, choice, note, then vs now', /'Marked', 'By · when', 'Note', 'What it showed then', 'Now'/.test(T));
check('put back says "back on the report" only from the RE-READ report (Codex 12:05), and says so when the re-read fails', /return load\(\)\.then\(function \(fresh\)/.test(T) && /var onReport = \(fresh\.rows \|\| \[\]\)\.some/.test(T) && /could not be read again/.test(T) && !/backOnReport/.test(T));
check('a retried click that was put back meanwhile is NOT called archived (Codex 16:25 P2); where it is now comes from the re-read report', /j\.restored_at \? lblR \+ ': your earlier click had been saved, but the row was put back since — this retry did NOT archive it again\.'/.test(T) && /if \(j\.already_recorded\) \{[\s\S]{0,700}return load\(\)\.then\(function \(fresh\)/.test(T) && !/is in the archive — your earlier click had already gone through/.test(T));
check('a failed refresh is shown on the screen (numbers may be out of date)', /The last refresh failed/.test(T) && /return j; \} setErr/.test(T));

console.log('UC — badge and What\'s New');
check('a v55.83 badge is shown (later builds move it on; realigned in UU)', />v55\.83-[A-Z]{2}<\/span>/.test(read('src/app/page.jsx')));
check('What\'s New still has the v55.83-UC entry (later builds go above it; realigned in UU)', /version: 'v55\.83-UC'/.test(read('src/components/WhatsNewWidget.jsx')));

console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
