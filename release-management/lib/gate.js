'use strict';
/*
 * v55.83-XH — the release gate as ONE shared, tested validator (Codex 12:53 #1/#2, 13:11 #1/#2).
 *
 * The gate compares the evidence RECORDED ON THE ITEM against the EXACT candidate
 * (its commit SHA + target environment) and the operator's confirmation against the
 * EXISTING recorded approval. It trusts no loose string and no source-lint result.
 *
 * An item becomes deployable only when ALL of its recorded evidence binds to the
 * candidate:
 *   - codexRef { sha, target, feedbackRef }          — Codex PASS for this exact SHA + env
 *   - behavioralQa { sha, target, result:'PASS', … }  — a SEPARATE executed behavioral result
 *                                                        bound to this SHA + env. Source/governance
 *                                                        LINT is supplementary and never satisfies this.
 *   - maxApproval { text }                            — Max's recorded named go; the operator's
 *                                                        confirm must EQUAL it (never manufactured here).
 * ctx = { sha, target, confirm } is the candidate the caller claims to be acting on. Every
 * recorded .sha / .target must equal ctx.sha / ctx.target, so a stale build, a wrong
 * environment, or a different-SHA QA all STOP. Both deploy.js and register.markVerifiedLive
 * call THIS function before doing anything.
 *
 * Returns { ok, problems: [] }. No I/O, no side effects, no mutation of the item.
 */
function str(v) { return v === null || v === undefined ? '' : String(v); }

function evaluateGate(item, ctx) {
  var problems = [];
  item = item || {};
  ctx = ctx || {};
  var sha = str(ctx.sha), target = str(ctx.target), confirm = str(ctx.confirm);

  if (!sha) { problems.push('No candidate --sha given; the gate must bind to an exact commit.'); }
  if (!target) { problems.push('No --target given.'); }

  // 1) Codex PASS, bound to this exact SHA + environment.
  var cr = item.codexRef;
  if (!cr || typeof cr !== 'object') {
    problems.push('No structured codexRef recorded. Record { sha, target, feedbackRef } for the exact Codex PASS.');
  } else {
    if (str(cr.sha) !== sha) { problems.push('codexRef.sha (' + str(cr.sha) + ') != candidate ' + sha + ' — a changed/rebased build invalidates the prior Codex PASS.'); }
    if (str(cr.target) !== target) { problems.push('codexRef.target (' + str(cr.target) + ') != target ' + target + '.'); }
    if (!cr.feedbackRef) { problems.push('codexRef.feedbackRef missing (the scoped Codex feedback entry).'); }
  }

  // 2) A SEPARATE executed BEHAVIORAL QA result, bound to this exact SHA + environment.
  //    Source/governance lint from run-qa.js is supplementary and is NOT accepted here.
  var qr = item.behavioralQa;
  if (!qr || typeof qr !== 'object') {
    problems.push('No behavioralQa recorded. A production move needs a SEPARATE executed behavioral result (PHP/staging/browser) bound to { sha, target }; source lint does not count.');
  } else {
    if (str(qr.result) !== 'PASS') { problems.push('behavioralQa.result is ' + str(qr.result) + ', need PASS.'); }
    if (str(qr.kind) && str(qr.kind) !== 'behavioral') { problems.push('behavioralQa.kind is ' + str(qr.kind) + ', not behavioral — source/governance lint is supplementary, not a substitute.'); }
    if (str(qr.sha) !== sha) { problems.push('behavioralQa.sha (' + str(qr.sha) + ') != candidate ' + sha + ' — stale QA for a different build.'); }
    if (str(qr.target) !== target) { problems.push('behavioralQa.target (' + str(qr.target) + ') != target ' + target + ' — QA from a different environment.'); }
  }

  // 3) Max's RECORDED approval; the operator's confirm must EQUAL it (never manufactured).
  var ap = item.maxApproval;
  if (!ap || typeof ap !== 'object' || !ap.text) {
    problems.push('No recorded Max approval (maxApproval.text). Record his named go first; a free-text confirm is not proof.');
  } else if (confirm !== str(ap.text).trim() && confirm.trim() !== str(ap.text).trim()) {
    problems.push('confirm does not match the recorded Max approval for this change.');
  }

  return { ok: problems.length === 0, problems: problems };
}

// The HEAD-binding decision, as a pure function (Codex 19:45 P2 #2): the deploy must bind to
// the ACTUAL checked-out commit, and an UNAVAILABLE/empty HEAD is a gate FAILURE — never
// permission to trust the supplied --sha string. Returns a problem string, or null when OK.
function headProblem(sha, head) {
  sha = str(sha); head = str(head);
  if (!sha) { return '--sha <commit> is required.'; }
  if (!head) { return 'Could not resolve the actual checked-out commit (git rev-parse HEAD failed/empty). An unavailable HEAD is a gate failure — the deploy will not trust the --sha string. Nothing changed.'; }
  if (head !== sha && head.indexOf(sha) !== 0) { return 'Working tree is at ' + head + ', not the --sha ' + sha + ' you passed. Check out the exact candidate first.'; }
  return null;
}

// v55.83-YJ — the roll-back gate, as a pure function. A roll back needs: the change is live, the exact
// backup folder the move recorded (never a folder typed at the time), and Max's RECORDED roll-back go,
// which the operator's confirm must equal. Returns a list of problems (empty = clear). No I/O.
function rollbackProblems(item, ctx) {
  var problems = [];
  item = item || {}; ctx = ctx || {};
  if (str(item.status) !== 'live' && str(item.lifecycle) !== 'deployed') { problems.push('This change is not on production, so there is nothing to roll back.'); }
  if (!str(item.backupDir)) { problems.push('No backup folder is recorded for this change (backupDir). Only a move made by deploy.js records one; a change moved by hand is restored by hand.'); }
  if (str(ctx.backup) && str(ctx.backup) !== str(item.backupDir)) { problems.push('--backup (' + str(ctx.backup) + ') is not the backup folder recorded for this change (' + str(item.backupDir) + ').'); }
  var ap = item.rollbackApproval;
  if (!ap || typeof ap !== 'object' || !ap.text) {
    problems.push('No recorded roll-back go from Max (rollbackApproval.text). Record his go first; a free-text confirm is not proof.');
  } else {
    if (str(ctx.confirm).trim() !== str(ap.text).trim()) { problems.push('confirm does not match the recorded roll-back go for this change.'); }
    // v55.83-YJ rev 3 (Codex 24 Nov): the go names the exact build and backup folder Max asked to undo. It must be
    // the build and backup this PC recorded for the move — an identical sentence is not enough.
    var liveSha = str(item.deployedSha || item.build);
    if (!str(ap.sha) || !str(ap.backup)) { problems.push('The recorded roll-back go does not name a build and a backup folder. Record it again from the request row (its build and backup).'); }
    else {
      if (str(ap.sha) !== liveSha) { problems.push('The roll-back go is for build ' + str(ap.sha) + ', but the build this PC moved is ' + (liveSha || 'not recorded') + '.'); }
      if (str(ap.backup) !== str(item.backupDir)) { problems.push('The roll-back go names backup ' + str(ap.backup) + ', but the backup recorded for this move is ' + (str(item.backupDir) || 'not recorded') + '.'); }
    }
  }
  return problems;
}

// v55.83-YJ rev 3 (Codex 24 Nov) — how a FAILED move ended, as a pure function of what lib/remote.deployLive
// returned. Three different endings, never one word for all of them:
//   not_replaced        nothing on the live app was replaced (no restore was needed)
//   restored            files were replaced AND the automatic restore finished and was confirmed (restored.ok)
//   recovery_incomplete files were replaced and the restore is NOT confirmed — also when the files are back
//                       but a later step of the restore failed. Only a person's check clears this.
function attemptRecord(res, sha) {
  res = res || {};
  var rs = res.restored || null;
  var outcome = !rs ? 'not_replaced' : (rs.ok === true ? 'restored' : 'recovery_incomplete');
  if (!rs && Array.isArray(res.replaced) && res.replaced.length) { outcome = 'recovery_incomplete'; }   // replaced, yet no restore ran: never 'not replaced'
  return { kind: 'move', at: new Date().toISOString(), sha: str(sha), outcome: outcome, backupDir: str(res.backupDir), replaced: (res.replaced || []).slice(),
    restoredFiles: rs ? (rs.restored || []).slice() : [], filesBack: !!(rs && rs.filesBack), undoDir: rs ? str(rs.undoDir) : '',
    problems: (res.problems || []).concat(rs ? (rs.problems || []) : []), lockStuck: !!res.lockStuck };
}
// The register state that goes with it: only a confirmed ending is 'failed' (= production is as it was).
function attemptState(rec) { return rec && (rec.outcome === 'not_replaced' || rec.outcome === 'restored') ? 'failed' : 'needs-attention'; }

module.exports = { evaluateGate: evaluateGate, headProblem: headProblem, rollbackProblems: rollbackProblems, attemptRecord: attemptRecord, attemptState: attemptState };
