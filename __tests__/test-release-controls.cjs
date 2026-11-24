const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
require('sucrase/register');
process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-test-only';
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
let caller = 'super'; let role = 'super_admin'; let perms = []; let rows = []; let failRpc = false; let permissionError = false; let workerVersion = 'warehouse-worker-v1';
let calls = []; let seq = 0;
const db = {
  from(name) {
    const filters = []; let single = false;
    const q = {
      select() { return q; }, eq(k, v) { filters.push(r => r[k] === v); return q; },
      in(k, vs) { filters.push(r => vs.includes(r[k])); return q; }, order() { return q; }, limit() { return q; },
      maybeSingle() { single = true; return q; },
      then(resolve, reject) {
        let data = name === 'users' ? [{ id: caller, role, name: 'Verified fixture user', active: true }] : name === 'module_permissions' ? perms : name === 'release_signoffs' ? rows : name === 'release_worker_status' ? [{ id: 1, enabled: true, version: workerVersion, last_seen: new Date().toISOString(), worker: 'fixture' }] : [];
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
const review = require('../src/app/api/releases/review/route').POST;
const worker = require('../release-management/deploy/worker');
const rules = require('../src/lib/release-signoff');
const { issueReview, reviewState } = require('../src/lib/release-review');
const { prepareDataCommand, executeDataCommand } = require('../release-management/deploy/warehouse-data-plan');
process.chdir(require('node:os').tmpdir());
function body(ids = ['fix-a', 'fix-c']) {
  return { item_ids: ids, action: 'go', confirm: 'DEPLOY', heads: Object.fromEntries(ids.map(id => [id, 0])), builds: Object.fromEntries(ids.map(id => [id, 'a'.repeat(40)])), digests: Object.fromEntries(ids.map(id => [id, selection.digest(register.items.find(it => it.id === id).manifest)])), review_receipt: issueReview(caller, ids, register, reviewState(register, rows).heads) };
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
  const request = body();
  check((await send({ ...request, review_receipt: '' })).status === 409 && calls.length === 0, 'approval without a background review refused');
  const reviewed = await review({ json: async () => ({ item_ids: request.item_ids }) });
  check(reviewed.body.passed && reviewed.body.receipt && calls.length === 0, 'background review reads release state without approval or writes');
  check((await send({ ...request, item_ids: [...request.item_ids].reverse(), review_receipt: reviewed.body.receipt })).status === 409, 'review receipt is bound to the selected changes');
  check((await send({ ...request, review_receipt: issueReview(caller, request.item_ids, register, request.heads, Date.now() - 16 * 60000) })).status === 409, 'old review receipts expire');
  r = await send({ ...request, review_receipt: reviewed.body.receipt });
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
  const liveRegister = JSON.parse(fs.readFileSync(path.join(root, 'release-management/release-register.json'), 'utf8'));
  const palletData = liveRegister.items.find(it => it.id === 'wh-bug-001');
  check(selection.candidateProblems(palletData).length === 0, 'pallet correction binds its exact approved record snapshot and script');
  check(!selection.supportedDataPlan({ ...palletData, id: 'arbitrary-sql' }), 'only the named pallet correction is supported');
  const data = prepareDataCommand(palletData, 29, '~/public_html');
  check(data.backup === 'zz_bug001_units_before_29', 'worker assigns a backup table to this request');
  assert.throws(() => prepareDataCommand(palletData, 29, '~/staging'));
  assert.throws(() => prepareDataCommand({ ...palletData, manifest: { ...palletData.manifest, dataPlan: { ...palletData.manifest.dataPlan, scriptHash: 'a'.repeat(64) } } }, 29, '~/public_html'));
  const closed = executeDataCommand(palletData, data, { run: () => ({ code: 0, out: JSON.stringify({ state: 'blocked', reason: 'Snapshot changed' }) }) });
  check(closed.action === 'failed' && closed.detail.outcome === 'not_replaced', 'a changed database snapshot cannot be treated as a deployment');
  const corrected = executeDataCommand(palletData, data, { run: () => ({ code: 0, out: JSON.stringify({ state: 'moved', updated: data.eligibleCount }) }) });
  check(corrected.action === 'moved' && corrected.detail.backup === data.backup, 'data completion records the checked count and exact backup table');
  assert.throws(() => executeDataCommand(palletData, data, { run: () => ({ code: 0, out: '{}' }) }));
  check(!rules.itemSignState(palletData, { where: 'live', dep: { ...moved, detail: corrected.detail } }).canRollback, 'database correction cannot be passed to code rollback');
  register.items.push(palletData, liveRegister.items.find(it => it.id === 'wh-bug-001-save-path'));
  const reviewData = () => review({ json: async () => ({ item_ids: ['wh-bug-001', 'wh-bug-001-save-path'] }) });
  check(!(await reviewData()).body.passed, 'database review cannot clear with an older worker');
  workerVersion = selection.DATA_WORKER_VERSION;
  const reviewedData = await reviewData();
  check(reviewedData.body.passed && reviewedData.body.results[0].dataChange, 'super admin can review both pallet changes together with the upgraded worker');
  role = 'staff'; perms = [{ user_id: caller, module_name: 'releases.manage', has_access: true }];
  check((await reviewData()).status === 403, 'code release delegation does not authorize database approvals');
  console.log(checks + ' release controls checks passed');
})().catch(err => { console.error(err); process.exitCode = 1; });
