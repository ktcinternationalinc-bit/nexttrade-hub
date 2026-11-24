const assert = require('node:assert/strict');
const Module = require('node:module');
require('sucrase/register');
const { DATA_WORKER_VERSION } = require('../release-management/lib/selection');
let valid = true; let active = true; let role = 'super_admin'; let dataRequest = false; let calls = [];
const db = { from(table) {
  const q = { select() { return q; }, eq() { return q; }, order() { return q; }, limit() { return q; }, in() { return q; }, upsert(row) { calls.push({ table, row }); return q; }, maybeSingle() { return q; }, then(resolve, reject) {
    const data = table === 'release_worker_credentials' ? { worker: 'registered-worker', enabled: valid } : table === 'users' ? { role, active } :
      table === 'release_signoffs' && dataRequest ? { detail: { candidate: { dataChange: true } } } : [];
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
  dataRequest = true;
  const claims = calls.length;
  assert.equal((await send({ op: 'claim', request: 1 })).body.data, false);
  assert.equal(calls.length, claims);
  assert.equal((await send({ op: 'claim', request: 1, version: DATA_WORKER_VERSION })).body.data, true);
  await send({ op: 'heartbeat', enabled: true, worker: 'forged', last_seen: '2099-01-01' });
  assert.equal(calls.at(-1).row.worker, 'registered-worker');
  assert.ok(!calls.at(-1).row.last_seen.startsWith('2099'));
  const id = '00000000-0000-0000-0000-000000000001';
  assert.equal((await send({ op: 'authorized', userId: id })).body.data, true);
  active = false; assert.equal((await send({ op: 'authorized', userId: id })).body.data, false);
  active = true; role = 'admin'; assert.equal((await send({ op: 'authorized', userId: id })).body.data, false);
  console.log('PASS worker endpoint: scoped access, revocation, registered identity, older workers cannot claim database requests');
})().catch(e => { console.error(e); process.exitCode = 1; });
