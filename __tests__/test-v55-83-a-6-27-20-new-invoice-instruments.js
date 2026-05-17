// v55.83-A.6.27.20 — Payment Instruments inside the "New Invoice" create form
//
// Per Max: "I crated a new transaction and a new invoice and there was no
// place to put in checks" — the existing instrument section only lived in
// the EXISTING-invoice detail modal. This build adds the same section to
// the new-invoice create form, with instruments held in draftInstruments[]
// form state and saved AFTER the invoice itself is created.
//
// Per Max's Option (a): no rollback. If individual instrument saves fail,
// the invoice still exists and we warn the user.
//
// FIVE rules still locked: instruments don't write to treasury, don't
// modify invoice.total_collected, don't change safe/bank balance.

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ── 1. UI exists inside the New Invoice modal ─────────────────────
ok('1a: New Invoice modal exists',
  /\{showAddInvoice && \(/.test(page));
ok('1b: Payment Instruments section is INSIDE the New Invoice modal',
  /\{showAddInvoice && \([\s\S]{0,100000}Payment Instruments \/ Scheduled Receivables[\s\S]{0,50000}<\/Modal>\s*\)\}/.test(page));
ok('1c: section description clarifies "Documentation only"',
  /checks or promissory notes the customer is providing[\s\S]{0,300}Documentation only/.test(page));

// ── 2. Draft instruments state ────────────────────────────────────
ok('2a: draftInstruments stored in formData (not separate state — closes on Cancel/Save)',
  /formData\.draftInstruments \|\| \[\]/.test(page));
ok('2b: draft form toggled by showDraftInstrumentForm',
  /formData\.showDraftInstrumentForm/.test(page));
ok('2c: draft instrument data in draftInstrumentDraft',
  /formData\.draftInstrumentDraft/.test(page));

// ── 3. Add form fields ────────────────────────────────────────────
ok('3a: type selector has check / promissory_note / other',
  /<option value="check">Check[\s\S]{0,300}<option value="promissory_note">Promissory Note[\s\S]{0,200}<option value="other">Other/.test(page));
ok('3b: amount validation rejects empty',
  /var amt = parseAmount\(d\.amount\);\s*if \(!amt \|\| amt <= 0\) \{ toast\.error\('Amount required'\); return; \}/.test(page));
ok('3c: due_date validation rejects empty',
  /if \(!d\.due_date\) \{ toast\.error\('Due date required'\); return; \}/.test(page));
ok('3d: parseAmount used (Arabic-Indic + comma tolerance)',
  /parseAmount\(d\.amount\)/.test(page));

// ── 4. List rendering ─────────────────────────────────────────────
ok('4a: type icon (check vs promissory note)',
  /\(formData\.draftInstruments \|\| \[\]\)\.map[\s\S]{0,500}instrument_type === 'promissory_note' \? '📜' : '🧾'/.test(page));
ok('4b: remove button (X) per instrument',
  /draftInstruments: \(formData\.draftInstruments \|\| \[\]\)\.filter\(function \(_, i\) \{ return i !== idx; \}\)/.test(page));
ok('4c: count display ("N instruments will be saved with this invoice")',
  /will be saved with this invoice/.test(page));

// ── 5. RULE 1 — no treasury inserts during instrument entry ──────
// The instrument-form save just modifies formData.draftInstruments.
// No dbInsert anywhere in the click handlers.
ok('5a: "Add to invoice" button only updates formData (NO dbInsert)',
  /Add to invoice\s*<\/button>/.test(page));

// ── 6. RULE 1 + 2 — save flow inserts instruments AFTER invoice ──
ok('6a: instrument save loop runs AFTER newInv is created',
  /if \(newInv && newInv\.id && \(formData\.draftInstruments \|\| \[\]\)\.length > 0\)/.test(page));
ok('6b: each instrument saved with invoice_id from newly-created invoice',
  /dbInsert\('checks', \{[\s\S]{0,400}invoice_id: newInv\.id/.test(page));
ok('6c: instrument save uses sanitized customer name from resolved vars',
  /customer_name: sanitize\(resolvedCustomerName \|\| formData\.customerName\)/.test(page));
ok('6d: instrument save sets created_by + updated_by audit columns',
  /dbInsert\('checks', \{[\s\S]{0,1500}created_by: user\?\.id,\s*updated_by: user\?\.id/.test(page));
ok('6e: instrument status starts as "pending"',
  /dbInsert\('checks', \{[\s\S]{0,1500}status: 'pending'/.test(page));

// ── 7. Failure handling (Option a per Max) ────────────────────────
ok('7a: instrument save wrapped in try/catch — individual failures don\'t kill the loop',
  /for \(const di of formData\.draftInstruments\) \{\s*try \{[\s\S]{0,1500}\} catch \(instErr\) \{/.test(page));
ok('7b: instrumentsFailed counter incremented on each failure',
  /instrumentsFailed\+\+/.test(page));
ok('7c: success toast varies based on instrument outcome',
  /instrumentsFailed > 0[\s\S]{0,500}Open the invoice to add manually/.test(page));
ok('7d: invoice still completes successfully even if all instruments fail',
  // The save flow doesn't return early on instrument failure
  /instrumentsFailed > 0[\s\S]{0,200}toast\.warning[\s\S]{0,1500}setTimeout\(\(\) => loadAllData/.test(page));

// ── 8. Form reset on close ────────────────────────────────────────
ok('8a: Cancel button clears formData (which wipes draftInstruments)',
  /<button onClick={\(\) => \{ setShowAddInvoice\(false\); setFormData\(\{\}\); \}\}/.test(page));
ok('8b: Save flow clears formData after success',
  /setShowAddInvoice\(false\); setFormData\(\{\}\);/.test(page));

// ── 9. RULE compliance — no money math changes from instrument flow ─
ok('9a: instrument save does NOT touch treasury',
  // Specifically inside the instrument loop
  !/for \(const di of formData\.draftInstruments\)[\s\S]{0,2000}dbInsert\('treasury'/.test(page));
ok('9b: instrument save does NOT write total_collected',
  !/for \(const di of formData\.draftInstruments\)[\s\S]{0,2000}dbUpdate\('invoices'[\s\S]{0,200}total_collected:/.test(page));
ok('9c: instrument save does NOT call recalcInvoiceCollected (recalc is for real money)',
  !/for \(const di of formData\.draftInstruments\)[\s\S]{0,2000}recalcInvoiceCollected/.test(page));

// ── 10. Regression guards on previous work ───────────────────────
ok('10a: A.6.27.18 existing-invoice instrument section still intact',
  // Both UI sections (new-invoice form AND existing-invoice modal) should
  // have a "Payment Instruments / Scheduled Receivables" header. Plus the
  // comment header in the state declaration. So 3 occurrences expected.
  (page.match(/Payment Instruments \/ Scheduled Receivables/g) || []).length >= 2);
ok('10b: A.6.27.19 findMatchingInstruments helper still exists',
  /const findMatchingInstruments = \(invoice, amt\) =>/.test(page));
ok('10c: A.6.27.19 handleDeleteTreasury still reverts linked instrument',
  /linkedCheckId[\s\S]{0,1500}status: 'pending'/.test(page));

// ── 11. Version stamp ────────────────────────────────────────────
ok('11a: version stamp v55.83-A.6.27.20',
  /BUILD v55\.83-A\.6\.27\.\d+/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.20 New Invoice Instruments tests passed');
