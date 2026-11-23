'use strict';
/*
 * v55.83-XH — shared release-register helpers (release-governance session).
 *
 * The ONE release log the Hub Change Schedule screen reads and the deploy/rollback
 * scripts append to: release-management/release-register.json.
 *
 * Codex pre-build points 2 & 4:
 *   - This is a maintained PLAN / snapshot, separate from an operational event log.
 *     The scripts record planned / deploying / verified / failed / rolled-back as
 *     DISTINCT states. Nothing is marked "live" just because a script ran or uploaded
 *     files — markVerifiedLive requires an explicit verified flag + a human/Codex/QA ref.
 *   - Writes are ATOMIC (temp file + rename) to avoid a torn/concurrent read-modify-write.
 *
 * This module only ADDS to or UPDATES the register; it never deletes items or history —
 * mirroring the rule that warehouse data is never deleted. The deployed Hub copy only
 * refreshes on the next Hub deploy (the fs file is a build snapshot), so the screen labels
 * itself a plan as-of a time, not a live feed.
 */
var fs = require('fs');
var path = require('path');
var evaluateGate = require('./gate').evaluateGate;

// Default to the real register; tests point RELEASE_REGISTER_FILE at a throwaway copy.
var REGISTER_FILE = process.env.RELEASE_REGISTER_FILE || path.resolve(__dirname, '..', 'release-register.json');
var LOCK_DIR = REGISTER_FILE + '.lock';
var STATES = ['planned', 'queued', 'deploying', 'verified', 'live', 'failed', 'rolled-back'];

function load() {
  var raw = fs.readFileSync(REGISTER_FILE, 'utf8');
  return JSON.parse(raw);
}

// Atomic: write a temp file in the same dir, then rename over the target.
function save(reg) {
  reg.updated = new Date().toISOString().slice(0, 10);
  var tmp = REGISTER_FILE + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(reg, null, 2) + '\n');
  fs.renameSync(tmp, REGISTER_FILE);
}

// A real cross-process lock (mkdir is atomic) so two sessions never interleave a
// load-modify-save. Atomic rename alone does not serialize that (Codex 12:53 note).
function sleepMs(ms) { var until = Date.now() + ms; while (Date.now() < until) { /* spin: CLI only */ } }
function withLock(fn) {
  var got = false;
  for (var i = 0; i < 100; i++) {
    try { fs.mkdirSync(LOCK_DIR); got = true; break; } catch (e) { sleepMs(50); }
  }
  if (!got) { throw new Error('release register is locked by another process (' + LOCK_DIR + '); try again.'); }
  try { return fn(); } finally { try { fs.rmdirSync(LOCK_DIR); } catch (e) { /* ignore */ } }
}

function findItem(reg, id) {
  var items = reg.items || [];
  for (var i = 0; i < items.length; i++) { if (items[i] && items[i].id === id) { return items[i]; } }
  return null;
}

// Add a new item or merge fields into an existing one (never drops fields/history).
function upsertItem(fields) {
  if (!fields || !fields.id) { throw new Error('upsertItem needs an id'); }
  return withLock(function () {
    var reg = load();
    if (!reg.items) { reg.items = []; }
    var existing = findItem(reg, fields.id);
    if (existing) { Object.keys(fields).forEach(function (k) { existing[k] = fields[k]; }); }
    else { reg.items.push(fields); }
    save(reg);
    return reg;
  });
}

// Record a distinct lifecycle state (planned/deploying/verified/failed/rolled-back).
// Does NOT by itself set status='live' — that is markVerifiedLive only.
function setState(id, state, note) {
  if (STATES.indexOf(state) < 0) { throw new Error('unknown state ' + state); }
  return withLock(function () {
    var reg = load();
    var it = findItem(reg, id);
    if (!it) { throw new Error('no register item with id ' + id); }
    it.lifecycle = state;
    if (note) { it.lifecycleNote = note; }
    if (!reg.events) { reg.events = []; }
    reg.events.push(evRow({ action: 'state', item: id, detail: state + (note ? ' — ' + note : '') }));
    save(reg);
    return it;
  });
}

// ---- Evidence RECORDERS (Codex 13:11 #1/#2): evidence is recorded on the item as it arrives,
// each bound to a { sha, target }. markVerifiedLive only VERIFIES what is recorded; it never
// creates or overwrites approval. These are separate, auditable steps.
function recordCodexPass(id, ref) {
  if (!ref || !ref.sha || !ref.target || !ref.feedbackRef) { throw new Error('recordCodexPass needs { sha, target, feedbackRef }'); }
  return withLock(function () {
    var reg = load(); var it = findItem(reg, id); if (!it) { throw new Error('no item ' + id); }
    it.codexRef = { sha: ref.sha, target: ref.target, feedbackRef: ref.feedbackRef, at: new Date().toISOString() };
    it.needsCodex = false;
    if (!reg.events) { reg.events = []; }
    reg.events.push(evRow({ action: 'codex-pass', item: id, build: ref.sha, detail: 'target=' + ref.target + ' ref=' + ref.feedbackRef }));
    save(reg); return it;
  });
}
// A SEPARATE executed behavioral result (PHP/staging/browser), bound to sha+target. NOT source lint.
function recordBehavioralQA(id, rec) {
  if (!rec || !rec.sha || !rec.target || rec.result !== 'PASS') { throw new Error('recordBehavioralQA needs { sha, target, result:"PASS", suite?, run? }'); }
  return withLock(function () {
    var reg = load(); var it = findItem(reg, id); if (!it) { throw new Error('no item ' + id); }
    it.behavioralQa = { sha: rec.sha, target: rec.target, kind: 'behavioral', result: 'PASS', suite: rec.suite || '', run: rec.run || '', at: new Date().toISOString() };
    if (!reg.events) { reg.events = []; }
    reg.events.push(evRow({ action: 'behavioral-qa', item: id, build: rec.sha, detail: 'target=' + rec.target + ' suite=' + (rec.suite || '-') }));
    save(reg); return it;
  });
}
function recordMaxApproval(id, text) {
  if (!text || String(text).trim().length < 8) { throw new Error('recordMaxApproval needs Max\'s named approval text'); }
  return withLock(function () {
    var reg = load(); var it = findItem(reg, id); if (!it) { throw new Error('no item ' + id); }
    it.maxApproval = { text: String(text).trim(), at: new Date().toISOString() };
    it.needsMax = false;
    if (!reg.events) { reg.events = []; }
    reg.events.push(evRow({ action: 'max-approval', item: id, detail: 'recorded' }));
    save(reg); return it;
  });
}

// Mark an item live on production — ONLY after the SHARED gate passes against the RECORDED
// evidence (Codex 13:11 #2). Loads the item inside the lock, runs evaluateGate against the
// candidate, and compares confirm to the EXISTING recorded approval. It NEVER creates or
// overwrites codexRef / behavioralQa / maxApproval. On any mismatch nothing changes.
// ev = { sha, target, confirm, build, backup, verifiedBy }.
function markVerifiedLive(id, ev) {
  ev = ev || {};
  return withLock(function () {
    var reg = load();
    var it = findItem(reg, id);
    if (!it) { throw new Error('no register item with id ' + id); }

    // This helper ONLY marks a change live on PRODUCTION (it writes where='production',
    // status='live'). A staging-only verification — even one whose codexRef/behavioralQa/
    // ev.target are all consistently 'staging' — must NEVER be routed through it, or it would
    // create the exact wrong-environment release record this gate exists to prevent
    // (Codex 19:45 P2). Refuse BEFORE any mutation or save, so the item and event history
    // stay byte-identical. Record staging verification through a separate staging state.
    if (String(ev.target || '') !== 'production') {
      throw new Error('markVerifiedLive is production-only; ev.target must be "production" (got "' + ev.target + '"). Nothing changed.');
    }

    // Same validator deploy.js uses, against what is RECORDED on the item.
    var verdict = evaluateGate(it, { sha: ev.sha, target: ev.target, confirm: ev.confirm });
    if (!verdict.ok) {
      throw new Error('markVerifiedLive refused — evidence does not bind to this candidate: ' + verdict.problems.join(' | ') + '. Nothing changed.');
    }
    // Write-only fields must also bind to the candidate.
    if (!ev.verifiedBy) { throw new Error('markVerifiedLive needs verifiedBy. Nothing changed.'); }
    if (!ev.backup) { throw new Error('markVerifiedLive needs the backup location. Nothing changed.'); }
    if (String(ev.build || '') !== String(ev.sha || '')) { throw new Error('markVerifiedLive build (' + ev.build + ') must equal the candidate sha (' + ev.sha + '). Nothing changed.'); }

    // Flip to live WITHOUT touching the recorded evidence (no manufactured approval).
    it.where = 'production';
    it.status = 'live';
    it.lifecycle = 'live';
    it.needsMax = false;
    it.needsCodex = false;
    it.build = ev.build;
    it.backup = ev.backup;
    it.verifiedBy = ev.verifiedBy;
    it.verifiedAt = new Date().toISOString();
    if (!reg.events) { reg.events = []; }
    reg.events.push(evRow({ action: 'verified-live', item: id, build: ev.build, by: ev.verifiedBy, backup: ev.backup, detail: 'codexRef.sha=' + it.codexRef.sha + ' behavioralQa.sha=' + it.behavioralQa.sha }));
    save(reg);
    return it;
  });
}

// Move an item back to staging after a rollback (history kept; nothing deleted).
function markRolledBack(id, by) {
  return withLock(function () {
    var reg = load();
    var it = findItem(reg, id);
    if (!it) { throw new Error('no register item with id ' + id); }
    it.where = 'staging';
    it.status = 'queued';
    it.lifecycle = 'rolled-back';
    it.needsMax = true;
    if (!reg.events) { reg.events = []; }
    reg.events.push(evRow({ action: 'rolled-back', item: id, by: by || 'release-tooling' }));
    save(reg);
    return it;
  });
}

function evRow(ev) {
  return {
    at: new Date().toISOString(),
    action: ev.action || 'note',
    item: ev.item || '',
    build: ev.build || '',
    by: ev.by || 'release-tooling',
    backup: ev.backup || '',
    detail: ev.detail || ''
  };
}

// Append to the deploy/rollback event log (created if absent). Append-only, under the lock.
// Only real state changes log; dry-run / safe-mode paths must NOT call this (side-effect-free).
function logEvent(ev) {
  return withLock(function () {
    var reg = load();
    if (!reg.events) { reg.events = []; }
    reg.events.push(evRow(ev));
    save(reg);
  });
}

module.exports = {
  REGISTER_FILE: REGISTER_FILE, STATES: STATES,
  load: load, save: save, findItem: findItem,
  upsertItem: upsertItem, setState: setState,
  recordCodexPass: recordCodexPass, recordBehavioralQA: recordBehavioralQA, recordMaxApproval: recordMaxApproval,
  markVerifiedLive: markVerifiedLive, markRolledBack: markRolledBack, logEvent: logEvent
};
