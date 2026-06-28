// v55.83-MS — Codex Round-2 REAL-fixture test (not a grep): prove the CSV amount-column detector picks the
// signed "Amount (One column)" and NEVER the "Debit Amount (One column)" — the bug that made expense rows
// read as 0 and never match. Exercises the ACTUAL shared helper used by /api/wave/import-transaction-csv.
var path = require('path');
var url = require('url');
var failures = [];
function ok(label, cond) { if (cond) console.log('OK ' + label); else { failures.push(label); console.log('FAIL ' + label); } }
(async function () {
  var lib = await import(url.pathToFileURL(path.join(__dirname, '..', 'src', 'lib', 'wave-csv-columns.js')).href);
  var detectAmountCol = lib.detectAmountCol;

  // Wave's REAL Account-Transactions export header order: the Debit/Credit one-column variants appear BEFORE
  // the signed "Amount (One column)". This is the exact order that broke detection.
  var waveHeaders = ['Account Name', 'Account Type', 'Transaction Date', 'Transaction Description', 'Other Accounts for this Transaction', 'Debit Amount (One column)', 'Credit Amount (One column)', 'Amount (One column)', 'Balance'];
  var ai = detectAmountCol(waveHeaders);
  ok('1: detects the SIGNED "Amount (One column)", not a Debit/Credit column', waveHeaders[ai] === 'Amount (One column)');
  ok('2: does NOT pick "Debit Amount (One column)" / "Credit Amount (One column)"', waveHeaders[ai] !== 'Debit Amount (One column)' && waveHeaders[ai] !== 'Credit Amount (One column)');

  // Reverse the order (signed amount first) — still correct (order-independent).
  var rev = ['Date', 'Amount (One column)', 'Debit Amount (One column)', 'Credit Amount (One column)'];
  ok('3: order-independent — still the signed amount when it comes first', rev[detectAmountCol(rev)] === 'Amount (One column)');

  // A simpler CSV with only a generic "Amount" column (and a Running Balance that must be excluded).
  var simple = ['Date', 'Description', 'Amount', 'Running Balance'];
  ok('4: generic CSV still resolves the Amount column (skips Running Balance)', simple[detectAmountCol(simple)] === 'Amount');

  // A bank-style CSV with separate Debit/Credit columns and NO single Amount — must NOT false-match Debit.
  var dc = ['Date', 'Description', 'Debit', 'Credit', 'Balance'];
  ok('5: separate Debit/Credit (no single Amount) -> no amount column (debit/credit excluded)', detectAmountCol(dc) === -1);

  console.log('');
  if (failures.length === 0) { console.log('✅ PASS'); process.exit(0); }
  else { console.log('❌ ' + failures.length + ' FAILED'); process.exit(1); }
})().catch(function (e) { console.log('crash: ' + (e && e.stack || e)); process.exit(1); });
