#!/usr/bin/env node
/*
 * v55.83-XH — Deploy a proven staging change to the live warehouse (release-governance session).
 *
 *   node release-management/deploy/deploy.js --item <registerId> --confirm "Max: yes, put <X> on production" [--dry-run] [--data-sql <file>]
 *
 * This implements the CHANGE-MANAGEMENT.md protocol (sections A–B):
 *   1. GATE: the item's RECORDED codexRef + behavioralQa + maxApproval, all bound to the exact
 *      commit and target (lib/gate.js), and --confirm equal to the recorded go. Missing any → refuse.
 *   2. BACK UP FIRST — each live file to ~/code-backups/<topic>-<date>/ (structure kept),
 *      and any data to zz_<topic>_<table>_before_<date> (NEVER dropped).
 *   3. Upload the new file(s); clear caches (view: always, config:/route: if relevant).
 *   4. Verify the page is not 500; record it in the shared register (markLive + logEvent).
 *
 * SAFETY — v55.83-YJ: the live steps are in lib/remote.js and run ONLY with --live AND both
 * config switches true (sshAuthorized, liveExecutionEnabled) AND the key, app folder and check
 * address set. Both switches ship false:
 *   - no connection of any kind is made before that.
 *   - Until then it prints the manual cPanel steps and the exact backup plan, and EXITS
 *     without touching anything (safe mode). See AUTHORIZE-SSH-KEY.md.
 *   - It contains NO delete/DROP of any kind. Data is never deleted. Ever.
 *
 * It never handles Max's password — SSH uses the authorized key only.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var cp = require('child_process');
var reg = require('../lib/register');
var gate = require('../lib/gate');
var evaluateGate = gate.evaluateGate;
var headProblem = gate.headProblem;

var DEPLOY_DIR = __dirname;
var CONFIG = JSON.parse(fs.readFileSync(path.join(DEPLOY_DIR, 'config.json'), 'utf8'));
var QA_RESULT = path.resolve(DEPLOY_DIR, '..', 'qa', 'qa-result.json');

function arg(name, def) {
  var i = process.argv.indexOf(name);
  if (i < 0) { return def; }
  var v = process.argv[i + 1];
  return (v === undefined || v.indexOf('--') === 0) ? true : v;
}
function has(name) { return process.argv.indexOf(name) >= 0; }
function say(s) { process.stdout.write(s + '\n'); }
function die(s, code) { process.stderr.write('\n' + s + '\n'); process.exit(code || 1); }

var today = new Date().toISOString().slice(0, 10).replace(/-/g, '');

function printManual(item, topic) {
  say('\n================ SAFE MODE — nothing was changed ================');
  say('The live warehouse has no authorized SSH key yet, so automated deploy is OFF.');
  say('See release-management/deploy/AUTHORIZE-SSH-KEY.md to turn it on.\n');
  say('Do this move by hand in cPanel (Max, in his own Chrome), per CHANGE-MANAGEMENT.md B:');
  say('  1. Confirm Codex PASS + your named go for THIS change only.');
  say('  2. cPanel → File Manager. For EACH file below, copy the current live file into');
  say('     ' + CONFIG.live.backupRoot + '/' + topic + '-' + today + '/  (keep the folder structure) FIRST.');
  say('  3. Upload/replace the new file(s).');
  say('  4. cPanel Terminal, in ' + CONFIG.live.publicHtml + ': php artisan view:clear');
  say('     (also config:clear if config/.env changed; route:clear if routes changed).');
  say('  5. Load the page, check the change, confirm nothing 500s.');
  say('  6. Tell the release session; it records the move + rollback in the register.');
  if (item && item.files) { say('\n  Files for this change (' + item.id + '): ' + item.files); }
  if (item && item.backup) { say('  Prior backup note: ' + item.backup); }
  say('\n  DATA: never deleted. A data change goes in as a reviewed 1-row UPDATE with a');
  say('        zz_' + topic + '_<table>_before_' + today + ' backup table that is never dropped.');
  say('================================================================\n');
}

var remote = require('../lib/remote');

// Supplementary source-lint note only (NOT a gate input). The gate's QA requirement is the
// item's recorded behavioralQa, checked by evaluateGate. This just surfaces a lint regression.
function sourceLintNote(releaseId) {
  if (!fs.existsSync(QA_RESULT)) { return 'no run-qa.js result on disk'; }
  try {
    var r = JSON.parse(fs.readFileSync(QA_RESULT, 'utf8'));
    var br = (r.byRelease || {})[releaseId];
    return 'source-lint ' + (br ? br.status : 'NONE') + ' @ ' + (r.ranAgainstSha || '?');
  } catch (e) { return 'source-lint unreadable: ' + e.message; }
}

// Resolve the ACTUAL checked-out commit, so the gate binds to the real artifact — not a
// supplied --sha string (Codex 13:11 #1).
// v55.83-YJ: a WAREHOUSE change is bound to the WAREHOUSE repo's commit (before YJ this read the Hub
// repo's HEAD for every item, i.e. the wrong repo for a warehouse change).
var HUB_ROOT = path.resolve(DEPLOY_DIR, '..', '..');
function repoRootFor(item) {
  if (item && item.repo === 'nextrade_WAREHOUSE') { return path.resolve(HUB_ROOT, (CONFIG.repo && CONFIG.repo.warehousePath) || '../nextrade_WAREHOUSE'); }
  return HUB_ROOT;
}
function actualHeadSha(item) {
  try { return cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRootFor(item), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch (e) { return ''; }
}
// The files being moved must be exactly as committed: no uncommitted edit may ride along.
function uncommitted(item, files) {
  try {
    var sub = (CONFIG.repo && CONFIG.repo.appSubdir) || '';
    var paths = files.map(function (f) { return sub ? sub + '/' + f : f; });
    return cp.execFileSync('git', ['status', '--porcelain', '--'].concat(paths), { cwd: repoRootFor(item), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch (e) { return 'git status could not be read'; }
}

function main() {
  var itemId = arg('--item');
  var confirm = arg('--confirm');
  var target = arg('--target', 'production');
  var sha = arg('--sha'); // the EXACT commit being deployed — bound against item.codexRef.sha
  // Default to dry-run. A real move needs an explicit --live (and still passes the gate + SSH
  // safe mode). A key granting connection is NOT per-release permission.
  var live = has('--live');
  var dryRun = has('--dry-run') || !live;
  if (!itemId || itemId === true) { die('Usage: deploy.js --item <registerId> --target production --sha <commit> --confirm "<the recorded Max approval text>" [--live]  (default is a dry run)'); }
  if (target !== 'production') { die('Only --target production is supported by this script. Hub deploys go through Vercel, not here.'); }

  var register = reg.load();
  var item = reg.findItem(register, itemId);
  if (!item) { die('No register item with id "' + itemId + '". Check release-management/release-register.json.'); }
  var topic = (item.id || itemId).replace(/[^a-z0-9]+/gi, '-').toLowerCase();

  say('\nDeploy request: ' + item.title + '  (' + item.id + ')');

  // Bind to the ACTUAL checked-out artifact, not the supplied string (Codex 13:11 #1).
  sha = (sha === true || !sha) ? '' : String(sha);
  var head = actualHeadSha(item);
  var problems0 = [];
  // Bind to the ACTUAL checked-out commit; an unavailable/empty HEAD is a gate FAILURE, never
  // permission to trust --sha (Codex 19:45 P2). Pure decision lives in lib/gate.headProblem,
  // so it stops here (exit 2) before any SSH probe or success message. Tested in-process.
  var hp = headProblem(sha, head);
  if (hp) { problems0.push(hp); }

  // ---- GATE: the SAME shared validator register.markVerifiedLive uses, against the item's
  //      RECORDED evidence (codexRef + behavioralQa + maxApproval), bound to this candidate. ----
  var verdict = evaluateGate(item, { sha: sha, target: target, confirm: (confirm === true ? '' : confirm) });
  var allProblems = problems0.concat(verdict.ok ? [] : verdict.problems);

  if (allProblems.length) {
    say('\nGATE: not clear to deploy ' + item.id + ' to ' + target + '  [' + sourceLintNote(item.release || item.id) + ']:');
    allProblems.forEach(function (p) { say('  ✗ ' + p); });
    say('\nNothing was changed. (The manual cPanel steps below are instructions, NOT approval —');
    say(' the same gate applies by hand: a recorded Codex PASS + a SEPARATE executed behavioral QA + Max\'s recorded go, all bound to this exact SHA.)');
    printManual(item, topic);
    process.exit(2);
  }
  say('GATE met: Codex ' + item.codexRef.sha + ' (' + item.codexRef.feedbackRef + ') · behavioralQa ' + item.behavioralQa.sha + ' PASS · Max approval recorded · target ' + target + ' · artifact ' + (head || sha) + '.');

  // ---- SSH SAFE MODE (an SSH refusal is never production approval; side-effect-free) ----
  // v55.83-YJ: record the PERSON'S functional check of a change that deploy.js already moved. No connection.
  if (has('--mark-live')) {
    var by = arg('--checked-by');
    if (!by || by === true || String(by).trim().length < 10) { die('--mark-live needs --checked-by "<who checked what on the live site>" (at least a few words). Nothing changed.', 2); }
    if (item.lifecycle !== 'deployed' || String(item.deployedSha || '') !== sha || !item.backupDir) { die('--mark-live is only for a change this script moved (state "deployed") at this exact --sha. Nothing changed.', 2); }
    reg.setState(item.id, 'verified', 'checked on the live site by: ' + String(by).trim());
    reg.markVerifiedLive(item.id, { sha: sha, target: target, confirm: confirm, build: sha, backup: item.backupDir, verifiedBy: String(by).trim() });
    say('\nRECORDED: ' + item.id + ' is live on production, checked by: ' + String(by).trim());
    process.exit(0);
  }
  if (item.lifecycle === 'needs-attention') { die('The last move or roll back of this change did not finish and its restore is not confirmed. A person must check the live site and record it (register.recordRecovery) before anything else. Nothing changed.', 2); }
  if (item.lifecycle === 'deployed') { die('This change was already moved (state "deployed") and is waiting for its check: use --mark-live --checked-by, or roll it back. Nothing changed.', 2); }

  // v55.83-YJ: BOTH switches (sshAuthorized + liveExecutionEnabled), the key file, the app folder and
  // the check address must be set BEFORE any connection is even tried. Otherwise: safe mode, no connection.
  var sw = remote.liveSwitch(CONFIG);
  if (!sw.on) {
    say('\nAutomated deploy is in SAFE MODE (' + sw.why.join('; ') + '). Nothing was changed; no connection was made; no event logged.');
    printManual(item, topic);
    process.exit(3);
  }

  // ---- the exact files of this change: explicit, on the item's recorded list, exactly as committed ----
  // Unique per-release backup id so a second same-day change never overwrites the first.
  var stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14); // YYYYMMDDHHMMSS
  var files = (arg('--files') && arg('--files') !== true) ? String(arg('--files')).split(',').map(function (x) { return x.trim(); }).filter(Boolean) : [];
  var fileProblems = remote.checkFiles(files, item.deployFiles);
  if (!fileProblems.length) { var dirty = uncommitted(item, files); if (dirty) { fileProblems.push('These files have uncommitted changes, so they are not the build Codex passed: ' + dirty.replace(/\s+/g, ' ')); } }
  if (fileProblems.length) {
    say('\nFILES: not clear to deploy ' + item.id + ':');
    fileProblems.forEach(function (p) { say('  ✗ ' + p); });
    say('\nNothing was changed; no connection was made.');
    process.exit(2);
  }
  var backupDir = CONFIG.live.backupRoot + '/' + topic + '-' + stamp;
  if (!live) { say('\n(DRY RUN — pass --live to actually move.)'); }
  say('\n' + (dryRun ? '[DRY RUN] ' : '') + 'Would back up live files to ' + backupDir + ' (unique id; structure kept) BEFORE any replace…');

  if (dryRun) {
    say('[DRY RUN] would: 1) ssh mkdir -p + copy each explicit --files target into the backup dir (verify each backup exists)');
    say('[DRY RUN]        2) scp ONLY the allowlisted file(s) up  3) php artisan view:clear (+config/route only if flagged)');
    say('[DRY RUN]        4) curl the page, assert not 500 (stop + roll back on failure)  5) register.setState verified, then markVerifiedLive with the refs');
    say('[DRY RUN] No delete/DROP, no restore SQL, no migration is ever issued. Data is never deleted. Nothing changed.');
    process.exit(0);
  }

  // ---- LIVE MOVE (v55.83-YJ). Reached only with: gate met + both switches on + --live + clean listed files.
  // Code files only. No data SQL, no migration, no delete: lib/remote.js sends none.
  var runner = remote.sshRunner({ host: CONFIG.live.host, sshUser: CONFIG.live.sshUser, port: CONFIG.live.sshPort || 22, keyPath: CONFIG.key.privateKeyPath });
  var probe = runner.run('echo ok');
  if (probe.code !== 0 || String(probe.out).trim() !== 'ok') { die('The server did not answer over SSH with the authorized key. Nothing was changed.', 3); }
  var cacheCmds = (CONFIG.caches.always || []).slice();
  if (item.configChanged === true) { cacheCmds = cacheCmds.concat(CONFIG.caches.ifConfigChanged || []); }
  if (item.routesChanged === true) { cacheCmds = cacheCmds.concat(CONFIG.caches.ifRoutesChanged || []); }
  var tmpDir = process.env.RELEASE_TMP_DIR || path.resolve(DEPLOY_DIR, '..');
  reg.setState(item.id, 'deploying', 'build ' + sha + ' · backup ' + backupDir);
  var res = remote.deployLive({
    runner: runner, appRoot: CONFIG.live.appRoot, backupRoot: CONFIG.live.backupRoot, topic: topic, stamp: stamp, sha: sha,
    files: files, allow: item.deployFiles, localRoot: path.join(repoRootFor(item), (CONFIG.repo && CONFIG.repo.appSubdir) || ''),
    cacheCmds: cacheCmds, siteUrl: CONFIG.live.checkUrl, tmpDir: tmpDir, log: say
  });
  if (!res.ok) {
    // v55.83-YJ rev 3 (Codex 24 Nov): three different endings, never one word for all of them.
    //   not_replaced        nothing on the live app was replaced
    //   restored            files were replaced AND the automatic restore finished and was confirmed
    //   recovery_incomplete files were replaced and the restore is NOT confirmed -> needs a person
    var rec = gate.attemptRecord(res, sha);                   // pure + tested: lib/gate.js
    var outcome = rec.outcome;
    var back = outcome === 'not_replaced' ? 'Nothing on the live app was replaced.'
      : outcome === 'restored' ? 'Everything was put back from ' + res.backupDir + ' (the failed files are kept in ' + rec.undoDir + ').'
      : 'THE AUTOMATIC RESTORE IS NOT CONFIRMED: ' + rec.problems.join(' | ') + ' — files put back so far: ' + (rec.restoredFiles.join(', ') || 'none') + '. CHECK THE LIVE SITE NOW; the backup is ' + res.backupDir + '.';
    reg.upsertItem({ id: item.id, lastAttempt: rec });
    reg.setState(item.id, gate.attemptState(rec), res.problems.join(' | ') + ' — ' + back);
    die('MOVE FAILED: ' + res.problems.join(' | ') + '\n' + back + '\nRecord it in the history: node release-management/deploy/history-row.js --item ' + item.id + ' --action ' + (outcome === 'recovery_incomplete' ? 'recovery_incomplete' : 'failed') + ' --ref <row number of the go>', 5);
  }
  // The files are in place and the site answers. That is NOT proof the change
  // works (Codex 24 Nov #5): the item is 'deployed', not 'live', until a person has checked the change itself
  // and that check is recorded with --mark-live --checked-by.
  reg.upsertItem({ id: item.id, backupDir: res.backupDir, deployedFiles: res.replaced, deployedSha: sha });
  reg.setState(item.id, 'deployed', 'files in place and fingerprint-checked; site answered ' + res.siteStatus + ' (not a functional check); backup ' + res.backupDir);
  say('\nMOVED, NOT YET CHECKED: the files of ' + item.id + ' are on production and the site answers (' + res.siteStatus + '). Backup: ' + res.backupDir);
  say('Now have a person check the change itself on the live site. Then record it:');
  say('  node release-management/deploy/deploy.js --item ' + item.id + ' --sha ' + sha + ' --confirm "<the recorded go>" --mark-live --checked-by "<who checked what>"');
  say('If it is wrong, put it back: node release-management/deploy/rollback.js --item ' + item.id + ' --confirm "<the recorded roll-back go>" --live');
}

main();
