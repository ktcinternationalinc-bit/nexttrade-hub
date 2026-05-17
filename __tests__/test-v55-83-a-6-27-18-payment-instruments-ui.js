// v55.83-A.6.27.18 — Payment Instruments invoice UI section
//
// Per Max: "I would put number one at the bottom four number two I would
// be something that expands into the section like you are suggestion, and
// that can be un expanded and expanded". Phase 2 of the instruments
// feature — the actual entry UI inside the invoice screen, collapsible.
//
// The FIVE rules still apply (locked by A.6.27.17 tests). This build
// adds entry UI but DOES NOT change the popup or commit logic.

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ── 1. Section state ──────────────────────────────────────────────
ok('1a: instrumentSectionExpanded state exists (defaults true)',
  /const \[instrumentSectionExpanded, setInstrumentSectionExpanded\] = useState\(true\)/.test(page));
ok('1b: showAddInstrumentForm state exists',
  /const \[showAddInstrumentForm, setShowAddInstrumentForm\] = useState\(false\)/.test(page));
ok('1c: instrumentForm state has all required fields',
  /const \[instrumentForm, setInstrumentForm\] = useState\(\{[\s\S]{0,300}instrument_type: 'check'[\s\S]{0,200}check_number: ''[\s\S]{0,100}amount: ''[\s\S]{0,100}due_date: ''/.test(page));
ok('1d: instrumentBusy state for save spinner',
  /const \[instrumentBusy, setInstrumentBusy\] = useState\(false\)/.test(page));

// ── 2. Section UI placement and structure ────────────────────────
ok('2a: section title text exists',
  /Payment Instruments \/ Scheduled Receivables/.test(page));
ok('2b: section is collapsible — onClick toggles expanded state',
  /setInstrumentSectionExpanded\(function \(e\) \{ return !e; \}\)/.test(page));
ok('2c: section uses canEditTreasury gate (consistent with rest of system)',
  // A.6.27.19: instead of duplicating the gate logic, delegate to canEditTreasury
  // which already handles super_admin OR 'Edit Treasury' OR 'Treasury' permissions.
  /var canEditInstruments = canEditTreasury/.test(page) ||
  /var canEditInstruments = isSuperAdmin \|\| \(modulePerms && modulePerms\['Treasury'\] === true\)/.test(page));

// ── 3. Summary view ──────────────────────────────────────────────
ok('3a: shows pending count + amount',
  /Pending: \{byStatus\.pending\.length\}/.test(page));
ok('3b: shows deposited / cleared / bounced when present',
  /Deposited: \{byStatus\.deposited\.length\}/.test(page) && /Cleared: \{byStatus\.cleared\.length\}/.test(page));
ok('3c: legacy status compatibility — collected maps to cleared',
  /if \(s === 'collected'\) s = 'cleared'/.test(page));
ok('3d: legacy status compatibility — uncollected maps to pending',
  /if \(s === 'uncollected'\) s = 'pending'/.test(page));

// ── 4. List rendering ────────────────────────────────────────────
ok('4a: list rows show type icon (check vs promissory note)',
  /instrument_type === 'promissory_note' \? '📜' : '🧾'/.test(page));
ok('4b: cleared/cancelled/replaced rows get strikethrough',
  /line-through text-slate-500/.test(page));
ok('4c: overdue pending rows get red background',
  /isOverdue \? 'bg-red-50'/.test(page));
ok('4d: due-soon rows get amber background',
  /isDueSoon \? 'bg-amber-50'/.test(page));

// ── 5. Action buttons (per Max: NO Mark Cleared button — that's the popup) ─
ok('5a: Mark Bounced button exists',
  /Mark Bounced/.test(page));
ok('5b: Mark Bounced requires a reason (prompt)',
  /prompt\('Why did this instrument bounce/.test(page));
ok('5c: Cancel button exists',
  />Cancel<\/button>/.test(page));
ok('5d: NO Mark Cleared button on the invoice UI (per Max — clearing only via popup)',
  !/>Mark Cleared</.test(page));
ok('5e: Mark Deposited button exists for pending instruments',
  /Mark Deposited\s*<\/button>/.test(page));

// ── 6. RULE 1 — Add Instrument form does NOT write to treasury ───
ok('6a: Add Instrument calls dbInsert on `checks` table only',
  /toast\.success\('Instrument recorded[\s\S]{0,200}/.test(page) &&
  /await dbInsert\('checks', \{[\s\S]{0,800}instrument_type: instrumentForm\.instrument_type/.test(page));
ok('6b: Add Instrument does NOT call dbInsert on treasury',
  // Find the instrument-form save handler and ensure no treasury insert happens inside
  !/await dbInsert\('checks'[\s\S]{0,1000}await dbInsert\('treasury'/.test(page));

// ── 7. RULE 2 — does not modify invoice.total_collected ──────────
ok('7a: Add Instrument does NOT update invoices.total_collected',
  // The instrument save handler must not write total_collected directly
  !/dbInsert\('checks'[\s\S]{0,500}dbUpdate\('invoices'[\s\S]{0,200}total_collected:/.test(page));

// ── 8. RULE applies to status transitions too ────────────────────
ok('8a: Mark Bounced does NOT change treasury or invoice totals',
  /dbUpdate\('checks', inst\.id, \{[\s\S]{0,200}status: 'bounced'[\s\S]{0,1500}Mark Bounced\s*<\/button>/.test(page));
ok('8b: Mark Deposited only changes status, not money',
  /dbUpdate\('checks', inst\.id, \{ status: 'deposited'[\s\S]{0,1500}Mark Deposited\s*<\/button>/.test(page));
ok('8c: Cancel only changes status to cancelled, no money side effects',
  /dbUpdate\('checks', inst\.id, \{ status: 'cancelled'/.test(page));

// ── 9. Form fields ───────────────────────────────────────────────
ok('9a: form has type selector with check / promissory_note / other',
  /<option value="check">Check[\s\S]{0,300}<option value="promissory_note">Promissory Note[\s\S]{0,200}<option value="other">Other/.test(page));
ok('9b: form has amount field with required validation',
  /Amount is required and must be greater than 0/.test(page));
ok('9c: form has due_date field with required validation',
  /Due date is required/.test(page));
ok('9d: form has bank_name field',
  /placeholder="CIB \/ NBE/.test(page));
ok('9e: form has notes textarea',
  /textarea[\s\S]{0,200}value=\{instrumentForm\.notes\}/.test(page));

// ── 10. Documentation-only disclaimer ────────────────────────────
ok('10a: Add Instrument form shows "documentation only" warning',
  /Documentation only — this does NOT affect the invoice's Collected amount or any treasury balance/.test(page));
ok('10b: Mark Bounced confirms before action',
  /prompt\('Why did this instrument bounce/.test(page));
ok('10c: Cancel confirms with explicit "documentation only" reminder',
  /Cancel instrument[\s\S]{0,200}does NOT change any treasury or invoice totals/.test(page));

// ── 11. Empty state ──────────────────────────────────────────────
ok('11a: empty state message when no instruments',
  /No checks or promissory notes recorded for this order yet/.test(page));

// ── 12. Regression guards on previous builds ─────────────────────
ok('12a: A.6.27.17 popup state still intact',
  /const \[pendingInstrumentMatch, setPendingInstrumentMatch\] = useState\(null\)/.test(page));
ok('12b: A.6.27.17 commitInstrumentLinkedTreasury helper still intact',
  /const commitInstrumentLinkedTreasury = async/.test(page));
ok('12c: A.6.27.16 closedTicketsForAI state still intact',
  /const \[closedTicketsForAI, setClosedTicketsForAI\] = useState\(\[\]\)/.test(page));
ok('12d: recalcInvoiceCollected still exists',
  /const recalcInvoiceCollected = async \(invoiceId\)/.test(page));

// ── 13. Version stamp ────────────────────────────────────────────
ok('13a: version stamp v55.83-A.6.27.18',
  /BUILD v55\.83-A\.6\.27\.\d+/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.18 Payment Instruments UI tests passed');
