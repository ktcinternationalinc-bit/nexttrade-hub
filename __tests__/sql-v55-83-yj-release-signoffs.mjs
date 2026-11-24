// v55.83-YJ — REAL Postgres 16: sql/v55-83-YJ-release-signoffs.sql, run twice. A sign-off row is never changed,
// deleted or emptied — not even by the server role or the table owner; browsers (anon / authenticated) can neither
// read nor write; the server can only add and read. Needs EMBEDDED_PG_DIR (embedded-postgres + pg).
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
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ok: ' : '  FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 600))); }
var dataDir = path.join(dir, 'data-yj-' + Date.now()); var port = 54000 + Math.floor(Math.random() * 900);
var server = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'test-only', port: port, persistent: false, initdbFlags: ['--encoding=UTF8', '--locale=C'] });
var db;
async function q(sql, p) { try { var r = await db.query(sql, p || []); return { rows: r.rows, count: r.rowCount }; } catch (e) { return { error: e.message }; } }
async function as(role, sql) { await db.query('SET ROLE ' + role); var r = await q(sql); await db.query('RESET ROLE'); return r; }
var U = '00000000-0000-0000-0000-0000000000d1';
try {
  console.log('YJ — release_signoffs on real Postgres 16');
  await server.initialise(); await server.start();
  db = new pg.Client({ host: 'localhost', port: port, user: 'postgres', password: 'test-only', database: 'postgres' }); await db.connect();
  await db.query("CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS; GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;"
    + " ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;"       // like Supabase: new tables are open unless revoked
    + " ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;");
  var sql = fs.readFileSync(path.join(root, 'sql/v55-83-YJ-release-signoffs.sql'), 'utf8');
  await db.query(sql);
  var ins0 = await as('service_role', "INSERT INTO public.release_signoffs (item_id, scope, action, sha, approval_text, signed_by, signed_by_name) VALUES ('wh-a', 'warehouse', 'go', 'abc1234', 'Max: yes, put wh-a on production @ abc1234', '" + U + "', 'Max') RETURNING id");
  var r2 = await db.query(sql);
  var checks = (Array.isArray(r2) ? r2[r2.length - 1] : r2).rows;
  check('SQL run twice: its check list says OK on every line (8)', checks.length === 8 && checks.every(function (c) { return c.result === 'OK'; }), checks);
  check('the server role can add a go', !ins0.error && ins0.rows.length === 1, ins0);
  check('re-running the SQL keeps the existing row', (await q('SELECT count(*)::int AS n FROM public.release_signoffs')).rows[0].n === 1);
  var id = ins0.rows[0].id;

  // never changed, never deleted, never emptied — server role AND the owner
  var e;
  e = await as('service_role', "UPDATE public.release_signoffs SET approval_text = 'forged' WHERE id = " + id); check('server role cannot change a row', !!e.error, e);
  e = await as('service_role', 'DELETE FROM public.release_signoffs WHERE id = ' + id); check('server role cannot delete a row', !!e.error, e);
  e = await as('service_role', 'TRUNCATE public.release_signoffs'); check('server role cannot empty the table', !!e.error, e);
  e = await q("UPDATE public.release_signoffs SET signed_by_name = 'x' WHERE id = " + id); check('even the table owner cannot change a row (guard)', !!e.error && /RELEASE_SIGNOFF_LOCKED/.test(e.error), e);
  e = await q('DELETE FROM public.release_signoffs WHERE id = ' + id); check('even the table owner cannot delete a row (guard)', !!e.error && /RELEASE_SIGNOFF_LOCKED/.test(e.error), e);
  e = await q('TRUNCATE public.release_signoffs'); check('even the table owner cannot empty the table (guard)', !!e.error && /RELEASE_SIGNOFF_LOCKED/.test(e.error), e);
  check('the row is unchanged after all of that', (await q('SELECT approval_text, signed_by_name FROM public.release_signoffs WHERE id = ' + id)).rows[0].approval_text === 'Max: yes, put wh-a on production @ abc1234');

  // browsers get nothing
  for (var role of ['anon', 'authenticated']) {
    e = await as(role, 'SELECT * FROM public.release_signoffs'); check(role + ' cannot read', !!e.error, e);
    e = await as(role, "INSERT INTO public.release_signoffs (item_id, scope, action, sha, approval_text, signed_by) VALUES ('wh-a', 'warehouse', 'go', 'abc1234', 'forged go text', '" + U + "')"); check(role + ' cannot add a go', !!e.error, e);
    e = await as(role, 'DELETE FROM public.release_signoffs'); check(role + ' cannot delete', !!e.error, e);
  }
  check('no forged row arrived', (await q('SELECT count(*)::int AS n FROM public.release_signoffs')).rows[0].n === 1);

  // shape rules
  function ins(cols, vals) { return as('service_role', 'INSERT INTO public.release_signoffs (' + cols + ') VALUES (' + vals + ') RETURNING id'); }
  e = await ins('item_id, scope, action, signed_by', "'wh-a', 'warehouse', 'go', '" + U + "'"); check('a go without a build and its sentence is refused', !!e.error, e);
  e = await ins('item_id, scope, action, sha, approval_text, signed_by', "'wh-a', 'warehouse', 'go', 'abc', 'Max: yes, put wh-a on production', '" + U + "'"); check('a go with a build id shorter than 7 is refused', !!e.error, e);
  e = await ins('item_id, scope, action, signed_by', "'wh-a', 'warehouse', 'rollback', '" + U + "'"); check('a roll-back request without its sentence is refused', !!e.error, e);
  e = await ins('item_id, scope, action, signed_by', "'wh-a', 'warehouse', 'deploy', '" + U + "'"); check('an unknown action is refused', !!e.error, e);
  e = await ins('item_id, scope, action, target, signed_by', "'wh-a', 'warehouse', 'withdraw', 'staging', '" + U + "'"); check('a target other than production is refused', !!e.error, e);
  e = await ins('item_id, scope, action, signed_by', "'wh-a', 'hub', 'withdraw', '" + U + "'"); check('a scope other than warehouse is refused (the Hub is not handled here)', !!e.error, e);
  e = await ins('id, item_id, scope, action, signed_by', "500, 'wh-a', 'warehouse', 'withdraw', '" + U + "'"); check('the row number cannot be chosen by the writer', !!e.error, e);
  e = await ins('item_id, scope, action, sha, approval_text', "'wh-a', 'warehouse', 'go', 'abc1234', 'Max: yes, put wh-a on production'"); check('a go with no signer is refused', !!e.error, e);

  // the real flow: go -> moved -> checked -> roll back asked -> rolled back, each a new row
  var w = await ins('item_id, scope, action, sha, signed_by, signed_by_name', "'wh-a', 'warehouse', 'withdraw', 'abc1234', '" + U + "', 'Max'"); check('taking a go back is a NEW row', !w.error && w.rows[0].id > id, w);
  var B = '{"backup":"/home/u/code-backups/wh-a-20261124101010","title":"A"}';
  e = await ins('item_id, scope, action, sha, detail, ref_id', "'wh-a', 'warehouse', 'moved', 'abc1234', '" + B + "'::jsonb, " + id); check('a move row without who recorded it is refused', !!e.error, e);
  e = await ins('item_id, scope, action, detail, ref_id, recorded_by', "'wh-a', 'warehouse', 'moved', '" + B + "'::jsonb, " + id + ", 'KTC office PC (Claude)'"); check('a move row without the build is refused', !!e.error, e);
  e = await ins('item_id, scope, action, sha, detail, ref_id, recorded_by', "'wh-a', 'warehouse', 'moved', 'abc1234', '{}'::jsonb, " + id + ", 'KTC office PC (Claude)'"); check('a move row without the backup folder is refused', !!e.error, e);
  e = await ins('item_id, scope, action, sha, detail, recorded_by', "'wh-a', 'warehouse', 'moved', 'abc1234', '" + B + "'::jsonb, 'KTC office PC (Claude)'"); check('a move row that points at no go is refused', !!e.error, e);
  e = await ins('item_id, scope, action, sha, detail, ref_id, recorded_by', "'wh-a', 'warehouse', 'moved', 'abc1234', '" + B + "'::jsonb, 999999, 'KTC office PC (Claude)'"); check('a move row that points at a row that does not exist is refused', !!e.error, e);
  var mv = await ins('item_id, scope, action, sha, detail, ref_id, recorded_by', "'wh-a', 'warehouse', 'moved', 'abc1234', '" + B + "'::jsonb, " + id + ", 'KTC office PC (Claude)'"); check('a complete moved row is added', !mv.error, mv);
  var ck = await ins('item_id, scope, action, sha, detail, recorded_by', "'wh-a', 'warehouse', 'checked_live', 'abc1234', '" + B + "'::jsonb, 'KTC office PC (Claude)'"); check('a checked_live row is added', !ck.error, ck);
  var rq = await ins('item_id, scope, action, sha, approval_text, signed_by, signed_by_name', "'wh-a', 'warehouse', 'rollback', 'abc1234', 'Max: roll wh-a back @ abc1234', '" + U + "', 'Max'"); check('a roll-back request that names no backup folder is refused', !!rq.error, rq);
  rq = await ins('item_id, scope, action, approval_text, detail, signed_by', "'wh-a', 'warehouse', 'rollback', 'Max: roll wh-a back', '" + B + "'::jsonb, '" + U + "'"); check('a roll-back request that names no build is refused', !!rq.error, rq);
  rq = await ins('item_id, scope, action, sha, approval_text, detail, ref_id, signed_by, signed_by_name', "'wh-a', 'warehouse', 'rollback', 'abc1234', 'Max: roll wh-a back @ abc1234', '" + B + "'::jsonb, " + mv.rows[0].id + ", '" + U + "', 'Max'"); check('a roll-back request naming its build, backup folder and the move it undoes is added', !rq.error, rq);
  var rf = await ins('item_id, scope, action, sha, detail, ref_id, recorded_by', "'wh-a', 'warehouse', 'rollback_failed', 'abc1234', '{\"note\":\"site 500\"}'::jsonb, " + rq.rows[0].id + ", 'KTC office PC (Claude)'"); check('a roll back that did not finish is recorded (no backup claim needed)', !rf.error, rf);
  e = await ins('item_id, scope, action, sha, detail, ref_id, recorded_by', "'wh-a', 'warehouse', 'failed', 'abc1234', '{\"note\":\"x\"}'::jsonb, " + id + ", 'KTC office PC (Claude)'"); check('a failed row that does not say how it ended is refused', !!e.error, e);
  e = await ins('item_id, scope, action, sha, detail, ref_id, recorded_by', "'wh-a', 'warehouse', 'failed', 'abc1234', '{\"outcome\":\"recovery_incomplete\"}'::jsonb, " + id + ", 'KTC office PC (Claude)'"); check('a failed row cannot carry an unconfirmed outcome', !!e.error, e);
  var f1 = await ins('item_id, scope, action, sha, detail, ref_id, recorded_by', "'wh-a', 'warehouse', 'failed', 'abc1234', '{\"outcome\":\"restored\"}'::jsonb, " + id + ", 'KTC office PC (Claude)'"); check('a failed row with outcome restored is added', !f1.error, f1);
  var f2 = await ins('item_id, scope, action, sha, detail, ref_id, recorded_by', "'wh-a', 'warehouse', 'failed', 'abc1234', '{\"outcome\":\"not_replaced\"}'::jsonb, " + id + ", 'KTC office PC (Claude)'"); check('a failed row with outcome not_replaced is added', !f2.error, f2);
  var ri = await ins('item_id, scope, action, sha, detail, ref_id, recorded_by', "'wh-a', 'warehouse', 'recovery_incomplete', 'abc1234', '{\"outcome\":\"recovery_incomplete\"}'::jsonb, " + id + ", 'KTC office PC (Claude)'"); check('a recovery_incomplete row is added', !ri.error, ri);
  e = await ins('item_id, scope, action, sha, detail, ref_id, recorded_by', "'wh-a', 'warehouse', 'recovery_confirmed', 'abc1234', '{\"where\":\"staging\"}'::jsonb, " + id + ", 'KTC office PC (Claude)'"); check('a recovery check without who checked what is refused', !!e.error, e);
  e = await ins('item_id, scope, action, sha, detail, ref_id, recorded_by', "'wh-a', 'warehouse', 'recovery_confirmed', 'abc1234', '{\"where\":\"somewhere\",\"checked\":\"Max looked at the three files\"}'::jsonb, " + id + ", 'KTC office PC (Claude)'"); check('a recovery check that does not say staging or live is refused', !!e.error, e);
  var rcv = await ins('item_id, scope, action, sha, detail, ref_id, recorded_by', "'wh-a', 'warehouse', 'recovery_confirmed', 'abc1234', '{\"where\":\"live\",\"checked\":\"Max looked at the three files\"}'::jsonb, " + id + ", 'KTC office PC (Claude)'"); check('a complete recovery check is added', !rcv.error, rcv);
  var rb = await ins('item_id, scope, action, sha, detail, ref_id, recorded_by', "'wh-a', 'warehouse', 'rolled_back', 'abc1234', '" + B + "'::jsonb, " + rq.rows[0].id + ", 'KTC office PC (Claude)'"); check('the roll back is recorded', !rb.error, rb);
  e = await q("UPDATE public.release_signoffs SET detail = '{}'::jsonb WHERE id = " + mv.rows[0].id); check('a move row cannot be changed afterwards either', !!e.error && /RELEASE_SIGNOFF_LOCKED/.test(e.error), e);
  var all = await as('service_role', 'SELECT id, action, created_at FROM public.release_signoffs ORDER BY id'); check('the server reads the whole history, in order, each with its time', !all.error && all.rows.map(function (x) { return x.action; }).join(',') === 'go,withdraw,moved,checked_live,rollback,rollback_failed,failed,failed,recovery_incomplete,recovery_confirmed,rolled_back' && all.rows.every(function (x) { return !!x.created_at; }), all);
  check('the SQL file itself removes nothing', !/DROP TABLE|^\s*DELETE\s|^\s*TRUNCATE\s/im.test(sql));
} catch (err) { failN++; console.log('  FAIL: crashed: ' + (err && err.stack || err)); }
try { if (db) { await db.end(); } } catch (e1) { /* closing */ }
try { await server.stop(); } catch (e2) { /* stopping */ }
console.log('\nYJ SQL: ' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
