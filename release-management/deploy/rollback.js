#!/usr/bin/env node
/*
 * v55.83-XH — Roll a live warehouse change back to its backup (release-governance session).
 *
 *   node release-management/deploy/rollback.js --item <registerId> [--backup <dir>] [--dry-run]
 *
 * CHANGE-MANAGEMENT.md section C:
 *   - Files: copy the .bak files from ~/code-backups/<topic>-<date>/ back over the live
 *     files, then php artisan view:clear (+ config:/route: clear if those were part of it).
 *   - Data: restore values FROM the zz_..._before_<date> table (which is never dropped), so
 *     prior values are always recoverable. Rolling back code never touches live data — no
 *     order, scan or bond row is ever lost.
 *
 * SAFETY: identical SSH safe-mode gate as deploy.js. Until the live SSH key is authorized it
 * prints the manual cPanel restore steps and refuses to act. It NEVER deletes data or drops a
 * zz_ backup table. It never handles Max's password.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var cp = require('child_process');
var reg = require('../lib/register');

var DEPLOY_DIR = __dirname;
var CONFIG = JSON.parse(fs.readFileSync(path.join(DEPLOY_DIR, 'config.json'), 'utf8'));

function arg(name, def) {
  var i = process.argv.indexOf(name);
  if (i < 0) { return def; }
  var v = process.argv[i + 1];
  return (v === undefined || v.indexOf('--') === 0) ? true : v;
}
function has(name) { return process.argv.indexOf(name) >= 0; }
function say(s) { process.stdout.write(s + '\n'); }
function die(s, code) { process.stderr.write('\n' + s + '\n'); process.exit(code || 1); }

var remote = require('../lib/remote');
var rollbackProblems = require('../lib/gate').rollbackProblems;

function printManual(item, backupDir) {
  say('\n================ SAFE MODE — nothing was changed ================');
  say('Automated rollback is OFF (no authorized SSH key). Restore by hand in cPanel:');
  say('  1. cPanel → File Manager. Copy the .bak files from');
  say('     ' + (backupDir || (CONFIG.live.backupRoot + '/<topic>-<date>/')) + ' back over the live files.');
  say('  2. cPanel Terminal, in ' + CONFIG.live.publicHtml + ': php artisan view:clear');
  say('     (also config:clear / route:clear if those were part of the change).');
  say('  3. DATA: a data rollback is NOT a generic UPDATE. For each affected row, an');
  say('     individually reviewed per-row/per-column restore from the zz_..._before_<date>');
  say('     table, with an expected-current-value guard (so a post-release edit is not');
  say('     overwritten and a row missing from the backup is never set to NULL), Max\'s');
  say('     named go, and a stop on any conflict. Never drop the zz_ table; no row is ever');
  say('     deleted. This script prints NO executable restore SQL — that step is by hand,');
  say('     reviewed, per row.');
  say('  4. Load the page, confirm the previous state is back and nothing 500s.');
  if (item && item.backup) { say('\n  Backup for this item: ' + item.backup); }
  if (item && item.rollback) { say('  Recorded rollback: ' + item.rollback); }
  say('================================================================\n');
}

function main() {
  var itemId = arg('--item');
  var live = has('--live');
  var dryRun = has('--dry-run') || !live;                       // v55.83-YJ: default is a dry run, like deploy.js
  var confirm = arg('--confirm');
  if (!itemId || itemId === true) { die('Usage: rollback.js --item <registerId> --confirm "<the recorded roll-back go>" [--backup <dir>] [--live]  (default is a dry run)'); }

  var register = reg.load();
  var item = reg.findItem(register, itemId);
  if (!item) { die('No register item with id "' + itemId + '".'); }
  var backupDir = (arg('--backup') && arg('--backup') !== true) ? String(arg('--backup')) : '';

  say('\nRollback request: ' + item.title + '  (' + item.id + ')');

  // v55.83-YJ GATE: a roll back needs Max's RECORDED roll-back go (matched by --confirm), a change that is
  // live, and the exact backup folder the move recorded. Before YJ this script had no approval check at all.
  if (item.lifecycle === 'needs-attention') { die('The last move or roll back of this change did not finish and its restore is not confirmed. A person must check the live site and record it (register.recordRecovery) first. Nothing changed.', 2); }
  var problems = rollbackProblems(item, { confirm: (confirm === true ? '' : confirm), backup: backupDir });
  if (problems.length) {
    say('\nGATE: not clear to roll back ' + item.id + ':');
    problems.forEach(function (p) { say('  ✗ ' + p); });
    say('\nNothing was changed. (The manual steps below are instructions, NOT approval.)');
    printManual(item, backupDir || item.backupDir);
    process.exit(2);
  }
  backupDir = item.backupDir;

  var sw = remote.liveSwitch(CONFIG);
  if (!sw.on) {
    say('\nAutomated rollback is in SAFE MODE (' + sw.why.join('; ') + '). Nothing was changed; no connection was made; no event logged.');
    printManual(item, backupDir);
    process.exit(3);
  }

  var stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  var topic = String(item.id).replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  var undoDir = CONFIG.live.backupRoot + '/' + topic + '-undo-' + stamp;
  if (dryRun) {
    say('[DRY RUN] would: 1) prove every file in ' + backupDir + ' still matches its backup list');
    say('[DRY RUN]        2) save the CURRENT live files to ' + undoDir + ' (so this roll back can itself be undone)');
    say('[DRY RUN]        3) put each backed-up file back and prove it is identical; a file the move ADDED is moved into the undo folder, not deleted');
    say('[DRY RUN]        4) php artisan view:clear (+config/route if flagged), then check the site answers');
    say('[DRY RUN] Code only. No data statement, no restore SQL, no delete/DROP is ever issued. Nothing changed.');
    process.exit(0);
  }

  var runner = remote.sshRunner({ host: CONFIG.live.host, sshUser: CONFIG.live.sshUser, port: CONFIG.live.sshPort || 22, keyPath: CONFIG.key.privateKeyPath });
  var probe = runner.run('echo ok');
  if (probe.code !== 0 || String(probe.out).trim() !== 'ok') { die('The server did not answer over SSH with the authorized key. Nothing was changed.', 3); }
  var cacheCmds = (CONFIG.caches.always || []).slice();
  if (item.configChanged === true) { cacheCmds = cacheCmds.concat(CONFIG.caches.ifConfigChanged || []); }
  if (item.routesChanged === true) { cacheCmds = cacheCmds.concat(CONFIG.caches.ifRoutesChanged || []); }
  var res = remote.restoreLive({ runner: runner, appRoot: CONFIG.live.appRoot, backupDir: backupDir, undoDir: undoDir, cacheCmds: cacheCmds, siteUrl: CONFIG.live.checkUrl,
    tmpDir: process.env.RELEASE_TMP_DIR || path.resolve(DEPLOY_DIR, '..'), reason: 'roll back of ' + item.id, log: say });
  if (!res.ok) {
    // nothing touched at all (refused before the first file) is different from stopped part-way
    var touched = res.restored.length > 0 || res.movedAside.length > 0;
    reg.upsertItem({ id: item.id, lastAttempt: { kind: 'rollback', at: new Date().toISOString(), sha: String(item.deployedSha || item.build || ''), outcome: touched ? 'recovery_incomplete' : 'not_started', backupDir: backupDir,
      restoredFiles: res.restored, movedAside: res.movedAside, filesBack: !!res.filesBack, undoDir: res.undoDir, problems: res.problems } });
    if (touched) { reg.setState(item.id, 'needs-attention', 'roll back stopped part-way: ' + res.problems.join(' | ')); }
    reg.logEvent({ action: 'rollback-failed', item: item.id, backup: backupDir, detail: res.problems.join(' | ') + ' · put back so far: ' + res.restored.join(', ') + ' · current files saved in ' + res.undoDir });
    die('ROLL BACK DID NOT FINISH: ' + res.problems.join(' | ') + '\nPut back so far: ' + (res.restored.join(', ') || 'none') + '\nThe files as they were before this attempt are in ' + res.undoDir, 5);
  }
  reg.markRolledBack(item.id, 'rollback.js: ' + res.restored.length + ' file(s) put back and fingerprint-checked; ' + res.movedAside.length + ' added file(s) moved to ' + res.undoDir);
  say('\nROLLED BACK: ' + item.id + ' is as it was before the move. The replaced files are kept in ' + res.undoDir + '. The database was not touched.');
}

main();
