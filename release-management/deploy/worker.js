#!/usr/bin/env node
'use strict';
// One office-PC poll. The database claim and remote server lock prevent duplicate execution.
// Credentials stay in the existing local env file / SSH key, never in the Hub browser.
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const { channel } = require('../lib/worker-channel');
const remote = require('../lib/remote');
const selection = require('../lib/selection');
const gate = require('../lib/gate');
const { authorized } = require('../lib/worker-authorization');
const VERSION = 'warehouse-worker-v1';
function arg(key) { const i = process.argv.indexOf(key); return i < 0 ? '' : process.argv[i + 1]; }
async function must(query) { const r = await query; if (r.error) throw new Error(r.error.message); return r.data; }
function activeMoves(history) {
  const map = {};
  for (const r of history) {
    if (r.action === 'moved' || (r.action === 'checked_live' && map[r.item_id]?.sha !== r.sha)) map[r.item_id] = r;
    if (r.action === 'rolled_back' || (r.action === 'recovery_confirmed' && r.detail?.where === 'staging')) delete map[r.item_id];
  }
  return map;
}
async function executeRequest(db, request, config, warehouseRepo, worker, runner) {
  let result; let event; let touched = false;
  try {
    if (!(await authorized(db, request.signed_by))) throw new Error('The approver no longer has warehouse release permission.');
    const history = await must(db.from('release_signoffs').select('*').eq('scope', 'warehouse').order('id', { ascending: true }).limit(5000));
    if (history.length >= 5000) throw new Error('Full release history is required.');
    const moves = activeMoves(history);
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const topic = 'request-' + request.id;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-release-' + request.id + '-'));
    if (request.action === 'go') {
      const item = request.detail?.candidate;
      const problems = selection.candidateProblems(item);
      if (!item || item.id !== request.item_id || item.manifest?.sha !== request.sha || problems.length) throw new Error('Candidate validation failed: ' + problems.join(' '));
      for (const dep of item.dependsOn || []) if (!moves[dep]) throw new Error('Dependency is not on production: ' + dep);
      if (moves[item.id]) throw new Error('This change is already deployed.');
      const localRoot = path.join(tmp, 'artifact');
      for (const file of item.manifest.files) {
        const dest = path.join(localRoot, file.path);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        // Read exact committed blobs, never a dirty checkout or whichever HEAD happens to be current.
        const blob = cp.execFileSync('git', ['show', request.sha + ':nextrade-app/' + file.path], { cwd: warehouseRepo, maxBuffer: 20 * 1024 * 1024 });
        fs.writeFileSync(dest, blob);
        if (remote.sha256File(dest) !== file.after) throw new Error('Committed artifact fingerprint mismatch: ' + file.path);
      }
      touched = true;
      result = remote.deployLive({ runner, appRoot: config.live.appRoot, backupRoot: config.live.backupRoot, topic, stamp, sha: request.sha,
        files: item.manifest.files.map(f => f.path), allow: item.manifest.files.map(f => f.path), manifest: item.manifest,
        localRoot, cacheCmds: ['php artisan view:clear', ...(item.configChanged ? ['php artisan config:clear'] : []), ...(item.routesChanged ? ['php artisan route:clear'] : [])],
        siteUrl: config.live.checkUrl, tmpDir: tmp });
      if (result.ok && !result.lockStuck) event = { action: 'moved', detail: { title: item.title, backup: result.backupDir, files: result.replaced, note: 'Code fingerprints verified; HTTP ' + result.siteStatus + '. Functional verification pending.', dependsOn: item.dependsOn || [] } };
      else {
        const attempt = gate.attemptRecord(result, request.sha);
        event = { action: attempt.outcome === 'recovery_incomplete' || result.lockStuck ? 'recovery_incomplete' : 'failed', detail: { title: item.title, backup: result.backupDir, outcome: attempt.outcome, note: attempt.problems.join(' | '), attempt } };
      }
    } else {
      const target = moves[request.item_id];
      if (!target || target.sha !== request.sha || target.detail?.backup !== request.detail?.backup || Number(target.id) !== Number(request.ref_id)) throw new Error('The rollback target changed; request a new rollback.');
      for (const [id, move] of Object.entries(moves)) if (id !== request.item_id && (move.detail?.dependsOn || []).includes(request.item_id)) throw new Error('Roll back dependent change first: ' + id);
      // Backup paths are taken from recorded moves only, never from arbitrary operator input.
      if (!String(target.detail.backup).includes('/code-backups/')) throw new Error('Invalid backup location.');
      touched = true;
      result = remote.restoreLive({ runner, appRoot: config.live.appRoot, backupDir: target.detail.backup,
        undoDir: config.live.backupRoot + '/undo-' + topic + '-' + stamp, sha: request.sha,
        cacheCmds: ['php artisan view:clear', 'php artisan config:clear', 'php artisan route:clear'], siteUrl: config.live.checkUrl, tmpDir: tmp, reason: 'Approved request ' + request.id });
      event = { action: result.ok && !result.lockStuck ? 'rolled_back' : 'rollback_failed', detail: { backup: target.detail.backup, undo: result.undoDir, note: result.ok && !result.lockStuck ? 'Selected code restored and verified. Database and uploads untouched.' : result.problems.join(' | ') } };
    }
  } catch (err) {
    event = { action: request.action === 'rollback' ? 'rollback_failed' : touched ? 'recovery_incomplete' : 'failed', detail: { outcome: 'not_replaced', note: err.message } };
  }
  // Result and claim completion are one transaction. If the connection fails, the running
  // claim remains blocked instead of silently repeating the deployment on the next poll.
  await must(db.rpc('release_finish', { p_request: request.id, p_worker: worker, p_event: event, p_attention: ['recovery_incomplete', 'rollback_failed'].includes(event.action) }));
  return event;
}
async function poll(db, config, warehouseRepo, worker, runner) {
  const sw = remote.liveSwitch(config);
  await must(db.from('release_worker_status').upsert({ id: 1, worker, version: VERSION, enabled: sw.on, last_seen: new Date().toISOString() }));
  if (!sw.on) return { state: 'disabled', reasons: sw.why };
  const requests = await must(db.from('release_signoffs').select('*').eq('scope', 'warehouse').in('action', ['go', 'rollback']).order('id', { ascending: true }).limit(5000));
  for (const request of requests) {
    if (request.detail?.execution !== VERSION) continue;
    const claimed = await must(db.rpc('release_claim', { p_request: request.id, p_worker: worker }));
    if (!claimed) continue;
    const event = await executeRequest(db, request, config, warehouseRepo, worker, runner);
    return { request: request.id, state: event.action };
  }
  return { state: 'idle' };
}
async function main() {
  const config = JSON.parse(fs.readFileSync(arg('--config') || path.join(__dirname, 'config.json'), 'utf8'));
  const repo = arg('--warehouse-repo');
  if (!repo || !fs.existsSync(repo)) throw new Error('--warehouse-repo is required');
  const credential = JSON.parse(fs.readFileSync(arg('--credential'), 'utf8'));
  const db = channel('https://nexttrade-hub.vercel.app', credential.token);
  const runner = remote.sshRunner({ host: config.live.host, sshUser: config.live.sshUser, port: config.live.sshPort, keyPath: config.key.privateKeyPath });
  try { console.log(JSON.stringify(await poll(db, config, repo, 'office-' + os.hostname(), runner))); }
  finally { runner.close(); }
}
if (require.main === module) main().catch(err => { console.error('Warehouse worker stopped: ' + err.message); process.exitCode = 1; });
module.exports = { authorized, activeMoves, executeRequest, poll };
