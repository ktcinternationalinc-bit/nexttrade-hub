// v55.83-MN — Codex Lane B QA FAIL: the "Hub-only" copy still told Max "Wave's API cannot accept bank
// transaction/category pushes" AFTER the build proved categorized transactions DO push (moneyTransactionCreate).
// Fixed to the new truth: uncategorized = "Needs category"; split lines = "Split — not built yet".
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond) { if (cond) console.log('OK ' + label); else { failures.push(label); console.log('FAIL ' + label); } }
var sync = fs.readFileSync(path.join(__dirname, '..', 'src/components/WaveSyncCenter.jsx'), 'utf8');

ok('1: stale Wave-cannot-accept-category-pushes copy is GONE',
  !/does not accept raw bank-transaction\/category pushes/.test(sync) &&
  !/Wave's API can't accept these/.test(sync));
ok('2: new truthful copy present — uncategorized rows say Needs category + categorized DO post',
  /ℹ Needs category/.test(sync) &&
  /categorized transactions DO post to Wave/.test(sync) &&
  /Pick a Wave Category in Bank Review, then this can post to Wave/.test(sync));
ok('3: split lines are labeled not-built-yet (not Wave-cannot-accept)',
  /Split — not built yet/.test(sync) && /Split-line push is not built yet/.test(sync));

console.log('');
if (failures.length === 0) { console.log('✅ PASS'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED'); process.exit(1); }
