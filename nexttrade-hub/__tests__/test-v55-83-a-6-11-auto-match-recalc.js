// v55.83-A.6.11 (Max May 13 2026) — Critical auto-match recalc fix.
//
// BUG: When auto-matcher matched a bank statement entry against a placeholder
// that ALREADY had linked_invoice_id (filled by v55.83-A.6.7 backfill SQL),
// the recalc was skipped because the conditional only checked
// `updates.linked_invoice_id` (newly-set, not pre-existing).
//
// Symptom on invoice 2303:
//   - 3 placeholder rows with linked_invoice_id pre-filled
//   - Auto-matcher matched them to bank statements (set bank_in=250000 each)
//   - Recalc never ran
//   - Invoice card still showed Confirmed=0, Pending=1.32M
//   - MISMATCH banner fired: "Sales 1.32M vs Treasury 750K"
//   - Treasury row display showed "EGP 0" (only read cash_in)
//
// FIX:
//   1. Recalc fires when EITHER updates.linked_invoice_id OR
//      placeholder.linked_invoice_id is truthy
//   2. Treasury row display shows cash_in + bank_in (not just cash_in)

var fs = require('fs');
var path = require('path');
var page = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'page.jsx'), 'utf8');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

// 1. Recalc target id resolves from BOTH sources
ok('1a: recalcTargetId resolves from updates OR placeholder.linked_invoice_id',
  /recalcTargetId = updates\.linked_invoice_id \|\| placeholder\.linked_invoice_id/.test(page));

// 2. Recalc fires when recalcTargetId truthy (not just updates.linked_invoice_id)
ok('2a: recalc fires on recalcTargetId, not just updates.linked_invoice_id',
  /if \(recalcTargetId\) \{\s*var recalcOk = false;\s*try \{ await recalcInvoiceCollected\(recalcTargetId\)/.test(page));

// 3. Old buggy "if (updates.linked_invoice_id)" pattern removed from this auto-match block
ok('3a: old fragile conditional pattern removed',
  !/if \(updates\.linked_invoice_id\) \{\s*var recalcOk = false;\s*try \{ await recalcInvoiceCollected\(updates\.linked_invoice_id\)/.test(page),
  'must no longer use updates.linked_invoice_id alone');

// 4. Retry-once pattern preserved
ok('4a: retry-once preserved (CRIT-6)',
  /recalc attempt 1 failed[\s\S]{0,500}recalc retry failed for invoice/.test(page));

// 5. Treasury row display sums cash_in + bank_in (not just cash_in)
ok('5a: row display reads cash_in + bank_in',
  /fE\(Number\(txn\.cash_in \|\| 0\) \+ Number\(txn\.bank_in \|\| 0\)\)/.test(page));

// 6. Bug context comment preserved for future readers
ok('6a: bug fix comment explains v55.83-A.6.7 backfill interaction',
  /v55\.83-A\.6\.11[\s\S]{0,500}backfill SQL filled it on existing/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.11 auto-match recalc fix tests passed');
