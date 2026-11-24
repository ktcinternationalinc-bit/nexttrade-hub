// v55.83-YJ — EXECUTED tests for the warehouse move + undo steps (release-management/lib/remote.js) and the
// roll-back gate. The steps run through a local shell against a THROWAWAY folder that stands in for the
// server: backups, uploads, fingerprints and restores really happen. Nothing connects anywhere.
// Needs a POSIX shell (Git bash). Set YJ_BASH to its path if it is not found.
var fs = require('fs'); var path = require('path'); var cp = require('child_process'); var crypto = require('crypto');
var root = path.join(__dirname, '..');
var remote = require(path.join(root, 'release-management/lib/remote.js'));
var gate = require(path.join(root, 'release-management/lib/gate.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ok: ' : '  FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 900))); }

var BASH = [process.env.YJ_BASH, 'D:/Git/usr/bin/bash.exe', 'C:/Program Files/Git/usr/bin/bash.exe', 'C:/Program Files/Git/bin/bash.exe', '/bin/bash', '/usr/bin/bash'].filter(function (p) { return p && fs.existsSync(p); })[0];
if (!BASH) { console.log('SKIPPED — no POSIX shell found (set YJ_BASH). Nothing was checked.'); process.exit(2); }
var isWin = process.platform === 'win32';
var TMP_BASE = process.env.YJ_TMP || (fs.existsSync('D:/GITHUB/_test-tools/tmp') ? 'D:/GITHUB/_test-tools/tmp' : require('os').tmpdir());
function toPosix(p) { p = p.replace(/\\/g, '/'); return isWin ? p.replace(/^([A-Za-z]):\//, function (m, d) { return '/' + d.toLowerCase() + '/'; }) : p; }
function toNative(p) { return isWin ? p.replace(/^\/([a-z])\//, function (m, d) { return d.toUpperCase() + ':/'; }) : p; }
function sha(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function read(p) { return fs.readFileSync(p); }
function write(p, s) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); }

var n = 0;
// A fresh pretend server: home/app (the live app, with artisan), home/bin/php (a stand-in), and a local "new build".
function world() {
  n++;
  var base = TMP_BASE.replace(/\\/g, '/') + '/yj-remote-' + process.pid + '-' + n;
  var home = base + '/home'; var local = base + '/local';
  write(home + '/app/artisan', '#!/usr/bin/env php\n');
  write(home + '/app/app/Http/A.php', '<?php // OLD A\n');
  write(home + '/app/resources/views/b.blade.php', 'OLD B\n');
  write(home + '/app/.env', 'SECRET=keep\n');
  write(home + '/bin/php', '#!/bin/sh\necho "$@" >> "$HOME/php-calls.log"\nif [ -f "$HOME/php-fails" ]; then exit 1; fi\nexit 0\n');
  write(local + '/app/Http/A.php', '<?php // NEW A\n');
  write(local + '/resources/views/b.blade.php', 'NEW B\n');
  write(local + '/resources/views/c.blade.php', 'NEW C (added)\n');
  var w = { base: base, home: home, local: local, cmds: [], status: 200, corruptPut: null, posixHome: toPosix(home) };
  w.runner = {
    run: function (cmd) {
      w.cmds.push('run ' + cmd);
      try {
        var out = cp.execFileSync(BASH, ['-c', 'export PATH="$HOME/bin:/usr/bin:/bin:$PATH"; ' + cmd], { env: Object.assign({}, process.env, { HOME: w.posixHome }), stdio: ['ignore', 'pipe', 'pipe'] });
        return { code: 0, out: out.toString() };
      } catch (e) { return { code: typeof e.status === 'number' ? e.status : 1, out: String(e.stderr || e.message) }; }
    },
    put: function (localFile, remoteFile) {
      w.cmds.push('put ' + remoteFile);
      try {
        var dest = toNative(remoteFile);
        if (w.corruptPut && remoteFile.indexOf(w.corruptPut) >= 0) { fs.writeFileSync(dest, 'CORRUPTED IN TRANSIT'); }
        else { fs.copyFileSync(localFile, dest); }
        return { code: 0, out: '' };
      } catch (e) { return { code: 1, out: e.message }; }
    },
    status: function () { return w.status; }
  };
  w.opts = function (stamp, files) {
    return { runner: w.runner, appRoot: '~/app', backupRoot: '~/code-backups', topic: 'wh-test', stamp: stamp, sha: 'abc1234', files: files || FILES, allow: FILES,
      localRoot: w.local, cacheCmds: ['php artisan view:clear'], siteUrl: 'https://example.invalid/', tmpDir: w.base };
  };
  w.live = function (f) { return fs.existsSync(w.home + '/app/' + f) ? read(w.home + '/app/' + f).toString() : null; };
  return w;
}
var FILES = ['app/Http/A.php', 'resources/views/b.blade.php', 'resources/views/c.blade.php'];
console.log('YJ — warehouse move + undo, executed against a throwaway folder (' + BASH + ')');

// ---------------- A. which files may be moved
var cf = remote.checkFiles;
check('a listed file passes', cf(['app/Http/A.php'], FILES).length === 0);
check('a file not on the change\'s list is refused', cf(['app/Http/Other.php'], FILES).length === 1);
check('.. is refused', cf(['app/../.env'], ['app/../.env']).length >= 1);
check('an absolute path is refused', cf(['/etc/passwd'], ['/etc/passwd']).length >= 1);
check('.env is refused even when listed', cf(['.env'], ['.env']).length >= 1 && cf(['config/.env.production'], ['config/.env.production']).length >= 1);
check('storage/ and vendor/ are refused even when listed', cf(['storage/app/x.php'], ['storage/app/x.php']).length >= 1 && cf(['vendor/a.php'], ['vendor/a.php']).length >= 1);
check('a path with a space, quote, ; or $ is refused', ['a b.php', "a'.php", 'a;rm.php', 'a$(x).php', 'a`x`.php', 'a\\b.php'].every(function (p) { return cf([p], [p]).length >= 1; }));
check('a wildcard is refused', cf(['app/*.php'], ['app/*.php']).length >= 1);
check('the same file twice is refused', cf(['app/Http/A.php', 'app/Http/A.php'], FILES).length >= 1);
check('no files / no recorded list = refused', cf([], FILES).length === 1 && cf(['app/Http/A.php'], undefined).length === 1 && cf(['app/Http/A.php'], []).length === 1);

// ---------------- B. a move that works
var w = world();
var oldA = read(w.home + '/app/app/Http/A.php'); var oldB = read(w.home + '/app/resources/views/b.blade.php');
var r = remote.deployLive(w.opts('20261124101010'));
check('the move reports ok', r.ok === true && r.problems.length === 0, r);
check('all three files are replaced / added on the live app', w.live(FILES[0]) === '<?php // NEW A\n' && w.live(FILES[1]) === 'NEW B\n' && w.live(FILES[2]) === 'NEW C (added)\n');
var bdir = toNative(r.backupDir);
check('the backup folder is ~/code-backups/<topic>-<stamp>', /\/code-backups\/wh-test-20261124101010$/.test(r.backupDir));
check('the backup holds the OLD bytes of both existing files', read(bdir + '/files/' + FILES[0]).equals(oldA) && read(bdir + '/files/' + FILES[1]).equals(oldB));
var man = JSON.parse(read(bdir + '/MANIFEST.json'));
check('the backup list records existed + fingerprint before, and "did not exist" for the added file',
  man.files.length === 3 && man.files[0].existed === true && man.files[0].before === sha(oldA) && man.files[1].before === sha(oldB) && man.files[2].existed === false && man.files[2].before === '', man);
var firstPutApp = w.cmds.findIndex(function (c) { return /^put .*\/app\/.*\.yj-new$/.test(c); });
var lastBackup = w.cmds.map(function (c, i) { return /^run cp -p .*code-backups/.test(c) ? i : -1; }).filter(function (i) { return i >= 0; }).pop();
var manifestPut = w.cmds.findIndex(function (c) { return /^put .*MANIFEST\.json$/.test(c); });
check('every backup copy and the backup list are made BEFORE the first new file is uploaded', lastBackup >= 0 && manifestPut > lastBackup && firstPutApp > manifestPut, { lastBackup: lastBackup, manifestPut: manifestPut, firstPutApp: firstPutApp });
check('the cache command ran once, in the app folder', read(w.home + '/php-calls.log').toString().trim() === 'artisan view:clear');
check('.env on the server was not touched', w.live('.env') === 'SECRET=keep\n');
check('no upload leftovers (.yj-new) stay on the live app', !fs.existsSync(w.home + '/app/app/Http/A.php.yj-new'));
check('no command sent is a delete, a DROP or a database statement', w.cmds.every(function (c) { return !/\brm\b|\bDROP\b|\bmysql\b|\bmigrate\b|\bDELETE\b|\bUPDATE\b/i.test(c); }), w.cmds.filter(function (c) { return /\brm\b|DROP|mysql|migrate/i.test(c); }));

// ---------------- C. undo: exactly as it was before
w.cmds = [];
var u = remote.restoreLive({ runner: w.runner, appRoot: '~/app', backupDir: r.backupDir, undoDir: '~/code-backups/wh-test-undo-20261124111111', cacheCmds: ['php artisan view:clear'], siteUrl: 'https://example.invalid/', tmpDir: w.base, reason: 'test' });
check('the undo reports ok', u.ok === true, u);
check('both replaced files are byte-identical to before the move', read(w.home + '/app/' + FILES[0]).equals(oldA) && read(w.home + '/app/' + FILES[1]).equals(oldB));
check('the file the move ADDED is gone from the live app…', w.live(FILES[2]) === null);
var udir = toNative(u.undoDir);
check('…but was MOVED to the undo folder, not deleted', fs.existsSync(udir + '/added/' + FILES[2]) && read(udir + '/added/' + FILES[2]).toString() === 'NEW C (added)\n' && u.movedAside.length === 1);
check('the undo folder keeps the NEW versions, so the undo can itself be undone', read(udir + '/files/' + FILES[0]).toString() === '<?php // NEW A\n' && read(udir + '/files/' + FILES[1]).toString() === 'NEW B\n' && fs.existsSync(udir + '/MANIFEST.json'));
check('the original backup is still complete after the undo', read(bdir + '/files/' + FILES[0]).equals(oldA) && fs.existsSync(bdir + '/MANIFEST.json'));
check('the undo sent no delete / DROP / database statement', w.cmds.every(function (c) { return !/\brm\b|\bDROP\b|\bmysql\b|\bmigrate\b/i.test(c); }));
var u2 = remote.restoreLive({ runner: w.runner, appRoot: '~/app', backupDir: r.backupDir, undoDir: '~/code-backups/wh-test-undo-20261124111111', cacheCmds: [], siteUrl: '', tmpDir: w.base });
check('an undo folder is never reused (second run with the same name is refused)', u2.ok === false && /already exists/.test(u2.problems.join(' ')));

// ---------------- D. the site does not answer after the move -> everything is put back by itself
w = world(); oldA = read(w.home + '/app/app/Http/A.php'); oldB = read(w.home + '/app/resources/views/b.blade.php');
w.status = 500;
r = remote.deployLive(w.opts('20261124121212'));
check('a 500 after the move = the move FAILS', r.ok === false && /answered 500/.test(r.problems.join(' ')), r);
check('…and the automatic restore ran and succeeded', !!r.restored && r.restored.ok === true, r.restored);
check('…the live app is byte-identical to before, and the added file is not there', read(w.home + '/app/' + FILES[0]).equals(oldA) && read(w.home + '/app/' + FILES[1]).equals(oldB) && w.live(FILES[2]) === null);
check('…the failed new files are kept in a "-failed-" folder', /wh-test-failed-20261124121212$/.test(r.restored.undoDir) && fs.existsSync(toNative(r.restored.undoDir) + '/added/' + FILES[2]));
w = world(); w.status = 0; r = remote.deployLive(w.opts('20261124121213'));
check('no answer at all from the site (0) is also a failure with a restore', r.ok === false && r.restored && r.restored.ok === true);

// ---------------- E. a file damaged in transit
w = world(); oldA = read(w.home + '/app/app/Http/A.php'); oldB = read(w.home + '/app/resources/views/b.blade.php');
w.corruptPut = 'b.blade.php.yj-new';
r = remote.deployLive(w.opts('20261124131313'));
check('an upload that is not identical to the local file stops the move', r.ok === false && /not identical/.test(r.problems.join(' ')), r);
check('…the damaged file never replaced the live one, and the first file was put back', read(w.home + '/app/' + FILES[1]).equals(oldB) && read(w.home + '/app/' + FILES[0]).equals(oldA) && r.restored && r.restored.ok === true, r.restored);

// ---------------- F. the cache command fails
w = world(); oldA = read(w.home + '/app/app/Http/A.php');
write(w.home + '/php-fails', '1');
r = remote.deployLive(w.opts('20261124141414'));
check('a failing cache command = failed move', r.ok === false && /view:clear failed/.test(r.problems.join(' ')), r);
check('…the files are back, and the automatic restore says honestly that ITS cache step failed too', read(w.home + '/app/' + FILES[0]).equals(oldA) && r.restored && r.restored.ok === false && r.restored.restored.length === 2, r.restored);

// ---------------- G. refusals before anything is touched
w = world();
r = remote.deployLive(w.opts('20261124151515'));
var again = remote.deployLive(w.opts('20261124151515'));
check('the same backup folder is never written twice', r.ok === true && again.ok === false && /never overwritten/.test(again.problems.join(' ')) && again.restored === null);
w = world(); fs.renameSync(w.home + '/app/artisan', w.home + '/app/artisan.moved');
r = remote.deployLive(w.opts('20261124161616'));
check('a folder that is not the warehouse app (no artisan) is refused, nothing made', r.ok === false && /no artisan/.test(r.problems.join(' ')) && !fs.existsSync(w.home + '/code-backups'));
w = world(); fs.unlinkSync(w.local + '/resources/views/c.blade.php');
r = remote.deployLive(w.opts('20261124171717'));
check('a new file missing from the local copy stops before any connection', r.ok === false && w.cmds.length === 0 && /not in the local warehouse copy/.test(r.problems.join(' ')));
w = world();
r = remote.deployLive(w.opts('20261124181818', ['app/Http/A.php', '.env']));
check('one bad file refuses the whole move before any connection', r.ok === false && w.cmds.length === 0 && w.live('.env') === 'SECRET=keep\n');
var bad = w.opts('20261124181819'); bad.appRoot = '~/app/../../etc';
check('an app folder with .. is refused', remote.deployLive(bad).ok === false);
bad = w.opts('2026'); check('a malformed time stamp is refused', remote.deployLive(bad).ok === false);
bad = w.opts('20261124181820'); bad.cacheCmds = ['php artisan migrate --force'];
r = remote.deployLive(bad);
check('any command other than view/config/route clear is refused (and the move is put back)', r.ok === false && /unexpected command/.test(r.problems.join(' ')) && w.live(FILES[0]) === '<?php // OLD A\n' && !fs.existsSync(w.home + '/php-calls.log'), r);

// ---------------- H. the undo refuses a backup that was changed
w = world(); oldA = read(w.home + '/app/app/Http/A.php');
r = remote.deployLive(w.opts('20261124191919'));
fs.writeFileSync(toNative(r.backupDir) + '/files/' + FILES[0], 'TAMPERED');
u = remote.restoreLive({ runner: w.runner, appRoot: '~/app', backupDir: r.backupDir, undoDir: '~/code-backups/wh-test-undo-20261124202020', cacheCmds: [], siteUrl: '', tmpDir: w.base });
check('a backup copy that no longer matches its list is refused BEFORE anything is touched', u.ok === false && /does not match the backup list/.test(u.problems.join(' ')) && w.live(FILES[0]) === '<?php // NEW A\n' && w.live(FILES[2]) !== null && !fs.existsSync(toNative(u.undoDir)), u);
u = remote.restoreLive({ runner: w.runner, appRoot: '~/app', backupDir: '~/code-backups/nope', undoDir: '~/code-backups/x-undo', cacheCmds: [], siteUrl: '', tmpDir: w.base });
check('an undo with no backup list is refused', u.ok === false);

// ---------------- I. the two switches
var keyFile = w.base + '/fake-key'; fs.writeFileSync(keyFile, 'not a real key');
var onCfg = { sshAuthorized: true, liveExecutionEnabled: true, key: { privateKeyPath: keyFile }, live: { appRoot: '~/nextrade-app', checkUrl: 'https://nextradeindustries.com/login' } };
check('all set = on', remote.liveSwitch(onCfg).on === true);
[['sshAuthorized', false], ['liveExecutionEnabled', false], ['liveExecutionEnabled', 'true'], ['liveExecutionEnabled', undefined]].forEach(function (c) {
  var cfg = JSON.parse(JSON.stringify(onCfg)); cfg[c[0]] = c[1];
  check(c[0] + ' = ' + JSON.stringify(c[1]) + ' -> off', remote.liveSwitch(cfg).on === false);
});
var cfg2 = JSON.parse(JSON.stringify(onCfg)); cfg2.key.privateKeyPath = 'CONFIRM-ON-THIS-PC — text'; check('a placeholder key path -> off', remote.liveSwitch(cfg2).on === false);
cfg2 = JSON.parse(JSON.stringify(onCfg)); cfg2.live.appRoot = ''; check('no app folder -> off', remote.liveSwitch(cfg2).on === false);
cfg2 = JSON.parse(JSON.stringify(onCfg)); cfg2.live.checkUrl = 'http://x'; check('a check address that is not https -> off', remote.liveSwitch(cfg2).on === false);
var shipped = JSON.parse(fs.readFileSync(path.join(root, 'release-management/deploy/config.json'), 'utf8'));
check('the SHIPPED config has BOTH switches off, so nothing can run even though the folder and key path are filled in', shipped.sshAuthorized === false && shipped.liveExecutionEnabled === false && remote.liveSwitch(shipped).on === false && remote.liveSwitch(shipped).why.length >= 2);
check('the shipped app folder is the live app, never the staging copy inside it', shipped.live.appRoot === '~/public_html' && !/staging/.test(shipped.live.appRoot) && /^https:\/\/nextradeindustries\.com\//.test(shipped.live.checkUrl));
check('a file path under staging/ is refused even when listed (public_html/staging is a separate copy of the app)', remote.checkFiles(['staging/app/Http/A.php'], ['staging/app/Http/A.php']).length >= 1);

// ---------------- J. the roll-back gate (pure)
var liveItem = { id: 'x', status: 'live', build: 'abc1234def', backupDir: '/home/u/code-backups/x-20261124101010', rollbackApproval: { text: 'Max: roll x back', sha: 'abc1234def', backup: '/home/u/code-backups/x-20261124101010' } };
check('a live change with a recorded backup folder and a matching go is clear', gate.rollbackProblems(liveItem, { confirm: 'Max: roll x back' }).length === 0);
check('no recorded roll-back go -> blocked', gate.rollbackProblems(Object.assign({}, liveItem, { rollbackApproval: undefined }), { confirm: 'Max: roll x back' }).length === 1);
check('confirm not equal to the recorded go -> blocked', gate.rollbackProblems(liveItem, { confirm: 'roll it back' }).length === 1 && gate.rollbackProblems(liveItem, {}).length === 1);
check('a change that is not live -> blocked', gate.rollbackProblems(Object.assign({}, liveItem, { status: 'queued' }), { confirm: 'Max: roll x back' }).length === 1);
check('no recorded backup folder (moved by hand) -> blocked', gate.rollbackProblems(Object.assign({}, liveItem, { backupDir: '' }), { confirm: 'Max: roll x back' }).length >= 1);
check('a --backup that is not the recorded folder -> blocked', gate.rollbackProblems(liveItem, { confirm: 'Max: roll x back', backup: '/home/u/code-backups/other' }).length === 1);
// Codex 24 Nov: the go must be FOR the build and backup this PC moved — the same sentence is not enough
check('a roll-back go for a DIFFERENT build than the one moved -> blocked', gate.rollbackProblems(Object.assign({}, liveItem, { rollbackApproval: { text: 'Max: roll x back', sha: 'ffff9999cccc', backup: '/home/u/code-backups/x-20261124101010' } }), { confirm: 'Max: roll x back' }).length === 1);
check('a roll-back go naming a DIFFERENT backup folder -> blocked', gate.rollbackProblems(Object.assign({}, liveItem, { rollbackApproval: { text: 'Max: roll x back', sha: 'abc1234def', backup: '/home/u/code-backups/x-other' } }), { confirm: 'Max: roll x back' }).length === 1);
check('a roll-back go that names no build / backup at all -> blocked', gate.rollbackProblems(Object.assign({}, liveItem, { rollbackApproval: { text: 'Max: roll x back' } }), { confirm: 'Max: roll x back' }).length === 1);
check('the build moved last (deployedSha) is what counts, ahead of an older build field', gate.rollbackProblems(Object.assign({}, liveItem, { build: 'old0000aaaa', deployedSha: 'abc1234def' }), { confirm: 'Max: roll x back' }).length === 0);

// ---------------- K. the register: roll-back go recorded, and both go's used up by a roll back
var regFile = w.base + '/register.json';
process.env.RELEASE_REGISTER_FILE = regFile;
delete require.cache[require.resolve(path.join(root, 'release-management/lib/register.js'))];
var reg = require(path.join(root, 'release-management/lib/register.js'));
function writeReg(items) { fs.writeFileSync(regFile, JSON.stringify({ items: items, protocol: [], legend: [] }, null, 2)); }
function item0() { return JSON.parse(fs.readFileSync(regFile, 'utf8')).items[0]; }
writeReg([{ id: 'q', title: 'Q', status: 'queued' }]);
var threw = false; try { reg.recordRollbackApproval('q', 'Max: roll q back @ abc1234', { sha: 'abc1234', backup: '/bk1' }); } catch (e) { threw = true; }
check('a roll-back go cannot be recorded for a change that is not live', threw && !item0().rollbackApproval);
writeReg([{ id: 'q', title: 'Q', status: 'live', where: 'production', build: 'abc1234', backupDir: '/bk1', maxApproval: { text: 'Max: yes, put q on production @ abc1234' } }]);
var threwT = false; try { reg.recordRollbackApproval('q', 'Max: roll q back @ abc1234'); } catch (e) { threwT = true; }
check('a roll-back go cannot be recorded without the build and backup it is for', threwT && !item0().rollbackApproval);
reg.recordRollbackApproval('q', 'Max: roll q back', { sha: 'abc1234', backup: '/bk1' });
check('a roll-back go is recorded on a live change, with the build and backup it is for', item0().rollbackApproval.text === 'Max: roll q back' && item0().rollbackApproval.sha === 'abc1234' && item0().rollbackApproval.backup === '/bk1' && gate.rollbackProblems(item0(), { confirm: 'Max: roll q back' }).length === 0);
reg.markRolledBack('q', 'test');
var it = item0();
check('after a roll back the change is back on staging and BOTH go\'s are used up (kept as history)', it.status === 'queued' && !it.maxApproval && !it.rollbackApproval && it.usedApprovals.length === 1 && it.usedApprovals[0].go.text.indexOf('abc1234') > 0 && it.usedApprovals[0].rollback.text === 'Max: roll q back');
check('…so the old go no longer opens the deploy gate', gate.evaluateGate(it, { sha: 'abc1234', target: 'production', confirm: 'Max: yes, put q on production @ abc1234' }).ok === false);

// ---------------- L. the real scripts stay in safe mode and change nothing
var whRoot = path.resolve(root, shipped.repo.warehousePath);
var whHead = ''; try { whHead = cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: whRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) { whHead = ''; }
function runScript(name, args) {
  var res = cp.spawnSync(process.execPath, [path.join(root, 'release-management/deploy/' + name)].concat(args), { env: Object.assign({}, process.env, { RELEASE_REGISTER_FILE: regFile }), encoding: 'utf8' });
  return { code: res.status, out: String(res.stdout) + String(res.stderr) };
}
writeReg([{ id: 'wh-x', title: 'X', repo: 'nextrade_WAREHOUSE', status: 'queued', deployFiles: ['app/Http/A.php'] }]);
var before = fs.readFileSync(regFile, 'utf8');
var d = runScript('deploy.js', ['--item', 'wh-x', '--sha', whHead || 'abc1234', '--confirm', 'go', '--live']);
check('deploy.js with no recorded evidence stops at the gate (exit 2), register untouched', d.code === 2 && /GATE: not clear/.test(d.out) && fs.readFileSync(regFile, 'utf8') === before, d);
if (whHead) {
  var go = 'Max: yes, put wh-x on production @ ' + whHead;
  writeReg([{ id: 'wh-x', title: 'X', repo: 'nextrade_WAREHOUSE', status: 'queued', deployFiles: ['app/Http/A.php'],
    codexRef: { sha: whHead, target: 'production', feedbackRef: 'test' }, behavioralQa: { sha: whHead, target: 'production', kind: 'behavioral', result: 'PASS' }, maxApproval: { text: go } }]);
  before = fs.readFileSync(regFile, 'utf8');
  d = runScript('deploy.js', ['--item', 'wh-x', '--sha', whHead, '--confirm', go, '--live', '--files', 'app/Http/A.php']);
  check('a WAREHOUSE change binds to the WAREHOUSE repo commit: gate met, then SAFE MODE (exit 3), no connection, register untouched',
    d.code === 3 && /GATE met/.test(d.out) && /SAFE MODE/.test(d.out) && /no connection was made/.test(d.out) && fs.readFileSync(regFile, 'utf8') === before, d);
  var hubHead = cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  if (hubHead !== whHead) {
    d = runScript('deploy.js', ['--item', 'wh-x', '--sha', hubHead, '--confirm', go, '--live']);
    check('the Hub repo commit is NOT accepted for a warehouse change (exit 2)', d.code === 2 && /Working tree is at/.test(d.out), d);
  }
} else { console.log('  (warehouse repo not on this machine: the two warehouse-commit checks were not run)'); }
writeReg([{ id: 'wh-y', title: 'Y', repo: 'nextrade_WAREHOUSE', status: 'live', backupDir: '~/code-backups/wh-y-20261124101010' }]);
before = fs.readFileSync(regFile, 'utf8');
d = runScript('rollback.js', ['--item', 'wh-y', '--confirm', 'roll it back', '--live']);
check('rollback.js with no recorded roll-back go stops at the gate (exit 2), register untouched', d.code === 2 && /GATE: not clear to roll back/.test(d.out) && fs.readFileSync(regFile, 'utf8') === before, d);
writeReg([{ id: 'wh-y', title: 'Y', repo: 'nextrade_WAREHOUSE', status: 'live', build: 'abc1234def', backupDir: '~/code-backups/wh-y-20261124101010', rollbackApproval: { text: 'Max: roll wh-y back', sha: 'abc1234def', backup: '~/code-backups/wh-y-20261124101010' } }]);
before = fs.readFileSync(regFile, 'utf8');
d = runScript('rollback.js', ['--item', 'wh-y', '--confirm', 'Max: roll wh-y back', '--live']);
check('rollback.js with the go recorded: SAFE MODE (exit 3), no connection, register untouched', d.code === 3 && /SAFE MODE/.test(d.out) && /no connection was made/.test(d.out) && fs.readFileSync(regFile, 'utf8') === before, d);


// ---------------- N. Codex 24 Nov #3: one release at a time, and never restore over someone else's change
w = world();
write(w.home + '/code-backups/.release-lock/OWNER', 'other-release-20261124000000');
r = remote.deployLive(w.opts('20261124210001'));
check('a move while another release holds the lock is refused; nothing replaced, no backup folder made', r.ok === false && /another release holds the lock on this server \(other-release-20261124000000/.test(r.problems.join(' ')) && r.restored === null && w.live(FILES[0]) === '<?php // OLD A\n' && !fs.existsSync(w.home + '/code-backups/wh-test-20261124210001') && fs.existsSync(w.home + '/code-backups/.release-lock/OWNER'), r);
w = world(); r = remote.deployLive(w.opts('20261124210002'));
check('a finished move releases the lock by MOVING it into the history folder (not deleting it)', r.ok === true && !fs.existsSync(w.home + '/code-backups/.release-lock') && fs.readdirSync(w.home + '/code-backups/.release-locks-done').length === 1 && /^wh-test-20261124210002-/.test(fs.readdirSync(w.home + '/code-backups/.release-locks-done')[0]));
write(w.home + '/code-backups/.release-lock/OWNER', 'other-release');
u = remote.restoreLive({ runner: w.runner, appRoot: '~/app', backupDir: r.backupDir, undoDir: '~/code-backups/wh-test-undo-20261124210003', cacheCmds: [], siteUrl: '', tmpDir: w.base });
check('an undo while another release holds the lock is refused; nothing touched', u.ok === false && /holds the lock/.test(u.problems.join(' ')) && w.live(FILES[0]) === '<?php // NEW A\n' && !fs.existsSync(toNative(u.undoDir)), u);
fs.renameSync(w.home + '/code-backups/.release-lock', w.home + '/code-backups/.release-lock-moved-by-a-person');
write(w.home + '/app/' + FILES[1], 'CHANGED BY A LATER RELEASE\n');
u = remote.restoreLive({ runner: w.runner, appRoot: '~/app', backupDir: r.backupDir, undoDir: '~/code-backups/wh-test-undo-20261124210004', cacheCmds: [], siteUrl: '', tmpDir: w.base });
check('a live file that a DIFFERENT release changed since is never restored over: the whole undo is refused, nothing touched', u.ok === false && /something else changed it/.test(u.problems.join(' ')) && w.live(FILES[1]) === 'CHANGED BY A LATER RELEASE\n' && w.live(FILES[0]) === '<?php // NEW A\n' && w.live(FILES[2]) !== null && !fs.existsSync(toNative(u.undoDir)), u);
check('…and the lock is released again after that refusal', !fs.existsSync(w.home + '/code-backups/.release-lock'));
var man2 = JSON.parse(read(toNative(r.backupDir) + '/MANIFEST.json'));
check('the backup list records the fingerprint of every NEW file as well (what this release put there)', man2.files.every(function (x) { return /^[0-9a-f]{64}$/.test(x.after); }) && man2.files[0].after === sha(read(w.local + '/' + FILES[0])));
w = world(); w.corruptPut = 'b.blade.php.yj-new'; r = remote.deployLive(w.opts('20261124210005'));
check('a damaged upload left next to the live file is moved into the failed folder, not left on the app and not deleted', r.ok === false && !fs.existsSync(w.home + '/app/' + FILES[1] + '.yj-new') && fs.existsSync(toNative(r.restored.undoDir) + '/leftover/' + FILES[1] + '.yj-new'), r.restored);
check('after a failed move the lock is released too', !fs.existsSync(w.home + '/code-backups/.release-lock'));
w = world(); write(w.home + '/php-fails', '1'); r = remote.deployLive(w.opts('20261124210006'));
check('when only the cache step of the automatic restore fails, it still says the FILES are back', r.restored.ok === false && r.restored.filesBack === true);

// ---------------- O. Codex 24 Nov #5: a page that answers is not a checked change
check('a finished move reports only the site status; it does not call the change live', (function () { var w2 = world(); var r2 = remote.deployLive(w2.opts('20261124210007')); return r2.ok === true && r2.siteStatus === 200 && !('live' in r2) && !('verified' in r2); })());
var depSrc2 = fs.readFileSync(path.join(root, 'release-management/deploy/deploy.js'), 'utf8');
var liveBlock = depSrc2.substring(depSrc2.indexOf('remote.deployLive('));
check('deploy.js sets the state "deployed" after a move and does NOT mark the change live in that run', /setState\(item\.id, 'deployed'/.test(liveBlock) && !/markVerifiedLive/.test(liveBlock));
check('marking it live is a separate step that needs --checked-by with real words and the exact moved build', /has\('--mark-live'\)/.test(depSrc2) && /--checked-by/.test(depSrc2) && /item\.lifecycle !== 'deployed' \|\| String\(item\.deployedSha \|\| ''\) !== sha/.test(depSrc2));
if (whHead) {
  var go2 = 'Max: yes, put wh-z on production @ ' + whHead;
  var base2 = { id: 'wh-z', title: 'Z', repo: 'nextrade_WAREHOUSE', status: 'queued', deployFiles: ['app/Http/A.php'], codexRef: { sha: whHead, target: 'production', feedbackRef: 'test' }, behavioralQa: { sha: whHead, target: 'production', kind: 'behavioral', result: 'PASS' }, maxApproval: { text: go2 } };
  writeReg([base2]); before = fs.readFileSync(regFile, 'utf8');
  d = runScript('deploy.js', ['--item', 'wh-z', '--sha', whHead, '--confirm', go2, '--mark-live', '--checked-by', 'Max opened the order queue and released one test order']);
  check('--mark-live on a change this script never moved is refused, register untouched', d.code === 2 && fs.readFileSync(regFile, 'utf8') === before, d);
  writeReg([Object.assign({}, base2, { lifecycle: 'deployed', deployedSha: whHead, backupDir: '/home/u/code-backups/wh-z-20261124101010' })]); before = fs.readFileSync(regFile, 'utf8');
  d = runScript('deploy.js', ['--item', 'wh-z', '--sha', whHead, '--confirm', go2, '--mark-live', '--checked-by', 'ok']);
  check('--mark-live without a real description of the check is refused', d.code === 2 && fs.readFileSync(regFile, 'utf8') === before, d);
  d = runScript('deploy.js', ['--item', 'wh-z', '--sha', whHead, '--confirm', go2, '--live', '--files', 'app/Http/A.php']);
  check('a change already moved and waiting for its check cannot be moved a second time', d.code === 2 && /waiting for its check/.test(d.out) && fs.readFileSync(regFile, 'utf8') === before, d);
  d = runScript('deploy.js', ['--item', 'wh-z', '--sha', whHead, '--confirm', go2, '--mark-live', '--checked-by', 'Max opened the order queue and released one test order']);
  var z = item0();
  check('with the person\'s check recorded, the change becomes live and keeps who checked what', d.code === 0 && z.status === 'live' && z.verifiedBy === 'Max opened the order queue and released one test order' && z.backup === '/home/u/code-backups/wh-z-20261124101010', [d, z]);
  writeReg([Object.assign({}, base2, { lifecycle: 'deployed', deployedSha: whHead, backupDir: '/home/u/code-backups/wh-z-20261124101010' })]);
  reg.recordRollbackApproval('wh-z', 'Max: roll wh-z back', { sha: whHead, backup: '/home/u/code-backups/wh-z-20261124101010' });
  check('a moved-but-unchecked change can still be rolled back (the go can be recorded and the gate is clear)', gate.rollbackProblems(item0(), { confirm: 'Max: roll wh-z back' }).length === 0);
}

// ---------------- P. Codex 24 Nov: how a failed move ended is recorded honestly (three endings)
w = world(); write(w.home + '/php-fails', '1'); r = remote.deployLive(w.opts('20261124220001'));
var rec = gate.attemptRecord(r, 'abc1234def');
check('REAL failed run (cache step fails, so the automatic restore cannot be confirmed): recorded as recovery_incomplete even though the files are back', r.ok === false && r.restored.ok === false && r.restored.filesBack === true && rec.outcome === 'recovery_incomplete' && rec.filesBack === true && gate.attemptState(rec) === 'needs-attention' && rec.backupDir === r.backupDir && rec.replaced.length === 3 && rec.undoDir === r.restored.undoDir && /view:clear failed/.test(rec.problems.join(' ')), rec);
w = world(); w.status = 500; r = remote.deployLive(w.opts('20261124220002')); rec = gate.attemptRecord(r, 'abc1234def');
check('REAL failed run with a confirmed automatic restore: recorded as restored / failed, with the backup and the kept files', r.restored.ok === true && rec.outcome === 'restored' && gate.attemptState(rec) === 'failed' && rec.backupDir === r.backupDir && rec.restoredFiles.length === 2, rec);
w = world(); r = remote.deployLive(w.opts('20261124220003')); var again2 = remote.deployLive(w.opts('20261124220003')); rec = gate.attemptRecord(again2, 'abc1234def');
check('REAL run refused before anything was replaced: recorded as not_replaced / failed', again2.ok === false && again2.restored === null && rec.outcome === 'not_replaced' && gate.attemptState(rec) === 'failed' && rec.replaced.length === 0, rec);
check('files replaced but no restore result at all is never called "not replaced"', gate.attemptRecord({ ok: false, replaced: ['a.php'], restored: null, problems: ['x'] }, 'abc1234def').outcome === 'recovery_incomplete');
// caller -> register -> history row: the unconfirmed ending cannot become a "failed / put back" row
var hrow = require(path.join(root, 'release-management/deploy/history-row.js'));
w = world(); write(w.home + '/php-fails', '1'); r = remote.deployLive(w.opts('20261124220004')); rec = gate.attemptRecord(r, 'abc1234def');
writeReg([{ id: 'wh-p', title: 'P', status: 'queued' }]); reg.upsertItem({ id: 'wh-p', lastAttempt: rec }); reg.setState('wh-p', gate.attemptState(rec), 'test');
var itP = item0(); var refused = false; try { hrow.historyRow(itP, { action: 'failed', ref: '7' }); } catch (e) { refused = true; }
var stmtP = hrow.historyRow(itP, { action: 'recovery_incomplete', ref: '7' });
check('after that real run the register says needs-attention, a "failed" history row is REFUSED, and the recovery_incomplete row carries the backup, the files and the reason', itP.lifecycle === 'needs-attention' && itP.lastAttempt.backupDir === r.backupDir && refused && stmtP.indexOf(r.backupDir) > 0 && stmtP.indexOf('"files_back":true') > 0 && stmtP.indexOf('view:clear failed') > 0, stmtP);
var threwR = false; try { reg.recordRecovery('wh-p', 'staging', 'ok'); } catch (e) { threwR = true; }
reg.recordRecovery('wh-p', 'staging', 'Max compared the three files with the backup');
check('only a person\'s recorded check clears it (a few real words are required), and then the recovery row can be written', threwR && item0().lifecycle === 'recovered' && item0().recovery.where === 'staging' && hrow.historyRow(item0(), { action: 'recovery_confirmed', ref: '7' }).indexOf('"where":"staging"') > 0);
var depSrc3 = fs.readFileSync(path.join(root, 'release-management/deploy/deploy.js'), 'utf8');
check('deploy.js records the attempt with that function before it exits, and refuses to act on a change that needs attention', /reg\.upsertItem\(\{ id: item\.id, lastAttempt: rec \}\);\s*reg\.setState\(item\.id, gate\.attemptState\(rec\)/.test(depSrc3) && depSrc3.indexOf('reg.upsertItem({ id: item.id, lastAttempt: rec })') < depSrc3.indexOf("die('MOVE FAILED: '") && /item\.lifecycle === 'needs-attention'\) \{ die\(/.test(depSrc3) && /item\.lifecycle === 'needs-attention'\) \{ die\(/.test(fs.readFileSync(path.join(root, 'release-management/deploy/rollback.js'), 'utf8')));
// ---------------- M. source pins
var remoteSrc = fs.readFileSync(path.join(root, 'release-management/lib/remote.js'), 'utf8');
var depSrc = fs.readFileSync(path.join(root, 'release-management/deploy/deploy.js'), 'utf8');
var rbSrc = fs.readFileSync(path.join(root, 'release-management/deploy/rollback.js'), 'utf8');
var sent = remoteSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
check('remote.js builds no rm / rmdir / DROP / mysql / migrate / chmod command', !/'\s*rm\s|"rm\s|rmdir|\bDROP\b|mysql|artisan migrate|chmod|chown/.test(sent));
check('deploy.js and rollback.js make no connection before liveSwitch is on', depSrc.indexOf('remote.liveSwitch(CONFIG)') < depSrc.indexOf('remote.sshRunner(') && rbSrc.indexOf('remote.liveSwitch(CONFIG)') < rbSrc.indexOf('remote.sshRunner(') && !/execFileSync\('ssh'/.test(depSrc + rbSrc));
check('rollback.js checks the roll-back gate before the switches', rbSrc.indexOf('rollbackProblems(item') < rbSrc.indexOf('remote.liveSwitch(CONFIG)') && rbSrc.indexOf('rollbackProblems(item') > 0);

// the scratch folders (yj-remote-<pid>-<n>) are left in place; this test removes nothing
console.log('\nYJ remote: ' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
