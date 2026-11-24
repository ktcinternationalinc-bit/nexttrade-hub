'use strict';
/*
 * v55.83-YJ — the live move and the undo, as steps run through an INJECTABLE runner.
 *
 *   runner.run(cmd)            -> { code, out }   run one POSIX shell command on the server
 *   runner.put(local, remote)  -> { code, out }   copy one local file up
 *   runner.status(url)         -> number          HTTP status of the site (0 = no answer)
 *
 * Real use = ssh / scp with the authorized key (sshRunner below). Tests = a local shell against a
 * throwaway folder, so backup / upload / verify / restore are EXECUTED, not read.
 *
 * Rules built in (CHANGE-MANAGEMENT.md A–C, and "data is never deleted"):
 *   - only files on the change's explicit allowlist; no .env, no storage/, no '..', no absolute path
 *   - back up FIRST, and prove each backup is byte-identical (sha256) before anything is replaced
 *   - a MANIFEST.json in the backup folder records, per file, whether it existed and its sha256
 *   - any failure after the first replace -> automatic restore from that backup
 *   - undo: the current live files are saved first (so the undo is itself reversible); a file the move
 *     ADDED is MOVED into that folder, never deleted; restored files are proven against the manifest
 *   - code only: no SQL, no migration, no data statement is ever sent. No rm, no DROP.
 */
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var cp = require('child_process');
var selection = require('./selection');

function str(v) { return v === null || v === undefined ? '' : String(v); }
function q(p) { return "'" + str(p) + "'"; }                       // paths are charset-checked first, so no quote can occur
function dirOf(p) { var i = str(p).lastIndexOf('/'); return i > 0 ? str(p).substring(0, i) : ''; }
function sha256File(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }

var SAFE_PATH = /^[A-Za-z0-9._\/-]+$/;

// One relative file path of the change. Returns a problem string or null.
function fileProblem(f) {
  var p = str(f);
  if (!selection.codePath(p)) { return p + ': only reviewed application code/assets are deployable; data, uploads and migrations are excluded'; }
  if (!p) { return 'empty file path'; }
  if (!SAFE_PATH.test(p)) { return p + ': only letters, digits, dot, dash, underscore and / are allowed'; }
  if (p.charAt(0) === '/' || p.charAt(0) === '-' || p.charAt(p.length - 1) === '/') { return p + ': must be a relative file path'; }
  var segs = p.split('/'); var i;
  for (i = 0; i < segs.length; i++) {
    if (segs[i] === '' || segs[i] === '.' || segs[i] === '..') { return p + ': "." / ".." / empty folders are not allowed'; }
    if (segs[i].toLowerCase().indexOf('.env') === 0) { return p + ': .env files are never moved by this tool'; }
  }
  if (segs[0].toLowerCase() === 'storage' || segs[0].toLowerCase() === 'vendor' || segs[0].toLowerCase() === 'node_modules' || segs[0].toLowerCase() === 'staging') { return p + ': ' + segs[0] + '/ is never moved by this tool'; }
  return null;
}

// files = what the operator asked to move; allow = the change's recorded deployFiles. Exact match only.
function checkFiles(files, allow) {
  var problems = []; var seen = {}; var i;
  if (!Array.isArray(files) || !files.length) { return ['No files given. List the exact files of this change.']; }
  if (!Array.isArray(allow) || !allow.length) { return ['This change has no deployFiles list recorded, so nothing may be moved.']; }
  for (i = 0; i < files.length; i++) {
    var fp = fileProblem(files[i]);
    if (fp) { problems.push(fp); continue; }
    if (seen[files[i]]) { problems.push(files[i] + ': listed twice'); }
    seen[files[i]] = 1;
    if (allow.indexOf(files[i]) < 0) { problems.push(files[i] + ': not on this change\'s deployFiles list'); }
  }
  return problems;
}

// A server folder given by config / register. Absolute or ~/..., safe characters, no '..'.
function dirProblem(d, label) {
  var p = str(d);
  if (!p) { return label + ' is not set'; }
  if (!/^(~\/|\/)[A-Za-z0-9._\/-]+$/.test(p)) { return label + ' (' + p + ') must be an absolute or ~/ path with plain characters'; }
  if (p.split('/').indexOf('..') >= 0) { return label + ' must not contain ".."'; }
  return null;
}

function Steps(runner, log) {
  this.runner = runner; this.log = log || function () {}; this.home = null;
}
Steps.prototype.run = function (cmd) { var r = this.runner.run(cmd) || {}; return { code: typeof r.code === 'number' ? r.code : 1, out: str(r.out).trim() }; };
Steps.prototype.must = function (cmd, what) { var r = this.run(cmd); if (r.code !== 0) { throw new Error(what + ' failed (' + r.code + ')' + (r.out ? ': ' + r.out.substring(0, 200) : '')); } return r.out; };
Steps.prototype.abs = function (p) {
  if (str(p).indexOf('~/') !== 0) { return str(p); }
  if (this.home === null) {
    var h = this.must('printf %s "$HOME"', 'reading the home folder');
    if (!/^\/[A-Za-z0-9._\/-]+$/.test(h)) { throw new Error('the server home folder has unexpected characters; stopping'); }
    this.home = h;
  }
  return this.home + str(p).substring(1);
};
Steps.prototype.isFile = function (p) { return this.run('test -f ' + q(p) + ' && test ! -L ' + q(p)).code === 0; };
Steps.prototype.exists = function (p) { return this.run('test -e ' + q(p) + ' || test -L ' + q(p)).code === 0; };
Steps.prototype.sha = function (p) {
  var out = this.must('sha256sum ' + q(p), 'reading the fingerprint of ' + p);
  var h = out.split(/\s+/)[0].replace(/^\\/, '');
  if (!/^[0-9a-f]{64}$/.test(h)) { throw new Error('unreadable fingerprint for ' + p); }
  return h;
};
Steps.prototype.copyVerified = function (from, to, what) {
  var d = dirOf(to);
  if (d) { this.must('mkdir -p ' + q(d), 'making the folder for ' + to); }
  this.must('cp -p ' + q(from) + ' ' + q(to), what);
  var a = this.sha(from); var b = this.sha(to);
  if (a !== b) { throw new Error(what + ': the copy is not identical to the original'); }
  return a;
};
Steps.prototype.putJson = function (obj, remote, tmpDir) {
  var local = path.join(tmpDir, 'yj-manifest-' + process.pid + '-' + Date.now() + '.json');
  var text = JSON.stringify(obj, null, 2) + '\n';
  fs.writeFileSync(local, text);
  try {
    var r = this.runner.put(local, remote) || {};
    if (r.code !== 0) { throw new Error('writing ' + remote + ' failed'); }
    var want = crypto.createHash('sha256').update(text).digest('hex');
    if (this.sha(remote) !== want) { throw new Error(remote + ' was not written correctly'); }
  } finally { try { fs.unlinkSync(local); } catch (e) { /* scratch file */ } }
};
// ONE release at a time on the server (Codex 24 Nov #3). mkdir is atomic: whoever makes the folder holds
// the lock. It is released by MOVING it into .release-locks-done/ (a history of runs; nothing is deleted).
// A run that died leaves the lock in place on purpose: the next run refuses until a person has looked.
Steps.prototype.takeLock = function (backupRoot, owner) {
  if (!/^[A-Za-z0-9._-]{2,120}$/.test(str(owner))) { throw new Error('unsafe lock owner name'); }
  this.must('mkdir -p ' + q(backupRoot), 'making the backup root');
  var lock = backupRoot + '/.release-lock';
  if (this.run('mkdir ' + q(lock)).code !== 0) {
    var held = this.run('cat ' + q(lock + '/OWNER')).out;
    throw new Error('another release holds the lock on this server (' + (held || 'owner unknown') + ' — ' + lock + '). Nothing was changed. If that run is finished or died, a person must check the site and move that folder aside first.');
  }
  this.must('printf %s ' + q(owner) + ' > ' + q(lock + '/OWNER'), 'writing the lock owner');
  this.lock = { path: lock, done: backupRoot + '/.release-locks-done', owner: owner };
};
Steps.prototype.dropLock = function () {
  if (!this.lock) { return true; }
  var l = this.lock; this.lock = null;
  var ok = this.run('mkdir -p ' + q(l.done) + ' && mv ' + q(l.path) + ' ' + q(l.done + '/' + l.owner + '-' + Date.now())).code === 0;
  return ok;
};
// What is on the live app for one file right now: '' = not there, else its fingerprint.
Steps.prototype.liveSha = function (p) {
  if (this.isFile(p)) { return this.sha(p); }
  if (this.exists(p)) { throw new Error(p + ' exists on the server but is not a plain file; stopping'); }
  return '';
};

Steps.prototype.readManifest = function (dir) {
  var txt = this.must('cat ' + q(dir + '/MANIFEST.json'), 'reading the backup list in ' + dir);
  var m;
  try { m = JSON.parse(txt); } catch (e) { throw new Error('the backup list in ' + dir + ' cannot be read'); }
  if (!m || !Array.isArray(m.files) || !m.files.length) { throw new Error('the backup list in ' + dir + ' is empty'); }
  for (var i = 0; i < m.files.length; i++) {
    var f = m.files[i] || {};
    var fp = fileProblem(f.path);
    if (fp) { throw new Error('the backup list names an unsafe file: ' + fp); }
    if (f.existed === true && !/^[0-9a-f]{64}$/.test(str(f.before))) { throw new Error('the backup list has no fingerprint for ' + f.path); }
    if (f.existed !== true && f.existed !== false) { throw new Error('the backup list does not say whether ' + f.path + ' existed'); }
    if (!/^[0-9a-f]{64}$/.test(str(f.after))) { throw new Error('the backup list has no fingerprint of the new ' + f.path); }
  }
  return m;
};

function siteOk(runner, url) {
  var st = 0;
  try { st = Number(runner.status(url)) || 0; } catch (e) { st = 0; }
  return { ok: st >= 200 && st < 400, status: st };
}
function clearCaches(s, appRoot, cmds) {
  var list = cmds || [];
  for (var i = 0; i < list.length; i++) {
    if (!/^php artisan (view|config|route):clear$/.test(list[i])) { throw new Error('refusing an unexpected command: ' + list[i]); }
    s.must('cd ' + q(appRoot) + ' && ' + list[i], list[i]);
  }
}

/*
 * Put the files of the backup in backupDir back. Used by the explicit roll back AND by the automatic
 * restore after a failed move. Saves the current live files to undoDir first.
 * o = { runner, appRoot, backupDir, undoDir, cacheCmds, siteUrl, tmpDir, reason, log }
 * Returns { ok, undoDir, restored: [], movedAside: [], problems: [] }.
 */
function restoreLive(o) {
  var s = new Steps(o.runner, o.log); var out = { ok: false, undoDir: '', restored: [], movedAside: [], problems: [] };
  try {
    var bad = dirProblem(o.appRoot, 'the app folder') || dirProblem(o.backupDir, 'the backup folder') || dirProblem(o.undoDir, 'the undo folder');
    if (bad) { throw new Error(bad); }
    var appRoot = s.abs(o.appRoot); var backupDir = s.abs(o.backupDir); var undoDir = s.abs(o.undoDir);
    out.undoDir = undoDir;
    if (!s.isFile(appRoot + '/artisan')) { throw new Error('the app folder ' + appRoot + ' does not look like the warehouse app (no artisan file)'); }
    var m = s.readManifest(backupDir);
    if (o.sha && m.sha !== o.sha) { throw new Error('The backup belongs to another release build.'); }
    if (s.exists(undoDir)) { throw new Error('the undo folder ' + undoDir + ' already exists; a folder is never reused'); }
    if (!o.lockHeld) {
      var root = dirOf(backupDir);
      s.takeLock(root, 'undo-' + (undoDir.substring(undoDir.lastIndexOf('/') + 1).replace(/[^A-Za-z0-9._-]/g, '-')));
    }
    var i; var f; var now = {};
    // 1) prove every backup is still what the list says, BEFORE touching anything
    for (i = 0; i < m.files.length; i++) {
      f = m.files[i];
      if (f.existed) {
        if (!s.isFile(backupDir + '/files/' + f.path)) { throw new Error('the backup copy of ' + f.path + ' is missing'); }
        if (s.sha(backupDir + '/files/' + f.path) !== f.before) { throw new Error('the backup copy of ' + f.path + ' does not match the backup list'); }
      }
    }
    // 1b) every live file must be EITHER what this release put there OR what was there before it. Anything
    //     else means a different release (or a person) changed it since: never restore over that.
    for (i = 0; i < m.files.length; i++) {
      f = m.files[i];
      now[f.path] = s.liveSha(appRoot + '/' + f.path);
      var wasBefore = f.existed ? f.before : '';
      if (now[f.path] !== f.after && now[f.path] !== wasBefore) {
        throw new Error(f.path + ' on the live app is neither this release\'s file nor the one before it — something else changed it since. Refusing to restore over it; nothing was changed.');
      }
    }
    // 2) save what is live now, so this undo can itself be undone
    s.must('mkdir -p ' + q(undoDir + '/files'), 'making the undo folder');
    var undo = { made: new Date().toISOString(), reason: str(o.reason), of: backupDir, files: [] };
    for (i = 0; i < m.files.length; i++) {
      f = m.files[i];
      if (s.isFile(appRoot + '/' + f.path)) { undo.files.push({ path: f.path, existed: true, before: s.copyVerified(appRoot + '/' + f.path, undoDir + '/files/' + f.path, 'saving the current ' + f.path) }); }
      else { undo.files.push({ path: f.path, existed: false, before: '' }); }
    }
    s.putJson(undo, undoDir + '/MANIFEST.json', o.tmpDir);
    // 2b) a half-uploaded file left by a failed move is moved into the undo folder (kept, not deleted)
    for (i = 0; i < m.files.length; i++) {
      var left = appRoot + '/' + m.files[i].path + '.yj-new';
      if (s.exists(left)) {
        s.must('mkdir -p ' + q(dirOf(undoDir + '/leftover/' + m.files[i].path)), 'making the folder for a leftover');
        s.must('mv ' + q(left) + ' ' + q(undoDir + '/leftover/' + m.files[i].path + '.yj-new'), 'moving a leftover upload aside');
      }
    }
    // 3) put back
    for (i = 0; i < m.files.length; i++) {
      f = m.files[i]; var target = appRoot + '/' + f.path;
      if (f.existed) {
        var tmp = target + '.yj-restore';
        s.copyVerified(backupDir + '/files/' + f.path, tmp, 'restoring ' + f.path);
        s.must('mv -f ' + q(tmp) + ' ' + q(target), 'putting ' + f.path + ' back');
        if (s.sha(target) !== f.before) { throw new Error(f.path + ' is not identical to the backup after the restore'); }
        out.restored.push(f.path);
      } else if (s.exists(target)) {
        // the move ADDED this file: it is moved aside (kept), never deleted
        s.must('mkdir -p ' + q(dirOf(undoDir + '/added/' + f.path)), 'making the folder for an added file');
        s.must('mv ' + q(target) + ' ' + q(undoDir + '/added/' + f.path), 'moving the added file ' + f.path + ' aside');
        out.movedAside.push(f.path);
      }
    }
    out.filesBack = true;                                        // every file is proven back, whatever happens next
    clearCaches(s, appRoot, o.cacheCmds);
    if (o.siteUrl) { var so = siteOk(o.runner, o.siteUrl); out.siteStatus = so.status; if (!so.ok) { throw new Error('the site answered ' + so.status + ' after the restore'); } }
    out.ok = true;
  } catch (e) { out.problems.push(e.message); }
  if (!o.lockHeld && !s.dropLock()) { out.problems.push('the release lock could not be released; a person must move it aside before the next release'); out.lockStuck = true; out.ok = false; }
  return out;
}

/*
 * Move the files of one change to the live app, backups first.
 * o = { runner, appRoot, backupRoot, topic, stamp, files, allow, localRoot, cacheCmds, siteUrl, tmpDir, log }
 * Returns { ok, backupDir, replaced: [], problems: [], restored: null | restoreLive result }.
 */
function deployLive(o) {
  var s = new Steps(o.runner, o.log);
  var out = { ok: false, backupDir: '', replaced: [], problems: [], restored: null };
  var started = false; var backupDir = ''; var appRoot = '';
  try {
    var fp = checkFiles(o.files, o.allow);
    if (fp.length) { throw new Error(fp.join(' | ')); }
    var expected = o.manifest;
    if (!expected || expected.sha !== o.sha || !Array.isArray(expected.files) || expected.files.length !== o.files.length) { throw new Error('A candidate-bound expected-live manifest is required.'); }
    var expectedByPath = {};
    expected.files.forEach(function (f) {
      if (!f || expectedByPath[f.path] || o.files.indexOf(f.path) < 0 || !(f.before === '' || /^[0-9a-f]{64}$/.test(f.before || '')) || !/^[0-9a-f]{64}$/.test(f.after || '')) throw new Error('Invalid expected-live manifest.');
      expectedByPath[f.path] = f;
    });
    if (!/^[a-z0-9-]{2,60}$/.test(str(o.topic))) { throw new Error('unsafe topic name'); }
    if (!/^[0-9]{14}$/.test(str(o.stamp))) { throw new Error('unsafe time stamp'); }
    var bad = dirProblem(o.appRoot, 'the app folder') || dirProblem(o.backupRoot, 'the backup root');
    if (bad) { throw new Error(bad); }
    var i; var f; var local = {};
    for (i = 0; i < o.files.length; i++) {
      var lp = path.join(o.localRoot, o.files[i]);
      if (!fs.existsSync(lp) || !fs.statSync(lp).isFile()) { throw new Error('the new file ' + o.files[i] + ' is not in the local warehouse copy'); }
      local[o.files[i]] = { path: lp, sha: sha256File(lp) };
      if (local[o.files[i]].sha !== expectedByPath[o.files[i]].after) { throw new Error('Candidate bytes changed: ' + o.files[i]); }
    }
    appRoot = s.abs(o.appRoot);
    backupDir = s.abs(o.backupRoot) + '/' + o.topic + '-' + o.stamp;
    out.backupDir = backupDir;
    if (!s.isFile(appRoot + '/artisan')) { throw new Error('the app folder ' + appRoot + ' does not look like the warehouse app (no artisan file)'); }
    if (s.exists(backupDir)) { throw new Error('the backup folder ' + backupDir + ' already exists; a backup is never overwritten'); }
    s.takeLock(s.abs(o.backupRoot), o.topic + '-' + o.stamp);    // one release at a time on this server
    // Check ALL files before backing up/replacing any. Never refresh this baseline during deployment.
    for (i = 0; i < o.files.length; i++) {
      f = o.files[i];
      if (s.liveSha(appRoot + '/' + f) !== expectedByPath[f].before) { throw new Error('Production changed since review: ' + f + '. Integrate the newer code and re-test; nothing replaced.'); }
    }

    // 1) BACK UP FIRST and prove each copy
    s.must('mkdir -p ' + q(backupDir + '/files'), 'making the backup folder');
    var manifest = { made: new Date().toISOString(), topic: o.topic, sha: str(o.sha), appRoot: appRoot, files: [] };
    for (i = 0; i < o.files.length; i++) {
      f = o.files[i]; var live = appRoot + '/' + f;
      if (s.isFile(live)) { manifest.files.push({ path: f, existed: true, before: s.copyVerified(live, backupDir + '/files/' + f, 'backing up ' + f), after: local[f].sha }); }
      else if (s.exists(live)) { throw new Error(f + ' exists on the server but is not a plain file; stopping'); }
      else { manifest.files.push({ path: f, existed: false, before: '', after: local[f].sha }); }
    }
    s.putJson(manifest, backupDir + '/MANIFEST.json', o.tmpDir);
    s.readManifest(backupDir);                                   // the list must read back before anything is replaced
    if (o.prepareDatabase) {
      out.databaseStarted = true;
      out.database = o.prepareDatabase({ appRoot: appRoot, backupDir: backupDir });
    }

    // 2) replace, one file at a time, each proven
    started = true;
    for (i = 0; i < o.files.length; i++) {
      f = o.files[i]; var target = appRoot + '/' + f; var tmp = target + '.yj-new';
      if (dirOf(target)) { s.must('mkdir -p ' + q(dirOf(target)), 'making the folder for ' + f); }
      var pr = o.runner.put(local[f].path, tmp) || {};
      if (pr.code !== 0) { throw new Error('uploading ' + f + ' failed'); }
      if (s.sha(tmp) !== local[f].sha) { throw new Error('the uploaded ' + f + ' is not identical to the local file'); }
      s.must('mv -f ' + q(tmp) + ' ' + q(target), 'putting the new ' + f + ' in place');
      if (s.sha(target) !== local[f].sha) { throw new Error(f + ' on the server is not identical to the local file'); }
      out.replaced.push(f);
    }
    clearCaches(s, appRoot, o.cacheCmds);
    // "The site answers" only proves the app did not fall over (not a 5xx, not silence). It does NOT prove the
    // change works: that is a separate, recorded check by a person before the change is called live (Codex #5).
    var so = siteOk(o.runner, o.siteUrl);
    out.siteStatus = so.status;
    if (!so.ok) { throw new Error('the site answered ' + so.status + ' after the move'); }
    out.ok = true;
  } catch (e) {
    out.problems.push(e.message);
    if (started) {
      // something was replaced: put everything back from the backup just taken (the lock is still ours)
      out.restored = restoreLive({ runner: o.runner, appRoot: o.appRoot, backupDir: backupDir, undoDir: s.abs(o.backupRoot) + '/' + o.topic + '-failed-' + o.stamp,
        cacheCmds: o.cacheCmds, siteUrl: '', tmpDir: o.tmpDir, reason: 'automatic restore after a failed move: ' + e.message, log: o.log, lockHeld: true });
    }
  }
  if (!s.dropLock()) { out.problems.push('the release lock could not be released; a person must move it aside before the next release'); out.lockStuck = true; }
  return out;
}

// The real runner: ssh / scp with the authorized key. Never a password. Only built when both switches are on.
function sshRunner(cfg) {
  var connection = require('./ssh-session').session(cfg);
  return {
    run: connection.run,
    put: connection.put,
    close: connection.close,
    status: function (url) {
      try { return Number(cp.execFileSync('curl', ['-s', '-o', process.platform === 'win32' ? 'NUL' : '/dev/null', '-w', '%{http_code}', '-m', '25', url], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 40000 }).toString().trim()) || 0; }
      catch (e) { return 0; }
    }
  };
}

// Both switches, the key and the app folder must all be set before any connection is even tried.
function liveSwitch(config) {
  var c = config || {}; var why = [];
  if (c.sshAuthorized !== true) { why.push('sshAuthorized is not true'); }
  if (c.liveExecutionEnabled !== true) { why.push('liveExecutionEnabled is not true'); }
  var key = c.key && c.key.privateKeyPath;
  if (!key || /SET-BY-MAX|CONFIRM-ON-THIS-PC/.test(str(key)) || !fs.existsSync(str(key))) { why.push('the private key path is not set to a file on this PC'); }
  var d = dirProblem(c.live && c.live.appRoot, 'live.appRoot');
  if (d) { why.push(d); }
  if (!/^https:\/\/[A-Za-z0-9.-]+(\/[A-Za-z0-9._\/-]*)?$/.test(str(c.live && c.live.checkUrl))) { why.push('live.checkUrl is not set to an https address'); }
  return { on: why.length === 0, why: why };
}

module.exports = { fileProblem: fileProblem, checkFiles: checkFiles, dirProblem: dirProblem, deployLive: deployLive, restoreLive: restoreLive, sshRunner: sshRunner, liveSwitch: liveSwitch, sha256File: sha256File };
