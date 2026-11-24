// v55.83-YJ — Change Schedule: sign-off and roll back of WAREHOUSE changes (Max, 24 Nov). Server-only rules,
// shared by /api/releases and /api/releases/signoff. SWC-safe (var + concat).
//
// A sign-off row is ONLY Max's go (gate input 3 of release-management/lib/gate.js). It never replaces
// the recorded Codex pass or the executed QA result and it moves nothing by itself.
// Hub releases are NOT handled here: they go out the way they always have (Max 24 Nov).
import { loadUserPermissions } from './server-permissions';

export var SIGNOFF_TABLE = 'release_signoffs';
// every column the rules need — one list, used by both routes, so the rules never run on half a row
export var SIGNOFF_COLUMNS = 'id, item_id, scope, action, sha, approval_text, detail, ref_id, signed_by_name, recorded_by, created_at';

function str(v) { return v === null || v === undefined ? '' : String(v); }
function norm(v) { return str(v).replace(/\s+/g, ' ').trim().toLowerCase(); }

// ---------------- who may sign: the super admin only (releases.access can read, never write)
export async function superAdminOnly(db, userId) {
  if (!userId) { return { ok: false, status: 403, error: 'Only the super admin can sign off or roll back.' }; }
  var ctx = await loadUserPermissions(db, userId);
  if (!ctx || ctx.isSuperAdmin !== true) { return { ok: false, status: 403, error: 'Only the super admin can sign off or roll back.' }; }
  var name = '';
  try {
    var r = await db.from('users').select('id, name').eq('id', userId).limit(1);
    name = (r && r.data && r.data[0] && r.data[0].name) || '';
  } catch (e) { name = ''; }
  return { ok: true, name: name };
}

export function tableMissing(error) {
  if (!error) { return false; }
  var code = str(error.code); var msg = str(error.message);
  return code === '42P01' || code === 'PGRST205' || /does not exist|schema cache|Could not find the table/i.test(msg);
}

// ---------------- register items
export function findItem(register, id) {
  var items = (register && Array.isArray(register.items)) ? register.items : [];
  var want = str(id);
  for (var i = 0; i < items.length; i++) { if (items[i] && str(items[i].id) === want) { return items[i]; } }
  return null;
}

// The exact build Codex passed for production, or null. A go can only be given for this.
export function passedBuild(item) {
  var cr = item && item.codexRef;
  if (!cr || typeof cr !== 'object') { return null; }
  if (!str(cr.sha) || str(cr.sha).length < 7) { return null; }
  if (str(cr.target) !== 'production') { return null; }
  if (!str(cr.feedbackRef)) { return null; }
  return { sha: str(cr.sha), feedbackRef: str(cr.feedbackRef) };
}

// The sentence that is stored and later matched by the deploy / rollback gate. Made here, never typed in the
// browser. Both name the exact build, so a go or a roll-back request for one build never fits another.
export function approvalText(action, item, sha) {
  if (action === 'go') { return 'Max: yes, put ' + str(item.id) + ' on production @ ' + str(sha); }
  if (action === 'rollback') { return 'Max: roll ' + str(item.id) + ' back @ ' + str(sha); }
  return '';
}

// The office PC records what happened to a change as rows too. Those rows are the CURRENT truth about where
// the change is — the register file that ships with the Hub only catches up on the next Hub release.
//   moved               files on production, waiting for a person's check
//   checked_live        a person checked it: live
//   failed              the move failed; detail.outcome says which: 'not_replaced' (nothing on production was
//                       touched) or 'restored' (put back automatically AND that restore was confirmed)
//   recovery_incomplete a move or a roll back stopped part-way and the restore is NOT confirmed
//   recovery_confirmed  a person checked the site after that and recorded where the change now is
//   rolled_back         put back to what it was before
//   rollback_failed     a roll back did not finish (same standing as recovery_incomplete)
export var MOVE_ACTIONS = ['moved', 'checked_live', 'failed', 'recovery_incomplete', 'recovery_confirmed', 'rolled_back', 'rollback_failed'];

// rows = this table's rows for scope 'warehouse', any order. Returns { itemId: state }.
//   state.kind   'go' | 'rollback' | 'none' — the open request, if any
//   state.where  'deployed' | 'live' | 'staging' | 'unknown' | '' ('' = no move row yet: the register decides)
//   state.dep    the move that is on production NOW: { id, sha, backup } — kept through later requests until a
//                real move changes it. A roll-back request is always FOR this (Codex 24 Nov: target binding).
//   state.block  true = production state unconfirmed: no new go and no new request until a person records it
// A go is used up by any move attempt (a new attempt needs a new go). A roll-back request is used up by the
// roll back; one that did not finish stays open and blocks.
export function latestByItem(rows) {
  var list = (rows || []).filter(function (r) { return r && (r.action === 'go' || r.action === 'rollback' || r.action === 'withdraw' || MOVE_ACTIONS.indexOf(r.action) >= 0); });
  list.sort(function (a, b) { return Number(a.id) - Number(b.id); });
  var out = {};
  for (var i = 0; i < list.length; i++) {
    var r = list[i]; var key = str(r.item_id);
    var prev = out[key] || { kind: 'none', where: '', whereAt: '', dep: null, block: false, problem: '' };
    var d = r.detail || {};
    var st = { kind: prev.kind, sha: prev.sha || '', text: prev.text || '', by: prev.by || '', at: prev.at || '', id: prev.id, target: prev.target || null,
      where: prev.where, whereAt: prev.whereAt, dep: prev.dep, block: prev.block, problem: prev.problem };
    function clearRequest() { st.kind = 'none'; st.sha = ''; st.text = ''; st.by = ''; st.at = ''; st.id = null; st.target = null; }
    if (r.action === 'withdraw') {
      clearRequest();
    } else if (r.action === 'go' || r.action === 'rollback') {
      st.kind = r.action; st.sha = str(r.sha); st.text = str(r.approval_text); st.by = str(r.signed_by_name); st.at = str(r.created_at); st.id = r.id;
      st.target = r.action === 'rollback' ? { sha: str(r.sha), backup: str(d.backup), row: r.ref_id == null ? null : r.ref_id } : null;
    } else {
      st.whereAt = str(r.created_at);
      if (r.action === 'moved') { clearRequest(); st.where = 'deployed'; st.dep = { id: r.id, sha: str(r.sha), backup: str(d.backup) }; st.block = false; st.problem = ''; }
      else if (r.action === 'checked_live') { st.where = 'live'; st.block = false; st.problem = ''; if (!st.dep || st.dep.sha !== str(r.sha)) { st.dep = { id: r.id, sha: str(r.sha), backup: str(d.backup) }; } }
      else if (r.action === 'rolled_back') { clearRequest(); st.where = 'staging'; st.dep = null; st.block = false; st.problem = ''; }
      else if (r.action === 'failed' && (d.outcome === 'not_replaced' || d.outcome === 'restored')) {
        clearRequest(); st.where = st.dep ? st.where : 'staging'; st.block = false;
        st.problem = d.outcome === 'restored' ? 'The last move failed and was put back. A new attempt needs a new go.' : 'The last move stopped before anything on production was replaced. A new attempt needs a new go.';
      } else if (r.action === 'recovery_confirmed' && (d.where === 'staging' || d.where === 'live')) {
        clearRequest(); st.where = d.where; st.block = false; st.problem = '';
        if (d.where === 'staging') { st.dep = null; }
      } else {
        // recovery_incomplete, rollback_failed, a failed row with no confirmed outcome, or anything not understood:
        // never guessed as "put back". The production state is unconfirmed until a person records it.
        if (r.action !== 'rollback_failed') { clearRequest(); }
        st.where = 'unknown'; st.block = true;
        st.problem = r.action === 'rollback_failed' ? 'The last roll back did not finish. The live site must be checked by a person before anything else is done.'
          : 'The last move did not finish and its restore is not confirmed. The live site must be checked by a person before anything else is done.';
      }
    }
    out[key] = st;
  }
  return out;
}

// Plain words for one history row (the screen shows these; no jargon). Never says "put back" unless confirmed.
function rowWords(r) {
  var d = r.detail || {};
  if (r.action === 'go') { return 'Approved for production'; }
  if (r.action === 'rollback') { return 'Roll back asked for'; }
  if (r.action === 'withdraw') { return 'Taken back'; }
  if (r.action === 'moved') { return 'Moved to production — waiting to be checked'; }
  if (r.action === 'checked_live') { return 'Checked on the live site — live'; }
  if (r.action === 'rolled_back') { return 'Rolled back to what it was before'; }
  if (r.action === 'rollback_failed') { return 'Roll back did not finish — needs attention'; }
  if (r.action === 'recovery_incomplete') { return 'Move did not finish — production state unconfirmed, needs attention'; }
  if (r.action === 'recovery_confirmed') { return d.where === 'live' ? 'Checked by a person after the problem — on production' : (d.where === 'staging' ? 'Checked by a person after the problem — back to what it was before' : 'Checked by a person after the problem'); }
  if (r.action === 'failed') { return d.outcome === 'restored' ? 'Move failed — put back automatically' : (d.outcome === 'not_replaced' ? 'Move failed — nothing on production was replaced' : 'Move failed — production state unconfirmed, needs attention'); }
  return str(r.action);
}
// rows (any order) + the register's Codex / test evidence -> one list, newest first. Nothing is left out.
export function historyList(rows, register) {
  var titles = {}; var items = (register && Array.isArray(register.items)) ? register.items : []; var i;
  for (i = 0; i < items.length; i++) { if (items[i] && items[i].id) { titles[str(items[i].id)] = str(items[i].title); } }
  var out = [];
  var list = rows || [];
  for (i = 0; i < list.length; i++) {
    var r = list[i]; if (!r) { continue; }
    var d = r.detail || {};
    out.push({ key: 'r' + r.id, row: r.id, ref: r.ref_id == null ? null : r.ref_id, at: str(r.created_at), item: str(r.item_id), title: titles[str(r.item_id)] || str(d.title) || str(r.item_id), action: str(r.action), what: rowWords(r),
      by: str(r.signed_by_name) || str(r.recorded_by), build: str(r.sha), backup: str(d.backup || d.backupDir), note: str(d.note).substring(0, 400) });
  }
  var ev = (register && Array.isArray(register.events)) ? register.events : [];
  for (i = 0; i < ev.length; i++) {
    var e = ev[i] || {};
    if (e.action !== 'codex-pass' && e.action !== 'behavioral-qa') { continue; }
    out.push({ key: 'e' + i, row: null, ref: null, at: str(e.at), item: str(e.item), title: titles[str(e.item)] || str(e.item), action: str(e.action), what: e.action === 'codex-pass' ? 'Codex passed this build' : 'Tested on staging — passed',
      by: e.action === 'codex-pass' ? 'Codex' : 'QA', build: str(e.build), backup: '', note: str(e.detail).substring(0, 400) });
  }
  out.sort(function (a, b) { return a.at < b.at ? 1 : (a.at > b.at ? -1 : 0); });
  return out;
}

// What a roll back of this change would undo, RIGHT NOW: the recorded move when there is one (it wins over the
// register), else a register item that deploy.js itself moved (a real build AND its recorded backup folder).
// A change moved by hand has neither: null, and it is restored by hand — never a roll-back request with no target.
export function liveTarget(item, st) {
  if (st && st.dep && str(st.dep.sha).length >= 7 && str(st.dep.backup).length >= 3) { return { sha: str(st.dep.sha), backup: str(st.dep.backup), row: st.dep.id, source: 'history' }; }
  if (st && st.where) { return null; }                                   // the history speaks for this change, and names no usable target
  var live = item && (item.status === 'live' || item.lifecycle === 'deployed');
  var sha = str(item && (item.deployedSha || item.build)); var backup = str(item && item.backupDir);
  if (live && /^[0-9a-f]{7,40}$/.test(sha) && backup.length >= 3) { return { sha: sha, backup: backup, row: null, source: 'register' }; }
  return null;
}

// What the screen may offer for one item, given its latest state. No guessing: a reason is always given when refused.
export function itemSignState(item, latest) {
  var st = latest || { kind: 'none' };
  // where the change IS: the recorded move rows win over the register file (which only catches up on a Hub release)
  var where = st.where || ((item && item.status === 'live') ? 'live' : ((item && item.lifecycle === 'deployed') ? 'deployed' : 'staging'));
  var live = where === 'live' || where === 'deployed';
  var build = passedBuild(item);
  var target = liveTarget(item, st);
  var out = { kind: st.kind || 'none', by: st.by || '', at: st.at || '', sha: st.sha || '', stale: false, canGo: false, canRollback: false, canWithdraw: false, why: '',
    where: where, whereAt: st.whereAt || '', problem: st.problem || '', liveBuild: target ? target.sha : '', liveBackup: target ? target.backup : '' };
  if (st.block) {
    // production state unconfirmed: nothing new may be asked for until a person has recorded what is there
    out.canWithdraw = st.kind === 'go' || st.kind === 'rollback';
    out.why = 'No new go or roll-back request can be recorded until a person has checked the live site and that check is recorded.';
    return out;
  }
  if (st.kind === 'go') {
    if (live) { out.kind = 'none'; }                                   // already moved: the go is used up
    else if (!build || build.sha !== st.sha) { out.stale = true; out.kind = 'none'; out.why = 'Your earlier go was for a different build. This build needs its own go.'; }
    else { out.canWithdraw = true; }
  }
  if (st.kind === 'rollback') {
    if (!live) { out.kind = 'none'; }                                  // already put back
    else if (!target || !st.target || st.target.sha !== target.sha || st.target.backup !== target.backup) { out.stale = true; out.kind = 'none'; out.why = 'Your earlier roll-back request was for a different build than the one on production now. It needs a new request.'; }
    else { out.canWithdraw = true; }
  }
  if (out.kind === 'none') {
    if (live) {
      if (target) { out.canRollback = true; }
      else { out.why = out.why || 'This change was moved by hand, so no build and backup folder are recorded for it. It can only be put back by hand; a roll back cannot be requested here.'; }
    }
    else if (!build) { out.why = out.why || 'Waiting for Codex to pass this exact build for production. It cannot be signed off before that.'; }
    else { out.canGo = true; }
  }
  return out;
}

// Validate one request. Returns { ok, error, status, row } — row is what to insert (without who).
export function checkSignoff(item, action, confirm, latest) {
  if (!item) { return { ok: false, status: 404, error: 'That change is not on the Change Schedule.' }; }
  if (action !== 'go' && action !== 'rollback' && action !== 'withdraw') { return { ok: false, status: 400, error: 'Unknown action.' }; }
  if (norm(confirm) === '' || norm(confirm) !== norm(item.title)) {
    return { ok: false, status: 400, error: 'Type the name of the change exactly as shown to confirm. Nothing was recorded.' };
  }
  var st = itemSignState(item, latest);
  if (action === 'go') {
    if (!st.canGo) {
      return { ok: false, status: 409, error: st.kind === 'go' ? 'This build already has your go.' : (st.where === 'unknown' ? st.why : (st.where !== 'staging' ? 'This change is already on production.' : (st.why || 'This change cannot be signed off yet.'))) };
    }
    var build = passedBuild(item);
    return { ok: true, row: { item_id: str(item.id), scope: 'warehouse', action: 'go', sha: build.sha, target: 'production', approval_text: approvalText('go', item, build.sha), detail: { title: str(item.title), codex: build.feedbackRef } } };
  }
  if (action === 'rollback') {
    if (!st.canRollback) {
      return { ok: false, status: 409, error: st.kind === 'rollback' ? 'A roll back is already requested for this change.' : (st.why || 'Only a change that is on production can be rolled back.') };
    }
    // the request names exactly what is on production now: its build, its backup folder, and the move it undoes
    var t = liveTarget(item, latest || { kind: 'none' });
    return { ok: true, row: { item_id: str(item.id), scope: 'warehouse', action: 'rollback', sha: t.sha, target: 'production', approval_text: approvalText('rollback', item, t.sha), ref_id: t.row,
      detail: { title: str(item.title), backup: t.backup, target_from: t.source } } };
  }
  if (!st.canWithdraw) { return { ok: false, status: 409, error: 'There is no open go or roll-back request to take back.' }; }
  return { ok: true, row: { item_id: str(item.id), scope: 'warehouse', action: 'withdraw', sha: st.sha || null, target: 'production', approval_text: null, detail: { title: str(item.title), withdraws: st.kind } } };
}
