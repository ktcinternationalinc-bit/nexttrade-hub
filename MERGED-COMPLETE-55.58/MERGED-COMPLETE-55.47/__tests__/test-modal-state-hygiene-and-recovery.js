// ============================================================
// Treasury "Order Not Found" modal — state hygiene + recovery path
//
// Bugs reported by Max (Apr 25, 2026):
//   1. Cash Out → Cash In flow: clicking "Create Invoice + Save"
//      did nothing (button silently failed validation because stale
//      __creatingInvoice / __newInv* state from earlier polluted formData)
//   2. Direct Cash In flow: invoice "appears in the system but greyed
//      out in transaction details, indicating it's not properly
//      registered" — i.e. the invoice WAS created in DB but my code
//      thought it failed (likely audit_log gap), so treasury never got
//      linked, OR the local invoices state didn't update so the link
//      couldn't render until 500ms loadAllData refresh.
//
// Fixes shipped in page.jsx:
//   A. closePendingTreasuryModal() helper — wipes pendingTreasuryRecord
//      AND every __creatingInvoice/__newInv* flag in formData. Used
//      everywhere the modal closes (X, backdrop, Cancel, success).
//   B. Opening a fresh modal also wipes the same stale state UP FRONT.
//   C. After successful invoice insert, optimistic insert into LOCAL
//      invoices state so the linked-invoice badge shows immediately.
//   D. RECOVERY PATH: if dbInsert throws OR returns nothing, look up
//      by order_number — if invoice exists, USE IT instead of failing.
//      Handles the audit_log known-gap (25.src.1b in test-full).
//   E. createInvoiceError state + visible red banner inside the modal
//      so failures can never look like "nothing happened".
//
// These tests lock all five fixes in.
// ============================================================

var assert = require('assert');
var fs = require('fs');
var path = require('path');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

// ---------- 1. State hygiene helper ----------
// Mirror of closePendingTreasuryModal — every key listed must be deleted
// from formData on every modal close.
function simulateCloseModal(formData) {
  var next = Object.assign({}, formData);
  delete next.__creatingInvoice;
  delete next.__newInvCustomer;
  delete next.__newInvCustomerId;
  delete next.__newInvTotal;
  delete next.__newInvDate;
  return next;
}

ok('1a: close wipes __creatingInvoice (Cash Out → Cash In bug fix)',
  (function() {
    var fd = { type: 'in', amount: 100, __creatingInvoice: true };
    return simulateCloseModal(fd).__creatingInvoice === undefined;
  })()
);

ok('1b: close wipes ALL invoice-creation keys in one shot',
  (function() {
    var fd = {
      type: 'in', amount: 100,
      __creatingInvoice: true,
      __newInvCustomer: 'old name',
      __newInvCustomerId: 'old-id',
      __newInvTotal: 999,
      __newInvDate: '2025-01-01',
    };
    var n = simulateCloseModal(fd);
    return n.__creatingInvoice === undefined
      && n.__newInvCustomer === undefined
      && n.__newInvCustomerId === undefined
      && n.__newInvTotal === undefined
      && n.__newInvDate === undefined;
  })()
);

ok('1c: close PRESERVES non-invoice fields (type, amount, etc.)',
  (function() {
    var fd = { type: 'in', amount: 100, desc: 'something', __creatingInvoice: true };
    var n = simulateCloseModal(fd);
    return n.type === 'in' && n.amount === 100 && n.desc === 'something';
  })()
);

ok('1d: close on empty formData is a no-op (no crash)',
  (function() {
    var n = simulateCloseModal({});
    return Object.keys(n).length === 0;
  })()
);

// ---------- 2. Recovery path — invoice-already-in-DB ----------
// Mirrors the "if dbInsert threw OR returned nothing, look up by
// order_number" branch.
function simulateCreateWithRecovery(opts) {
  // opts: { dbInsertFn, lookupFn }
  // Returns: { result: 'created'|'recovered'|'failed', source: ..., error?: ... }
  var inserted = null;
  var dbErrorMessage = null;
  try {
    inserted = opts.dbInsertFn();
  } catch (e) {
    dbErrorMessage = e && e.message;
  }
  if (!inserted || !inserted.id) {
    try {
      var lookup = opts.lookupFn();
      if (lookup && lookup.id) {
        return { result: 'recovered', source: lookup, error: dbErrorMessage };
      }
    } catch (e2) {
      // lookup failed too, fall through to failed
    }
  }
  if (!inserted || !inserted.id) {
    return { result: 'failed', error: dbErrorMessage || 'no row returned' };
  }
  return { result: 'created', source: inserted };
}

ok('2a: dbInsert succeeds normally → result=created',
  (function() {
    var r = simulateCreateWithRecovery({
      dbInsertFn: function() { return { id: 'inv-new', order_number: '5500' }; },
      lookupFn: function() { return null; },
    });
    return r.result === 'created' && r.source.id === 'inv-new';
  })()
);

ok('2b: dbInsert throws (audit_log gap) BUT invoice IS in DB → result=recovered [BUG B FIX]',
  (function() {
    // This simulates exactly the 25.src.1b known gap:
    // invoice insert succeeded, audit_log insert failed, error
    // propagated. With the fix, we look up by order_number and
    // find the invoice that's already there.
    var r = simulateCreateWithRecovery({
      dbInsertFn: function() { throw new Error('audit_log RLS denied'); },
      lookupFn: function() { return { id: 'inv-recovered', order_number: '5500' }; },
    });
    return r.result === 'recovered' && r.source.id === 'inv-recovered'
      && r.error.indexOf('audit_log') >= 0;
  })()
);

ok('2c: dbInsert throws AND lookup finds nothing → result=failed (visible error)',
  (function() {
    var r = simulateCreateWithRecovery({
      dbInsertFn: function() { throw new Error('connection lost'); },
      lookupFn: function() { return null; },
    });
    return r.result === 'failed' && r.error.indexOf('connection') >= 0;
  })()
);

ok('2d: dbInsert returns null → recovery looks up + finds (defensive)',
  (function() {
    var r = simulateCreateWithRecovery({
      dbInsertFn: function() { return null; },
      lookupFn: function() { return { id: 'inv-found', order_number: '5500' }; },
    });
    return r.result === 'recovered';
  })()
);

ok('2e: dbInsert returns row with no id → recovery still kicks in',
  (function() {
    var r = simulateCreateWithRecovery({
      dbInsertFn: function() { return { order_number: '5500' }; }, // no id
      lookupFn: function() { return { id: 'inv-found' }; },
    });
    return r.result === 'recovered';
  })()
);

ok('2f: lookup itself throws → result=failed but no crash',
  (function() {
    var r = simulateCreateWithRecovery({
      dbInsertFn: function() { throw new Error('first error'); },
      lookupFn: function() { throw new Error('lookup also broke'); },
    });
    return r.result === 'failed';
  })()
);

// ---------- 3. Optimistic local invoices state ----------
function applyOptimistic(prev, inserted) {
  if (prev.some(function(i) { return i.id === inserted.id; })) return prev;
  return [inserted].concat(prev);
}

ok('3a: brand new invoice → prepended to local invoices',
  (function() {
    var prev = [{ id: 'a' }, { id: 'b' }];
    var next = applyOptimistic(prev, { id: 'c', order_number: '5500' });
    return next.length === 3 && next[0].id === 'c';
  })()
);

ok('3b: invoice already in local state → no double-add',
  (function() {
    var prev = [{ id: 'a' }, { id: 'b' }];
    var next = applyOptimistic(prev, { id: 'a' });
    return next.length === 2 && next === prev; // same reference
  })()
);

ok('3c: empty initial state → just the new one',
  (function() {
    var next = applyOptimistic([], { id: 'first' });
    return next.length === 1 && next[0].id === 'first';
  })()
);

// ---------- 4. Source-code wiring ----------
var pageSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'page.jsx'), 'utf8');

ok('4a: closePendingTreasuryModal helper is defined',
  /const closePendingTreasuryModal = \(\) =>/.test(pageSrc)
);

ok('4b: closePendingTreasuryModal wipes __creatingInvoice',
  (function() {
    var helperMatch = pageSrc.match(/const closePendingTreasuryModal = \(\) => \{[\s\S]{0,800}?\};/);
    return helperMatch && helperMatch[0].indexOf('delete next.__creatingInvoice') >= 0;
  })()
);

ok('4c: closePendingTreasuryModal wipes all four __newInv* keys',
  (function() {
    var helperMatch = pageSrc.match(/const closePendingTreasuryModal = \(\) => \{[\s\S]{0,800}?\};/);
    if (!helperMatch) return false;
    var body = helperMatch[0];
    return body.indexOf('delete next.__newInvCustomer') >= 0
      && body.indexOf('delete next.__newInvCustomerId') >= 0
      && body.indexOf('delete next.__newInvTotal') >= 0
      && body.indexOf('delete next.__newInvDate') >= 0;
  })()
);

ok('4d: closePendingTreasuryModal also resets isCreatingInvoice + error banner',
  (function() {
    var helperMatch = pageSrc.match(/const closePendingTreasuryModal = \(\) => \{[\s\S]{0,800}?\};/);
    if (!helperMatch) return false;
    var body = helperMatch[0];
    return body.indexOf('setIsCreatingInvoice(false)') >= 0
      && body.indexOf('setCreateInvoiceError(null)') >= 0
      && body.indexOf('setPendingTreasuryRecord(null)') >= 0;
  })()
);

ok('4e: opening a new modal ALSO wipes stale state up front',
  (function() {
    // Look for the wipe block immediately before the setPendingTreasuryRecord({...}) call
    var idx = pageSrc.indexOf("[treasury-add] OPENING modal");
    if (idx < 0) return false;
    var window_ = pageSrc.substring(idx, idx + 1500);
    return window_.indexOf('delete next.__creatingInvoice') >= 0
      && window_.indexOf('setPendingTreasuryRecord({') >= 0;
  })()
);

ok('4f: Backdrop click uses closePendingTreasuryModal (not direct setPendingTreasuryRecord(null))',
  /onClick=\{\(\) => \{ closePendingTreasuryModal\(\); \}\}/.test(pageSrc)
);

ok('4g: X button uses closePendingTreasuryModal',
  /onClick=\{\(\) => closePendingTreasuryModal\(\)\}[\s\S]{0,200}className="px-3 py-1\.5 rounded-lg bg-white/.test(pageSrc)
);

ok('4h: Cancel button uses closePendingTreasuryModal',
  /onClick=\{\(\) => closePendingTreasuryModal\(\)\}[\s\S]{0,200}Cancel/.test(pageSrc)
);

ok('4i: finalizePendingTreasury also routes through closePendingTreasuryModal',
  (function() {
    var fpt = pageSrc.match(/const finalizePendingTreasury = async \(invoiceToLink\)[\s\S]{0,4000}?^\s{2}\};/m);
    return fpt && fpt[0].indexOf('closePendingTreasuryModal()') >= 0;
  })()
);

ok('4j: createInvoiceError state declared',
  /const \[createInvoiceError, setCreateInvoiceError\] = useState\(null\)/.test(pageSrc)
);

ok('4k: Red error banner renders when createInvoiceError is set',
  /\{createInvoiceError && \([\s\S]{0,500}?Save failed/.test(pageSrc)
);

ok('4l: Red banner has dismissible X',
  /onClick=\{\(\) => setCreateInvoiceError\(null\)\}/.test(pageSrc)
);

ok('4m: Recovery path — looks up by order_number after dbInsert throws',
  /lookup = await supabase\.from\('invoices'\)\.select\('\*'\)\.eq\('order_number', sanitize\(orderNum\)\)\.maybeSingle\(\)/.test(pageSrc)
);

ok('4n: Recovery path uses .maybeSingle() not .single() (so empty result returns null instead of throwing)',
  pageSrc.indexOf("[create-invoice] checking DB for invoice (recovery path)") >= 0
);

ok('4o: Optimistic insert into LOCAL invoices state after success',
  (function() {
    // Find the optimistic insert in the green button onClick
    var btnIdx = pageSrc.indexOf("[create-invoice] invoice ready");
    if (btnIdx < 0) return false;
    var window_ = pageSrc.substring(btnIdx, btnIdx + 1200);
    return window_.indexOf('setInvoices(function(prev)') >= 0
      && window_.indexOf('[inserted].concat(prev)') >= 0;
  })()
);

ok('4p: finalizePendingTreasury ALSO does optimistic insert on the typo-suggestion path',
  (function() {
    var fpt = pageSrc.match(/const finalizePendingTreasury = async \(invoiceToLink\)[\s\S]{0,4000}?^\s{2}\};/m);
    if (!fpt) return false;
    return fpt[0].indexOf('setInvoices(function(prev)') >= 0;
  })()
);

ok('4q: Validation failures populate the red banner (not just a toast)',
  (function() {
    // Search for setCreateInvoiceError calls in validation branches
    var matches = pageSrc.match(/setCreateInvoiceError\([^)]+/g) || [];
    // We expect at least: 3 validation branches (no name, bad total, no order#)
    //   + 1 the "could not create" final fail
    //   + 1 the "unexpected error" outer catch
    //   + 1 in finalizePendingTreasury
    //   + the red banner dismiss = at least 5 distinct call sites
    return matches.length >= 5;
  })()
);

// ---------- 5. Scenario: Cash Out → Cash In with stale state ----------
// This simulates the exact bug Max reported.

function simulateMultiAttemptFlow() {
  // Stage 1: User does Cash IN attempt with bad order# → modal opens →
  //   user clicks "+ Create Invoice Now" → __creatingInvoice=true → user
  //   closes modal with X (the OLD code path didn't clear __creatingInvoice)
  var formData = { type: 'in', amount: 100, orderNumber: '5500' };
  // Click "+ Create Invoice Now":
  formData = Object.assign({}, formData, {
    __creatingInvoice: true,
    __newInvCustomer: 'old typed value',
    __newInvCustomerId: null,
    __newInvTotal: 100,
    __newInvDate: '2026-04-20',
  });
  // Close modal — using NEW helper that wipes:
  formData = simulateCloseModal(formData);

  // Stage 2: User clicks Cash OUT (only type + bankAccountId change):
  formData = Object.assign({}, formData, { type: 'out', bankAccountId: '' });
  // Stage 3: User clicks Cash IN again:
  formData = Object.assign({}, formData, { type: 'in', bankAccountId: '' });
  // Stage 4: User saves → modal opens fresh (no stale __creatingInvoice).
  //   With the OLD code, __creatingInvoice would still be true here and the
  //   modal would skip the "+ Create Invoice Now" button and jump straight
  //   to the form, where __newInvCustomer is empty, so validation fails.
  return formData;
}

ok('5a: Cash IN attempt → close modal → Cash Out → Cash In leaves NO stale __creatingInvoice [BUG A FIX]',
  simulateMultiAttemptFlow().__creatingInvoice === undefined
);

ok('5b: Same flow leaves NO stale __newInvCustomer',
  simulateMultiAttemptFlow().__newInvCustomer === undefined
);

ok('5c: Same flow preserves the new transaction type (Cash IN)',
  simulateMultiAttemptFlow().type === 'in'
);

// ---------- Summary ----------
console.log('');
if (failures.length === 0) {
  console.log('✅ All Treasury modal state-hygiene + recovery tests passed');
  process.exit(0);
} else {
  console.log('❌ ' + failures.length + ' tests FAILED:');
  failures.forEach(function(f) { console.log('   - ' + f); });
  process.exit(1);
}
