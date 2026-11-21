// v55.83-WP — UNDO the last single category pick (Max, 21 Nov 2026: "need to be able to undo a category selection").
// One pick changes more than one line: the line's category, a learned rule, the look-alike lines that rule filled, the Wave
// category of those lines and (when every dollar is accounted for) the line's review status. An undo puts back EXACTLY what
// that pick changed and nothing else (Codex design response 21 Nov 00:19):
//   • the pick stores the exact BEFORE and AFTER state of every row and rule it changed, in the audit log (no new table);
//   • every restore is a CONDITIONAL update: it only happens while the row / rule is still in the state the pick left it in, so
//     a later change by anybody is never overwritten, and running the same undo twice can never restore twice;
//   • a line that is already in the ClickBooks ledger, or already sent to Wave, is NOT undone here (said plainly);
//   • the picked line decides: if IT cannot be undone, nothing is changed at all.
// Server only. var + concat.
import { merchantKey } from './expense-rules';

export var UNDO_HOURS = 24;
export var UNDO_MAX_ROWS = 2000;
// Only columns that EXIST on the live bank_transactions table (checked against its live column list, 21 Nov 2026 — there is no
// wave_transaction_id column there). "Sent to Wave" is read from the line's own sync fields.
export var LINE_COLS = 'id, name, merchant_name, account_id, wave_business_id, date, posted_date, transfer_group_id, classification, category_source, category_verified, category_verified_by, category_verified_at, wave_account_id, wave_account_name, category_status, wave_sync_status, sync_status, review_status, reviewed_by, reviewed_at';
export var LOOK_COLS = 'id, account_id, wave_business_id, date, posted_date, transfer_group_id, classification, category_source, category_verified, review_status, wave_account_id, category_status, wave_sync_status, sync_status';
// a line whose category has gone to Wave (or is on its way right now): its Wave side must be corrected in Wave, not here
export function sentToWave(t) { var a = String((t && t.category_status) || ''); var b = String((t && t.wave_sync_status) || ''); var c = String((t && t.sync_status) || ''); return a === 'synced' || a === 'syncing' || b === 'synced' || b === 'syncing' || c === 'synced' || c === 'syncing'; }

function pick(o, keys) { var out = {}; keys.forEach(function (k) { out[k] = o && o[k] !== undefined ? o[k] : null; }); return out; }
// v55.83-WS (Codex FAIL of WP) — the snapshot also holds verification, pairing and Wave sync state, so a state that was ALREADY
// there before the pick never blocks the undo, and a change made AFTER it always does
var STATE = ['classification', 'category_source', 'wave_account_id', 'wave_account_name', 'category_status', 'wave_sync_status', 'sync_status', 'review_status', 'reviewed_by', 'reviewed_at', 'category_verified', 'category_verified_by', 'category_verified_at', 'transfer_group_id', 'account_id', 'wave_business_id'];
// the fields the undo of the picked line compares with what the pick left
var CMP_LINE = ['classification', 'category_source', 'review_status', 'reviewed_by', 'reviewed_at', 'wave_account_id', 'category_verified', 'category_verified_by', 'category_verified_at', 'transfer_group_id'];

// the picked line as it is right now (null when it cannot be read)
export async function readLine(db, id) {
  var r = await db.from('bank_transactions').select(LINE_COLS).eq('id', id).maybeSingle();
  return (r && !r.error && r.data) ? r.data : null;
}
// the rule the pick is about to learn / retarget, as it is BEFORE the pick: same lookup as learnRule
export async function readRuleFor(db, line) {
  var key = merchantKey(((line && line.merchant_name) || '') + ' ' + ((line && line.name) || ''));
  if (!key) { return null; }
  var r = await db.from('us_expense_rules').select('id, classification, active, source, updated_at').ilike('match_text', key).limit(1);
  return (r && !r.error && r.data && r.data.length) ? r.data[0] : null;
}
export async function readRule(db, id) {
  if (!id || id === true) { return null; }
  var r = await db.from('us_expense_rules').select('id, classification, active, source, updated_at').eq('id', id).maybeSingle();
  return (r && !r.error && r.data) ? r.data : null;
}

// Written by the pick. snap = { before (line), after (line), cls, rule: { how, before, after }, look: [{ id, c, s }] (state BEFORE
// the fill), wave: { id, name, rows: [{ id, st }] } (lines whose Wave category this pick set, with their status before) }.
// Returns the undo id, or null when nothing can be undone or the snapshot could not be stored (then no undo is offered).
export async function writeUndoPoint(db, by, snap) {
  try {
    var b = snap.before; var a = snap.after;
    if (!b || !a || !by) { return null; }
    if ((snap.look || []).length > UNDO_MAX_ROWS) { return null; }
    var same = STATE.every(function (k) { return (b[k] === undefined ? null : b[k]) === (a[k] === undefined ? null : a[k]); });
    if (same && !(snap.look || []).length && !(snap.rule && (snap.rule.how === 'learned' || snap.rule.how === 'updated'))) { return null; }
    var details = { v: 2, cls: snap.cls, line: { id: a.id, who: String(a.merchant_name || a.name || '').substring(0, 80), before: pick(b, STATE), after: pick(a, STATE) },
      rule: snap.rule || null, look: snap.look || [], wave: snap.wave || null };
    var ins = await db.from('hub_audit_log').insert({ actor_id: by, action: 'category_pick_undo_point', entity: 'bank_transaction', entity_id: String(a.id), details: details }).select('id');
    if (ins.error || !ins.data || !ins.data.length) { return null; }
    return ins.data[0].id;
  } catch (e) { return null; }
}

// Which of these bank lines already have an entry in the ClickBooks ledger. { known: bool, posted: { id: true } }.
// known false = the check is not installed (sql/v55-83-WS-ledger-posted-check.sql) or failed → NO undo at all (fail closed; review
// status is never taken as proof that a line was not posted — Codex, 21 Nov).
export async function ledgerPosted(db, ids) {
  var out = { known: false, posted: {} };
  if (!ids || !ids.length) { out.known = true; return out; }
  try {
    for (var i = 0; i < ids.length; i += 500) {
      var r = await db.rpc('hub_bank_ledger_posted', { p_ids: ids.slice(i, i + 500).map(String) });
      if (!r || r.error) { return { known: false, posted: {} }; }
      (r.data || []).forEach(function (x) { var id = typeof x === 'string' ? x : (x && (x.hub_bank_ledger_posted || x.id)); if (id) { out.posted[String(id)] = true; } });
    }
    out.known = true; return out;
  } catch (e) { return { known: false, posted: {} }; }
}
function finished(st) { return st === 'reviewed' || st === 'approved'; }
function eqState(row, st, keys) { return keys.every(function (k) { return (row[k] === undefined ? null : row[k]) === (st[k] === undefined ? null : st[k]); }); }

// v55.83-WS (Codex FAIL of WP, 21 Nov) — what may still be changed on a line at undo time, checked on its CURRENT state:
// scope = { priv: privateScope() result, floor: the person's history-window start or null, business: the company id }.
// Returns null when allowed, else the reason in plain words.
export function outOfScope(t, scope) {
  var s = scope || {};
  if (!t) { return 'the line could not be read'; }
  if (s.priv && s.priv.error) { return 'the Hub could not check which bank accounts are private'; }
  if (s.priv && !s.priv.all && t.account_id && s.priv.hidden && s.priv.hidden[t.account_id]) { return 'it is in a private bank account you may not see'; }
  if (s.business && t.wave_business_id && t.wave_business_id !== s.business) { return 'it belongs to another company'; }
  var d = String(t.posted_date || t.date || '').substring(0, 10);
  if (s.floor && d && d < s.floor) { return 'it is older than the history you may see'; }
  return null;
}
function eqOrIs(q, col, v) { return (v === null || v === undefined) ? q.is(col, null) : q.eq(col, v); }

// The undo itself. Returns { ok, status, error } or { ok: true, line, look: { restored, changed_since, in_ledger, sent_to_wave,
// out_of_scope }, rule }.
export async function undoCategoryPick(db, by, undoId, nowMs, scope) {
  if (!undoId) { return { ok: false, status: 400, error: 'Nothing to undo.' }; }
  var pr = await db.from('hub_audit_log').select('id, actor_id, action, entity_id, details, created_at').eq('id', undoId).maybeSingle();
  var p = pr && !pr.error ? pr.data : null;
  if (!p || p.action !== 'category_pick_undo_point' || !p.details || (p.details.v !== 1 && p.details.v !== 2)) { return { ok: false, status: 404, error: 'This category change cannot be undone here (no undo record).' }; }
  if (String(p.actor_id) !== String(by)) { return { ok: false, status: 403, error: 'Only the person who picked the category can undo it.' }; }
  var age = (Number(nowMs) || Date.now()) - Date.parse(p.created_at);
  if (!(age >= 0) || age > UNDO_HOURS * 3600000) { return { ok: false, status: 409, error: 'This category was picked more than ' + UNDO_HOURS + ' hours ago — pick the right category on the line instead.' }; }
  var done = await db.from('hub_audit_log').select('id').eq('action', 'category_pick_undone').eq('entity_id', String(undoId)).limit(1);
  if (done && !done.error && done.data && done.data.length) { return { ok: false, status: 409, error: 'This category change was already undone.' }; }
  if (p.details.v !== 2) { return { ok: false, status: 409, error: 'This category was picked before the current undo rules — pick the right category on the line instead.' }; }
  var d = p.details; var L = d.line; var b = L.before; var a = L.after;
  var cur = await readLine(db, L.id);
  if (!cur) { return { ok: false, status: 404, error: 'The bank line could not be read — nothing was changed.' }; }
  var lookIds = (d.look || []).map(function (x) { return x.id; });
  // (Codex) a missing ledger check is never replaced by "it is not reviewed, so it was never posted": no check, no undo at all
  var led = await ledgerPosted(db, [L.id].concat(lookIds));
  if (!led.known) { return { ok: false, status: 409, needs_sql: true, error: 'Undo needs a one-time database step first (sql/v55-83-WS-ledger-posted-check.sql), so the Hub can check that a line is not already in the ClickBooks ledger. Nothing was changed — pick the right category on the line instead.' }; }
  var already = eqState(cur, b, CMP_LINE) && !eqState(b, a, CMP_LINE); // a first attempt got as far as the line: finish the rest
  if (!already) {
    var why = outOfScope(cur, scope);
    if (why) { return { ok: false, status: 403, error: 'This line cannot be changed by you now: ' + why + '. Nothing was changed.' }; }
    if (cur.transfer_group_id) { return { ok: false, status: 409, error: 'This line was paired as a transfer after your pick. Nothing was changed — unpair it first if the pairing is wrong.' }; }
    if (!eqState(cur, a, ['category_verified', 'category_verified_by', 'category_verified_at'])) { return { ok: false, status: 409, error: 'The category of this line was verified after your pick. Nothing was changed.' }; }
    if (!eqState(cur, a, ['review_status', 'reviewed_by', 'reviewed_at'])) { return { ok: false, status: 409, error: 'This line was reviewed again after your pick. Nothing was changed — pick the right category on the line instead.' }; }
    if (!eqState(cur, a, CMP_LINE)) { return { ok: false, status: 409, error: 'This line was changed again after your pick, so the undo would overwrite newer work. Nothing was changed — pick the right category on the line.' }; }
    if (led.posted[String(L.id)]) { return { ok: false, status: 409, error: 'This line is already in the ClickBooks ledger, so it cannot be undone here. Nothing was changed. Correct it in ClickBooks (reverse the entry), then pick the right category.' }; }
    // (Codex P1) sent to Wave is read from the line as it is NOW, whoever set its Wave account
    if (sentToWave(cur)) { return { ok: false, status: 409, error: 'This line has already been sent to Wave. Nothing was changed — change it in Wave, then pick the right category here.' }; }
    var waveByPick = (b.wave_account_id || null) !== (a.wave_account_id || null);
    var reviewByPick = (b.review_status || null) !== (a.review_status || null);
    var patch = { classification: b.classification, category_source: b.category_source };
    if (waveByPick) { patch.wave_account_id = b.wave_account_id; patch.wave_account_name = b.wave_account_name; patch.category_status = b.category_status; }
    if (reviewByPick) { patch.review_status = b.review_status; patch.reviewed_by = b.reviewed_by; patch.reviewed_at = b.reviewed_at; }
    // the update only happens while EVERY compared field is still exactly what the pick left (null compared as null)
    var q = db.from('bank_transactions').update(patch).eq('id', L.id);
    CMP_LINE.forEach(function (k) { q = eqOrIs(q, k, a[k] === undefined ? null : a[k]); });
    var up = await q.select('id');
    if (up.error) { return { ok: false, status: 400, error: up.error.message }; }
    if (!up.data || !up.data.length) { return { ok: false, status: 409, error: 'This line was changed again just now. Nothing was changed by the undo.' }; }
  }
  // look-alike lines the pick filled: each back to ITS OWN recorded category, only while it still has what the pick gave it
  var look = { restored: 0, changed_since: 0, in_ledger: 0, sent_to_wave: 0, out_of_scope: 0 };
  var waveRows = {}; ((d.wave && d.wave.rows) || []).forEach(function (w) { waveRows[w.id] = w; });
  var curLook = {};
  for (var i = 0; i < lookIds.length; i += 200) {
    var rr = await db.from('bank_transactions').select(LOOK_COLS).in('id', lookIds.slice(i, i + 200));
    // the look-alikes could not be read → stop here, said plainly; nothing more is changed and the undo can be run again
    if (!rr || rr.error) { return { ok: false, status: 400, error: 'The line itself was put back, but the look-alike lines could not be read (' + ((rr && rr.error && rr.error.message) || 'no answer') + '). Press Undo again to finish.' }; }
    (rr.data || []).forEach(function (t) { curLook[t.id] = t; });
  }
  var groups = {};
  (d.look || []).forEach(function (x) {
    var t = curLook[x.id];
    if (!t || t.classification !== d.cls || t.category_source !== 'rule' || t.category_verified === true || t.transfer_group_id) { if (!(t && t.classification === x.c && (t.category_source || null) === (x.s || null))) { look.changed_since++; } return; }
    if (outOfScope(t, scope)) { look.out_of_scope++; return; }
    if (led.posted[String(x.id)]) { look.in_ledger++; return; }
    if (sentToWave(t)) { look.sent_to_wave++; return; }
    var w = waveRows[x.id];
    var gk = JSON.stringify([x.c === undefined ? null : x.c, x.s === undefined ? null : x.s, w ? 1 : 0, w ? (w.st === undefined ? null : w.st) : null]);
    (groups[gk] = groups[gk] || { c: x.c === undefined ? null : x.c, s: x.s === undefined ? null : x.s, wave: !!w, st: w ? (w.st === undefined ? null : w.st) : null, ids: [] }).ids.push(x.id);
  });
  var gkeys = Object.keys(groups);
  for (var g = 0; g < gkeys.length; g++) {
    var G = groups[gkeys[g]];
    for (var j = 0; j < G.ids.length; j += 200) {
      var patchL = { classification: G.c, category_source: G.s };
      if (G.wave) { patchL.wave_account_id = null; patchL.wave_account_name = null; patchL.category_status = G.st; }
      var ql = db.from('bank_transactions').update(patchL).in('id', G.ids.slice(j, j + 200)).eq('classification', d.cls).eq('category_source', 'rule').not('category_verified', 'is', true).is('transfer_group_id', null);
      if (G.wave) { ql = ql.eq('wave_account_id', d.wave.id); }
      var ul = await ql.select('id');
      var n = (!ul.error && ul.data) ? ul.data.length : 0; look.restored += n; look.changed_since += G.ids.slice(j, j + 200).length - n;
    }
  }
  // the rule: a rule this pick created is switched off (never deleted); one it retargeted goes back; any other is left alone.
  var rule = 'none';
  if (d.rule && d.rule.after && d.rule.after.id && (d.rule.how === 'learned' || d.rule.how === 'updated')) {
    var RA = d.rule.after; var RB = d.rule.before;
    var qr = db.from('us_expense_rules').update(d.rule.how === 'learned' ? { active: false, updated_by: by, updated_at: new Date().toISOString() } : { classification: RB.classification, active: RB.active, updated_by: by, updated_at: new Date().toISOString() })
      .eq('id', RA.id).eq('classification', RA.classification).eq('active', true);
    if (RA.updated_at) { qr = qr.eq('updated_at', RA.updated_at); }
    var ur = await qr.select('id');
    rule = (!ur.error && ur.data && ur.data.length) ? (d.rule.how === 'learned' ? 'switched_off' : 'put_back') : 'changed_since';
  } else if (d.rule && d.rule.how) { rule = 'left'; }
  var result = { line: already ? 'already_back' : 'restored', line_id: L.id, to: b.classification || null, look: look, rule: rule, ledger_check: led.known };
  try { await db.from('hub_audit_log').insert({ actor_id: by, action: 'category_pick_undone', entity: 'undo_point', entity_id: String(undoId), details: result }); } catch (eA) { /* the restore itself is done */ }
  return Object.assign({ ok: true }, result);
}

// one sentence for the person, from the result above
export function undoWords(r, labelOf) {
  if (!r || r.ok !== true) { return (r && r.error) || 'Not undone.'; }
  var lab = r.to ? ((labelOf && labelOf(r.to)) || r.to) : 'no category';
  var out = 'Undone: the line is back to ' + lab + '.';
  var k = r.look || {};
  if (k.restored) { out += ' ' + k.restored + ' look-alike line(s) put back too.'; }
  var left = (k.changed_since || 0) + (k.in_ledger || 0) + (k.sent_to_wave || 0) + (k.out_of_scope || 0);
  if (left) { out += ' ' + left + ' look-alike line(s) were LEFT as they are (' + [k.changed_since ? k.changed_since + ' changed since' : '', k.in_ledger ? k.in_ledger + ' already in the ClickBooks ledger' : '', k.sent_to_wave ? k.sent_to_wave + ' already sent to Wave' : '', k.out_of_scope ? k.out_of_scope + ' you may not change' : ''].filter(Boolean).join(', ') + ').'; }
  if (r.rule === 'switched_off') { out += ' The rule this pick created is switched off.'; }
  else if (r.rule === 'put_back') { out += ' The rule is back to its earlier category.'; }
  else if (r.rule === 'changed_since') { out += ' The rule was changed by someone since and was left alone.'; }
  return out;
}
