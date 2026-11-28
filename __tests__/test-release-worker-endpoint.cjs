const assert = require('node:assert/strict');
const Module = require('node:module');
require('sucrase/register');
const { DATA_WORKER_VERSION, SCHEMA_WORKER_VERSION } = require('../release-management/lib/selection');
const register = require('../release-management/release-register.json');
const catalog = require('../release-management/warehouse-data-migration-candidates.json');
const acid = {
  ...register.items.find(item => item.id === 'wh-stage-rules'),
  manifest: { dataPlan: {
    kind: 'warehouse-acid-schema-v1', scriptHash: 'a'.repeat(64),
    migrations: catalog.find(plan => plan.id === 'wh-stage-rules').files
      .filter(file => file.path.startsWith('database/migrations/')).map(file => ({ name: file.path.split('/').at(-1), sha256: file.expectedAfter })),
  } },
};
let valid = true; let active = true; let role = 'super_admin'; let dataRequest = null; let calls = [];
let claim = null; let history = [];
const db = { from(table) {
  const q = { select() { return q; }, eq() { return q; }, order() { return q; }, limit() { return q; }, in() { return q; }, upsert(row) { calls.push({ table, row }); return q; }, maybeSingle() { return q; }, then(resolve, reject) {
    const data = table === 'release_worker_credentials' ? { worker: 'registered-worker', enabled: valid } : table === 'users' ? { role, active } :
      table === 'release_execution' ? claim : table === 'release_signoffs' && dataRequest ? { detail: { candidate: dataRequest } } : history;
    return Promise.resolve({ data }).then(resolve, reject);
  } }; return q;
}, async rpc(name, body) { calls.push({ name, body }); return { data: true }; } };
const orig = Module._load;
Module._load = function (name) {
  if (name === 'next/server') return { NextResponse: { json: (body, opts) => ({ body, status: opts?.status || 200 }) } };
  if (name === '@supabase/supabase-js') return { createClient: () => db };
  return orig.apply(this, arguments);
};
const { POST } = require('../src/app/api/releases/worker/route');
async function send(body, token = 'a'.repeat(64)) { return POST({ headers: new Headers({ authorization: 'Bearer ' + token }), json: async () => body }); }
(async () => {
  assert.equal((await send({ op: 'history' }, '')).status, 401);
  valid = false; assert.equal((await send({ op: 'history' })).status, 403); valid = true;
  assert.equal((await send({ op: 'sql', query: 'select * from bank_transactions' })).status, 400);
  assert.equal((await send({ op: 'delete' })).status, 400);
  await send({ op: 'claim', request: 1, worker: 'forged' });
  assert.equal(calls.at(-1).body.p_worker, 'registered-worker');
  dataRequest = register.items.find(item => item.id === 'wh-bug-001');
  const claims = calls.length;
  assert.equal((await send({ op: 'claim', request: 1 })).body.data, false);
  assert.equal(calls.length, claims);
  assert.equal((await send({ op: 'claim', request: 1, version: DATA_WORKER_VERSION })).body.data, true);
  assert.equal((await send({ op: 'claim', request: 1, version: SCHEMA_WORKER_VERSION })).body.data, true);
  dataRequest = acid;
  const oldClaims = calls.length;
  assert.equal((await send({ op: 'claim', request: 1, version: DATA_WORKER_VERSION })).body.data, false);
  assert.equal(calls.length, oldClaims);
  assert.equal((await send({ op: 'claim', request: 1, version: SCHEMA_WORKER_VERSION })).body.data, true);
  dataRequest = { ...acid, dependsOn: [] };
  assert.equal((await send({ op: 'claim', request: 1, version: SCHEMA_WORKER_VERSION })).body.data, false);
  await send({ op: 'heartbeat', enabled: true, version: SCHEMA_WORKER_VERSION });
  assert.equal(calls.at(-1).row.version, SCHEMA_WORKER_VERSION);
  await send({ op: 'heartbeat', enabled: true, worker: 'forged', last_seen: '2099-01-01' });
  assert.equal(calls.at(-1).row.worker, 'registered-worker');
  assert.ok(!calls.at(-1).row.last_seen.startsWith('2099'));
  const id = '00000000-0000-0000-0000-000000000001';
  assert.equal((await send({ op: 'authorized', userId: id })).body.data, true);
  active = false; assert.equal((await send({ op: 'authorized', userId: id })).body.data, false);
  active = true; role = 'admin'; assert.equal((await send({ op: 'authorized', userId: id })).body.data, false);
  dataRequest = null;
  claim = { request_id: 3 };
  history = [{ id: 3, item_id: 'wh-bug-001-save-path', action: 'rollback', ref_id: 2, detail: { versionCheckpoint: 1 } }];
  const rejected = await send({ op: 'history' });
  assert.equal(rejected.status, 409);
  assert.match(rejected.body.error.message, /version changed before the restore/);
  claim = null;
  assert.deepEqual((await send({ op: 'history' })).body.data, history);
  console.log('PASS worker endpoint: scoped access, revocation, registered identity, older workers cannot claim database requests');
})().catch(e => { console.error(e); process.exitCode = 1; });
