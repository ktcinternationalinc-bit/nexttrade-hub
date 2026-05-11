// ============================================================
// Session 15 (Apr 22 2026) — UI consistency + Check uncollect + Context-aware screens
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
var ticketsTab = fs.readFileSync(path.join(REPO, 'src/components/TicketsTab.jsx'), 'utf8');
var greeter = fs.readFileSync(path.join(REPO, 'src/components/AIGreeter.jsx'), 'utf8');

// ===== PART 1: DASHBOARD EMPTY SPACE FIX =====

test('S15.D1 Empty space above Nadia removed (pt-12 mt-8 gone)', function() {
  // The old wrapper had "mb-4 pt-12 mt-8" which added ~80px of dead space.
  // New version should have just "mb-4".
  assert(!/mb-4 pt-12 mt-8/.test(page),
    'old "mb-4 pt-12 mt-8" must be removed — was adding ~80px dead space above Nadia');
});

test('S15.D2 S17.5: dashboard AIGreeter restored + overlay on other tabs', function() {
  // S16 had moved Nadia to overlay-only (broke dashboard home). S17.5
  // restored her to the dashboard. Now BOTH exist: dashboard AIGreeter is
  // the primary home, overlay is for non-dashboard tabs.
  // v55.82-F: the overlay mount block now wraps in an IIFE to compute
  // suppressNadia (Treasury modal-open + Wake Nadia gating). The gate
  // is still `tab !== 'dashboard'`; allow either direct mount OR IIFE
  // wrapping with the same gate.
  assert(/<AIGreeter\s/.test(page),
    'dashboard AIGreeter must be present (primary home)');
  assert(/<NadiaFloatingOverlay\s/.test(page),
    'overlay must also be present (for non-dashboard tabs)');
  assert(/tab !== 'dashboard' && (\(\s*<NadiaFloatingOverlay|\(\(\) => \{)/.test(page),
    'overlay must be gated on tab !== dashboard to avoid double-mount');
});

// ===== PART 2: TICKETS TAB UI — MATCHES DASHBOARD =====

test('S15.T1 TicketsTab: title is larger and bolder (15px, font-bold)', function() {
  assert(/font-bold text-\[15px\] text-slate-900 leading-tight/.test(ticketsTab),
    'title must be 15px bold — matches dashboard visual language');
});

test('S15.T2 TicketsTab: ticket# becomes small monospace tag (not cramped beside title)', function() {
  assert(/text-\[10px\] font-mono font-bold text-slate-500 tracking-wider/.test(ticketsTab),
    'ticket number is now a small grey monospace tag in the info row, not a blue chip next to title');
});

test('S15.T3 TicketsTab: colored left border drives urgency', function() {
  // v55.82-D — closed tickets pick slate-grey #94a3b8, open tickets pick
  // priority's leftBorderColor. Accept either pattern.
  assert(/borderLeft: '4px solid ' \+ (leftBorderColor|\(t\.status === 'Closed' \? '#94a3b8' : leftBorderColor\))/.test(ticketsTab),
    'card must have 4px colored left border (priority color when open, slate when closed)');
  // S16 palette: due-today moved from amber (#f59e0b) to orange (#f97316)
  // to disambiguate from medium-priority yellow.
  assert(/leftBorderColor = isOverdue \? '#ef4444' : \(isDueToday \? '#f97316' : priColor\)/.test(ticketsTab),
    'leftBorderColor logic: overdue→red, dueToday→ORANGE (distinct from medium yellow), else→priority color');
});

test('S15.T4 TicketsTab: explicit N DAYS OVERDUE badge', function() {
  assert(/daysOverdue === 1 \? '1 DAY OVERDUE' : daysOverdue \+ ' DAYS OVERDUE'/.test(ticketsTab),
    'overdue label must spell out day count, pluralized');
  assert(!/'OVERDUE'/.test(ticketsTab) || /DAYS OVERDUE/.test(ticketsTab),
    'bare "OVERDUE" label should not exist without day count');
});

test('S15.T5 TicketsTab: DUE TODAY badge for today dates', function() {
  assert(/isDueToday = t\.due_date === todayStr/.test(ticketsTab),
    'isDueToday flag must be computed');
  assert(/DUE TODAY/.test(ticketsTab),
    'due-today label must be visible');
});

test('S15.T6 TicketsTab: status renders as bordered pill (matches dashboard)', function() {
  assert(/const statusPill = \{/.test(ticketsTab),
    'statusPill map must exist');
  assert(/border: '1px solid ' \+ sp\.border/.test(ticketsTab),
    'status pills have a border for clearer edges (matches dashboard)');
});

// ===== PART 3: DASHBOARD TITLE PROMINENCE =====

test('S15.D3 Dashboard ticket title bumped to 15px / weight 800', function() {
  assert(/fontSize: 15, fontWeight: 800, color: '#f1f5f9'/.test(page),
    'dashboard ticket title must be 15px fontWeight 800 — matches Tickets tab');
});

test('S15.D4 Dashboard card left border bumped to 4px', function() {
  assert(/borderLeft: '4px solid ' \+ leftBorderColor/.test(page),
    'dashboard card should use 4px left border (stronger separation)');
});

// ===== PART 4: CHECK UNCOLLECT LOGIC =====

test('S15.C1 handleUncollectCheck function is defined', function() {
  assert(/const handleUncollectCheck = async \(check, reason\) =>/.test(page),
    'handleUncollectCheck handler must be defined');
});

test('S15.C2 Uncollect refuses if check not currently collected', function() {
  // S22.7 — the new message includes current status for diagnostic clarity
  assert(/if \(check\.status !== 'collected'\)[\s\S]{0,300}Only collected checks can be uncollected/.test(page),
    'must reject if check is already pending');
});

test('S15.C3 Uncollect confirms with user before proceeding', function() {
  assert(/const confirmMsg = 'Reverse the collection of this check\?/.test(page),
    'must have a clear confirm message');
  // S22.7 — there's a console.log('[uncollect] user cancelled') between
  // the confirm() call and return now
  assert(/if \(!confirm\(confirmMsg\)\) \{[\s\S]{0,100}return;/.test(page),
    'must wait for user confirmation before proceeding');
});

test('S15.C4 Uncollect looks up treasury row by linked_treasury_id first', function() {
  assert(/if \(check\.linked_treasury_id\)[\s\S]{0,200}supabase\.from\('treasury'\)[\s\S]*?\.eq\('id', check\.linked_treasury_id\)/.test(page),
    'primary lookup: check.linked_treasury_id');
});

test('S15.C5 Uncollect falls back to source_check_id if no linked_treasury_id', function() {
  assert(/\.eq\('source_check_id', check\.id\)/.test(page),
    'fallback lookup: source_check_id = check.id');
});

test('S15.C6 Uncollect DELETES treasury row if it was created by the collect flow', function() {
  assert(/wasCreatedByCollect = treasuryRow\.source_check_id === check\.id/.test(page),
    'must detect whether this treasury row was created by collect flow');
  assert(/if \(wasCreatedByCollect\)[\s\S]{0,200}\.delete\(\)\.eq\('id', treasuryRow\.id\)/.test(page),
    'if created by collect, DELETE the treasury row (reverses double-count)');
});

test('S15.C7 Uncollect UNSTAMPS a pre-existing treasury row (does not delete)', function() {
  // The else branch should clear source_check_id + payment_source
  assert(/source_check_id: null,[\s\S]{0,100}payment_source: null/.test(page),
    'unstamp flow must clear both source_check_id and payment_source');
});

test('S15.C8 Uncollect unlinks matched bank transactions', function() {
  assert(/egypt_bank_transactions[\s\S]{0,200}matched_treasury_id: null[\s\S]{0,80}matched_at: null[\s\S]{0,80}matched_by: null/.test(page),
    'must clear matched_treasury_id, matched_at, matched_by on bank txns pointing at this treasury row');
});

test('S15.C9 Uncollect recalculates the invoice collected total', function() {
  // Grab the uncollect function body
  var m = page.match(/handleUncollectCheck = async \(check, reason\) =>[\s\S]*?\s\s\};/);
  assert(m, 'uncollect body found');
  assert(/recalcInvoiceCollected\(invoiceId\)/.test(m[0]),
    'uncollect must recalc the linked invoice');
});

test('S15.C10 Uncollect flips check back to pending + clears collection fields', function() {
  // S22.7 — the new code uses a baseChanges object + Object.assign instead
  // of a single inline object, so the regex matches the baseChanges literal
  assert(/const baseChanges = \{[\s\S]{0,300}status: 'pending',[\s\S]{0,100}collection_date: null,[\s\S]{0,100}linked_treasury_id: null/.test(page),
    'check must be set back to pending with nulled collection_date and linked_treasury_id');
  // New: also verify the fallback update happens when the full update fails
  assert(/retrying minimal/.test(page),
    'uncollect falls back to a minimal update if physical_check_returned column is missing');
});

test('S15.C11 Uncollect writes an audit trail to daily_log', function() {
  assert(/auditNote = 'Check uncollected by '/.test(page),
    'audit note must be built');
  assert(/daily_log[\s\S]{0,300}entry_text: auditNote/.test(page),
    'audit note must be inserted to daily_log');
});

test('S15.C12 Uncollect button shown ONLY to admins/super_admins on collected checks', function() {
  assert(/userProfile\?\.role === 'super_admin' \|\| userProfile\?\.role === 'admin'[\s\S]{0,500}handleUncollectCheck\(c\)/.test(page),
    'button must be gated to super_admin or admin');
  assert(/title="Uncollect/.test(page),
    'button must have a title for hover tooltip');
});

// ===== PART 5: CONTEXT-AWARE SCREENS =====

test('S15.X1 AIGreeter accepts context props', function() {
  assert(/contextTab, contextSelectedCustomer, contextSelectedInvoice, contextOpenTicketId/.test(greeter),
    'AIGreeter must destructure the 4 context props');
});

test('S15.X2 page.jsx passes context props to AIGreeter', function() {
  assert(/contextTab=\{tab\}/.test(page),
    'must pass tab as contextTab');
  assert(/contextSelectedCustomer=\{selectedCustomer\}/.test(page),
    'must pass selectedCustomer');
  assert(/contextSelectedInvoice=\{selectedInvoice\}/.test(page),
    'must pass selectedInvoice');
  assert(/contextOpenTicketId=\{openTicketId\}/.test(page),
    'must pass openTicketId');
});

test('S15.X3 buildContext injects CURRENT SCREEN CONTEXT block when tab known', function() {
  assert(/===== CURRENT SCREEN CONTEXT =====/.test(greeter),
    'screen-context block label must exist');
  assert(/if \(contextTab\) \{/.test(greeter),
    'block must be gated on contextTab');
});

test('S15.X4 Customer context pulls their invoices for Nadia', function() {
  assert(/custInvoices = \(invoices \|\| \[\]\)\.filter/.test(greeter),
    'must compute the customer\'s invoices');
  assert(/custOutstanding = custInvoices\.reduce/.test(greeter),
    'must compute outstanding for selected customer');
  assert(/Lifetime collected/.test(greeter),
    'must surface lifetime collected in context');
});

test('S15.X5 Invoice context exposes full money state to Nadia', function() {
  // total_amount, total_collected, outstanding, date
  ['total_amount', 'total_collected', 'outstanding', 'invoice_date'].forEach(function(f) {
    assert(greeter.indexOf(f) >= 0, 'invoice context must include ' + f);
  });
});

test('S15.X6 Open ticket context finds ticket by id and shows status/priority/due', function() {
  assert(/openT = \(tickets \|\| \[\]\)\.find\(function\(t\) \{ return t\.id === contextOpenTicketId/.test(greeter),
    'must look up open ticket by id in the tickets array');
});

test('S15.X7 Tab-specific hints map exists for major tabs', function() {
  assert(/var tabHints = \{/.test(greeter),
    'tabHints map must exist');
  ['treasury', 'sales', 'customers', 'checks', 'tickets', 'crm'].forEach(function(t) {
    assert(new RegExp(t + ':').test(greeter), 'tabHints must include ' + t);
  });
});

test('S15.X8 useCallback deps updated to include context props', function() {
  assert(/\[myId, firstName, fullName, userProfile, tickets, invoices, treasury, checks, loginHistory, contextTab, contextSelectedCustomer, contextSelectedInvoice, contextOpenTicketId\]/.test(greeter),
    'buildContext useCallback dep array must include all 4 context props');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
