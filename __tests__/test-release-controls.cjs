const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
require('sucrase/register');
const root = path.join(__dirname, '..');
const selection = require('../release-management/lib/selection');
let checks = 0;
function check(value, label) { assert.ok(value, label); console.log('PASS ' + label); checks++; }
function candidate(id) {
  const manifest = { sha: 'a'.repeat(40), target: 'production', dataCompatible: true, files: [{ path: 'resources/views/' + id + '.blade.php', before: 'b'.repeat(64), after: 'c'.repeat(64) }] };
  const evidence = { sha: manifest.sha, target: 'production', manifestDigest: selection.digest(manifest) };
  return { id, title: 'Fixture ' + id, repo: 'nextrade_WAREHOUSE', status: 'queued', manifest, codexRef: { ...evidence, feedbackRef: 'test-reviewed' }, behavioralQa: { ...evidence, kind: 'behavioral', result: 'PASS' } };
}
const register = { items: ['fix-a', 'fix-b', 'fix-c', 'fix-d'].map(candidate), events: [] };
let caller = 'super'; let role = 'super_admin'; let perms = []; let rows = []; let failRpc = false; let permissionError = false;
let calls = []; let seq = 0;
const db = {
  from(name) {
    const filters = []; let single = false;
    const q = {
      select() { return q; }, eq(k, v) { filters.push(r => r[k] === v); return q; },
      in(k, vs) { filters.push(r => vs.includes(r[k])); return q; }, order() { return q; }, limit() { return q; },
      maybeSingle() { single = true; return q; },
      then(resolve, reject) {
        let data = name === 'users' ? [{ id: caller, role, name: 'Verified fixture user', active: true }] : name === 'module_permissions' ? perms : name === 'release_signoffs' ? rows : name === 'release_worker_status' ? [{ id: 1, enabled: true, last_seen: new Date().toISOString(), worker: 'fixture' }] : [];
        data = data.filter(r => filters.every(f => f(r)));
        return Promise.resolve({ data: single ? data[0] || null : data, error: permissionError && name === 'module_permissions' ? { message: 'unavailable' } : null }).then(resolve, reject);
      }
    }; return q;
  },
  async rpc(name, body) {
    calls.push({ name, body });
    if (failRpc) return { error: { code: 'P0001', message: 'Change state changed; refresh and review again' } };
    const added = body.p_rows.map(r => ({ ...r, id: ++seq, created_at: new Date().toISOString() }));
    rows.push(...added); return { data: added };
  }
};
const original = Module._load;
Module._load = function (name, parent) {
  if (name === 'next/server') return { NextResponse: { json: (body, init) => ({ body, status: init?.status || 200 }) } };
  if (name === '@supabase/supabase-js') return { createClient: () => db };
  if (/verified-caller$/.test(name)) return { verifiedCaller: async () => caller ? { userId: caller } : { error: 'Sign in', status: 401 } };
  if (/release-register\.json$/.test(name)) return register;
  return original.apply(this, arguments);
};
const read = require('../src/app/api/releases/route').GET;
const post = require('../src/app/api/releases/signoff/route').POST;
const worker = require('../release-management/deploy/worker');
const rules = require('../src/lib/release-signoff');
process.chdir(require('node:os').tmpdir());
function body(ids = ['fix-a', 'fix-c']) {
  return { item_ids: ids, action: 'go', confirm: 'DEPLOY', heads: Object.fromEntries(ids.map(id => [id, 0])), builds: Object.fromEntries(ids.map(id => [id, 'a'.repeat(40)])), digests: Object.fromEntries(ids.map(id => [id, selection.digest(register.items.find(it => it.id === id).manifest)])) };
}
async function send(b) { return post({ json: async () => b }); }
(async () => {
  let r = await read({}); check(r.body.canSign && r.body.signoffs['fix-a'].canGo, 'super admin can review eligible candidate');
  role = 'admin'; check((await read({})).body.ok && !(await read({})).body.canSign, 'ordinary admin can view but cannot manage');
  check((await send(body())).status === 403 && calls.length === 0, 'ordinary admin direct POST refused');
  role = 'staff'; check((await read({})).body.ok, 'staff can view without a legacy access grant');
  perms = [{ user_id: caller, module_name: 'releases.manage', has_access: true }];
  check((await read({})).body.canSign, 'explicit release grant enables delegated manager');
  perms.push({ user_id: caller, module_name: 'releases.manage', has_access: false });
  check((await send(body())).status === 403, 'explicit deny overrides grant');
  perms.pop(); permissionError = true;
  check((await send(body())).status === 403, 'permission read failure closes management');
  permissionError = false; caller = null;
  check((await read({})).status === 401 && (await send(body())).status === 401, 'anonymous read and write denied');
  caller = 'super'; role = 'super_admin'; perms = [];
  r = await send(body());
  check(r.status === 200 && r.body.moved === false && rows.map(r => r.item_id).join(',') === 'fix-a,fix-c', 'select two of four queues exactly those two, not all');
  check(rows.every(r => r.signed_by === 'super' && r.detail.candidate.manifest.sha === 'a'.repeat(40)), 'verified signer and immutable artifact snapshot saved');
  check((await send(body())).status === 409, 'duplicate click or stale screen rejected');
  rows = []; calls = []; seq = 0;
  let b = body(); b.builds['fix-a'] = 'd'.repeat(40);
  check((await send(b)).status === 409 && !calls.length, 'changed build is not silently approved');
  b = body(); b.digests['fix-a'] = 'd'.repeat(64);
  check((await send(b)).status === 409 && !calls.length, 'changed manifest/baseline is not silently approved');
  const a = register.items[0]; const old = a.behavioralQa.result; a.behavioralQa.result = 'FAIL';
  check((await send(body())).status === 409, 'failed staging QA blocks release'); a.behavioralQa.result = old;
  failRpc = true; check((await send(body())).status === 409, 'database concurrency refusal reaches user'); failRpc = false;
  let states = Object.fromEntries(register.items.map(it => [it.id, { canGo: true, where: 'staging' }]));
  register.items[2].dependsOn = ['fix-a'];
  let plan = selection.selectionPlan(register.items, states, ['fix-c', 'fix-a'], 'go');
  check(plan.ok && plan.items[0].id === 'fix-a', 'dependencies execute first');
  check(!selection.selectionPlan(register.items, states, ['fix-c'], 'go').ok, 'missing dependency blocked');
  delete register.items[2].dependsOn;
  const overlap = candidate('fix-z'); overlap.manifest.files[0].path = a.manifest.files[0].path;
  check(!selection.selectionPlan([a, overlap], { ...states, 'fix-z': { canGo: true } }, ['fix-a', 'fix-z'], 'go').ok, 'shared files require a reviewed combined release');
  check(selection.candidateProblems({ ...a, dataChange: true }).length > 0, 'data changes excluded');
  check(selection.candidateProblems({ ...a, behavioralQa: { ...a.behavioralQa, kind: 'syntax-only' } }).length > 0, 'syntax-only checks cannot replace functional QA');
  const moved = { id: 31, item_id: 'fix-a', action: 'moved', sha: 'a'.repeat(40), detail: { backup: '/home/test/code-backups/a' } };
  const checked = { ...moved, id: 32, action: 'checked_live' };
  check(worker.activeMoves([moved, checked])['fix-a'].id === 31, 'functional check retains original deployment target');
  const st = rules.latestByItem([moved, checked]);
  const rb = rules.checkSignoff(a, 'rollback', a.title, st['fix-a']);
  check(rb.ok && rb.row.ref_id === 31 && rb.row.detail.backup === moved.detail.backup, 'rollback bound to actual deployment backup and reference');
  check(rules.approvalText('go', a, a.manifest.sha).startsWith('Approved:'), 'delegated approval does not impersonate Max');
  console.log(checks + ' release controls checks passed');
})().catch(err => { console.error(err); process.exitCode = 1; });
