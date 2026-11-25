// v55.83-YX — wc_vendor_scope SQL in a REAL Postgres (PGlite, D:\GITHUB\_test-tools\pglite), starting from Supabase-like permissive
// default privileges, after the exact XB and XW scripts. Run: node __tests__/test-v55-83-yx-vendor-scope-sql.mjs
import fs from 'fs'; import path from 'path'; import { createRequire } from 'module'; import { fileURLToPath, pathToFileURL } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const req = createRequire(path.join(process.env.PGLITE_DIR || 'D:/GITHUB/_test-tools/pglite', 'x.js'));
const { PGlite } = await import(pathToFileURL(req.resolve('@electric-sql/pglite')).href);
let pass = 0, fail = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { fail++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra))); }
async function err(db, q) { try { await db.exec(q); return null; } catch (e) { try { await db.exec('rollback'); } catch (e2) { /* none */ } return String(e.message); } }
const sqlDir = path.join(here, '..', 'sql');
const XB = fs.readFileSync(path.join(sqlDir, 'v55-83-XB-weight-check.sql'), 'utf8');
const WX = fs.readFileSync(path.join(sqlDir, 'v55-83-WX-bill-category-rules.sql'), 'utf8');
const XW = fs.readFileSync(path.join(sqlDir, 'v55-83-XW-xb-wx-privileges.sql'), 'utf8');
const YX = fs.readFileSync(path.join(sqlDir, 'v55-83-YX-wc-vendor-scope.sql'), 'utf8');
const MAX = "'f234ed3f-10dc-49ae-8d33-35cae7b27d45'";
async function fresh(withXW) {
  const db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls;" +
    " grant usage on schema public to anon, authenticated, service_role;" +
    " alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
    " alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;" +
    " alter default privileges in schema public grant all on functions to anon, authenticated, service_role;" +
    " create table public.vendor_bills (id uuid primary key, vendor_name text, category text);");
  await db.exec(XB); await db.exec(WX); if (withXW) { await db.exec(XW); }
  return db;
}
console.log('YX SQL — vendor scope table, real Postgres, Supabase-like defaults');
const db = await fresh(true);
const r1 = await db.exec(YX); let again = null; try { await db.exec(YX); } catch (e) { again = e.message; }
const chk = r1[r1.length - 1].rows[0];
check('installs after XB + XW, runs again safely, and its closing check says OK (service_role SELECT, INSERT; browser none; guards present)', again === null && chk.result === 'OK' && chk.service_role_rights === 'SELECT, INSERT' && chk.browser_rights === 'none', [again, chk]);
await db.exec('set role service_role');
const ins = await err(db, "insert into wc_vendor_scope (version, vendor_keys, vendor_names, actor) values (1, array['nexpac','kronos logistics'], array['NexPac Corporation','Kronos Logistics'], " + MAX + ")");
const rd = (await db.query('select version, vendor_keys from wc_vendor_scope')).rows;
check('the server can save a selection and read it back', ins === null && rd.length === 1 && rd[0].vendor_keys.join() === 'nexpac,kronos logistics', [ins, rd]);
const dupV = await err(db, "insert into wc_vendor_scope (version, vendor_keys, vendor_names, actor) values (1, array['nexpac'], array['NexPac'], " + MAX + ")");
const empty = await err(db, "insert into wc_vendor_scope (version, vendor_keys, vendor_names, actor) values (2, array[]::text[], array[]::text[], " + MAX + ")");
check('a second version 1 is refused (unique); an empty selection is refused', !!dupV && !!empty, [dupV, empty]);
const up = await err(db, "update wc_vendor_scope set vendor_keys = array['x']"); const de = await err(db, 'delete from wc_vendor_scope'); const tr = await err(db, 'truncate wc_vendor_scope');
check('service_role cannot change, delete or empty it (permission denied)', /permission denied/.test(up || '') && /permission denied/.test(de || '') && /permission denied/.test(tr || ''), [up, de, tr]);
await db.exec('reset role');
const oup = await err(db, "update wc_vendor_scope set note = 'x'"); const otr = await err(db, 'truncate wc_vendor_scope');
check('even the owner cannot edit or empty it (row guard + TRUNCATE guard)', /never changed or deleted/.test(oup || '') && /TRUNCATE on wc_vendor_scope is refused/.test(otr || ''), [oup, otr]);
for (const role of ['anon', 'authenticated']) { await db.exec('set role ' + role); const rs = await err(db, 'select * from wc_vendor_scope'); await db.exec('reset role'); check(role + ' cannot read it', /permission denied/.test(rs || ''), rs); }
check('every saved row is still there', (await db.query('select count(*)::int n from wc_vendor_scope')).rows[0].n === 1);
const db2 = await fresh(false);
await db2.exec('drop function public.wc_refuse_truncate() cascade').catch(() => {});
const miss = await err(db2, YX); const there = (await db2.query("select to_regclass('public.wc_vendor_scope') is not null as t")).rows[0].t;
check('without XW (no TRUNCATE guard function) it stops with "run the XB and XW scripts first" and creates nothing', /run the XB and XW scripts first/.test(miss || '') && there === false, [miss, there]);
console.log('\nYX SQL: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
