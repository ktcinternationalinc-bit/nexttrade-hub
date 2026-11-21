// v55.83-XB — the weight-check SQL in a REAL Postgres (PGlite, D:\GITHUB\_test-tools\pglite). Run: node __tests__/test-v55-83-xb-sql.mjs
import fs from 'fs'; import path from 'path'; import { createRequire } from 'module'; import { fileURLToPath, pathToFileURL } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const req = createRequire(path.join(process.env.PGLITE_DIR || 'D:/GITHUB/_test-tools/pglite', 'x.js'));
const { PGlite } = await import(pathToFileURL(req.resolve('@electric-sql/pglite')).href);
let pass = 0, fail = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { fail++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra || ''))); }
async function refused(db, q) { try { await db.exec(q); return false; } catch (e) { return /refused|permission denied|violates|null value|duplicate key/.test(String(e.message)) ? true : ("OTHER ERROR: " + e.message); } }
console.log('XB SQL — real Postgres');
const db = new PGlite();
await db.exec("create role anon; create role authenticated; create role service_role; create table public.vendor_bills (id uuid primary key, vendor_name text); insert into vendor_bills values ('00000000-0000-0000-0000-000000000001','NexPac Corporation');");
const sql = fs.readFileSync(path.join(here, '..', 'sql', 'v55-83-XB-weight-check.sql'), 'utf8');
await db.exec(sql);
let again = 'ok'; try { await db.exec(sql); } catch (e) { again = e.message; }
check('the SQL runs, and runs again safely', again === 'ok', again);
const t = await db.query("select relname, relrowsecurity from pg_class where relname like 'wc\\_%' and relkind='r' order by 1");
check('10 new tables, RLS on every one', t.rows.length === 10 && t.rows.every(r => r.relrowsecurity === true), t.rows);
const U = "'00000000-0000-0000-0000-0000000000aa'";
const B = "'00000000-0000-0000-0000-000000000001'";
const run = await db.query("insert into wc_fetch_runs (trigger, triggered_by, source) values ('recheck', " + U + ", 'nextrade-staging') returning id");
const runId = run.rows[0].id;
check('a fetch run can be FINISHED once', (await refused(db, "update wc_fetch_runs set finished_at = now(), ok = true, complete = true where id = '" + runId + "'")) === false);
check('…but not changed again after it finished', (await refused(db, "update wc_fetch_runs set ok = false where id = '" + runId + "'")) === true);
check('…and never deleted', (await refused(db, "delete from wc_fetch_runs where id = '" + runId + "'")) === true);
await db.exec("insert into wc_receipt_versions (source, receipt_id, version_no, content_hash, state, data, fetch_run_id) values ('nextrade-staging', '11', 1, 'h1', 'present', '{}', '" + runId + "')");
check('a receipt version cannot be edited', (await refused(db, "update wc_receipt_versions set content_hash = 'x'")) === true);
check('…cannot be deleted', (await refused(db, "delete from wc_receipt_versions")) === true);
check('…a second version 1 of the same receipt is refused (unique)', (await refused(db, "insert into wc_receipt_versions (source, receipt_id, version_no, content_hash, state) values ('nextrade-staging', '11', 1, 'h2', 'present')")) === true);
await db.exec("insert into wc_links (bill_id, source, receipt_id, basis, bill_value, receipt_value, state, actor) values (" + B + ", 'nextrade-staging', '11', 'cgt_reference', '9', '9', 'confirmed', " + U + ")");
check('a link with an unknown basis (e.g. release number) is refused', (await refused(db, "insert into wc_links (bill_id, source, receipt_id, basis, state, actor) values (" + B + ", 's', '1', 'release_number', 'confirmed', " + U + ")")) === true);
check('a link cannot be edited or deleted', (await refused(db, "update wc_links set state = 'rejected'")) === true && (await refused(db, "delete from wc_links")) === true);
check('a product mapping with no warehouse product is refused', (await refused(db, "insert into wc_product_maps (family, version, state, vendor_key, item_key, actor) values (gen_random_uuid(), 1, 'active', 'nexpac', 'x', " + U + ")")) === true);
check('a tolerance with neither % nor lb is refused', (await refused(db, "insert into wc_tolerances (version, actor) values (1, " + U + ")")) === true);
check('a decision without a real reason is refused', (await refused(db, "insert into wc_decisions (item_key, kind, reason, actor, evidence_hash, snapshot) values ('k', 'accept_discrepancy', 'ok', " + U + ", 'e', '{}')")) === true);
await db.exec("insert into wc_decisions (item_key, kind, reason, actor, evidence_hash, snapshot, comparison_fp) values ('k', 'accept_discrepancy', 'supplier confirmed the short delivery', " + U + ", 'e', '{}', 'f')");
check('a decision cannot be edited or deleted', (await refused(db, "update wc_decisions set reason = 'changed later'")) === true && (await refused(db, "delete from wc_decisions")) === true);
check('an unknown decision kind is refused', (await refused(db, "insert into wc_decisions (item_key, kind, reason, actor, evidence_hash, snapshot) values ('k', 'mark_paid', 'trying to pay', " + U + ", 'e', '{}')")) === true);
const r1 = await db.query("select wc_save_report($1::jsonb, $2::jsonb) as r", [JSON.stringify({ run_by: JSON.parse(U.replace(/'/g, '"')), date_from: '2026-10-01', date_to: '2026-10-31', status_at_run: 'Open — 1 item outstanding', filters: { vendor: 'NexPac' } }), JSON.stringify([{ item_key: 'a', bill_ids: [JSON.parse(B.replace(/'/g, '"'))], bill_dates: ['2026-10-05'], outcome: 'discrepancy', state: 'unreviewed', needs_attention: true, row: { x: 1 } }, { item_key: 'b', bill_ids: [], outcome: 'warehouse_only', state: 'unreviewed', needs_attention: false, row: {} }])]);
const r2 = await db.query("select wc_save_report($1::jsonb, '[]'::jsonb) as r", [JSON.stringify({ run_by: JSON.parse(U.replace(/'/g, '"')), status_at_run: 'Complete — every item decided' })]);
check('reports are numbered WC-YYYY-0001, WC-YYYY-0002 (unique, from a sequence)', /^WC-\d{4}-0001$/.test(r1.rows[0].r.report_no) && /^WC-\d{4}-0002$/.test(r2.rows[0].r.report_no) && r1.rows[0].r.items === 2, [r1.rows, r2.rows]);
const items = await db.query("select seq, item_key, bill_dates from wc_report_items order by seq");
check('report items saved in order with their bill dates', items.rows.length === 2 && items.rows[0].item_key === 'a' && items.rows[1].seq === 2);
check('a saved report and its items can never be changed or deleted', (await refused(db, "update wc_reports set status_at_run = 'Complete'")) === true && (await refused(db, "delete from wc_report_items")) === true);
let bad = 'no'; try { await db.query("select wc_save_report($1::jsonb, '[{\"item_key\":\"z\",\"bill_ids\":[\"not-a-uuid\"],\"outcome\":\"x\",\"state\":\"y\",\"row\":{}}]'::jsonb)", [JSON.stringify({ run_by: JSON.parse(U.replace(/'/g, '"')), status_at_run: 'x' })]); } catch (e) { bad = 'refused'; }
const cnt = await db.query("select count(*)::int n from wc_reports");
check('a report whose items fail is saved NOT AT ALL (one transaction)', bad === 'refused' && cnt.rows[0].n === 2);
await db.exec("set role authenticated");
check('the browser role (authenticated) cannot read decisions', (await refused(db, "select * from wc_decisions")) === true);
check('…nor save a report', (await refused(db, "select wc_save_report('{}'::jsonb, '[]'::jsonb)")) === true);
await db.exec("reset role; set role anon");
check('anon cannot read receipt copies', (await refused(db, "select * from wc_receipt_versions")) === true);
await db.exec("reset role");
console.log('\nXB SQL: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
