#!/usr/bin/env node
/*
 * v55.83-XH — Deploy a proven staging change to the live warehouse (release-governance session).
 *
 *   node release-management/deploy/deploy.js --item <registerId> --confirm "Max: yes, put <X> on production" [--dry-run] [--data-sql <file>]
 *
 * This implements the CHANGE-MANAGEMENT.md protocol (sections A–B):
 *   1. GATE: Codex PASS (register.needsCodex=false) AND QA PASS for this item's
 *      release (qa-result.json) AND Max's named go (--confirm). Missing any → refuse.
 *   2. BACK UP FIRST — each live file to ~/code-backups/<topic>-<date>/ (structure kept),
 *      and any data to zz_<topic>_<table>_before_<date> (NEVER dropped).
 *   3. Upload the new file(s); clear caches (view: always, config:/route: if relevant).
 *   4. Verify the page is not 500; record it in the shared register (markLive + logEvent).
 *
 * SAFETY — this NEVER runs live until the SSH key is authorized:
 *   - config.sshAuthorized must be true AND an SSH reachability check must pass.
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

function sshReachable() {
  // A real reachability probe, only attempted when the operator claims it's authorized.
  if (!CONFIG.sshAuthorized) { return false; }
  var key = CONFIG.key && CONFIG.key.privateKeyPath;
  if (!key || /SET-BY-MAX|CONFIRM-ON-THIS-PC/.test(String(key)) || !fs.existsSync(key)) { return false; }
  try {
    cp.execFileSync('ssh', ['-i', key, '-p', String(CONFIG.live.sshPort || 22),
      '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'StrictHostKeyChecking=accept-new',
      CONFIG.live.sshUser + '@' + CONFIG.live.host, 'echo ok'], { stdio: 'pipe', timeout: 15000 });
    return true;
  } catch (e) { return false; }
}

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
function actualHeadSha() {
  try { return cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.resolve(DEPLOY_DIR, '..', '..'), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch (e) { return ''; }
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
  var head = actualHeadSha();
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
  if (!sshReachable()) {
    say('\nAutomated deploy is in SAFE MODE (no authorized/working SSH key). Nothing was changed; no event logged.');
    printManual(item, topic);
    process.exit(3);
  }

  // ---- LIVE PATH (only when SSH is authorized AND reachable) ----
  // Unique per-release backup id so a second same-day change never overwrites the first.
  var stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14); // YYYYMMDDHHMMSS
  var files = (arg('--files') && arg('--files') !== true) ? String(arg('--files')).split(',') : [];
  var backupDir = CONFIG.live.backupRoot + '/' + topic + '-' + stamp;
  if (!live) { say('\n(DRY RUN — pass --live to actually move, which still requires authorized SSH.)'); }
  say('\n' + (dryRun ? '[DRY RUN] ' : '') + 'Would back up live files to ' + backupDir + ' (unique id; structure kept) BEFORE any replace…');

  if (dryRun) {
    say('[DRY RUN] would: 1) ssh mkdir -p + copy each explicit --files target into the backup dir (verify each backup exists)');
    say('[DRY RUN]        2) scp ONLY the allowlisted file(s) up  3) php artisan view:clear (+config/route only if flagged)');
    say('[DRY RUN]        4) curl the page, assert not 500 (stop + roll back on failure)  5) register.setState verified, then markVerifiedLive with the refs');
    say('[DRY RUN] No delete/DROP, no restore SQL, no migration is ever issued. Data is never deleted. Nothing changed.');
    process.exit(0);
  }

  // NOTE: the live file list + any reviewed data SQL must be supplied explicitly
  // (--files, --data-sql) and are executed here via ssh/scp with the authorized key.
  // Backups run BEFORE any replace; no destructive command is ever sent. This block
  // stays unreached until Max authorizes SSH, so it is covered by the safe-mode exit above.
  die('Live SSH deploy path is intentionally not auto-run in this build. Re-review this block with Codex at the time SSH is authorized, then enable it deliberately. Nothing was changed.', 4);
}

main();
