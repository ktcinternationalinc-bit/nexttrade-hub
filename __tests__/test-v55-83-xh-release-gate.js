// v55.83-XH — EXECUTED tests for the shared release gate + markVerifiedLive, against RECORDED
// evidence bound to the exact candidate (Codex 13:11 #1/#2). Uses a throwaway register so the
// real one is never touched.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = path.join(__dirname, '..');
const { evaluateGate } = require(path.join(root, 'release-management/lib/gate.js'));
let pass = 0;
function ok(cond, msg) { assert.ok(cond, msg); console.log('  ok: ' + msg); pass++; }

const SHA = 'abc1234deadbeef';
const OTHER = 'ffff9999cccc0000';
// A fully-recorded, production-bound item.
function goodItem() {
  return {
    id: 'ctl',
    codexRef: { sha: SHA, target: 'production', feedbackRef: 'codex-13:11', at: 't' },
    behavioralQa: { sha: SHA, target: 'production', kind: 'behavioral', result: 'PASS', suite: 'staging-smoke', at: 't' },
    maxApproval: { text: 'Max: yes, put ctl on production', at: 't' }
  };
}
const ctx = { sha: SHA, target: 'production', confirm: 'Max: yes, put ctl on production' };

// ---- evaluateGate ----
ok(evaluateGate(goodItem(), ctx).ok === true, 'valid complete control passes');
ok(evaluateGate({ id: 'x' }, ctx).ok === false, 'no recorded evidence → blocked');

let i;
i = goodItem(); delete i.codexRef; ok(evaluateGate(i, ctx).ok === false, 'no codexRef → blocked');
i = goodItem(); i.codexRef.sha = OTHER; ok(evaluateGate(i, ctx).ok === false, 'stale codexRef.sha → blocked');
i = goodItem(); i.codexRef.target = 'staging'; ok(evaluateGate(i, ctx).ok === false, 'codexRef.target != candidate target → blocked');
i = goodItem(); delete i.codexRef.feedbackRef; ok(evaluateGate(i, ctx).ok === false, 'codexRef.feedbackRef missing → blocked');

i = goodItem(); delete i.behavioralQa; ok(evaluateGate(i, ctx).ok === false, 'no behavioralQa → blocked (source lint is not enough)');
i = goodItem(); i.behavioralQa.sha = OTHER; ok(evaluateGate(i, ctx).ok === false, 'stale behavioralQa.sha (QA for a different build) → blocked');
i = goodItem(); i.behavioralQa.target = 'staging'; ok(evaluateGate(i, ctx).ok === false, 'behavioralQa.target staging while deploying production → blocked');
i = goodItem(); i.behavioralQa.result = 'FAIL'; ok(evaluateGate(i, ctx).ok === false, 'behavioralQa.result FAIL → blocked');
i = goodItem(); i.behavioralQa.kind = 'source'; ok(evaluateGate(i, ctx).ok === false, 'behavioralQa marked source (not behavioral) → blocked');

i = goodItem(); delete i.maxApproval; ok(evaluateGate(i, ctx).ok === false, 'no recorded Max approval → blocked');
ok(evaluateGate(goodItem(), Object.assign({}, ctx, { confirm: 'not approved' })).ok === false, 'confirm not matching recorded approval → blocked');
ok(evaluateGate(goodItem(), Object.assign({}, ctx, { sha: '' })).ok === false, 'missing candidate sha → blocked');

// ---- markVerifiedLive against a throwaway register (write path + no-write-on-mismatch) ----
const tmp = path.join(os.tmpdir(), 'xh-register-test-' + process.pid + '.json');
function writeReg(item) {
  fs.writeFileSync(tmp, JSON.stringify({ items: [item], protocol: [], legend: [] }, null, 2));
}
process.env.RELEASE_REGISTER_FILE = tmp;
delete require.cache[require.resolve(path.join(root, 'release-management/lib/register.js'))];
const reg = require(path.join(root, 'release-management/lib/register.js'));
function readItem() { return JSON.parse(fs.readFileSync(tmp, 'utf8')).items[0]; }

// Mismatch: contradictory evidence passed in — must THROW and change nothing.
writeReg(goodItem());
let threw = false;
try {
  reg.markVerifiedLive('ctl', { sha: OTHER, target: 'production', confirm: 'Max: yes, put ctl on production', build: OTHER, backup: '~/b', verifiedBy: 'x' });
} catch (e) { threw = /does not bind|refused/i.test(e.message); }
ok(threw, 'markVerifiedLive with a wrong-SHA build throws');
ok(readItem().status !== 'live', 'register item unchanged after the wrong-SHA refusal');

// Contradictory confirm vs recorded approval — must THROW, nothing changes, approval not overwritten.
writeReg(goodItem());
threw = false;
try { reg.markVerifiedLive('ctl', { sha: SHA, target: 'production', confirm: 'not approved', build: SHA, backup: '~/b', verifiedBy: 'x' }); } catch (e) { threw = true; }
ok(threw, 'markVerifiedLive with a confirm != recorded approval throws');
ok(readItem().maxApproval.text === 'Max: yes, put ctl on production', 'recorded approval is NOT overwritten by the argument');

// Staging QA evidence passed for a production move — must THROW.
writeReg((function () { var g = goodItem(); g.behavioralQa.target = 'staging'; return g; })());
threw = false;
try { reg.markVerifiedLive('ctl', { sha: SHA, target: 'production', confirm: ctx.confirm, build: SHA, backup: '~/b', verifiedBy: 'x' }); } catch (e) { threw = true; }
ok(threw, 'markVerifiedLive with staging behavioralQa for a production move throws');

// build != sha — must THROW.
writeReg(goodItem());
threw = false;
try { reg.markVerifiedLive('ctl', { sha: SHA, target: 'production', confirm: ctx.confirm, build: OTHER, backup: '~/b', verifiedBy: 'x' }); } catch (e) { threw = true; }
ok(threw, 'markVerifiedLive with build != sha throws');

// ALL-CONSISTENT-STAGING must be refused by the production-only helper (Codex 19:45 P2).
// codexRef/behavioralQa/ev all 'staging', same SHA, matching approval -> the evidence is
// internally consistent, but markVerifiedLive must NOT mark it production/live.
(function () {
  var g = {
    id: 'ctl',
    codexRef: { sha: SHA, target: 'staging', feedbackRef: 'codex-staging', at: 't' },
    behavioralQa: { sha: SHA, target: 'staging', kind: 'behavioral', result: 'PASS', at: 't' },
    maxApproval: { text: 'Max: staging only for QA', at: 't' }
  };
  writeReg(g);
  var before = fs.readFileSync(tmp, 'utf8');
  var t = false;
  try { reg.markVerifiedLive('ctl', { sha: SHA, target: 'staging', confirm: 'Max: staging only for QA', build: SHA, backup: '~/b', verifiedBy: 'x' }); } catch (e) { t = /production-only/i.test(e.message); }
  ok(t, 'markVerifiedLive refuses an all-consistent-STAGING verification (production-only)');
  ok(fs.readFileSync(tmp, 'utf8') === before, 'the item AND event history are byte-identical after the staging refusal');
})();

// Valid complete control — SHOULD flip to live, WITHOUT rewriting the recorded evidence.
writeReg(goodItem());
const res = reg.markVerifiedLive('ctl', { sha: SHA, target: 'production', confirm: ctx.confirm, build: SHA, backup: '~/code-backups/ctl-x', verifiedBy: 'release-session' });
ok(res.status === 'live' && res.where === 'production', 'valid control flips the item to live');
const after = readItem();
ok(after.maxApproval.text === 'Max: yes, put ctl on production' && after.codexRef.sha === SHA && after.behavioralQa.sha === SHA, 'recorded evidence preserved (not manufactured/overwritten)');
ok(Array.isArray(JSON.parse(fs.readFileSync(tmp, 'utf8')).events), 'an event was logged for the verified-live write');

try { fs.unlinkSync(tmp); } catch (e) {}
delete process.env.RELEASE_REGISTER_FILE;

console.log('\nXH release-gate: ' + pass + '/' + pass + ' checks passed');
process.exit(0);
