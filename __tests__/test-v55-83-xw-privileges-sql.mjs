// v55.83-XW — the XB / WX privilege correction in a REAL Postgres (PGlite, D:\GITHUB\_test-tools\pglite).
// The fixture STARTS like Supabase: default privileges give anon, authenticated and service_role EVERY right on new tables,
// sequences and functions, and service_role bypasses RLS. Then the exact XB and WX scripts are installed, the gap is shown,
// XW is run (twice) and the result is checked. Run: node __tests__/test-v55-83-xw-privileges-sql.mjs
import fs from 'fs'; import path from 'path'; import { createRequire } from 'module'; import { fileURLToPath, pathToFileURL } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const req = createRequire(path.join(process.env.PGLITE_DIR || 'D:/GITHUB/_test-tools/pglite', 'x.js'));
const { PGlite } = await import(pathToFileURL(req.resolve('@electric-sql/pglite')).href);
let pass = 0, fail = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { fail++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra))); }
async function err(db, q) { try { await db.exec(q); return null; } catch (e) { try { await db.exec('rollback'); } catch (e2) { /* not in a transaction */ } return String(e.message); } }
const sqlDir = path.join(here, '..', 'sql');
const XB = fs.readFileSync(path.join(sqlDir, 'v55-83-XB-weight-check.sql'), 'utf8');
const WX = fs.readFileSync(path.join(sqlDir, 'v55-83-WX-bill-category-rules.sql'), 'utf8');
const XW = fs.readFileSync(path.join(sqlDir, 'v55-83-XW-xb-wx-privileges.sql'), 'utf8');
const CHECK = XW.substring(XW.indexOf('-- check after running'));
const TABLES = ['bill_category_rules', 'wc_decisions', 'wc_fetch_runs', 'wc_links', 'wc_product_maps', 'wc_receipt_seen', 'wc_receipt_versions', 'wc_ref_searches', 'wc_report_items', 'wc_reports', 'wc_tolerances'];
const U = "'00000000-0000-0000-0000-0000000000aa'"; const B = "'00000000-0000-0000-0000-000000000001'";

async function fresh(withWx) {
  const db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls;" +
    " grant usage on schema public to anon, authenticated, service_role;" +
    " alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
    " alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;" +
    " alter default privileges in schema public grant all on functions to anon, authenticated, service_role;" +
    " create table public.vendor_bills (id uuid primary key, vendor_name text, category text); insert into vendor_bills values (" + B + ", 'NexPac Corporation', null);");
  await db.exec(XB);
  if (withWx) { await db.exec(WX); }
  return db;
}
async function counts(db) { const o = {}; for (const t of TABLES) { o[t] = Number((await db.query('select count(*)::int as n from public.' + t)).rows[0].n); } return o; }
async function runCheck(db) { const r = await db.exec(CHECK); return r[r.length - 1].rows; }
async function seed(db, tag) {
  const run = (await db.query("insert into wc_fetch_runs (trigger, triggered_by, source) values ('recheck', " + U + ", 'nextrade-staging') returning id")).rows[0].id;
  await db.exec("insert into wc_receipt_versions (source, receipt_id, version_no, content_hash, state, data, fetch_run_id) values ('nextrade-staging', '" + tag + "', 1, 'h', 'present', '{}', '" + run + "');" +
    " insert into wc_ref_searches (fetch_run_id, source, ref_norm, found) values ('" + run + "', 'nextrade-staging', '9" + tag + "', 1);" +
    " insert into wc_receipt_seen (fetch_run_id, source, receipt_id, content_hash) values ('" + run + "', 'nextrade-staging', '" + tag + "', 'h');" +
    " insert into wc_links (bill_id, source, receipt_id, basis, bill_value, receipt_value, state, actor) values (" + B + ", 'nextrade-staging', '" + tag + "', 'cgt_reference', '9', '9', 'confirmed', " + U + ");" +
    " insert into wc_product_maps (family, version, state, vendor_key, item_key, wh_product_type, actor) values (gen_random_uuid(), 1, 'active', 'nexpac', '" + tag + "', '7', " + U + ");" +
    " insert into wc_tolerances (version, pct, actor) values ((select coalesce(max(version), 0) + 1 from wc_tolerances), 2, " + U + ");" +
    " insert into wc_decisions (item_key, kind, reason, actor, evidence_hash, snapshot, comparison_fp) values ('" + tag + "', 'accept_discrepancy', 'supplier confirmed the short delivery', " + U + ", 'e', '{}', 'f');");
  const rep = await db.query("select wc_save_report($1::jsonb, $2::jsonb) as r", [JSON.stringify({ run_by: '00000000-0000-0000-0000-0000000000aa', date_from: '2026-10-01', date_to: '2026-10-31', status_at_run: 'Open — 1 item outstanding' }), JSON.stringify([{ item_key: tag, bill_ids: ['00000000-0000-0000-0000-000000000001'], bill_dates: ['2026-10-05'], outcome: 'equal', state: 'validated', needs_attention: false, row: {} }])]);
  return { run: run, report: rep.rows[0].r };
}

console.log('XW SQL — XB / WX privilege correction, real Postgres, Supabase-like permissive defaults');
const db = await fresh(true);

console.log('A. the gap, before XW (proves the fixture is permissive like Supabase)');
check('service_role holds TRUNCATE and DELETE on wc_decisions, wc_reports and bill_category_rules', (await db.query("select bool_and(has_table_privilege('service_role', 'public.' || t, 'TRUNCATE') and has_table_privilege('service_role', 'public.' || t, 'DELETE')) as ok from unnest(array['wc_decisions', 'wc_reports', 'bill_category_rules']) t")).rows[0].ok === true);
await seed(db, 'before');
await db.exec("insert into bill_category_rules (name, vendor_match, wave_business_id, category) values ('Kronos inbound', 'kronos', 'biz', 'Freight in')");
const gap = await err(db, "begin; set local role service_role; truncate public.wc_decisions; rollback;");
check('…and really can empty wc_decisions with TRUNCATE (the row guards do not stop it) — rolled back', gap === null, gap);
check('…the rolled-back TRUNCATE left the rows', (await counts(db)).wc_decisions === 1);

console.log('B. run XW twice — every row is kept');
const before = await counts(db);
const run1 = await db.exec(XW);
const after1 = await counts(db);
let again = null; try { await db.exec(XW); } catch (e) { again = e.message; }
const after2 = await counts(db);
check('XW runs, and runs again safely', again === null, again);
check('no row is removed or added by either run (all 11 tables)', JSON.stringify(before) === JSON.stringify(after1) && JSON.stringify(after1) === JSON.stringify(after2) && TABLES.every(t => before[t] >= 1), [before, after2]);
const chk = run1[run1.length - 1].rows;
check('its closing check lists the 11 tables, every one OK', chk.length === 11 && chk.every(r => r.result === 'OK') && chk.map(r => r.table_name).join() === TABLES.join(), chk);
check('…service_role: SELECT, INSERT on XB tables; + UPDATE on wc_fetch_runs; SELECT, INSERT, UPDATE on bill_category_rules; browser roles none; TRUNCATE refused on all', chk.every(r => r.service_role_rights === r.should_be && r.browser_rights === 'none' && r.truncate_refused === 'yes') && chk.filter(r => r.table_name === 'wc_fetch_runs')[0].service_role_rights === 'SELECT, INSERT, UPDATE' && chk.filter(r => r.table_name === 'wc_decisions')[0].service_role_rights === 'SELECT, INSERT' && chk.filter(r => r.table_name === 'bill_category_rules')[0].service_role_rights === 'SELECT, INSERT, UPDATE', chk);

console.log('C. what the Hub does still works (as service_role)');
await db.exec('set role service_role');
let okWork = null; let s2 = null;
try { s2 = await seed(db, 'after'); } catch (e) { okWork = e.message; }
check('service_role can ADD to every XB table (fetch run, receipt version, reference search, receipt seen, link, mapping, tolerance, decision)', okWork === null, okWork);
check('…can SAVE a numbered report with its items (wc_save_report)', s2 && /^WC-\d{4}-\d{4}$/.test(s2.report.report_no) && s2.report.items === 1, s2);
const fin = await err(db, "update wc_fetch_runs set finished_at = now(), ok = true, complete = true where id = '" + (s2 && s2.run) + "'");
check('…can FINISH a warehouse read once', fin === null, fin);
const reads = await db.query("select (select count(*) from wc_decisions)::int d, (select count(*) from wc_reports)::int r, (select count(*) from wc_report_items)::int i, (select count(*) from wc_receipt_seen)::int s");
check('…can READ them (2 decisions, 2 reports, 2 report items, 2 receipts seen)', JSON.stringify(reads.rows[0]) === JSON.stringify({ d: 2, r: 2, i: 2, s: 2 }), reads.rows[0]);
const wxIns = await err(db, "insert into bill_category_rules (name, vendor_match, wave_business_id, category) values ('AMB outbound', 'amb', 'biz', 'Freight out')");
const wxUpd = await err(db, "update bill_category_rules set active = false, version = version + 1, updated_at = now() where vendor_match = 'amb'");
check('…can ADD a bill rule and CHANGE it (switch it off)', wxIns === null && wxUpd === null && (await db.query("select active from bill_category_rules where vendor_match = 'amb'")).rows[0].active === false, [wxIns, wxUpd]);

console.log('D. what must never happen is refused');
const denied = s => !!s && /permission denied/.test(s);
for (const t of ['wc_decisions', 'wc_reports', 'wc_report_items', 'wc_links', 'wc_fetch_runs', 'bill_category_rules']) {
  const tr = await err(db, 'truncate public.' + t + (t === 'wc_reports' ? ' cascade' : ''));
  const de = await err(db, 'delete from public.' + t);
  check('service_role: TRUNCATE and DELETE on ' + t + ' → permission denied', denied(tr) && denied(de), [tr, de]);
}
const upd = await err(db, "update wc_decisions set reason = 'changed later by the server'");
check('service_role: UPDATE on wc_decisions → permission denied (only wc_fetch_runs may be finished)', denied(upd), upd);
const sv = await err(db, "select setval('public.wc_report_no_seq', 1)");
check('service_role: cannot reset the report-number sequence (setval → permission denied); it still takes the next number', denied(sv), sv);
await db.exec('reset role');
const ownerTr = await err(db, 'truncate public.wc_decisions');
const ownerTr2 = await err(db, 'truncate public.wc_reports cascade');
const ownerTr3 = await err(db, 'truncate public.bill_category_rules');
check('even the table OWNER cannot TRUNCATE: the statement guard refuses wc_decisions, wc_reports (+ items) and bill_category_rules', /XB: TRUNCATE on wc_decisions is refused/.test(ownerTr || '') && /TRUNCATE on wc_report(s|_items) is refused/.test(ownerTr2 || '') && /HUB_GUARD: bill rules are never deleted/.test(ownerTr3 || ''), [ownerTr, ownerTr2, ownerTr3]);
for (const role of ['anon', 'authenticated']) {
  await db.exec('set role ' + role);
  const rs = await err(db, 'select * from wc_decisions'); const rb = await err(db, 'select * from bill_category_rules'); const rf = await err(db, "select wc_save_report('{}'::jsonb, '[]'::jsonb)");
  await db.exec('reset role');
  check(role + ': cannot read wc_decisions or bill_category_rules, nor call wc_save_report', denied(rs) && denied(rb) && denied(rf), [rs, rb, rf]);
}
const end = await counts(db);
check('after all of that, every row is still there (nothing emptied)', TABLES.every(t => end[t] >= after2[t]) && end.wc_decisions === 2 && end.bill_category_rules === 2, end);
const rowGuard = await err(db, "update wc_decisions set reason = 'owner edit'");
check('the existing XB row guard still refuses an edit (unchanged by XW)', /never changed or deleted/.test(rowGuard || ''), rowGuard);

console.log('E. the closing check is not a rubber stamp');
const bad = await db.exec("begin; grant delete on public.wc_links to service_role; drop trigger wc_decisions_no_truncate on public.wc_decisions; grant select on public.bill_category_rules to anon;" + CHECK + "; rollback;");
const badRows = bad.filter(r => r.rows && r.rows.length === 11).pop().rows;
const by = n => badRows.filter(r => r.table_name === n)[0];
check('an extra DELETE right, a missing TRUNCATE guard and a browser right each show as PROBLEM', by('wc_links').result === 'PROBLEM' && /DELETE/.test(by('wc_links').service_role_rights) && by('wc_decisions').result === 'PROBLEM' && by('wc_decisions').truncate_refused === 'NO' && by('bill_category_rules').result === 'PROBLEM' && by('bill_category_rules').browser_rights === 'HAS RIGHTS' && badRows.filter(r => r.result === 'OK').length === 8, badRows);
check('…and that was rolled back (all OK again)', (await runCheck(db)).every(r => r.result === 'OK'));

console.log('F. XB or WX not installed → stops at the first line, changes nothing');
const db2 = await fresh(false);
const miss = await err(db2, XW);
const fn = (await db2.query("select to_regprocedure('public.wc_refuse_truncate()') is null as none, has_table_privilege('service_role', 'public.wc_decisions', 'TRUNCATE') as still")).rows[0];
check('without WX: "XW: table public.bill_category_rules is missing — run the XB and WX scripts first. Nothing was changed." and nothing changed', /XW: table public\.bill_category_rules is missing/.test(miss || '') && fn.none === true && fn.still === true, [miss, fn]);

console.log('\nXW SQL: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
