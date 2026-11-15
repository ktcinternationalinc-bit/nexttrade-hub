// ============================================================
// v55.83-HD — Open Accounts Excel export must strip the system
// "Auto-synced from invoice … Edit the invoice to change this entry."
// note, exactly like the on-screen ledger and the print export do.
//
// Codex QA FAIL (HB pass): the Excel description cell concatenated raw
// e.notes (open-account-export.js:892), leaking implementation noise onto
// customer/internal statements. Screen (OpenAccountsTab) and print
// (open-account-export.js:308) already stripped it.
//
// Fix: run e.notes through the same strip regex before building the Excel
// Description cell; if nothing real remains, append nothing.
// These tests lock the behavior + the source wiring in.
// ============================================================

var assert = require('assert');
var fs = require('fs');
var path = require('path');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

// Mirror of the strip used by screen/print/Excel. If the regex changes,
// update it here AND in src/lib/open-account-export.js + OpenAccountsTab.jsx.
function stripSystemNote(notes) {
  return notes ? String(notes).replace(/Auto-synced from invoice[\s\S]*?Edit the invoice to change this entry\.?/gi, '').trim() : '';
}
// Models line 892: description cell = desc + (stripped note ? ' — ' + note : '')
function descCell(desc, notes) {
  var n = stripSystemNote(notes);
  return (desc || '') + (n ? ' — ' + n : '');
}

var SYS = 'Auto-synced from invoice INV-1001. Edit the invoice to change this entry.';

// ---------- 1. strip behavior ----------
ok('1a: pure system note → empty', stripSystemNote(SYS) === '');
ok('1b: real note + system note → only real note kept',
  stripSystemNote('Paid in cash. ' + SYS) === 'Paid in cash.');
ok('1c: real note alone → unchanged',
  stripSystemNote('Partial payment, balance next week') === 'Partial payment, balance next week');
ok('1d: Arabic real note + system note → only Arabic kept',
  stripSystemNote('دفعة جزئية ' + SYS) === 'دفعة جزئية');
ok('1e: empty / null safe', stripSystemNote('') === '' && stripSystemNote(null) === '' && stripSystemNote(undefined) === '');
ok('1f: case-insensitive variant stripped',
  stripSystemNote('note AUTO-SYNCED FROM INVOICE x. EDIT THE INVOICE TO CHANGE THIS ENTRY') === 'note');

// ---------- 2. Excel description cell ----------
ok('2a: desc + pure system note → desc only (no " — ")',
  descCell('Invoice', SYS) === 'Invoice');
ok('2b: desc + real note → "desc — note"',
  descCell('Invoice', 'Paid in cash. ' + SYS) === 'Invoice — Paid in cash.');
ok('2c: desc + no note → desc only',
  descCell('Invoice', '') === 'Invoice');
ok('2d: blank desc + system note → empty string (no stray " — ")',
  descCell('', SYS) === '');

// ---------- 3. source wiring ----------
var exportPath = path.join(__dirname, '..', 'src', 'lib', 'open-account-export.js');
var src = fs.readFileSync(exportPath, 'utf8');

ok('3a: Excel path computes a stripped _xlNote with the auto-sync regex',
  /_xlNote\s*=\s*e\.notes\s*\?\s*String\(e\.notes\)\.replace\(\/Auto-synced from invoice/.test(src));
ok('3b: Excel description cell uses _xlNote, not raw e.notes',
  src.indexOf("(e.description || '') + (_xlNote ? ' — ' + _xlNote : '')") > -1);
ok('3c: raw `e.notes ? \" — \" + e.notes` concatenation is gone from the Excel row',
  src.indexOf("(e.description || '') + (e.notes ? ' — ' + e.notes : '')") === -1);

// ---------- Summary ----------
console.log('');
if (failures.length === 0) {
  console.log('✅ All v55.83-HD Excel note-strip tests passed');
  process.exit(0);
} else {
  console.log('❌ ' + failures.length + ' tests FAILED:');
  failures.forEach(function (f) { console.log('   - ' + f); });
  process.exit(1);
}
