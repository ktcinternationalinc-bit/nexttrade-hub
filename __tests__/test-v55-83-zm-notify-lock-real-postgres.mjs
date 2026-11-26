// v55.83-ZM — REAL Postgres run of sql/v55-83-ZE-notify-lock.sql: builds public.notifications exactly as live (26 Nov: 7 columns,
// RLS on, policy allow_all_notifications for everyone, full rights for anon + authenticated), runs the script, then acts as each role:
// anon and authenticated can no longer read, add, change or delete a notice; service_role still can; the rows are kept. Then the
// safety checks (a wrong column set / an extra policy stops it with nothing changed) and the rollback. Needs PGLITE_DIR. Never touches Supabase.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
var here = path.dirname(fileURLToPath(import.meta.url)); var root = path.join(here, '..');
var req = createRequire(path.join(process.env.PGLITE_DIR || root, 'package.json'));
var PGlite;
try { PGlite = (await import('file://' + req.resolve('@electric-sql/pglite').replace(/\\/g, '/'))).PGlite; }
catch (e) { console.log('SKIPPED — @electric-sql/pglite not found (set PGLITE_DIR). Nothing was checked.'); process.exit(2); }
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 500))); }
var SQL = fs.readFileSync(path.join(root, 'sql/v55-83-ZE-notify-lock.sql'), 'utf8');
var ROLLBACK = SQL.split('-- ROLLBACK')[1].split('\n').filter(function (l) { return /^-- (begin|create|grant|commit)/.test(l); }).map(function (l) { return l.substring(3); }).join('\n');
var A = '11111111-1111-1111-1111-111111111111';
var LIVE = `
create role anon; create role authenticated; create role service_role bypassrls; -- as on Supabase
grant usage on schema public to anon, authenticated, service_role;
create table public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid, type text, title text, body text, read boolean default false, created_at timestamptz default now());
alter table public.notifications enable row level security;
create policy allow_all_notifications on public.notifications for all to public using (true);
grant all on table public.notifications to anon, authenticated, service_role;
insert into public.notifications (user_id, type, title, body) values ('${A}', 'ticket_assigned', 'Ticket T-1', 'x'), ('${A}', 'ticket_assigned', 'Ticket T-2', 'y');`;
async function as(db, role, sql) { try { await db.exec('set role ' + role); var r = await db.query(sql); await db.exec('reset role'); return { rows: r.rows }; } catch (e) { try { await db.exec('reset role'); } catch (e2) {} return { error: e.message }; } }
async function rights(db, role) {
  return {
    read: await as(db, role, 'select id from public.notifications'),
    add: await as(db, role, "insert into public.notifications (user_id, type, title) values ('" + A + "', 't', 'x') returning id"),
    change: await as(db, role, 'update public.notifications set read = true returning id'),
    del: await as(db, role, 'delete from public.notifications returning id'),
  };
}
console.log('ZM — notifications lock on real Postgres (PGlite)');

// 0) the hole as it is on live today
var db = new PGlite(); await db.exec(LIVE);
var before = { read: await as(db, 'anon', 'select id from public.notifications'), add: await as(db, 'anon', "insert into public.notifications (user_id, type, title) values ('" + A + "', 't', 'x') returning id") };
check('BEFORE (as live): anon with no sign-in can read the notices', before.read.rows && before.read.rows.length === 2, before.read);
check('BEFORE (as live): anon can add one', before.add.rows && before.add.rows.length === 1, before.add);
await db.exec("delete from public.notifications where title = 'x'");

// 1) the script runs and its proof line is right
var ran = await db.exec(SQL);
var proof = ran[ran.length - 2] && ran[ran.length - 2].rows && ran[ran.length - 2].rows[0];
check('the script runs in one go; proof: rls on, 0 policies, 0 browser rights, 3 server rights, 2 rows kept', proof && proof.rls === true && Number(proof.policies) === 0 && Number(proof.browser_rights) === 0 && Number(proof.server_rights) === 3 && Number(proof.rows_kept) === 2, proof);
var an = await rights(db, 'anon'); var au = await rights(db, 'authenticated');
check('AFTER: anon can no longer read, add, change or delete', an.read.error && an.add.error && an.change.error && an.del.error, an);
check('AFTER: authenticated (the browser, signed in) can no longer read, add, change or delete', au.read.error && au.add.error && au.change.error && au.del.error, au);
var srvRead = await as(db, 'service_role', 'select id from public.notifications');
var srvAdd = await as(db, 'service_role', "insert into public.notifications (user_id, type, title, body, read) values ('" + A + "', 'reminder', 'Server notice', 'z', false) returning id");
var srvMark = await as(db, 'service_role', "update public.notifications set read = true where user_id = '" + A + "' and read = false returning id");
check('AFTER: the Hub server (service_role) still reads, adds and marks read', srvRead.rows && srvRead.rows.length === 2 && srvAdd.rows && srvAdd.rows.length === 1 && srvMark.rows && srvMark.rows.length === 3, [srvRead, srvAdd, srvMark]);
var kept = await db.query('select count(*)::int n from public.notifications');
check('nothing was deleted (2 old rows + the server one)', kept.rows[0].n === 3, kept.rows);
var again = null; try { await db.exec(SQL); again = 'ran'; } catch (e) { again = e.message; }
check('running it a second time is harmless (same end state)', again === 'ran', again);

// 2) safety checks stop it with NOTHING changed
var db2 = new PGlite(); await db2.exec(LIVE); await db2.exec('alter table public.notifications add column target_user uuid');
var stop1 = null; try { await db2.exec(SQL); } catch (e) { stop1 = e.message; try { await db2.exec('rollback'); } catch (eR) {} } // the SQL editor ends the failed transaction the same way
var pol2 = await db2.query("select count(*)::int n from pg_policies where tablename = 'notifications'");
check('SAFETY: a different column set stops it with a plain message, and the policy is still there (nothing changed)', /STOP: public\.notifications has columns/.test(stop1 || '') && pol2.rows[0].n === 1, stop1);
var db3 = new PGlite(); await db3.exec(LIVE); await db3.exec('create policy other_one on public.notifications for select to authenticated using (true)');
var stop2 = null; try { await db3.exec(SQL); } catch (e) { stop2 = e.message; try { await db3.exec('rollback'); } catch (eR) {} }
var g3 = await as(db3, 'anon', 'select id from public.notifications');
check('SAFETY: an extra policy stops it, and anon rights are untouched (nothing changed)', /STOP: .*other polic/.test(stop2 || '') && g3.rows && g3.rows.length === 2, stop2);

// 3) rollback puts back exactly the 26 Nov state
await db.exec(ROLLBACK);
var rb = await rights(db, 'anon');
var pol = await db.query("select policyname, cmd, roles::text r, qual from pg_policies where tablename = 'notifications'");
check('ROLLBACK: allow_all_notifications is back (ALL, public, true) and anon can read again', pol.rows.length === 1 && pol.rows[0].policyname === 'allow_all_notifications' && pol.rows[0].cmd === 'ALL' && /public/.test(pol.rows[0].r) && pol.rows[0].qual === 'true' && rb.read.rows && rb.read.rows.length >= 3, [pol.rows, rb.read]);

console.log('\nZM SQL: ' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
