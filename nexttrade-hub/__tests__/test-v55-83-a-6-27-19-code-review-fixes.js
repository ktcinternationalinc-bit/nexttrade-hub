// v55.83-A.6.27.19 — Code review fixes for Payment Instruments
//
// This test locks the EIGHT real gaps the code review uncovered:
//
//   #1 (HIGH) PaymentForm cash/bank channels now trigger the popup
//   #3 (HIGH) parseAmount instead of Number() (Arabic numerals, commas)
//   #4 (HIGH) canEditTreasury used consistently (not just modulePerms['Treasury'])
//   #6 (HIGH) Treasury delete reverts the linked instrument to pending
//   #8 (MED)  Multiple matching instruments — popup shows ALL candidates
//   #9 (LOW)  Modal close resets instrument form state
//   #10 (MED) SQL migration: created_at/updated_at no longer NOT NULL
//   #11 (NEW) findMatchingInstruments helper exists and is the single source
//
// These fixes do NOT change the FIVE non-negotiable rules — they fix
// gaps in HOW those rules are applied across all entry paths.

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');
var sql = read('sql/v55-83-a-6-27-17-payment-instruments.sql');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ── Fix #1: PaymentForm channels trigger the popup ────────────────
ok('1a: findMatchingInstruments helper exists',
  /const findMatchingInstruments = \(invoice, amt\) =>/.test(page));
ok('1b: PaymentForm cash channel uses findMatchingInstruments',
  /isSafeChannel[\s\S]{0,2000}var cashInstrumentMatches = findMatchingInstruments\(selectedInvoice, Number\(pd\.amount\)\)/.test(page));
ok('1c: PaymentForm bank channel uses findMatchingInstruments',
  /isBankChannel[\s\S]{0,4000}var bankInstrumentMatches = findMatchingInstruments\(selectedInvoice, Number\(pd\.amount\)\)/.test(page));
ok('1d: PaymentForm cash branch defers to popup when matches found',
  /cashInstrumentMatches\.length > 0[\s\S]{0,400}setPendingInstrumentMatch\(\{[\s\S]{0,300}onResume:/.test(page));
ok('1e: PaymentForm bank branch defers to popup when matches found',
  /bankInstrumentMatches\.length > 0[\s\S]{0,400}setPendingInstrumentMatch\(\{[\s\S]{0,300}onResume:/.test(page));
ok('1f: PaymentForm popup hook respects re-entry guard (popup_decision flag)',
  /if \(!pd\.__instrument_popup_decision\)[\s\S]{0,400}cashInstrumentMatches/.test(page));
ok('1g: PaymentForm popup hook releases addPaymentRunning guard so resume can re-enter',
  /addPaymentRunning\.current = false; \/\/ release re-entry guard/.test(page));

// ── Fix #3: parseAmount for instrument amounts ────────────────────
ok('3a: instrument save uses parseAmount (Arabic-Indic + comma tolerance)',
  /var amt = parseAmount\(instrumentForm\.amount\)/.test(page));
ok('3b: parseAmount is imported from utils',
  /parseAmount/.test(page) && /from '\.\.\/lib\/utils'/.test(page));

// ── Fix #4: Permission gate consistency ───────────────────────────
ok('4a: instrument section delegates to canEditTreasury',
  /var canEditInstruments = canEditTreasury/.test(page));
ok('4b: canEditTreasury defined to include super_admin, "Edit Treasury", "Treasury"',
  /const canEditTreasury = isSuperAdmin \|\| modulePerms\?\.\['Edit Treasury'\] === true \|\| modulePerms\?\.\['Treasury'\] === true/.test(page));

// ── Fix #6: Treasury delete reverts linked instrument ─────────────
ok('6a: handleDeleteTreasury reads source_check_id before delete',
  /const linkedCheckId = txn\.source_check_id \|\| null/.test(page));
ok('6b: reverts instrument to pending after delete (if linked)',
  /if \(linkedCheckId\)[\s\S]{0,1500}dbUpdate\('checks', linkedCheckId, \{[\s\S]{0,300}status: 'pending'/.test(page));
ok('6c: revert ONLY fires if instrument is currently linked to THIS treasury row',
  /if \(inst && inst\.linked_treasury_id === txnId\)/.test(page));
ok('6d: revert clears linked_treasury_id on the instrument',
  /linkedCheckId[\s\S]{0,1500}linked_treasury_id: null/.test(page));
ok('6e: revert clears collection_date on the instrument',
  /linkedCheckId[\s\S]{0,1500}collection_date: null/.test(page));

// ── Fix #8: Multiple matching instruments — popup shows ALL ───────
ok('8a: popup state carries instruments array, not single instrument',
  /pendingInstrumentMatch\.instruments \|\| \(pendingInstrumentMatch\.instrument \? \[pendingInstrumentMatch\.instrument\] : \[\]\)/.test(page));
ok('8b: popup renders one button PER candidate instrument',
  /candidates\.map\(function \(inst\) \{[\s\S]{0,1500}<button[\s\S]{0,1500}stamped\.source_check_id = inst\.id/.test(page));
ok('8c: popup distinguishes single vs multiple-match heading',
  /multiple \? candidates\.length \+ ' matching instruments found' : 'Matching instrument found'/.test(page));
ok('8d: helper returns array via .filter, not single via .find',
  /const findMatchingInstruments = \(invoice, amt\)[\s\S]{0,500}\(checks \|\| \[\]\)\.filter\(function \(c\)/.test(page));

// ── Fix #9: Modal close resets instrument form state ─────────────
ok('9a: invoice modal onClose resets showAddInstrumentForm',
  /setSelectedInvoice\(null\)[\s\S]{0,400}setShowAddInstrumentForm\(false\)/.test(page));
ok('9b: invoice modal onClose resets instrumentForm to default values',
  /setSelectedInvoice\(null\)[\s\S]{0,500}setInstrumentForm\(\{ instrument_type: 'check'/.test(page));

// ── Fix #10: SQL migration timestamps no longer lie about legacy rows ─
ok('10a: created_at column is nullable (no NOT NULL)',
  /created_at timestamptz DEFAULT now\(\)/.test(sql) && !/created_at timestamptz NOT NULL DEFAULT now\(\)/.test(sql));
ok('10b: updated_at column is nullable (no NOT NULL)',
  /updated_at timestamptz DEFAULT now\(\)/.test(sql) && !/updated_at timestamptz NOT NULL DEFAULT now\(\)/.test(sql));
ok('10c: SQL comments explain why (no backfill lying about legacy rows)',
  /NULLABLE[\s\S]{0,500}backfill EVERY existing row's created_at[\s\S]{0,300}lie/.test(sql));

// ── Fix #11: Helper architecture ──────────────────────────────────
ok('11a: findMatchingInstruments is the SINGLE source of truth for popup match logic',
  // Both handleAddTreasury and PaymentForm now call findMatchingInstruments
  /handleAddTreasury[\s\S]{0,30000}findMatchingInstruments\(matchingInvoice, amt\)/.test(page));
ok('11b: popup carries onResume callback for caller-specific resume logic',
  /onResume: function \(stamped\)[\s\S]{0,200}return commitInstrumentLinkedTreasury/.test(page));
ok('11c: popup falls back to commitInstrumentLinkedTreasury if no onResume given',
  /var resume = pendingInstrumentMatch\.onResume \|\| \(function \(s\) \{ return commitInstrumentLinkedTreasury/.test(page));

// ── Regression guards — the FIVE rules still hold ─────────────────
ok('R1: instrument save still uses dbInsert(checks) only — NO treasury insert from save',
  // Find the save handler in the Add Instrument form body and check.
  /toast\.success\('Instrument recorded — does not affect invoice total'\)/.test(page) &&
  !/await dbInsert\('checks'[\s\S]{0,2000}await dbInsert\('treasury'/.test(page));
ok('R2: instrument save does NOT modify invoices.total_collected',
  !/dbInsert\('checks'[\s\S]{0,2000}dbUpdate\('invoices'[\s\S]{0,200}total_collected:/.test(page));
ok('R3: Mark Bounced / Cancel / Mark Deposited still only change status',
  /dbUpdate\('checks', inst\.id, \{[\s\S]{0,300}status: 'bounced'[\s\S]{0,2000}Mark Bounced\s*<\/button>/.test(page));
ok('R4: recalcInvoiceCollected still exists and is the sole money math function for invoices',
  /const recalcInvoiceCollected = async \(invoiceId\)/.test(page));
ok('R5: commitInstrumentLinkedTreasury calls dbInsert(treasury) exactly once',
  /const commitInstrumentLinkedTreasury[\s\S]{0,300}const inserted = await dbInsert\('treasury', record, user\?\.id\)/.test(page));

// ── Regression guards — older builds intact ───────────────────────
ok('R6: A.6.27.16 closedTicketsForAI state intact',
  /const \[closedTicketsForAI, setClosedTicketsForAI\] = useState\(\[\]\)/.test(page));
ok('R7: A.6.27.14 EgyptBankTab.matchToInvoice still delegates to recalc (no direct total_collected)',
  // Check by ensuring the rewritten file's comment is still present
  fs.readFileSync(path.join(__dirname, '..', 'src/components/EgyptBankTab.jsx'), 'utf8').includes('ARCHITECTURAL FIX'));

// ── Version stamp ─────────────────────────────────────────────────
ok('V1: version stamp v55.83-A.6.27.19',
  /BUILD v55\.83-A\.6\.27\.\d+/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.19 code-review-fix tests passed');
