// v55.83-YH — REAL SQL engine (PGlite): sql/v55-83-YH-canada-history.sql, run three times. The archive lines can be added but never
// changed, deleted or truncated; a load is marked complete once and the same file cannot be complete twice; a decision is never
// edited; browsers (anon / authenticated) cannot read or write any of the four tables.
// Needs PGLITE_DIR = a folder that has @electric-sql/pglite installed (on Max's machine: D:/GITHUB/_test-tools/pglite).
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';
var here = path.dirname(fileURLToPath(import.meta.url)); var root = path.join(here, '..');
var dir = process.env.PGLITE_DIR;
if (!dir) { console.log('SKIPPED — set PGLITE_DIR. Nothing was checked.'); process.exit(2); }
var req = createRequire(path.join(dir, 'package.json'));
const { PGlite } = await import(pathToFileURL(req.resolve('@electric-sql/pglite')).href);
const F = path.join(root, 'sql/v55-83-YH-canada-history.sql');
const db = new PGlite();
let pass = 0, fail = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { fail++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra || '').substring(0, 400))); }
async function tryq(q) { try { await db.exec(q); return null; } catch (e) { return String(e.message || e); } }
await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
const sql = fs.readFileSync(F, 'utf8');
const res = await db.exec(sql);
const rep = res[res.length - 1].rows;
check('install: every verification line OK (6)', rep.length === 6 && rep.every(r => r.result === 'OK'), rep);
check('install twice: no error', (await tryq(sql)) === null);
const rep2 = (await db.exec(sql)).pop().rows;
check('third run still all OK', rep2.every(r => r.result === 'OK'), rep2);
let e;
await db.exec("set role service_role");
e = await tryq("insert into canada_history_batches (id, source_file, data_sha256, receipt_lines, shipment_lines) values ('00000000-0000-4000-8000-000000000001','f','h1',1,1)");
check('service role adds a batch (starts as loading)', e === null, e);
e = await tryq("insert into canada_history_receipts (batch_id, source_row, entry_date, entry_kind, goods_name, weight_lb) values ('00000000-0000-4000-8000-000000000001',5,'2021-06-29','received','Seconds Auto',7513)");
check('adds a received line', e === null, e);
e = await tryq("insert into canada_history_receipts (batch_id, source_row, entry_date, entry_kind, goods_name, weight_lb) values ('00000000-0000-4000-8000-000000000001',643,null,'disposal','Trim',-439474)");
check('adds an undated negative disposal line', e === null, e);
e = await tryq("insert into canada_history_receipts (batch_id, source_row, entry_date, entry_kind, goods_name, weight_lb) values ('00000000-0000-4000-8000-000000000001',6,'2021-06-29','received','Seconds Auto',-1)");
check('a negative RECEIVED line is refused', !!e, e);
e = await tryq("insert into canada_history_receipts (batch_id, source_row, entry_date, entry_kind, goods_name, weight_lb) values ('00000000-0000-4000-8000-000000000001',6,null,'received','Seconds Auto',5)");
check('a received line with no date is refused', !!e, e);
e = await tryq("insert into canada_history_receipts (batch_id, source_row, entry_date, entry_kind, goods_name, weight_lb) values ('00000000-0000-4000-8000-000000000001',6,'2021-06-29','sold','Seconds Auto',5)");
check('an unknown kind is refused', !!e, e);
e = await tryq("insert into canada_history_shipments (batch_id, source_row, ship_date, release_no, customer, goods_name, weight_lb) values ('00000000-0000-4000-8000-000000000001',7,'2021-06-29','1001-677','Customer A','Seconds Auto',53905)");
check('adds a shipped line', e === null, e);
e = await tryq("insert into canada_history_shipments (batch_id, source_row, ship_date, release_no, goods_name, weight_lb) values ('00000000-0000-4000-8000-000000000001',7,'2021-06-29','1001-677','Seconds Auto',0)");
check('a zero shipped weight is refused', !!e, e);
e = await tryq("update canada_history_receipts set weight_lb = 1");
check('UPDATE of a received line is refused', !!e, e);
e = await tryq("delete from canada_history_receipts");
check('DELETE of a received line is refused', !!e, e);
e = await tryq("update canada_history_shipments set customer = 'x'");
check('UPDATE of a shipped line is refused', !!e, e);
e = await tryq("delete from canada_history_shipments");
check('DELETE of a shipped line is refused', !!e, e);
e = await tryq("truncate canada_history_shipments");
check('TRUNCATE is refused', !!e, e);
e = await tryq("update canada_history_batches set receipt_lines = 99 where data_sha256 = 'h1'");
check('changing a batch (other than finishing it) is refused', !!e, e);
e = await tryq("update canada_history_batches set status = 'complete' where data_sha256 = 'h1' and status = 'loading'");
check('a batch is marked complete once', e === null, e);
e = await tryq("update canada_history_batches set status = 'loading' where data_sha256 = 'h1'");
check('...and cannot be un-completed', !!e, e);
e = await tryq("delete from canada_history_batches");
check('a batch cannot be deleted', !!e, e);
e = await tryq("insert into canada_history_batches (id, source_file, data_sha256, receipt_lines, shipment_lines) values ('00000000-0000-4000-8000-000000000002','f','h1',1,1)");
check('a second load attempt of the same file can start (loading)', e === null, e);
e = await tryq("update canada_history_batches set status = 'complete' where id = '00000000-0000-4000-8000-000000000002'");
check('...but the same file cannot be complete twice', !!e, e);
e = await tryq("insert into canada_history_goods_decisions (goods_name, cgt_type, decided_by) values ('Decking','Roofing','max')");
check('a decision is added', e === null, e);
e = await tryq("update canada_history_goods_decisions set cgt_type = 'x'");
check('a decision is never edited', !!e, e);
e = await tryq("delete from canada_history_goods_decisions");
check('a decision is never deleted', !!e, e);
const n = (await db.query("select (select count(*) from canada_history_receipts) r, (select count(*) from canada_history_shipments) s, (select count(*) from canada_history_goods_decisions) d")).rows[0];
check('everything added is still there', Number(n.r) === 2 && Number(n.s) === 1 && Number(n.d) === 1, n);
await db.exec("reset role");
for (const role of ['anon', 'authenticated']) {
  await db.exec("set role " + role);
  for (const t of ['canada_history_batches', 'canada_history_receipts', 'canada_history_shipments', 'canada_history_goods_decisions']) {
    e = await tryq("select * from " + t);
    const e2 = await tryq("insert into " + t + " default values");
    check(role + ' cannot read or write ' + t, !!e && /permission denied/.test(e) && !!e2 && /permission denied/.test(e2), [e, e2]);
  }
  await db.exec("reset role");
}
console.log('\nYH SQL: ' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
