// v55.83-A.6.17 (Max May 14 2026) — Open Full Invoice from Treasury Cleanup
//
// FIX: v55.83-A.6.16 shipped with the cleanup tool plumbed correctly all the way
// through, EXCEPT one line — ReportsTab's CleanupSection call site did NOT pass
// `onOpenInvoice` to the cleanup component. So clicking the invoice link did
// nothing because the prop arrived as undefined inside TreasuryCleanupTab.
//
// This test verifies the full prop chain end-to-end and prevents the bug
// recurring: every link in the chain must pass onOpenInvoice.
//
// Also: the design no longer switches tabs. The invoice modal renders globally
// (outside tab gates), so we just setSelectedInvoice(inv) and Reports stays
// mounted underneath. No tab dance, no useEffect, no return-to-tab state.

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

// === 1. End-to-end prop chain ===
ok('1a: page.jsx ReportsTab call passes onOpenInvoice callback',
  /<ReportsTab[\s\S]{0,800}onOpenInvoice=\{\(inv\)/.test(page));
ok('1b: page.jsx callback calls setSelectedInvoice (modal trigger)',
  /onOpenInvoice=\{\(inv\) => \{[\s\S]{0,400}setSelectedInvoice\(inv\)/.test(page));
ok('1c: ReportsTab onOpenInvoice callback does NOT switch tabs (modal is global)',
  // Match ReportsTab call site specifically, ensure setTab is absent in that callback only
  !/ReportsTab[\s\S]{0,800}onOpenInvoice=\{\(inv\) => \{[^}]*setTab\(/.test(page));

ok('2a: ReportsTab signature accepts onOpenInvoice',
  /ReportsTab\([\s\S]{0,400}onOpenInvoice/.test(reports));
// THE BUG FROM A.6.16: this was missing
ok('2b: ReportsTab CleanupSection CALL passes onOpenInvoice (the missing line bug from A.6.16)',
  /<CleanupSection[\s\S]{0,500}onOpenInvoice=\{onOpenInvoice\}/.test(reports));

ok('3a: TreasuryCleanupTab signature accepts onOpenInvoice',
  /export default function TreasuryCleanupTab\([\s\S]{0,400}onOpenInvoice/.test(cleanup));
ok('3b: invoice # in left list is a clickable button when onOpenInvoice is provided',
  /onOpenInvoice \? \(\s*<button[\s\S]{0,300}onOpenInvoice\(e\.invoice\)/.test(cleanup));
ok('3c: button uses ev.stopPropagation so row click does not also fire',
  /ev\.stopPropagation\(\); onOpenInvoice\(e\.invoice\)/.test(cleanup));
ok('3d: detail panel has prominent Open Full Invoice button',
  /Open Full Invoice \/ فتح الفاتورة الكاملة/.test(cleanup));
ok('3e: InvoiceDetailPanel signature accepts onOpenInvoice',
  /function InvoiceDetailPanel\([\s\S]{0,300}onOpenInvoice/.test(cleanup));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.17 tests passed');
