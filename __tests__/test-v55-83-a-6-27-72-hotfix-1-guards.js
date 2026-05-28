/* v72 HOTFIX 1 QA validation — verifies defensive guards work correctly */
var path = require('path');
var fs = require('fs');

var libPath = path.join(__dirname, '..', 'src', 'lib', 'open-account-ledger.js');
var libCode = fs.readFileSync(libPath, 'utf8')
  .replace(/^'use client';\s*/m, '')
  .replace(/export var /g, 'var ')
  .replace(/export function /g, 'function ');
// suppress console.warn during tests
var origWarn = console.warn;
console.warn = function () {};
eval(libCode);
console.warn = origWarn;

var bugs = [];
function check(name, condition, details) {
  if (!condition) {
    bugs.push({ name: name, details: details });
    console.log('  ❌ ' + name + (details ? ' — ' + details : ''));
  } else {
    console.log('  ✓ ' + name);
  }
}

console.log('\n══════ v72 HOTFIX 1 — defensive guards ══════');

// ═══════ HOTFIX 1.1: Null type now treated as credit_adjustment ═══════
console.log('\n── Guard 1: null transaction_type ──');
{
  var entries = [
    { id: 'a1', entry_date: '2026-05-23', currency: 'USD', credit_amount: 1000, transaction_type: null },
    { id: 'a3', entry_date: '2026-05-23', currency: 'USD', credit_amount: 200, transaction_type: 'payment_received' },
  ];
  var result = simulate(entries);
  var usd = result.byCurrency.USD || {};
  // Now null type is treated as credit_adjustment → credit_amount=1000 → theirPrepaid
  // Plus payment_received 200 → theirPrepaid
  // Total: 1200
  check('Null transaction_type now adds to pots (not silently dropped)',
    usd.theirPrepaid === 1200,
    'theirPrepaid=' + usd.theirPrepaid + ' (expected 1200)');
  check('Warnings collected for null-type entries',
    result.warnings && result.warnings.some(function (w) { return /no transaction_type/.test(w.msg); }),
    'warnings: ' + JSON.stringify(result.warnings));
}

// ═══════ HOTFIX 1.2: Negative amounts clamped ═══════
console.log('\n── Guard 2: negative amounts ──');
{
  var entries = [
    { id: 'n1', entry_date: '2026-05-23', currency: 'USD', credit_amount: -500, transaction_type: 'payment_received' },
    { id: 'p1', entry_date: '2026-05-23', currency: 'USD', credit_amount: 100, transaction_type: 'payment_received' },
  ];
  var result = simulate(entries);
  var usd = result.byCurrency.USD || {};
  check('Negative payment clamped to 0, doesn\'t poison pot',
    usd.theirPrepaid === 100,
    'theirPrepaid=' + usd.theirPrepaid + ' (expected 100, negative was clamped)');
  check('Warning emitted for negative amount',
    result.warnings && result.warnings.some(function (w) { return /negative/.test(w.msg); }));
}

// ═══════ HOTFIX 1.3: Offset overflow clamped ═══════
console.log('\n── Guard 3: offset over-apply ──');
{
  var entries = [
    { id: 'inv1', entry_date: '2026-05-23', currency: 'USD', credit_amount: 1000, transaction_type: 'sales_invoice' },
    { id: 'bill1', entry_date: '2026-05-23', currency: 'USD', debit_amount: 1000, transaction_type: 'vendor_bill' },
    { id: 'pay1', entry_date: '2026-05-24', currency: 'USD', credit_amount: 600, transaction_type: 'payment_received' },
    { id: 'off1', entry_date: '2026-05-25', currency: 'USD', debit_amount: 1000,
      transaction_type: 'offset', offset_invoice_id: 'inv1', offset_bill_id: 'bill1', offset_pair_id: 'p1' },
    { id: 'off2', entry_date: '2026-05-25', currency: 'USD', credit_amount: 1000,
      transaction_type: 'offset', offset_invoice_id: 'inv1', offset_bill_id: 'bill1', offset_pair_id: 'p1' },
  ];
  var result = simulate(entries);
  var usd = result.byCurrency.USD || {};
  // inv1: 1000 invoice - 600 payment = 400 remaining, then offset tries 1000 → clamped to 400 → invoice settled
  // applied[inv1] = 600 + 400 = 1000 (matches original) — NOT overshot
  // bill1: 1000 - 1000 offset = 0 settled
  check('Offset clamped to remaining — no over-application',
    result.applications.inv1 === 1000,
    'applied[inv1]=' + result.applications.inv1 + ' (expected exactly 1000, was overshooting before)');
  check('Warning emitted for offset clamp',
    result.warnings && result.warnings.some(function (w) { return /exceeds invoice remaining/.test(w.msg); }));
}

// ═══════ HOTFIX 1.4: Stale offset references logged ═══════
console.log('\n── Guard 4: stale offset references ──');
{
  var entries = [
    { id: 'inv1', entry_date: '2026-05-23', currency: 'USD', credit_amount: 1000, transaction_type: 'sales_invoice' },
    { id: 'off1', entry_date: '2026-05-24', currency: 'USD', debit_amount: 500,
      transaction_type: 'offset', offset_invoice_id: 'GHOST', offset_bill_id: 'inv1', offset_pair_id: 'p1' },
  ];
  var result = simulate(entries);
  check('Warning when offset references missing invoice (HOTFIX 28 updated wording)',
    result.warnings && result.warnings.some(function (w) {
      // Old wording: "not in open pool". New wordings (HOTFIX 28):
      // "REJECTED malformed offset row" / "Offset invoice already closed or not in this currency pool"
      return /not in open pool|REJECTED malformed offset|already closed or not in this currency/.test(w.msg);
    }));
}

// ═══════ HOTFIX 1.5: Max's real-data scenario still correct ═══════
console.log('\n── Max\'s end-to-end scenario (regression) ──');
{
  var entries = [
    { id: 'a', entry_date: '2026-05-23', created_at: '2026-05-23T10:00Z', currency: 'USD', credit_amount: 1000, transaction_type: 'payment_received' },
    { id: 'b', entry_date: '2026-05-23', created_at: '2026-05-23T10:01Z', currency: 'USD', debit_amount: 28000, transaction_type: 'vendor_bill' },
    { id: 'c', entry_date: '2026-05-23', created_at: '2026-05-23T10:02Z', currency: 'USD', debit_amount: 25000, transaction_type: 'payment_sent' },
    { id: 'd', entry_date: '2026-05-23', created_at: '2026-05-23T10:03Z', currency: 'USD', debit_amount: 3433, transaction_type: 'payment_sent' },
    { id: 'e', entry_date: '2026-05-23', created_at: '2026-05-23T10:04Z', currency: 'EGP', credit_amount: 50000, transaction_type: 'payment_received' },
    { id: 'f', entry_date: '2026-05-23', created_at: '2026-05-23T10:05Z', currency: 'EGP', credit_amount: 33, transaction_type: 'sales_invoice' },
    { id: 'g', entry_date: '2026-05-25', created_at: '2026-05-25T10:00Z', currency: 'EGP', credit_amount: 50000, transaction_type: 'payment_received' },
    { id: 'h', entry_date: '2026-05-25', created_at: '2026-05-25T10:01Z', currency: 'USD', credit_amount: 20000, transaction_type: 'sales_invoice' },
  ];
  var result = simulate(entries);
  var usd = result.byCurrency.USD;
  var egp = result.byCurrency.EGP;
  // USD trace: 
  //   +1000 prepaid (theirPrepaid=1000)
  //   +28000 vendor bill (ourPrepaid=0, openBills=28000)
  //   -25000 payment sent → consumes openBill → openBill=3000
  //   -3433 payment sent → consumes openBill (3000), 433 → ourPrepaid
  //   +20000 sales invoice → consumes theirPrepaid 1000, 19000 → openInvoices
  // Final: theirOpenInvoices=19000, ourOpenBills=0, theirPrepaid=0, ourPrepaid=433
  // Net = (19000 - 0) - (0 - 433) = 19433 (in our favor)
  check('USD net = +$19,433 in our favor (Max\'s exact scenario)',
    Math.abs(usd.netBalance - 19433) < 0.01,
    'netBalance=' + usd.netBalance);
  check('USD theirOpenInvoices = 19,000',
    usd.theirOpenInvoices === 19000);
  check('USD ourPrepaid = 433',
    usd.ourPrepaid === 433);
  check('EGP theirPrepaid = 99,967',
    egp.theirPrepaid === 99967,
    'egp.theirPrepaid=' + egp.theirPrepaid);
}

console.log('\n══════════════════════════════════════════════');
console.log('Bugs: ' + bugs.length);
process.exit(bugs.length === 0 ? 0 : 1);
