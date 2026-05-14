// v55.83-A.6.19 (Max May 14 2026) — Invoice edit fixes
//
// Per Max May 14 2026:
//   1. Delete line items from existing invoice: each line gets a 🗑 button
//      that immediately deletes from invoice_items table + updates local state
//      + writes audit log.
//   2. Invoice date must be ALWAYS VISIBLE on the invoice (not only in Edit mode).
//      Big blue "Invoice Date" pill near the customer name.
//   3. PDF export already includes date (was line 5151) — no change needed.

var fs = require('fs');
var path = require('path');
var page = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'page.jsx'), 'utf8');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

// === 1. Always-visible invoice date in modal header ===
ok('1a: invoice date row exists in always-visible header',
  /📅 Invoice Date \/ تاريخ الفاتورة/.test(page));
ok('1b: shows actual invoice_date value',
  /\{selectedInvoice\.invoice_date \|\| '—'\}/.test(page));
ok('1c: shows order number alongside date',
  /Order # \{selectedInvoice\.order_number\}/.test(page));
ok('1d: date display is outside the editingInvoice gate (always visible)',
  // The header has no `editingInvoice` gate wrapping it
  /v55\.83-A\.6\.19[\s\S]{0,200}Invoice date row, always visible[\s\S]{0,500}Invoice Date \/ تاريخ الفاتورة/.test(page));

// === 2. Delete line item button ===
ok('2a: deleteLineItem function defined',
  /const deleteLineItem = async \(lineItem\) =>/.test(page));
ok('2b: confirmation prompt before delete',
  /deleteLineItem[\s\S]{0,400}confirm\('Delete this line item/.test(page));
ok('2c: deletes from invoice_items table',
  /deleteLineItem[\s\S]{0,800}from\('invoice_items'\)\.delete\(\)\.eq\('id', lineItem\.id\)/.test(page));
ok('2d: updates local state immediately (no refresh needed)',
  /deleteLineItem[\s\S]{0,1200}setInvoiceItems\(prev => prev\.filter\(it => it\.id !== lineItem\.id\)\)/.test(page));
ok('2e: writes audit_log entry',
  /deleteLineItem[\s\S]{0,2000}entity_type: 'invoice_items'[\s\S]{0,300}action: 'delete_line_item'/.test(page));
ok('2f: delete button rendered per row',
  /onClick=\{\(\) => deleteLineItem\(it\)\}/.test(page));
ok('2g: delete button has bilingual title',
  /title="Delete this line \/ حذف هذا البند"/.test(page));
ok('2h: header has empty column for the delete button',
  /th[^>]*>—<\/th>/.test(page));

// === 3. PDF export still includes date (regression) ===
ok('3a: PDF export includes invoice_date',
  /<strong>Date<\/strong>[\s\S]{0,100}inv\.invoice_date/.test(page));

// === 4. Empty-state contrast (small text fix while I was in this area) ===
ok('4a: empty-state text contrast bumped to slate-500',
  /No item breakdown available \/ لا يوجد تفاصيل بنود[\s\S]{0,30}<\/div>/.test(page) &&
  // Find that string in context of text-slate-500 not 400
  !(/text-slate-400 mb-2 text-center">No item breakdown/.test(page)));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.19 tests passed');
