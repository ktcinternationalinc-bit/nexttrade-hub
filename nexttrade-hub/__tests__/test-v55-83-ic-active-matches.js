// ============================================================
// v55.83-IC — Bank Review must treat only ACTIVE payment_matches as matches.
//
// Bug (Codex): matchesByTxn was built from ALL payment_matches rows, including
// voided ones. So after unmatching (which sets payment_matches.voided = true),
// the transaction could still show the "Matched" badge/panel/unmatch button —
// driven by a voided match row.
//
// Fix: filter payment_matches to voided !== true before grouping into matchesByTxn.
//
// Part 1 models the grouping logic; Part 2 locks the source wiring.
// ============================================================

var assert = require('assert');
var fs = require('fs');
var path = require('path');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

// ---- 1. grouping logic: voided matches must not appear ----
function buildByTxn(rows) {
  var m = (rows || []).filter(function (x) { return x && x.voided !== true; });
  var byTxn = {};
  m.forEach(function (x) { (byTxn[x.bank_transaction_id] = byTxn[x.bank_transaction_id] || []).push(x); });
  return byTxn;
}
var rows = [
  { id: 'a', bank_transaction_id: 't1', voided: false },
  { id: 'b', bank_transaction_id: 't1', voided: true },   // voided — must be excluded
  { id: 'c', bank_transaction_id: 't2', voided: true },   // only match for t2 is voided
];
var by = buildByTxn(rows);
ok('1a: active match kept', (by.t1 || []).length === 1 && by.t1[0].id === 'a');
ok('1b: voided match on t1 excluded', !(by.t1 || []).some(function (x) { return x.id === 'b'; }));
ok('1c: t2 (only voided) has NO active matches → not shown as matched', !by.t2 || by.t2.length === 0);
ok('1d: undefined voided treated as active (legacy rows)', buildByTxn([{ id: 'x', bank_transaction_id: 't3' }]).t3.length === 1);

// ---- 2. source wiring ----
var src = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'BankReviewTab.jsx'), 'utf8');
ok('2a: matchesByTxn source filters payment_matches on voided !== true',
  /res\[1\][\s\S]{0,40}\.filter\(function \(x\) \{ return x && x\.voided !== true; \}\)/.test(src));
// v55.83-IS: unmatch moved to the service-role route — it still voids payment_matches there (audit-preserving).
ok('2b: unmatch voids payment_matches (audit-preserving), now server-side',
  /from\('payment_matches'\)\.update\(\{ voided: true \}\)\.eq\('bank_transaction_id', bid\)/.test(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'api', 'accounting', 'bank-write', 'route.js'), 'utf8')));

console.log('');
if (failures.length === 0) {
  console.log('✅ All v55.83-IC active-matches tests passed');
  process.exit(0);
} else {
  console.log('❌ ' + failures.length + ' tests FAILED:');
  failures.forEach(function (f) { console.log('   - ' + f); });
  process.exit(1);
}
