// v55.83-A.6.7 (Max May 13 2026) — Treasury + Sales comprehensive audit fixes.
//
// Covers:
//   CRIT-0: Schema/code resilience — dbInsert handles missing columns (already tested)
//   CRIT-1: Auto-link treasury rows to invoice by order_number on insert
//   CRIT-2: total_collected vs confirmed+pending — backfill SQL is the fix, no code test
//   CRIT-3: Instapay/Vodafone not flagged as pending (depends on cash_method, no code change)
//   CRIT-4: Overpayment surfaces overpayment_amount, doesn't silently cap
//   CRIT-5: tTotalForInvoice excludes source_check_id-stamped treasury rows
//   CRIT-6: Bank match recalc retries on failure

var fs = require('fs');
var path = require('path');
var page = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'page.jsx'), 'utf8');
var sup = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'supabase.js'), 'utf8');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

// CRIT-1: Auto-link treasury rows on insert
ok('CRIT-1a: dbInsert resolves treasury order_number → linked_invoice_id',
  /table === 'treasury'[\s\S]{0,300}attemptRecord\.order_number[\s\S]{0,200}!attemptRecord\.linked_invoice_id/.test(sup));
ok('CRIT-1b: lookup queries invoices by order_number',
  /supabase\.from\('invoices'\)\s*\.select\('id'\)\s*\.eq\('order_number'/.test(sup));
ok('CRIT-1c: linked_invoice_id assigned when invoice found',
  /lookup\.data\.id[\s\S]{0,200}linked_invoice_id: lookup\.data\.id/.test(sup));
ok('CRIT-1d: lookup failure does not block insert (defensive try/catch)',
  /try \{\s*var lookup[\s\S]{0,800}catch \(lookupErr\)/.test(sup));

// CRIT-4: Overpayment tracked, not silently capped
ok('CRIT-4a: overpaymentAmount tracked when totalAll > totalAmt',
  /overpaymentAmount = totalAll - totalAmt/.test(page));
ok('CRIT-4b: dbUpdate writes overpayment_amount field',
  /total_pending_bank: cappedPending,\s*overpayment_amount: overpaymentAmount/.test(page));
ok('CRIT-4c: invoice modal surfaces overpayment_amount warning',
  /selectedInvoice\.overpayment_amount[\s\S]{0,400}review for duplicate payments/.test(page));

// CRIT-5: tTotalForInvoice excludes source_check_id-stamped rows
ok('CRIT-5a: tTotalForInvoice skips treasury rows with source_check_id',
  /tTotalForInvoice[\s\S]{0,400}if \(t\.source_check_id\) return a/.test(page));
ok('CRIT-5b: docstring/comment explains shadow-row exclusion',
  /CRIT-5[\s\S]{0,400}shadow[\s\S]{0,400}source of truth/.test(page));

// CRIT-6: Auto-match retries recalc on failure
ok('CRIT-6a: auto-match recalc has retry-once pattern',
  /CRIT-6[\s\S]{0,800}recalc attempt 1 failed[\s\S]{0,600}recalc retry failed/.test(page));
ok('CRIT-6b: retry has 750ms delay between attempts',
  /setTimeout\(r, 750\)/.test(page));

// Round 2 audit findings
ok('R2-1: auto-match check collection resolves invoice from order_number',
  /resolvedInvoiceId = chk\.invoice_id \|\| null;\s*if \(!resolvedInvoiceId && chk\.order_number\)/.test(page));
ok('R2-2: manual check reconcile resolves invoice from order_number',
  /resolvedInv2 = evalResult\.invoice \?[\s\S]{0,300}if \(!resolvedInv2 && reconcileCheck\.order_number\)/.test(page));
ok('R2-3: recalc fires whichever invoice ended up linked (eval or fallback)',
  /if \(evalResult\.invoice\) await recalcInvoiceCollected\(evalResult\.invoice\.id\);\s*else if \(resolvedInv2\) await recalcInvoiceCollected\(resolvedInv2\)/.test(page));
ok('R2-4: outstanding has 0.50 EGP rounding tolerance (HIGH-1)',
  // v55.83-A.6.8 — outstanding logic became write-off-aware. Either form
  // is acceptable as long as the 0.50 tolerance is applied somewhere.
  /Math\.abs\(totalAmt - capped\) < 0\.50/.test(page) ||
  /Math\.abs\(remainder\) < 0\.50/.test(page));

// Existing 176-test baseline still intact (smoke check)
ok('Baseline: routeHistory case-insensitive (from A.6.2) still present',
  /norm\(r\.origin\) !== routeOrigin/.test(require('fs').readFileSync(path.join(__dirname, '..', 'src', 'components', 'ShippingRatesTab.jsx'), 'utf8')));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.7 CRIT-fix tests passed');
