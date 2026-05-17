// v55.83-A.6.27.14 — Financial Architecture Lock
//
// Locks the invariants that the financial linkage system must hold:
//   • The recalc is the SINGLE source of truth for invoice "collected"
//   • Egypt Bank match path creates/updates treasury rows; does not write
//     total_collected directly
//   • Check collection picks the right CHANNEL (bank vs cash) and does
//     NOT duplicate a treasury row that already represents the check
//   • UUID-keyed treasury map matches recalc filters
//   • Orphan detector won't steal rows linked to another invoice
//   • "Confirm and close pending checks" button exists on a paid invoice
//
// If any of these regress, this test fails and the build doesn't ship.

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');
var ebt = read('src/components/EgyptBankTab.jsx');
var supa = read('src/lib/supabase.js');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

// ── 1. Architectural contract is documented ───────────────────────
ok('1a: supabase.js documents that all recalc MUST go through recalcInvoiceCollected',
  /All invoice recalculation MUST go through `recalcInvoiceCollected/.test(supa));

// ── 2. EgyptBankTab no longer writes total_collected directly ─────
ok('2a: EgyptBankTab.matchToInvoice does not write total_collected directly',
  !/await dbUpdate\('invoices', invoiceId, \{[\s\S]{0,80}total_collected:/.test(ebt));
ok('2b: EgyptBankTab.unmatch does not write total_collected directly',
  !/await dbUpdate\('invoices', inv\.id, \{ total_collected:/.test(ebt));
ok('2c: EgyptBankTab accepts recalcInvoiceCollected prop',
  /function EgyptBankTab\([^)]*recalcInvoiceCollected/.test(ebt));
ok('2d: EgyptBankTab.matchToInvoice calls recalcInvoiceCollected',
  /\/\/ Step 5: delegate to the canonical recalc[\s\S]{0,300}recalcInvoiceCollected\(invoiceId\)/.test(ebt));
ok('2e: EgyptBankTab.unmatch calls recalcInvoiceCollected',
  /const unmatch = async \(txnId\) => \{[\s\S]{0,3000}recalcInvoiceCollected\(invoiceId\)/.test(ebt));
ok('2f: EgyptBankTab.match prefers placeholder before creating new row',
  /look for an existing placeholder[\s\S]{0,500}is_bank_placeholder/.test(ebt));
ok('2g: EgyptBankTab.match prefers existing check-tied treasury row before creating new',
  /before creating a new treasury row[\s\S]{0,600}source_check_id[\s\S]{0,500}limit\(1\)/.test(ebt));
ok('2h: page.jsx passes recalcInvoiceCollected to EgyptBankTab',
  /<EgyptBankTab[\s\S]{0,400}recalcInvoiceCollected=\{recalcInvoiceCollected\}/.test(page));

// ── 3. Invoice-detail Egypt Bank link/unlink buttons delegate to recalc ──
ok('3a: invoice-detail Egypt Bank unlink uses recalcInvoiceCollected',
  /v55\.83-A\.6\.27\.14[\s\S]{0,800}recalcInvoiceCollected\(selectedInvoice\.id\)[\s\S]{0,800}unlink<\/button>/.test(page));
ok('3b: invoice-detail Egypt Bank link creates treasury row + recalc',
  /Bank deposit matched to invoice[\s\S]{0,800}recalcInvoiceCollected\(selectedInvoice\.id\)/.test(page));

// ── 4. Check collection: correct channel selection ───────────────
ok('4a: handleCollectCheck Case C: cash_in only when physicalReturned (cash swap)',
  /cash_in: physicalReturned \? checkAmt : 0[\s\S]{0,100}bank_in: physicalReturned \? 0 : checkAmt/.test(page));
ok('4b: auto-check-bank match uses bank_in (not cash_in)',
  /auto-matcher firing when an Egypt Bank statement entry[\s\S]{0,1500}cash_in: 0[\s\S]{0,200}bank_in: Number\(chk\.amount\)/.test(page));
ok('4c: auto-check-bank match stamps source_check_id',
  /transaction_date: collectionDate[\s\S]{0,500}source_check_id: chk\.id/.test(page));
ok('4d: auto-check-bank match stamps matched_bank_txn_id',
  /transaction_date: collectionDate[\s\S]{0,500}matched_bank_txn_id: bank\.id/.test(page));

// ── 5. UUID-keyed treasury map matches recalc filters ─────────────
ok('5a: treasuryByInvoiceId useMemo exists',
  /const treasuryByInvoiceId = useMemo/.test(page));
ok('5b: treasuryByInvoiceId skips dedup_sibling_id',
  /treasuryByInvoiceId = useMemo[\s\S]{0,800}if \(t\.dedup_sibling_id\) return/.test(page));
ok('5c: treasuryByInvoiceId skips [bank confirmation markers',
  /treasuryByInvoiceId = useMemo[\s\S]{0,900}\[bank confirmation/.test(page));

// ── 6. Orphan detector respects other-invoice ownership ───────────
ok('6a: orphan detector excludes rows already linked to a different invoice',
  /Already linked-by-UUID to a DIFFERENT invoice\?[\s\S]{0,400}t\.linked_invoice_id !== invoice\.id/.test(page));

// ── 7. Confirm-and-close-pending-checks button ────────────────────
ok('7a: paid invoice shows "Confirm and close pending checks" button when pending exist',
  /Confirm and close pending checks/.test(page));
ok('7b: close-pending-checks button is gated by outstanding=0',
  /!\(selectedInvoice\.outstanding > 0\) && \(\(\) => \{[\s\S]{0,500}status === 'pending'/.test(page));
ok('7c: close-pending-checks prefers linking to existing treasury row (no duplicate)',
  // The IIFE block starts with the comment, body contains the candidate match
  // logic, ends with the button text. Look for source_check_id stamping anywhere
  // inside.
  /Close pending checks[\s\S]{0,6000}source_check_id: chk\.id/.test(page));
ok('7d: close-pending-checks confirms with Max before flipping',
  /Close pending checks[\s\S]{0,2500}if \(!confirm\([\s\S]{0,5000}Confirm and close pending checks/.test(page));

// ── 8. recalc invariants unchanged (regression guard) ─────────────
ok('8a: recalc still caps at total_amount (no over-100% collected)',
  /Cap at invoice total[\s\S]{0,1500}totalAll > totalAmt[\s\S]{0,500}cappedConfirmed = confirmed \* scale/.test(page));
ok('8b: recalc surfaces overpayment_amount when totalAll > totalAmt',
  /overpayment_amount: overpaymentAmount/.test(page));
ok('8c: recalc skips dedup_sibling_id and [bank confirmation markers',
  /recalcInvoiceCollected[\s\S]{0,2000}if \(t\.dedup_sibling_id\) continue[\s\S]{0,200}\[bank confirmation/.test(page));

// ── 9. Version stamp ──────────────────────────────────────────────
ok('9a: version stamp v55.83-A.6.27.14',
  /BUILD v55\.83-A\.6\.27\.1[12345]/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.14 financial architecture tests passed');
