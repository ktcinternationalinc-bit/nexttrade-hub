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

function sshReachable() {
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
  var dryRun = has('--dry-run');
  if (!itemId || itemId === true) { die('Usage: rollback.js --item <registerId> [--backup <dir>] [--dry-run]'); }

  var register = reg.load();
  var item = reg.findItem(register, itemId);
  if (!item) { die('No register item with id "' + itemId + '".'); }
  var backupDir = (arg('--backup') && arg('--backup') !== true) ? String(arg('--backup')) : '';

  say('\nRollback request: ' + item.title + '  (' + item.id + ')');

  if (!sshReachable()) {
    say('\nAutomated rollback is in SAFE MODE (no authorized/working SSH key). Nothing was changed; no event logged.');
    printManual(item, backupDir);
    process.exit(3);
  }

  if (dryRun) {
    say('[DRY RUN] would restore .bak files from ' + (backupDir || '<backup dir>') + ', then view:clear (+config/route if flagged),');
    say('[DRY RUN] then restore any data FROM the zz_ table. No delete/DROP is ever issued. Nothing changed.');
    process.exit(0);
  }

  die('Live SSH rollback path is intentionally not auto-run in this build. Re-review with Codex when SSH is authorized, then enable deliberately. Nothing was changed.', 4);
}

main();
