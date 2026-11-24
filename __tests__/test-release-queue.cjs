const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const root = path.join(__dirname, '..');
let count = 0;
function ok(value, label) { assert.ok(value, label); console.log('PASS ' + label); count++; }
(async () => {
  const db = new PGlite();
  try {
    await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;");
    await db.exec(fs.readFileSync(path.join(root, 'sql/v55-83-YJ-release-signoffs.sql'), 'utf8'));
    const migration = fs.readFileSync(path.join(root, 'sql/warehouse-release-execution.sql'), 'utf8');
    await db.exec(migration); await db.exec(migration);
    ok(true, 'migration runs twice');
    const user = '00000000-0000-0000-0000-000000000001';
    const row = id => ({ item_id: id, action: 'go', sha: 'a'.repeat(40), approval_text: 'Approved: deploy exact build', signed_by: user, signed_by_name: 'Fixture', detail: { execution: 'warehouse-worker-v1' } });
    const q = async (sql, args = []) => (await db.query(sql, args)).rows;
    const enqueue = (rows, heads) => q('select * from release_enqueue($1::jsonb,$2::jsonb)', [JSON.stringify(rows), JSON.stringify(heads)]);
    const claim = async id => (await q('select release_claim($1, $2) as ok', [id, 'fixture-worker']))[0].ok;
    await db.exec('SET ROLE service_role');
    const rows = await enqueue([row('fix-a'), row('fix-c')], { 'fix-a': 0, 'fix-c': 0 });
    ok(rows.length === 2 && rows.every(r => ['fix-a', 'fix-c'].includes(r.item_id)), 'only selected two fixes queued');
    await assert.rejects(enqueue([row('fix-b'), row('fix-a')], { 'fix-b': 0, 'fix-a': 0 }), /state changed/);
    ok((await q("select count(*)::int n from release_signoffs where item_id='fix-b'"))[0].n === 0, 'stale batch inserts nothing');
    ok(await claim(rows[0].id), 'first request claimed');
    ok(!(await claim(rows[0].id)), 'same request cannot execute twice');
    ok(!(await claim(rows[1].id)), 'second worker cannot overlap live execution');
    await assert.rejects(enqueue([{ ...row('fix-a'), action: 'withdraw' }], { 'fix-a': rows[0].id }), /executing/);
    ok(true, 'withdraw cannot race an active execution');
    await assert.rejects(q('select release_finish($1,$2,$3::jsonb,false)', [rows[0].id, 'wrong-worker', JSON.stringify({ action: 'moved', detail: { backup: '/home/test/code-backups/one' } })]), /owned/);
    ok(true, 'another worker cannot finish the claim');
    const finished = await q('select release_finish($1,$2,$3::jsonb,false) as id', [rows[0].id, 'fixture-worker', JSON.stringify({ action: 'moved', detail: { backup: '/home/test/code-backups/one' } })]);
    const move = finished[0].id;
    await q('select release_check($1,$2,$3,$4,$5)', [move, move, 'Checked fixture page renders and controls work.', user, 'Fixture']);
    ok((await q("select count(*)::int n from release_signoffs where action='checked_live'"))[0].n === 1, 'production verification is a separate attributed audit event');
    await assert.rejects(q('select release_check($1,$2,$3,$4,$5)', [move, move, 'Duplicate stale check', user, 'Fixture']), /state changed/);
    ok(true, 'stale verification cannot overwrite later events');
    ok(!(await claim(rows[0].id)), 'completed request never replays');
    ok(await claim(rows[1].id), 'next selected request can run after completion');
    await q('select release_finish($1,$2,$3::jsonb,true)', [rows[1].id, 'fixture-worker', JSON.stringify({ action: 'recovery_incomplete', detail: { note: 'Fixture interruption' } })]);
    const third = await enqueue([row('fix-d')], { 'fix-d': 0 });
    ok(!(await claim(third[0].id)), 'uncertain recovery blocks further execution');
    await assert.rejects(q("update release_signoffs set signed_by_name='forged'"));
    ok(true, 'history cannot be rewritten by service role');
    await db.exec('RESET ROLE');
    for (const role of ['anon', 'authenticated']) {
      await db.exec('SET ROLE ' + role);
      for (const sql of ['select * from release_execution', 'select * from release_worker_status', 'select * from release_worker_credentials', "select release_claim(1,'attacker')", "select * from release_enqueue('[]','{}')"]) {
        await assert.rejects(q(sql), /permission denied/);
        ok(true, role + ' denied ' + sql.split('(')[0]);
      }
      await db.exec('RESET ROLE');
    }
    ok((await q("select count(*)::int n from release_signoffs where action='moved'"))[0].n === 1, 'one deployment creates one result audit event');
    console.log(count + ' queue SQL checks passed');
  } finally { await db.close(); }
})().catch(err => { console.error(err); process.exitCode = 1; });
