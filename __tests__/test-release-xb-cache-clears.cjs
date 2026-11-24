'use strict';
// Codex 24 Nov 14:30 (P2): the XB receipts-feed LIVE candidate changes routes/api.php and config/services.php, so the release
// worker must clear the route AND config caches, not only views. Runs the REAL worker executeRequest() on the REAL registered item
// with the real committed warehouse blobs; only authorisation, the database and the remote engine are stand-ins, and the review /
// staging-QA records are SYNTHETIC here (never written to the register).
// Run: node __tests__/test-release-xb-cache-clears.cjs   (WAREHOUSE_REPO = the worker's repo, default below)
const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..');
const remote = require(path.join(root, 'release-management/lib/remote'));
const selection = require(path.join(root, 'release-management/lib/selection'));
const worker = require(path.join(root, 'release-management/deploy/worker'));
const register = JSON.parse(fs.readFileSync(path.join(root, 'release-management/release-register.json'), 'utf8'));
const WAREHOUSE_REPO = process.env.WAREHOUSE_REPO || 'D:/GITHUB/nextrade-hubA/output/warehouse-order-queue-candidate';
let pass = 0, fail = 0;
function check(ok, label, extra) { if (ok) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label + (extra === undefined ? '' : '  ' + JSON.stringify(extra).slice(0, 500))); } }

(async function main() {
  const item = register.items.find(i => i.id === 'wh-xb-receipts-feed');
  check(!!item, 'the register lists wh-xb-receipts-feed');
  const paths = item.manifest.files.map(f => f.path);
  check(item.routesChanged === true && item.configChanged === true && paths.indexOf('routes/api.php') >= 0 && paths.indexOf('config/services.php') >= 0,
    'it changes routes/api.php and config/services.php AND says so (routesChanged + configChanged)', { routesChanged: item.routesChanged, configChanged: item.configChanged });
  check(!item.codexRef && !item.behavioralQa && selection.candidateProblems(item).length === 2, 'in the register it is still blocked (no review / staging QA invented)');
  if (!fs.existsSync(WAREHOUSE_REPO)) { check(false, 'warehouse repo not found: ' + WAREHOUSE_REPO); return finish(); }

  // SYNTHETIC evidence, in memory only, so the real executeRequest gets past its gates
  const hash = selection.digest(item.manifest);
  const candidate = Object.assign({}, item, {
    codexRef: { sha: item.manifest.sha, target: 'production', manifestDigest: hash, feedbackRef: 'SYNTHETIC-TEST-ONLY' },
    behavioralQa: { sha: item.manifest.sha, target: 'production', manifestDigest: hash, kind: 'behavioral', result: 'PASS', summary: 'SYNTHETIC-TEST-ONLY' }
  });
  check(selection.candidateProblems(candidate).length === 0, '(test set-up) with synthetic evidence the candidate passes the gates', selection.candidateProblems(candidate));

  // stand-ins: authorisation, history, completion, and the remote engine (records what it is asked to do; touches no server)
  let deployCall = null; let finished = null;
  const realDeploy = remote.deployLive;
  remote.deployLive = function (o) {
    deployCall = { cacheCmds: o.cacheCmds.slice(), files: o.files.slice(), allow: o.allow.slice(), sha: o.sha, staged: o.files.map(f => remote.sha256File(path.join(o.localRoot, f))) };
    return { ok: true, backupDir: '/home/test/code-backups/request-1-x', replaced: o.files.slice(), siteStatus: 200 };
  };
  const chain = { data: [], error: null };
  ['select', 'eq', 'in', 'order', 'limit'].forEach(k => { chain[k] = () => chain; });
  const db = { authorize: async () => true, from: () => chain, rpc: async (fn, args) => { if (fn === 'release_finish') { finished = args; } return { data: true, error: null }; } };
  const request = { id: 1, action: 'go', item_id: item.id, sha: item.manifest.sha, signed_by: 'test-approver', detail: { candidate: candidate, execution: 'warehouse-worker-v1' } };
  const config = { live: { appRoot: '/home/test/public_html', backupRoot: '/home/test/code-backups', checkUrl: 'https://example.invalid/' } };
  let event = null; let err = null;
  try { event = await worker.executeRequest(db, request, config, WAREHOUSE_REPO, 'test-worker', null); } catch (e) { err = e.message; }
  remote.deployLive = realDeploy;

  check(!err && event && event.action === 'moved', 'the real executeRequest moves it (stand-in engine)', err || event);
  check(deployCall && deployCall.cacheCmds.indexOf('php artisan route:clear') >= 0 && deployCall.cacheCmds.indexOf('php artisan config:clear') >= 0 && deployCall.cacheCmds.indexOf('php artisan view:clear') >= 0,
    'the deployment engine is told to run view:clear, config:clear AND route:clear', deployCall && deployCall.cacheCmds);
  check(deployCall && JSON.stringify(deployCall.files) === JSON.stringify(paths) && JSON.stringify(deployCall.allow) === JSON.stringify(paths) && deployCall.sha === item.manifest.sha,
    'exactly the three listed files, from exactly build ' + item.manifest.sha.slice(0, 8), deployCall);
  check(deployCall && deployCall.staged.every((h, i) => h === item.manifest.files[i].after), 'the staged bytes are the committed blobs (each matches its manifest "after")', deployCall && deployCall.staged);
  check(finished && finished.p_event && finished.p_event.action === 'moved', 'the result is recorded through release_finish', finished);

  // contrast: the same item WITHOUT the two flags would only clear views (the Codex reproduction)
  const bare = Object.assign({}, candidate); delete bare.routesChanged; delete bare.configChanged;
  remote.deployLive = function (o) { deployCall = { cacheCmds: o.cacheCmds.slice() }; return { ok: true, backupDir: '/home/test/code-backups/request-2-x', replaced: o.files.slice(), siteStatus: 200 }; };
  await worker.executeRequest(db, Object.assign({}, request, { id: 2, detail: { candidate: bare, execution: 'warehouse-worker-v1' } }), config, WAREHOUSE_REPO, 'test-worker', null);
  remote.deployLive = realDeploy;
  check(deployCall && JSON.stringify(deployCall.cacheCmds) === JSON.stringify(['php artisan view:clear']), '(contrast) without the flags the worker would clear only views — the defect Codex found', deployCall && deployCall.cacheCmds);
  finish();
})().catch(e => { console.error(e); process.exit(1); });
function finish() { console.log(fail ? fail + ' FAILED, ' + pass + ' passed' : pass + ' XB release cache checks passed'); process.exit(fail ? 1 : 0); }
