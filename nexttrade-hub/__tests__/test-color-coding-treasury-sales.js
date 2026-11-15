// ============================================================
// Session 12 (Apr 22 2026) — Color coding for Treasury + Sales
//
// Purpose: make money flows visible at a glance — green for incoming,
// red for outgoing, gradients for partials, progress bars for percentages.
// No data logic changes; UI-only. These tests assert the visual contract
// stays in place across future edits.
// ============================================================

var fs = require('fs');
var path = require('path');
var assert = require('assert');
var REPO = path.resolve(__dirname, '..');

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('✓ ' + name); passed++; }
  catch (e) { console.log('✗ ' + name + ' — ' + e.message); failed++; }
}

var page = fs.readFileSync(path.join(REPO, 'src/app/page.jsx'), 'utf8');

// ===== TREASURY SUMMARY CARDS =====
test('S12.T1 Treasury Cash In card uses emerald gradient', function() {
  // S17: switched to DARK emerald (#064e3b → #065f46) for high contrast
  assert(/setTreasuryDrill\('in'\)[\s\S]{0,600}linear-gradient\(135deg, #064e3b 0%, #065f46 100%\)/.test(page),
    'Cash In card must have dark emerald gradient background (S17 upgrade)');
});

test('S12.T2 Treasury Cash Out card uses red gradient', function() {
  // S17: switched to DARK red (#7f1d1d → #991b1b) for high contrast
  assert(/setTreasuryDrill\('out'\)[\s\S]{0,600}linear-gradient\(135deg, #7f1d1d 0%, #991b1b 100%\)/.test(page),
    'Cash Out card must have dark red gradient background (S17 upgrade)');
});

test('S12.T3 Treasury Net card flips color when going negative', function() {
  // S17: new dark blue/amber palette
  assert(/border: '2px solid ' \+ \(totalCashIn >= totalCashOut \? '#3b82f6' : '#f59e0b'\)/.test(page),
    'Net card border must compare in vs out to pick blue (positive) or amber (negative)');
  assert(/linear-gradient\(135deg, #1e3a8a 0%, #1e40af 100%\)/.test(page),
    'Positive net uses dark blue gradient');
  assert(/linear-gradient\(135deg, #78350f 0%, #92400e 100%\)/.test(page),
    'Negative/breakeven net uses dark amber gradient as a warning');
});

test('S12.T4 Treasury cards have hover-scale animation', function() {
  assert(/hover:scale-\[1\.02\]/.test(page),
    'cards should subtly grow on hover so they feel interactive');
});

test('S12.T5 Treasury Net card has progress bar for visual ratio', function() {
  assert(/\(totalCashIn - totalCashOut\) \/ totalCashIn \* 100/.test(page),
    'Net card must have a progress bar showing net as % of cash_in');
});

// ===== SALES SUMMARY CARDS =====
test('S12.S1 Sales Invoiced card uses sky-blue gradient', function() {
  // S17: Sales cards redesigned — Invoiced now uses dark sky #0c4a6e → #075985
  // The label emoji was moved into a separate span from the text.
  // v55.83-A.6.27.66 (C1): label is now "Invoiced{totalsAreMixedCurrency ? ' (mixed)' : ''}"
  // when multi-currency invoices are filtered, so accept either literal.
  assert(/Invoiced\{totalsAreMixedCurrency.*\}<\/div>/.test(page) || /Invoiced<\/div>/.test(page),
    'Invoiced label must still exist in the Sales cards');
  assert(/linear-gradient\(135deg, #0c4a6e 0%, #075985 100%\)/.test(page),
    'dark sky-blue gradient must be present on Invoiced card (S17 upgrade)');
});

test('S12.S2 Sales Collected card has progress bar showing collection rate', function() {
  assert(/totalCollected \/ totalInvoiced \* 100/.test(page),
    'Collected card must show progress bar of collected / invoiced');
});

test('S12.S3 Sales Outstanding card has progress bar showing outstanding rate', function() {
  assert(/totalOutstanding \/ totalInvoiced \* 100/.test(page),
    'Outstanding card must show progress bar of outstanding / invoiced');
});

test('S12.S4 Sales summary cards all have hover effects matching Treasury', function() {
  var matches = page.match(/hover:scale-\[1\.02\]/g) || [];
  assert(matches.length >= 6,
    'expected at least 6 hover-scale cards (3 Treasury + 3 Sales), found ' + matches.length);
});

// ===== INVOICE TABLE ROWS =====
test('S12.I1 Invoice rows have status-colored left border', function() {
  // Look for the borderLeft style in the InvoiceTable component
  var match = page.match(/const InvoiceTable[\s\S]*?const data\.map\(inv =>/) ||
              page.match(/const InvoiceTable = [\s\S]*?{data\.map\(inv =>/);
  // Check for the pattern in the broader InvoiceTable area
  assert(/borderLeft: '4px solid ' \+ rowBorderColor/.test(page),
    'invoice rows must have a 4px left border color matching their status');
});

test('S12.I2 borderColors map covers all five recon statuses', function() {
  // Required mapping
  ['reconciled', 'open', 'unverified', 'mismatch', 'overpaid'].forEach(function(status) {
    var rx = new RegExp(status + ":\\s*'#[0-9a-fA-F]{6}'");
    assert(rx.test(page), 'borderColors must include color for status: ' + status);
  });
});

test('S12.I3 Paid amount color shifts based on payment percentage', function() {
  // paidColor logic: gray when 0, brighter green when >= 100%, soft green otherwise
  assert(/paidAmt === 0 \? '#94a3b8'/.test(page),
    'unpaid invoices show gray, not green');
  assert(/paidPct >= 100 \? '#059669' : '#34d399'/.test(page),
    'fully paid uses brighter green than partial');
});

test('S12.I4 Owed amount color intensifies as amount increases', function() {
  // owedColor: green when 0, dark red when most unpaid, lighter red as more paid
  assert(/owedAmt === 0 \? '#10b981'/.test(page),
    'fully reconciled (0 owed) shows green');
  assert(/paidPct < 25 \? '#dc2626'/.test(page),
    'high outstanding uses deeper red');
  assert(/paidPct < 75 \? '#f87171' : '#fb923c'/.test(page),
    'medium outstanding uses softer red shades');
});

test('S12.I5 Each row has a payment progress bar under Paid column', function() {
  // The bar uses paidPct and the same paidColor
  assert(/width: paidPct \+ '%', background: paidColor/.test(page),
    'invoice rows must include a progress bar showing paidPct');
});

test('S12.I6 paidPct calculation handles zero invoice amount safely', function() {
  // No NaN or Infinity when invoice total is 0
  assert(/var paidPct = invAmt > 0 \? Math\.min\(100, Math\.round\(\(paidAmt \/ invAmt\) \* 100\)\) : \(paidAmt > 0 \? 100 : 0\)/.test(page),
    'paidPct must avoid divide-by-zero on invoices with no total');
});

// ===== NO REGRESSIONS =====
test('S12.R1 No template literals introduced (SWC-safe)', function() {
  // S12 changes added new code — make sure none used backticks (which break Vercel SWC compile)
  // Count backticks in just the modified InvoiceTable section
  var invSection = page.match(/const InvoiceTable[\s\S]*?const \w+ = [\s\S]*?\}\)\;\s*\}\;/);
  if (invSection) {
    var bt = (invSection[0].match(/`/g) || []).length;
    assert(bt === 0, 'InvoiceTable section must use string concatenation, not template literals (found ' + bt + ' backticks)');
  }
});

test('S12.R2 InvoiceTable still calls onSelect when row clicked', function() {
  assert(/onClick=\{\(\) => onSelect\(inv\)\}/.test(page),
    'invoice rows must remain clickable for drill-down');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
