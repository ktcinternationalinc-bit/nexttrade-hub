// v55.83-XH — EXECUTED regression for the deploy HEAD-binding gate (Codex 19:45 P2 #2):
// an unavailable/empty git HEAD must be a gate FAILURE, never permission to trust --sha.
// headProblem is the exact pure decision deploy.js uses (lib/gate.headProblem).
const assert = require('assert');
const path = require('path');
const { headProblem } = require(path.join(__dirname, '..', 'release-management/lib/gate.js'));
let pass = 0;
function ok(cond, msg) { assert.ok(cond, msg); console.log('  ok: ' + msg); pass++; }

const SHA = 'abc1234deadbeef';

// Empty/unavailable HEAD -> a gate problem mentioning the unavailable HEAD (NOT null, NOT trusted).
const empty = headProblem(SHA, '');
ok(empty && /unavailable HEAD|could not resolve the actual checked-out/i.test(empty), 'empty HEAD is a gate failure (not permission to trust --sha)');
ok(headProblem(SHA, null) !== null && headProblem(SHA, undefined) !== null, 'null/undefined HEAD is also a gate failure');

// Missing --sha -> its own problem.
ok(headProblem('', 'abc1234deadbeef') && /--sha/.test(headProblem('', 'abc1234deadbeef')), 'missing --sha is a problem');

// Matching HEAD (exact or prefix) -> no problem.
ok(headProblem(SHA, SHA) === null, 'exact matching HEAD passes');
ok(headProblem('abc1234', 'abc1234deadbeef') === null, 'a --sha that is a prefix of HEAD passes');

// Different HEAD -> a mismatch problem (not silently accepted).
const mismatch = headProblem(SHA, 'ffff9999cccc0000');
ok(mismatch && /Working tree is at/.test(mismatch), 'a different HEAD is a gate failure (no trusting the string)');

console.log('\nXH deploy-head-guard: ' + pass + '/' + pass + ' checks passed');
process.exit(0);
