// Explicit opt-in: temporary files under the SSH account's private home, outside every website.
const fs = require('fs'); const path = require('path'); const os = require('os'); const assert = require('node:assert/strict');
const remote = require('../release-management/lib/remote');
const config = require('../release-management/deploy/config.json');
if (process.env.NT_RELEASE_REMOTE_QA !== '1') throw new Error('Set NT_RELEASE_REMOTE_QA=1 explicitly.');
const runner = remote.sshRunner({ ...config.live, port: config.live.sshPort, keyPath: config.key.privateKeyPath });
const id = new Date().toISOString().replace(/\D/g, '').slice(0,14);
const base = '/home/nextueoa/release-qa-' + id;
const local = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-host-qa-'));
const file = 'resources/views/release-fixture.blade.php';
function run(cmd) { const r = runner.run(cmd); assert.equal(r.code, 0, r.out); return r.out.trim(); }
function put(content, target) { const f = path.join(local, 'generated-' + Date.now()); fs.writeFileSync(f, content); assert.equal(runner.put(f, target).code, 0); return remote.sha256File(f); }
run("mkdir -p '" + base + "/app/resources/views' '" + base + "/app/storage' '" + base + "/code-backups'");
put('QA fixture only\n', base + '/app/artisan');
const before = put('ORIGINAL\n', base + '/app/' + file);
const sentinel = put('PRESERVE BUSINESS DATA SENTINEL\n', base + '/app/storage/sentinel.txt');
fs.mkdirSync(path.join(local, 'resources/views'), { recursive: true });
fs.writeFileSync(path.join(local, file), 'CANDIDATE\n');
const sha = 'a'.repeat(40);
const manifest = { sha, files: [{ path: file, before, after: remote.sha256File(path.join(local, file)) }] };
const opts = { runner, appRoot: base + '/app', backupRoot: base + '/code-backups', topic: 'qa-fixture', stamp: id, sha, files: [file], allow: [file], manifest, localRoot: local, cacheCmds: [], siteUrl: config.live.checkUrl, tmpDir: local };
const moved = remote.deployLive(opts); assert.ok(moved.ok && !moved.lockStuck, JSON.stringify(moved));
assert.ok(run("sha256sum '" + base + '/app/' + file + "'").startsWith(manifest.files[0].after));
const restored = remote.restoreLive({ runner, appRoot: opts.appRoot, backupDir: moved.backupDir, undoDir: base + '/code-backups/qa-undo', sha, cacheCmds: [], siteUrl: config.live.checkUrl, tmpDir: local });
assert.ok(restored.ok, JSON.stringify(restored));
assert.ok(run("sha256sum '" + base + '/app/' + file + "'").startsWith(before));
put('NEWER DEVELOPER CHANGE\n', base + '/app/' + file);
const refused = remote.deployLive({ ...opts, topic: 'stale-fixture' });
assert.ok(!refused.ok && refused.replaced.length === 0 && /Production changed/.test(refused.problems.join(' ')));
assert.ok(run("sha256sum '" + base + "/app/storage/sentinel.txt'").startsWith(sentinel));
console.log(JSON.stringify({ result: 'PASS', checks: ['SSH backed-up deploy', 'exact bytes', 'selected rollback', 'stale baseline refusal', 'data sentinel unchanged'], evidence: base, http: moved.siteStatus, liveApplicationChanged: false }));
