// v55.83-A.1 — Bank-confirmation tracking + billing-error friendly message
//
// Ships 4 features:
//   1. Two-number display on invoice (Confirmed + Pending bank match)
//   2. Path A (Add Payment > Bank Transfer) now also requires bank-statement
//      confirmation — unified with Path B (placeholder flow)
//   3. Visual badge component (InvoicePaymentBadge)
//   4. Dashboard widget surfacing invoices awaiting bank match
// Plus: billing-error detection in /api/ask + /api/hr-report/coach
var fs = require('fs');
var path = require('path');

var failures = [];
function ok(label, cond, hint) {
  if (cond) { console.log('✓ ' + label); }
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

var sqlPath  = path.join(__dirname, '..', 'sql', 'v55-83-a-1-bank-confirmation.sql');
var pagePath = path.join(__dirname, '..', 'src', 'app', 'page.jsx');
var badgePath = path.join(__dirname, '..', 'src', 'components', 'InvoicePaymentBadge.jsx');
var widgetPath = path.join(__dirname, '..', 'src', 'components', 'PendingBankConfirmationsWidget.jsx');
var askPath = path.join(__dirname, '..', 'src', 'app', 'api', 'ask', 'route.js');
var coachPath = path.join(__dirname, '..', 'src', 'app', 'api', 'hr-report', 'coach', 'route.js');

ok('1: SQL migration exists', fs.existsSync(sqlPath));

var sql = fs.readFileSync(sqlPath, 'utf8');
ok('1a: SQL adds total_confirmed column',
  /ADD COLUMN IF NOT EXISTS total_confirmed NUMERIC/.test(sql));
ok('1b: SQL adds total_pending_bank column',
  /ADD COLUMN IF NOT EXISTS total_pending_bank NUMERIC/.test(sql));
ok('1c: SQL adds needs_bank_match to treasury',
  /ADD COLUMN IF NOT EXISTS needs_bank_match BOOLEAN/.test(sql));
ok('1d: SQL backfills existing trusted-bank rows as needs_bank_match',
  /UPDATE treasury\s*SET needs_bank_match = TRUE/.test(sql));
ok('1e: SQL idempotent (IF NOT EXISTS everywhere)',
  (sql.match(/IF NOT EXISTS/g) || []).length >= 5);
ok('1f: SQL has verification queries at the bottom',
  /SELECT[\s\S]{0,200}invoices_with_pending_bank/.test(sql));

var page = fs.readFileSync(pagePath, 'utf8');

ok('2: recalcInvoiceCollected splits into confirmed + pending',
  /confirmed \+= cashAmt \+ bankAmt/.test(page) &&
  /pending \+= bankAmt/.test(page));
ok('2a: recalc reads needs_bank_match column',
  /\.select\([^)]*needs_bank_match/.test(page));
ok('2b: recalc reads matched_bank_txn_id column',
  /\.select\([^)]*matched_bank_txn_id/.test(page));
ok('2c: recalc writes total_confirmed and total_pending_bank',
  /total_confirmed: cappedConfirmed/.test(page) &&
  /total_pending_bank: cappedPending/.test(page));
ok('2d: recalc preserves total_collected for backward compat',
  /total_collected: capped/.test(page));
ok('2e: recalc handles overflow by scaling proportionally (cap)',
  /scale = totalAmt \/ totalAll/.test(page));

ok('3: Path A (Add Payment > Bank Transfer) flags needs_bank_match',
  /needs_bank_match: true,\s*\/\/ v55\.83-A\.1/.test(page));
ok('3a: Path A description includes "awaiting match" tag',
  /\[🏦 Bank Transfer · awaiting match\]/.test(page));

ok('4: Auto-matcher clears needs_bank_match on match',
  /is_bank_placeholder: false,\s*needs_bank_match: false/.test(page));

ok('5: InvoicePaymentBadge component exists', fs.existsSync(badgePath));
var badge = fs.readFileSync(badgePath, 'utf8');
ok('5a: badge handles three states (confirmed/pending/none)',
  /🟢/.test(badge) && /🟡/.test(badge) && /⚪/.test(badge));
ok('5b: badge has backward-compat fallback for pre-migration data',
  /if \(confirmed === 0 && pending === 0 && collected > 0\)/.test(badge));
ok('5c: badge supports compact mode for inline use',
  /compact \?/.test(badge));

ok('6: PendingBankConfirmationsWidget component exists', fs.existsSync(widgetPath));
var widget = fs.readFileSync(widgetPath, 'utf8');
ok('6a: widget filters for total_pending_bank > 0',
  /total_pending_bank \|\| 0\) > 0/.test(widget));
ok('6b: widget gated by isSuperAdmin or View Financial Reports perm',
  /isSuperAdmin \|\| \(modulePerms && modulePerms\['View Financial Reports'\]/.test(widget));
ok('6c: widget shows days-waiting urgency coloring',
  /daysWaiting >= 14 \? 'text-red-600/.test(widget));
ok('6d: widget caps display to top 25 rows',
  /\.slice\(0, 25\)/.test(widget));
ok('6e: widget tells user how to clear the backlog',
  /go to Egypt Bank tab/.test(widget));

ok('7: page.jsx imports InvoicePaymentBadge',
  /import InvoicePaymentBadge from '\.\.\/components\/InvoicePaymentBadge'/.test(page));
ok('7a: page.jsx imports PendingBankConfirmationsWidget',
  /import PendingBankConfirmationsWidget from '\.\.\/components\/PendingBankConfirmationsWidget'/.test(page));
ok('7b: invoice detail uses InvoicePaymentBadge',
  /<InvoicePaymentBadge invoice=\{selectedInvoice\}/.test(page));
ok('7c: invoice detail shows confirmed/pending breakdown when pending > 0',
  /total_pending_bank \|\| 0\) > 0[\s\S]{0,800}Pending bank match/.test(page));
ok('7d: dashboard renders PendingBankConfirmationsWidget',
  /<PendingBankConfirmationsWidget[\s\S]{0,300}invoices=\{invoices\}/.test(page));
ok('7e: widget click navigates to invoice detail',
  /setTab\('sales'\); setSelectedInvoice\(inv\)/.test(page));

ok('8: /api/ask detects billing error in main chain', fs.existsSync(askPath));
var ask = fs.readFileSync(askPath, 'utf8');
ok('8a: ask route checks for "credit balance is too low"',
  /credit balance is too low/i.test(ask));
ok('8b: ask returns friendly billing message + error_type',
  /error_type: 'billing'[\s\S]{0,200}admin_action_required: true/.test(ask));
ok('8c: ask greeter chain ALSO detects billing error',
  // Both main + greeter blocks should have the billing detection
  (ask.match(/credit balance is too low/gi) || []).length >= 2);

ok('9: HR coach detects billing error', fs.existsSync(coachPath));
var coach = fs.readFileSync(coachPath, 'utf8');
ok('9a: coach route checks for credit balance',
  /credit balance is too low/i.test(coach));
ok('9b: coach returns friendly billing message',
  /Anthropic account needs credit/i.test(coach));

ok('10: version stamp bumped to v55.83-A.1',
  />v55\.83-A\.1</.test(page) && /BUILD v55\.83-A\.1/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' test' + (failures.length === 1 ? '' : 's') + ' failed:');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.83-A.1 tests passed');
