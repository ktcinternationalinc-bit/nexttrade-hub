// v55.83-A.6.16 (Max May 14 2026) — Open Full Invoice from Treasury Cleanup
//
// Before this build, the cleanup tool showed only treasury rows for a flagged
// invoice — no customer line items, no add-payment, no edit. You could
// delete/unlink rows blind. After this build, every flagged invoice has:
//   • Clickable invoice # in the left list -> opens full invoice modal
//   • Big "Open Full Invoice" button in the detail panel
//   • Closing the invoice modal returns you back to Reports → Cleanup

var fs = require('fs');
var path = require('path');
var cleanup = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'TreasuryCleanupTab.jsx'), 'utf8');
var reports = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'ReportsTab.jsx'), 'utf8');
var page = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'page.jsx'), 'utf8');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

// 1. ReportsTab accepts onOpenInvoice
ok('1a: ReportsTab accepts onOpenInvoice prop',
  /ReportsTab\([\s\S]{0,400}onOpenInvoice/.test(reports));

// 2. TreasuryCleanupTab accepts onOpenInvoice
ok('2a: TreasuryCleanupTab signature accepts onOpenInvoice',
  /export default function TreasuryCleanupTab\([\s\S]{0,400}onOpenInvoice/.test(cleanup));

// 3. Left list invoice # is a clickable button when onOpenInvoice is provided
ok('3a: invoice # is a clickable button',
  /onOpenInvoice \? \(\s*<button[\s\S]{0,300}onOpenInvoice\(e\.invoice\)/.test(cleanup));
ok('3b: button uses ev.stopPropagation to not double-trigger row select',
  /ev\.stopPropagation\(\); onOpenInvoice\(e\.invoice\)/.test(cleanup));
ok('3c: button bilingual title',
  /Open invoice \/ افتح الفاتورة/.test(cleanup));

// 4. Detail panel has prominent Open Full Invoice button
ok('4a: detail panel has Open Full Invoice button',
  /Open Full Invoice \/ فتح الفاتورة الكاملة/.test(cleanup));
ok('4b: button is gated by onOpenInvoice presence',
  /\{onOpenInvoice && \(\s*<button/.test(cleanup));

// 5. InvoiceDetailPanel signature accepts onOpenInvoice
ok('5a: InvoiceDetailPanel signature has onOpenInvoice',
  /function InvoiceDetailPanel\([\s\S]{0,200}onOpenInvoice/.test(cleanup));

// 6. page.jsx wires the callback with return-to-tab
ok('6a: returnToTabAfterInvoice state defined',
  /const \[returnToTabAfterInvoice, setReturnToTabAfterInvoice\] = useState\(null\)/.test(page));
ok('6b: useEffect returns to reports tab when invoice modal closes',
  /prevSelectedInvoiceRef\.current && !selectedInvoice && returnToTabAfterInvoice/.test(page));
ok('6c: ReportsTab onOpenInvoice callback sets returnToTabAfterInvoice + opens invoice + switches tab',
  /onOpenInvoice=\{\(inv\) => \{[\s\S]{0,300}setReturnToTabAfterInvoice\('reports'\);\s*setSelectedInvoice\(inv\);\s*setTab\('sales'\)/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.16 tests passed');
