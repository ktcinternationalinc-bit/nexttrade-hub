// ============================================================
// v55.83-LJ — final CSV-import hardening (Codex LI review):
//  1. A CSV row that references an INVOICE is a payment, not a categorization — route it to
//     needs_manual_invoice_link, never apply it as a category (the blotter must not imply the invoice
//     relationship is known from a category import).
//  2. The conflict guard catches LABEL-ONLY existing categories (wave_account_name without an id), not just
//     resolved ids — no silent overwrite of any existing category.
//  3. Audit stores before/after + raw row + row hash + matched bank txn id + applied_by/at (idempotent review).
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var route = rd('src/app/api/wave/import-transaction-csv/route.js');
var sync = rd('src/components/WaveSyncCenter.jsx');

ok('1: invoice/customer columns are detected',
  /invoice: findCol\(headers, \['invoice'\]/.test(route) &&
  /customer: findCol\(headers, \['customer', 'contact', 'client'\]\)/.test(route));
ok('2: a row referencing an invoice is routed to needs_manual_invoice_link and NOT applied as a category',
  /if \(cInv\) \{ needsInvoiceLink\.push\(/.test(route) &&
  /this is a PAYMENT; reconcile via invoice-payment sync, not category import/.test(route) &&
  /needs_manual_invoice_link_count: needsInvoiceLink\.length/.test(route));
ok('3: the conflict guard catches ANY existing category (label-only included), not just a resolved id',
  /var hasExistingCat = !!\(best\.wave_account_id \|\| best\.wave_account_name\);/.test(route) &&
  /if \(hasExistingCat && wouldChange && !allowOverride\) \{/.test(route));
ok('4: audit records before/after + raw row + row hash + matched bank txn id + applied_by/at',
  /row_hash: rowHash\(rowArr\), raw_row: rowArr\.join\(' \| '\)/.test(route) &&
  /before: \{ wave_account_id: best\.wave_account_id \|\| null/.test(route) &&
  /after: \{ wave_account_id: patch\.wave_account_id \|\| null/.test(route) &&
  /applied_by: by, applied_at: appliedAt/.test(route));
ok('5: the UI surfaces the invoice-linked count (so the user routes those to payment sync)',
  /invoice-linked → use payment sync/.test(sync));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-LJ csv-invoice-and-audit tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
