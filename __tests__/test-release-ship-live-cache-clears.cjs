'use strict';
// Max 25 Nov "Yes, switch to live": the LIVE shipping-feed candidate (wh-hub-feed-shipping-live) adds a route to routes/api.php,
// so the release worker must clear the ROUTE cache (not only views); it does not touch config/services.php, so no config:clear.
// Runs the REAL worker executeRequest() on the REAL registered item with the real committed warehouse blobs; only authorisation,
// the database and the remote engine are stand-ins, and the review / staging-QA records are SYNTHETIC here (never written to the register).
// Run: node __tests__/test-release-ship-live-cache-clears.cjs   (WAREHOUSE_REPO = the worker's repo, default below)
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
  const item = register.items.find(i => i.id === 'wh-hub-feed-shipping-live');
  check(!!item, 'the register lists wh-hub-feed-shipping-live');
  const paths = item.manifest.files.map(f => f.path);
  check(item.routesChanged === true && item.configChanged === false && item.dataChange === false && JSON.stringify(paths) === JSON.stringify(['app/Http/Controllers/HubFeedController.php', 'routes/api.php']),
    'it changes the controller and routes/api.php only, and says so (routesChanged true, configChanged false, no data change)', { routesChanged: item.routesChanged, configChanged: item.configChanged, paths: paths });
  const dg = selection.digest(item.manifest);
  check(item.manifest.sha === '09d21b12370a694bfd45eb04f8b6285e41cbcb14' && item.build === item.manifest.sha && dg === '130b64e6453b5d08d2ac1b1df78f05be113f9a388d9729b9e5ae23c01cb99a22',
    'build 09d21b12, manifest digest 130b64e6', { sha: item.manifest.sha, digest: dg });
  const before = item.manifest.files.map(f => f.before);
  check(before[0] === 'f5eb24f9b6d40ac1e00e8d885c6163b58fdf27a385312d1be0352fcf8a3c644d' && before[1] === '39edb117dbbe93dd3d6919d9e70e361e7b7aca05942af04145f5df673d9969e3',
    '"before" fingerprints are the two files as the receipts move (905ef4b8) put them on live', before);
  // 25 Nov: Codex's package review + the owner's Laravel fixtures (incl. the live-schema run) — bound to THIS build and digest
  check(item.codexRef && item.behavioralQa && item.codexRef.sha === item.manifest.sha && item.behavioralQa.sha === item.manifest.sha && item.codexRef.manifestDigest === dg && item.behavioralQa.manifestDigest === dg && /^CODEX_QA_FEEDBACK\.md#codex-qa--25-nov--live-shipping-feed-09d21b12/.test(item.codexRef.feedbackRef) && item.behavioralQa.kind === 'behavioral' && item.behavioralQa.result === 'PASS' && /requirement_columns 51/.test(item.behavioralQa.summary) && selection.candidateProblems(item).length === 0,
    'the register carries Codex\'s review + staging QA for exactly build 09d21b12 / digest 130b64e6, so the item is selectable (Max still has to give the go)', selection.candidateProblems(item));
  const moved = Object.assign({}, item, { manifest: Object.assign({}, item.manifest, { sha: '0000000000000000000000000000000000000000' }) });
  check(selection.candidateProblems(moved).length > 0, '(contrast) the same records do not cover any other build', selection.candidateProblems(moved));
  if (!fs.existsSync(WAREHOUSE_REPO)) { check(false, 'warehouse repo not found: ' + WAREHOUSE_REPO); return finish(); }

  // "before" really is the receipts build's bytes (what the worker put on live), "after" really is this build's bytes
  const cp = require('child_process'); const crypto = require('crypto');
  function blob(sha, p) { return crypto.createHash('sha256').update(cp.execFileSync('git', ['-C', WAREHOUSE_REPO, 'show', sha + ':nextrade-app/' + p])).digest('hex'); }
  check(item.manifest.files.every(f => blob('905ef4b8', f.path) === f.before && blob(item.manifest.sha, f.path) === f.after),
    'every "before" = the committed 905ef4b8 blob and every "after" = the committed 09d21b12 blob');
  check(blob('905ef4b8', 'config/services.php') === blob(item.manifest.sha, 'config/services.php'), 'config/services.php is the same in both builds (so it is not in the manifest)');

  // SYNTHETIC evidence, in memory only, so the real executeRequest gets past its gates
  const candidate = Object.assign({}, item, {
    codexRef: { sha: item.manifest.sha, target: 'production', manifestDigest: dg, feedbackRef: 'SYNTHETIC-TEST-ONLY' },
    behavioralQa: { sha: item.manifest.sha, target: 'production', manifestDigest: dg, kind: 'behavioral', result: 'PASS', summary: 'SYNTHETIC-TEST-ONLY' }
  });
  check(selection.candidateProblems(candidate).length === 0, '(test set-up) with synthetic evidence the candidate passes the gates', selection.candidateProblems(candidate));

  let deployCall = null; let finished = null;
  const realDeploy = remote.deployLive;
  remote.deployLive = function (o) {
    deployCall = { cacheCmds: o.cacheCmds.slice(), files: o.files.slice(), allow: o.allow.slice(), sha: o.sha, staged: o.files.map(f => remote.sha256File(path.join(o.localRoot, f))) };
    return { ok: true, backupDir: '/home/test/code-backups/request-1-x', replaced: o.files.slice(), siteStatus: 200 };
  };
  // history stand-in: the receipts feed (its dependency) is on production, as it is on live since 24 Nov
  const chain = { data: [{ id: 10, scope: 'warehouse', item_id: 'wh-xb-receipts-feed', action: 'moved', sha: '905ef4b81f7c63fd487e4ed372f66c37da9e13ff' }], error: null };
  ['select', 'eq', 'in', 'order', 'limit'].forEach(k => { chain[k] = () => chain; });
  const db = { authorize: async () => true, from: () => chain, rpc: async (fn, args) => { if (fn === 'release_finish') { finished = args; } return { data: true, error: null }; } };
  const request = { id: 1, action: 'go', item_id: item.id, sha: item.manifest.sha, signed_by: 'test-approver', detail: { candidate: candidate, execution: 'warehouse-worker-v1' } };
  const config = { live: { appRoot: '/home/test/public_html', backupRoot: '/home/test/code-backups', checkUrl: 'https://example.invalid/' } };
  let event = null; let err = null;
  try { event = await worker.executeRequest(db, request, config, WAREHOUSE_REPO, 'test-worker', null); } catch (e) { err = e.message; }
  remote.deployLive = realDeploy;

  check(!err && event && event.action === 'moved', 'the real executeRequest moves it (stand-in engine)', err || event);
  check(deployCall && deployCall.cacheCmds.indexOf('php artisan route:clear') >= 0 && deployCall.cacheCmds.indexOf('php artisan view:clear') >= 0 && deployCall.cacheCmds.indexOf('php artisan config:clear') < 0,
    'the deployment engine is told to run view:clear AND route:clear (no config:clear: config is not touched)', deployCall && deployCall.cacheCmds);
  check(deployCall && JSON.stringify(deployCall.files) === JSON.stringify(paths) && JSON.stringify(deployCall.allow) === JSON.stringify(paths) && deployCall.sha === item.manifest.sha,
    'exactly the two listed files, from exactly build ' + item.manifest.sha.slice(0, 8), deployCall);
  check(deployCall && deployCall.staged.every((h, i) => h === item.manifest.files[i].after), 'the staged bytes are the committed blobs (each matches its manifest "after")', deployCall && deployCall.staged);
  check(finished && finished.p_event && finished.p_event.action === 'moved', 'the result is recorded through release_finish', finished);

  // contrast: if the receipts feed were not on production (empty history) the worker refuses before touching anything
  const saved = chain.data; chain.data = []; deployCall = null; let depEvent = null;
  remote.deployLive = function (o) { deployCall = { cacheCmds: o.cacheCmds.slice() }; return { ok: true, backupDir: 'x', replaced: o.files.slice(), siteStatus: 200 }; };
  depEvent = await worker.executeRequest(db, Object.assign({}, request, { id: 3 }), config, WAREHOUSE_REPO, 'test-worker', null);
  remote.deployLive = realDeploy; chain.data = saved;
  check(deployCall === null && depEvent && depEvent.action === 'failed' && /Dependency is not on production: wh-xb-receipts-feed/.test(depEvent.detail && depEvent.detail.note), '(contrast) without the receipts feed on production the move is refused and nothing is sent', depEvent);

  // contrast: without routesChanged the new route would stay invisible behind a cached route table
  const bare = Object.assign({}, candidate); delete bare.routesChanged;
  remote.deployLive = function (o) { deployCall = { cacheCmds: o.cacheCmds.slice() }; return { ok: true, backupDir: '/home/test/code-backups/request-2-x', replaced: o.files.slice(), siteStatus: 200 }; };
  await worker.executeRequest(db, Object.assign({}, request, { id: 2, detail: { candidate: bare, execution: 'warehouse-worker-v1' } }), config, WAREHOUSE_REPO, 'test-worker', null);
  remote.deployLive = realDeploy;
  check(deployCall && JSON.stringify(deployCall.cacheCmds) === JSON.stringify(['php artisan view:clear']), '(contrast) without the flag the worker would clear only views', deployCall && deployCall.cacheCmds);
  finish();
})().catch(e => { console.error(e); process.exit(1); });
function finish() { console.log(fail ? fail + ' FAILED, ' + pass + ' passed' : pass + ' live shipping release cache checks passed'); process.exit(fail ? 1 : 0); }
