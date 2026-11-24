#!/usr/bin/env node
/*
 * v55.83-YJ — print the ONE history row for something the office PC just did to a warehouse change, so the
 * Change Schedule history is right at all times (Max, 24 Nov: "keeping accurate change mgmt history at all times").
 *
 *   node release-management/deploy/history-row.js --item <id>
 *        --action moved|checked_live|failed|recovery_incomplete|recovery_confirmed|rolled_back|rollback_failed
 *        --ref <row number of the go / roll-back request this carried out> [--note "<what happened>"]
 *
 * OPERATOR-ASSISTED, not automatic: it prints a single INSERT for public.release_signoffs and runs nothing.
 * Everything that matters is READ FROM THE REGISTER, i.e. from what deploy.js / rollback.js themselves
 * recorded — the build, the backup folder and, for a failure, HOW it ended (lastAttempt.outcome). None of it
 * can be typed here, and a row that disagrees with the register is refused (Codex 24 Nov): a move whose
 * restore is not confirmed can only be recorded as recovery_incomplete, never as "failed / put back".
 * The row is added through the database connection as part of carrying out Max's go for that change; rows in
 * that table can never be changed or deleted afterwards.
 */
'use strict';
var reg = require('../lib/register');

var ACTIONS = ['moved', 'checked_live', 'failed', 'recovery_incomplete', 'recovery_confirmed', 'rolled_back', 'rollback_failed'];
function arg(name) { var i = process.argv.indexOf(name); if (i < 0) { return ''; } var v = process.argv[i + 1]; return (v === undefined || v.indexOf('--') === 0) ? '' : String(v); }
function lit(v) { return "'" + String(v).replace(/'/g, "''") + "'"; }               // SQL text literal
function die(s) { process.stderr.write('\n' + s + '\n'); process.exit(2); }
function list(v) { return Array.isArray(v) ? v.map(String) : []; }

// Pure: build the statement from an item and the request. Exported for the tests.
function historyRow(item, o) {
  if (!item || !item.id) { throw new Error('no such change in the register'); }
  if (ACTIONS.indexOf(o.action) < 0) { throw new Error('--action must be one of ' + ACTIONS.join(' / ')); }
  var needsRef = o.action !== 'checked_live';
  if (needsRef && !/^[0-9]+$/.test(String(o.ref || ''))) { throw new Error('--ref <number of the go / roll-back row> is required for ' + o.action); }
  if (o.ref && !/^[0-9]+$/.test(String(o.ref))) { throw new Error('--ref must be a number'); }
  var la = item.lastAttempt || {};
  var life = String(item.lifecycle || '');
  var detail = { title: String(item.title || '') };
  var sha = ''; var backup = '';

  if (o.action === 'moved' || o.action === 'checked_live' || o.action === 'rolled_back') {
    var want = { moved: 'deployed', checked_live: 'live', rolled_back: 'rolled-back' }[o.action];
    if (life !== want) { throw new Error('the register says ' + item.id + ' is "' + (life || 'not moved') + '", not "' + want + '" — record what actually happened'); }
    sha = String(item.deployedSha || item.build || '');
    backup = String(item.backupDir || '');
    if (backup.length < 3) { throw new Error('the register has no backup folder recorded for ' + item.id + ' — only a move made by deploy.js can be recorded as ' + o.action); }
    if (o.action === 'checked_live') { detail.checked = String(item.verifiedBy || ''); }
  } else if (o.action === 'failed') {
    // only the two endings where production is KNOWN to be as it was
    if (life !== 'failed' || la.kind !== 'move' || (la.outcome !== 'not_replaced' && la.outcome !== 'restored')) {
      throw new Error('"failed" is only for a move that ended with nothing replaced, or with a CONFIRMED automatic restore. The register says: state "' + (life || '-') + '", outcome "' + (la.outcome || 'not recorded') + '". A restore that is not confirmed is recorded as recovery_incomplete.');
    }
    sha = String(la.sha || ''); backup = String(la.backupDir || '');
    detail.outcome = la.outcome; detail.replaced = list(la.replaced); detail.restored = list(la.restoredFiles); detail.kept_in = String(la.undoDir || '');
    detail.problems = list(la.problems).join(' | ').substring(0, 600);
  } else if (o.action === 'recovery_incomplete' || o.action === 'rollback_failed') {
    var kind = o.action === 'rollback_failed' ? 'rollback' : 'move';
    if (life !== 'needs-attention' || la.kind !== kind || la.outcome !== 'recovery_incomplete') {
      throw new Error('"' + o.action + '" is only for a ' + kind + ' that stopped part-way with its restore not confirmed. The register says: state "' + (life || '-') + '", last attempt "' + (la.kind || '-') + '", outcome "' + (la.outcome || 'not recorded') + '".');
    }
    sha = String(la.sha || ''); backup = String(la.backupDir || '');
    detail.outcome = 'recovery_incomplete'; detail.files_back = la.filesBack === true; detail.replaced = list(la.replaced); detail.restored = list(la.restoredFiles); detail.kept_in = String(la.undoDir || '');
    detail.problems = list(la.problems).join(' | ').substring(0, 600);
  } else {                                                       // recovery_confirmed
    var rc = item.recovery || {};
    if (life !== 'recovered' || (rc.where !== 'staging' && rc.where !== 'live') || String(rc.by || '').length < 10) {
      throw new Error('"recovery_confirmed" needs the person\'s check recorded first (register.recordRecovery: where + who checked what). The register says: state "' + (life || '-') + '".');
    }
    sha = String(la.sha || item.deployedSha || item.build || ''); backup = String(la.backupDir || item.backupDir || '');
    detail.where = rc.where; detail.checked = String(rc.by);
  }
  if (sha.length < 7) { throw new Error('the register has no build recorded for this step of ' + item.id); }
  detail.backup = backup;
  detail.note = String(o.note || '').substring(0, 400);
  return 'INSERT INTO public.release_signoffs (item_id, scope, action, sha, target, detail, ref_id, recorded_by) VALUES ('
    + lit(item.id) + ", 'warehouse', " + lit(o.action) + ', ' + lit(sha) + ", 'production', " + lit(JSON.stringify(detail)) + '::jsonb, '
    + (o.ref ? String(o.ref) : 'NULL') + ", 'KTC office PC (Claude)') RETURNING id, created_at;";
}

if (require.main === module) {
  var itemId = arg('--item');
  if (!itemId) { die('Usage: history-row.js --item <id> --action ' + ACTIONS.join('|') + ' --ref <row number> [--note "<text>"]'); }
  try { process.stdout.write(historyRow(reg.findItem(reg.load(), itemId), { action: arg('--action'), ref: arg('--ref'), note: arg('--note') }) + '\n'); }
  catch (e) { die(e.message + '\nNothing was printed to run.'); }
}
module.exports = { historyRow: historyRow, ACTIONS: ACTIONS };
