// ============================================================
// v55.83-IE — Bank Review must NOT locally reverse a Wave-pushed payment.
//
// Bug (Codex): unmatch()/reverse voided accounting_invoice_payments by
// bank_transaction_id with no check for whether the payment had already been
// pushed to Wave (wave_payment_id set, or sync_status synced/manual_done).
// Local-only void would leave the Hub reversed but Wave still holding the payment.
//
// Fix: block local reverse when any non-voided payment row for the txn is
// Wave-synced; instruct the user to reverse in Wave first.
//
// Part 1 = the guard predicate; Part 2 = source wiring.
// ============================================================

var assert = require('assert');
var fs = require('fs');
var path = require('path');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

// Mirror of the guard predicate used in unmatch().
function isSyncedBlocked(payRows) {
  return (payRows || []).some(function (p) { return p && (p.wave_payment_id || p.sync_status === 'synced' || p.sync_status === 'manual_done'); });
}

// ---- 1. guard predicate ----
ok('1a: payment with wave_payment_id is blocked', isSyncedBlocked([{ wave_payment_id: 'WP-1', sync_status: 'pending_wave_sync' }]) === true);
ok('1b: sync_status synced is blocked', isSyncedBlocked([{ sync_status: 'synced' }]) === true);
ok('1c: sync_status manual_done is blocked', isSyncedBlocked([{ sync_status: 'manual_done' }]) === true);
ok('1d: local-only payments are allowed (pending_wave_sync, no wave id)', isSyncedBlocked([{ sync_status: 'pending_wave_sync', wave_payment_id: null }]) === false);
ok('1e: null/none allowed', isSyncedBlocked([{ sync_status: null }]) === false && isSyncedBlocked([]) === false);
ok('1f: ANY synced row in the set blocks the whole reverse', isSyncedBlocked([{ sync_status: 'pending_wave_sync' }, { wave_payment_id: 'WP-2' }]) === true);

// ---- 2. source wiring ----
var src = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'BankReviewTab.jsx'), 'utf8');
ok('2a: unmatch checks wave_payment_id / synced / manual_done before voiding',
  /wave_payment_id \|\| p\.sync_status === 'synced' \|\| p\.sync_status === 'manual_done'/.test(src));
ok('2b: payment load includes wave_payment_id',
  /accounting_invoice_payments'\)\.select\('[^']*wave_payment_id/.test(src));
ok('2c: the guard returns early (blocks) with a Wave message',
  /already pushed to Wave[\s\S]{0,200}return;/.test(src));

console.log('');
if (failures.length === 0) {
  console.log('✅ All v55.83-IE no-local-reverse-of-synced tests passed');
  process.exit(0);
} else {
  console.log('❌ ' + failures.length + ' tests FAILED:');
  failures.forEach(function (f) { console.log('   - ' + f); });
  process.exit(1);
}
