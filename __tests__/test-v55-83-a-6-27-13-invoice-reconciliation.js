// v55.83-A.6.27.13 — Invoice Reconciliation Architecture Test
//
// Locks in the FIX for the architectural display/recalc disagreement that
// surfaced as the "invoice 2330 shows collected=110,000 but recalc capped
// at 110,000 from a 247,500 pre-cap total" bug.
//
// CONTRACT BEING LOCKED:
//   1. There must exist a treasuryByInvoiceId map keyed by linked_invoice_id
//      (UUID) that contains the same row set the recalc uses.
//   2. The skip filters in that map must match recalcInvoiceCollected exactly
//      (dedup_sibling_id, '[bank confirmation' description).
//   3. The invoice-detail Treasury panel must read from treasuryByInvoiceId
//      (NOT from treasuryByOrder).
//   4. The payment-source breakdown must read from treasuryByInvoiceId too,
//      so the mix (Cash/Bank/Check) reconciles with Collected.
//   5. A findOrphanedOrderNumberMatches helper must surface rows that are
//      linked by string but not by UUID — these are the "broken link" rows
//      that previously inflated the recalc but stayed invisible to the user.
//   6. The orphan warning UI must offer a "Link Now" button that calls
//      dbUpdate + recalcInvoiceCollected + loadAllData.
//
// If any of these regress, this test fails and the build doesn't ship.

var fs = require('fs');
var path = require('path');

function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

// ── 1. UUID-keyed map exists with the right filters ───────────────
ok('1a: treasuryByInvoiceId useMemo exists',
  /const treasuryByInvoiceId = useMemo\(\(\) => \{/.test(page));
ok('1b: treasuryByInvoiceId keys by linked_invoice_id (UUID)',
  /treasuryByInvoiceId = useMemo[\s\S]{0,500}!t\.linked_invoice_id/.test(page));
ok('1c: treasuryByInvoiceId skips dedup_sibling_id (matches recalc)',
  /treasuryByInvoiceId = useMemo[\s\S]{0,800}if \(t\.dedup_sibling_id\) return/.test(page));
ok('1d: treasuryByInvoiceId skips [bank confirmation markers (matches recalc)',
  /treasuryByInvoiceId = useMemo[\s\S]{0,900}\[bank confirmation/.test(page));

// ── 2. Recalc uses the same skip filters as the map ───────────────
ok('2a: recalcInvoiceCollected skips dedup_sibling_id',
  /recalcInvoiceCollected[\s\S]{0,1500}if \(t\.dedup_sibling_id\) continue/.test(page));
ok('2b: recalcInvoiceCollected skips [bank confirmation markers',
  /recalcInvoiceCollected[\s\S]{0,1800}\[bank confirmation/.test(page));
ok('2c: recalcInvoiceCollected queries by linked_invoice_id UUID',
  /recalcInvoiceCollected[\s\S]{0,1200}\.eq\('linked_invoice_id', invoiceId\)/.test(page));

// ── 3. Orphan detector exists ─────────────────────────────────────
ok('3a: findOrphanedOrderNumberMatches helper exists',
  /const findOrphanedOrderNumberMatches = \(invoice\) => \{/.test(page));
ok('3b: helper returns rows with matching order_number but NOT in UUID map',
  /findOrphanedOrderNumberMatches[\s\S]{0,800}byUuidIds\[t\.id\]/.test(page));
ok('3c: helper skips dedup mirrors and confirm markers (same as recalc)',
  /findOrphanedOrderNumberMatches[\s\S]{0,1000}t\.dedup_sibling_id[\s\S]{0,400}\[bank confirmation/.test(page));

// ── 4. Invoice-detail Treasury panel uses UUID-keyed map ──────────
ok('4a: panel reads from treasuryByInvoiceId, not treasuryByOrder',
  /Treasury panel[\s\S]{0,1200}treasuryByInvoiceId\[selectedInvoice\.id\]/.test(page));
ok('4b: no remaining string-keyed lookups in selectedInvoice scope',
  // After A.6.27.13 there should be ZERO uses of
  // treasuryByOrder[selectedInvoice.order_number] inside invoice view.
  !/treasuryByOrder\[selectedInvoice\.order_number\]/.test(page));

// ── 5. Orphan warning UI ──────────────────────────────────────────
ok('5a: orphan warning banner appears when orphans exist',
  /Linkage drift detected/.test(page));
ok('5b: orphan list explains why money is not counted',
  /not properly linked to this invoice by ID[\s\S]{0,200}NOT counted/.test(page));
ok('5c: "Link Now" button calls dbUpdate + recalcInvoiceCollected + loadAllData',
  /dbUpdate\('treasury', t\.id, \{ linked_invoice_id: selectedInvoice\.id \}[\s\S]{0,200}recalcInvoiceCollected\(selectedInvoice\.id\)[\s\S]{0,200}loadAllData\(\)[\s\S]{0,400}Link Now/.test(page));
ok('5d: orphan row has an Inspect button too',
  /Linkage drift detected[\s\S]{0,2000}setInspectedTreasury\(t\)/.test(page));

// ── 6. Payment-source breakdown also UUID-keyed ───────────────────
ok('6a: payment source mix reads from treasuryByInvoiceId',
  /payment-source mix[\s\S]{0,500}treasuryByInvoiceId\[selectedInvoice\.id\]/.test(page));

// ── 7. Version stamp ──────────────────────────────────────────────
ok('7a: version stamp v55.83-A.6.27.13',
  /BUILD v55\.83-A\.6\.27\.1[34]/.test(page));

// ── 8. Money-trail data integrity invariants (no regression in math) ─
ok('8a: recalc still caps at total_amount (no over-100% collected)',
  /Cap at invoice total[\s\S]{0,1500}totalAll > totalAmt[\s\S]{0,500}cappedConfirmed = confirmed \* scale/.test(page));
ok('8b: recalc surfaces overpayment_amount when totalAll > totalAmt',
  /overpayment_amount: overpaymentAmount/.test(page));
ok('8c: recalc writes total_confirmed AND total_pending_bank separately',
  /total_confirmed: cappedConfirmed,\s*total_pending_bank: cappedPending/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.13 reconciliation architecture tests passed');
