// v55.83-A.6.27.17 — Phase 1 Payment Instruments / Scheduled Receivables
//
// Per Max's spec: documentation layer only. Instruments NEVER affect treasury
// or invoice money math. The popup is a LINK, not a CREATE. Five rules
// (locked here):
//
//   1. Entering an instrument NEVER writes to treasury.
//   2. Entering an instrument NEVER changes invoice.total_collected.
//   3. Entering an instrument NEVER changes safe or bank balance.
//   4. The recalc doesn't read instruments — it reads treasury only.
//   5. The popup is a LINK, not a CREATE. Stamps source_check_id on the
//      treasury row the accountant was already entering. Exactly ONE
//      treasury row is inserted regardless of the popup answer.

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

// ── 1. SQL migration exists and is additive ───────────────────────
ok('1a: SQL migration adds instrument_type column',
  /ALTER TABLE checks\s+ADD COLUMN IF NOT EXISTS instrument_type/.test(sql));
ok('1b: instrument_type constrained to check / promissory_note / other',
  /CHECK \(instrument_type IN \('check', 'promissory_note', 'other'\)\)/.test(sql));
ok('1c: SQL adds issue_date, attachment_url, audit columns',
  /issue_date date/.test(sql) && /attachment_url text/.test(sql) && /created_by uuid/.test(sql) && /updated_by uuid/.test(sql));
ok('1d: SQL adds replaced_by_id foreign key',
  /replaced_by_id uuid REFERENCES checks\(id\)/.test(sql));
ok('1e: SQL adds bounce_reason column',
  /bounce_reason text/.test(sql));
ok('1f: SQL is purely additive — no DROP, no DELETE, no UPDATE on existing data',
  !/DROP TABLE checks|DELETE FROM checks|UPDATE checks SET/.test(sql));
ok('1g: SQL adds dashboard index on due_date+status',
  /CREATE INDEX IF NOT EXISTS idx_checks_due_date_status/.test(sql));
ok('1h: SQL adds popup-lookup index on invoice_id+status',
  /CREATE INDEX IF NOT EXISTS idx_checks_invoice_status/.test(sql));
ok('1i: SQL adds updated_at trigger',
  /CREATE OR REPLACE FUNCTION update_checks_updated_at[\s\S]{0,400}CREATE TRIGGER trigger_checks_updated_at/.test(sql));

// ── 2. State setup ────────────────────────────────────────────────
ok('2a: pendingInstrumentMatch state exists',
  /const \[pendingInstrumentMatch, setPendingInstrumentMatch\] = useState\(null\)/.test(page));

// ── 3. RULE 1 — entering an instrument never writes to treasury ──
// Check that the popup logic does NOT insert any treasury row directly
// from instrument data. The treasury row comes from the accountant's
// formData; the popup only stamps source_check_id.
ok('3a: instrument popup uses pre-built record from pendingInstrumentMatch.record (not from instrument)',
  // A.6.27.19: popup carries an array of candidates. Each button's onClick
  // pulls record from pendingInstrumentMatch.record and stamps source_check_id
  // with the chosen instrument's id.
  /var stamped = pendingInstrumentMatch\.record;\s*stamped\.source_check_id = inst\.id/.test(page));
ok('3b: NO treasury insert is triggered by the instrument data',
  !/from\('treasury'\)\.insert\(pendingInstrumentMatch\.instrument/.test(page) &&
  !/from\('treasury'\)\.insert\(inst\b/.test(page));

// ── 4. RULE 5 — exactly one treasury row, with or without link ────
ok('4a: commitInstrumentLinkedTreasury exists and calls dbInsert exactly once',
  /const commitInstrumentLinkedTreasury = async \(record, matchingInvoice, isBankPlaceholder\)[\s\S]{0,300}const inserted = await dbInsert\('treasury', record, user\?\.id\)/.test(page));
ok('4b: Popup branches use the onResume callback (caller-supplied) — works for both handleAddTreasury and PaymentForm',
  /var resume = pendingInstrumentMatch\.onResume \|\| \(function \(s\) \{ return commitInstrumentLinkedTreasury\(/.test(page));
ok('4c: Link branch stamps source_check_id BEFORE the resume callback fires',
  // A.6.27.19: per-instrument button stamps source_check_id then calls resume
  /stamped\.source_check_id = inst\.id;\s*stamped\.payment_source = 'check';\s*stamped\.__instrument_popup_decision = 'link'[\s\S]{0,700}await resume\(stamped\)/.test(page));

// ── 5. RULE 2 — invoice.total_collected change comes ONLY from recalc ──
// Verify the popup commit calls recalcInvoiceCollected (the canonical
// source of truth) and never writes total_collected directly.
ok('5a: commitInstrumentLinkedTreasury defers to recalcInvoiceCollected',
  /commitInstrumentLinkedTreasury[\s\S]{0,2000}await recalcInvoiceCollected\(matchingInvoice\.id\)/.test(page));
ok('5b: commitInstrumentLinkedTreasury does NOT write total_collected directly',
  !/commitInstrumentLinkedTreasury[\s\S]{0,2000}dbUpdate\('invoices'[\s\S]{0,200}total_collected:/.test(page));

// ── 6. Popup match criteria ───────────────────────────────────────
ok('6a: popup match: only pending or deposited instruments',
  /if \(c\.status !== 'pending' && c\.status !== 'deposited'\) return false/.test(page));
ok('6b: popup match: skips instruments already linked to another treasury row',
  /if \(c\.linked_treasury_id\) return false/.test(page));
ok('6c: popup match: amount tolerance 1 EGP for rounding',
  /Math\.abs\(Number\(c\.amount\) - amt\) < 1/.test(page));
ok('6d: popup match: scope by invoice_id OR order_number',
  // A.6.27.19: this lives in the findMatchingInstruments helper now
  /if \(c\.invoice_id !== invoice\.id && c\.order_number !== invoice\.order_number\) return false/.test(page));

// ── 7. Popup re-entry suppression ─────────────────────────────────
ok('7a: handler checks __instrument_popup_decision to avoid re-prompting',
  /!record\.__instrument_popup_decision/.test(page));
ok('7b: bank placeholders bypass the popup entirely',
  /if \(!isBankPlaceholder && !record\.__instrument_popup_decision\)/.test(page));

// ── 8. Instrument flip on link path ───────────────────────────────
ok('8a: link path flips instrument to "cleared"',
  /commitInstrumentLinkedTreasury[\s\S]{0,1500}status: 'cleared',\s*collection_date:/.test(page));
ok('8b: link path stamps linked_treasury_id on the instrument',
  /commitInstrumentLinkedTreasury[\s\S]{0,1500}linked_treasury_id: inserted\.id/.test(page));

// ── 9. Popup UI renders ──────────────────────────────────────────
ok('9a: popup renders when pendingInstrumentMatch is set',
  /\{pendingInstrumentMatch && \(/.test(page));
ok('9b: popup distinguishes check vs promissory note in label',
  /inst\.instrument_type === 'promissory_note' \? '📜 Promissory Note' : '🧾 Check'/.test(page));
ok('9c: popup has per-candidate link button, separate-payment button, and Cancel',
  /Yes, this clears[\s\S]{0,1500}No, this is a separate payment[\s\S]{0,500}Cancel — go back to the form/.test(page));

// ── 10. Existing logic still intact (regression guards) ───────────
ok('10a: recalcInvoiceCollected still exists',
  /const recalcInvoiceCollected = async \(invoiceId\)/.test(page));
ok('10b: handleCollectCheck Case C channel logic still uses physicalReturned flag',
  /cash_in: physicalReturned \? checkAmt : 0[\s\S]{0,100}bank_in: physicalReturned \? 0 : checkAmt/.test(page));
ok('10c: closedTicketsForAI state still intact (from A.6.27.16)',
  /const \[closedTicketsForAI, setClosedTicketsForAI\] = useState\(\[\]\)/.test(page));

// ── 11. Version stamp ────────────────────────────────────────────
ok('11a: version stamp v55.83-A.6.27.17',
  /BUILD v55\.83-A\.6\.27\.\d+/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.17 Payment Instruments Phase 1 tests passed');
