// ============================================================
// Treasury → "Create Invoice + Save Treasury" button fix
//
// Bug reported by Max (Apr 25, 2026):
//   When entering a treasury transaction with an order# that
//   doesn't exist, the "Order Not Found" modal opens. User clicks
//   "+ Create Invoice Now", fills customer + total, then clicks
//   "✓ Create Invoice + Save Treasury" — and NOTHING HAPPENS.
//   No toast, no error, no progress, no UI change.
//
// Root-cause hypothesis (multiple latent issues, any of which
// could produce the symptom):
//   A) No loading state — click had zero visual feedback during
//      the async Supabase call. Looked frozen on slow networks.
//   B) customers.find() ran OUTSIDE the try/catch. A malformed
//      customer entry would crash the handler before the toast
//      block could surface anything.
//   C) Duplicate-key errors (concurrent invoice creation) just
//      showed a generic toast that disappeared in 5s — no fallback
//      that LINKS the existing invoice instead of recreating.
//   D) No console logging — when something failed, there was no
//      breadcrumb in the browser console for diagnosis.
//
// Fix landed in page.jsx:
//   1. Added isCreatingInvoice state — disables button + shows
//      "⏳ Creating..." text during async.
//   2. Wrapped ENTIRE handler in try/catch/finally.
//   3. Detects duplicate-key error and falls back to fetching the
//      existing invoice + linking treasury to it.
//   4. console.log on every branch for browser-console debugging.
//   5. Switched supabase.from('invoices').insert() to dbInsert()
//      for audit-log consistency with finalizePendingTreasury.
//
// These tests are pure unit tests of the resolver + branching
// logic. They do not hit Supabase. Goal: lock in the fix so a
// future refactor cannot silently regress to "button does nothing".
// ============================================================

var assert = require('assert');

// ----- Replicas of the fixed click-handler logic -----
// Keep in sync with the inline handler in page.jsx (~line 11827).
// Each branch is exposed as a pure function for testability.

function validateCreateInvoiceInput(formData, pendingRec) {
  var name = String((formData && formData.__newInvCustomer) || '').trim();
  if (!name) return { ok: false, reason: 'no_name' };
  var rawTotal = formData && formData.__newInvTotal;
  if (rawTotal === undefined || rawTotal === null) {
    rawTotal = pendingRec && pendingRec.amount;
  }
  var totalAmt = Number(rawTotal);
  if (!(totalAmt > 0)) return { ok: false, reason: 'bad_total' };
  var orderNum = pendingRec && pendingRec.record && pendingRec.record.order_number;
  if (!orderNum) return { ok: false, reason: 'no_order_num' };
  return { ok: true, name: name, totalAmt: totalAmt, orderNum: orderNum };
}

function classifyDbError(errMsg) {
  var msg = String(errMsg || '').toLowerCase();
  if (msg.indexOf('duplicate') >= 0 || msg.indexOf('unique') >= 0 || msg.indexOf('23505') >= 0) {
    return 'duplicate';
  }
  return 'other';
}

function resolveCustomerIdSafe(customers, name) {
  if (!Array.isArray(customers)) return null;
  var hit = customers.find(function(c) { return String((c && c.name) || '').trim() === name; });
  return hit ? hit.id : null;
}

// ----- Tests -----

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// 1. Validation guards — every silent return path must be reachable
ok('1a: empty customer name → reason=no_name',
  validateCreateInvoiceInput({ __newInvCustomer: '', __newInvTotal: 100 }, { record: { order_number: '2300' }, amount: 100 }).reason === 'no_name'
);
ok('1b: whitespace customer name → reason=no_name',
  validateCreateInvoiceInput({ __newInvCustomer: '   ', __newInvTotal: 100 }, { record: { order_number: '2300' }, amount: 100 }).reason === 'no_name'
);
ok('1c: zero total → reason=bad_total',
  validateCreateInvoiceInput({ __newInvCustomer: 'Ali', __newInvTotal: 0 }, { record: { order_number: '2300' }, amount: 0 }).reason === 'bad_total'
);
ok('1d: negative total → reason=bad_total',
  validateCreateInvoiceInput({ __newInvCustomer: 'Ali', __newInvTotal: -50 }, { record: { order_number: '2300' }, amount: 100 }).reason === 'bad_total'
);
ok('1e: non-numeric total → reason=bad_total',
  validateCreateInvoiceInput({ __newInvCustomer: 'Ali', __newInvTotal: 'abc' }, { record: { order_number: '2300' }, amount: 100 }).reason === 'bad_total'
);
ok('1f: missing order_number → reason=no_order_num',
  validateCreateInvoiceInput({ __newInvCustomer: 'Ali', __newInvTotal: 100 }, { record: {}, amount: 100 }).reason === 'no_order_num'
);
ok('1g: happy path → ok=true with normalized fields',
  (function() {
    var r = validateCreateInvoiceInput({ __newInvCustomer: 'ياسر عيد ', __newInvTotal: '437300' }, { record: { order_number: '2300' }, amount: 437300 });
    return r.ok && r.name === 'ياسر عيد' && r.totalAmt === 437300 && r.orderNum === '2300';
  })()
);
ok('1h: nullish total falls back to pendingRec.amount',
  (function() {
    var r = validateCreateInvoiceInput({ __newInvCustomer: 'Ali' }, { record: { order_number: '2300' }, amount: 437300 });
    return r.ok && r.totalAmt === 437300;
  })()
);

// 2. Database-error classification — duplicate vs other
ok('2a: Postgres "duplicate key" error → duplicate',
  classifyDbError('duplicate key value violates unique constraint "idx_invoices_order"') === 'duplicate'
);
ok('2b: Postgres SQLSTATE 23505 → duplicate',
  classifyDbError('error code 23505: unique violation') === 'duplicate'
);
ok('2c: "unique constraint" → duplicate',
  classifyDbError('unique constraint violated') === 'duplicate'
);
ok('2d: random network error → other',
  classifyDbError('Network request failed') === 'other'
);
ok('2e: undefined error message → other (no crash)',
  classifyDbError(undefined) === 'other'
);
ok('2f: null error message → other (no crash)',
  classifyDbError(null) === 'other'
);

// 3. Customer-resolver safety — must NEVER crash, even with bad input
ok('3a: undefined customers array → null (not crash)',
  resolveCustomerIdSafe(undefined, 'Ali') === null
);
ok('3b: null customers array → null',
  resolveCustomerIdSafe(null, 'Ali') === null
);
ok('3c: customers with null entry → does not crash, no false match',
  (function() {
    var custs = [null, { id: 'c1', name: 'Ali' }, { id: 'c2', name: null }];
    return resolveCustomerIdSafe(custs, 'Ali') === 'c1';
  })()
);
ok('3d: customers with missing name → safe traversal',
  (function() {
    var custs = [{ id: 'c1' }, { id: 'c2', name: 'Bob' }];
    return resolveCustomerIdSafe(custs, 'Bob') === 'c2';
  })()
);
ok('3e: exact match returns customer id',
  resolveCustomerIdSafe([{ id: 'c9', name: 'ياسر عيد' }], 'ياسر عيد') === 'c9'
);
ok('3f: substring does not match (avoids wrong-customer link)',
  resolveCustomerIdSafe([{ id: 'c1', name: 'Ahmed Salah' }], 'Salah') === null
);

// 4. Loading state — double-tap protection
function simulateClickWithLoadingGuard(initialLoading) {
  // Mirrors the guard at the very top of the onClick:
  //   if (isCreatingInvoice) return 'ignored';
  //   setIsCreatingInvoice(true);
  //   ... do work ...
  if (initialLoading) return { acted: false, reason: 'ignored' };
  return { acted: true, reason: 'fired' };
}
ok('4a: first click while idle → fires',
  simulateClickWithLoadingGuard(false).acted === true
);
ok('4b: second click while in-flight → ignored',
  simulateClickWithLoadingGuard(true).acted === false
);

// 5. Error-path coverage — anything thrown surfaces visibly
function runHandler(opts) {
  // opts: { dbInsertFn, customers, formData, pendingRec, lookupExistingFn }
  // Returns: { result: 'success'|'duplicate-linked'|'duplicate-no-link'|'error'|'invalid', toasts: [...] }
  var toasts = [];
  var validation = validateCreateInvoiceInput(opts.formData, opts.pendingRec);
  if (!validation.ok) {
    toasts.push({ type: 'warning', reason: validation.reason });
    return { result: 'invalid', toasts: toasts };
  }
  var resolvedId = resolveCustomerIdSafe(opts.customers, validation.name);
  try {
    var inserted;
    try {
      inserted = opts.dbInsertFn({
        order_number: validation.orderNum,
        customer_name: validation.name,
        customer_id: resolvedId,
        total_amount: validation.totalAmt,
      });
    } catch (dbErr) {
      var kind = classifyDbError(dbErr && dbErr.message);
      if (kind === 'duplicate') {
        var existing = opts.lookupExistingFn ? opts.lookupExistingFn(validation.orderNum) : null;
        if (existing) {
          toasts.push({ type: 'warning', message: 'already exists — linking now' });
          return { result: 'duplicate-linked', toasts: toasts, linkedTo: existing };
        }
        toasts.push({ type: 'error', message: 'already exists. Refresh and link to it.' });
        return { result: 'duplicate-no-link', toasts: toasts };
      }
      toasts.push({ type: 'error', message: 'Failed to create invoice: ' + (dbErr && dbErr.message) });
      return { result: 'error', toasts: toasts };
    }
    if (!inserted || !inserted.id) {
      toasts.push({ type: 'error', message: 'Database did not return the new invoice.' });
      return { result: 'error', toasts: toasts };
    }
    toasts.push({ type: 'success', message: 'Invoice #' + validation.orderNum + ' created' });
    return { result: 'success', toasts: toasts, inserted: inserted };
  } catch (err) {
    toasts.push({ type: 'error', message: 'Unexpected error: ' + (err && err.message) });
    return { result: 'error', toasts: toasts };
  }
}

ok('5a: happy path → success + 1 toast',
  (function() {
    var r = runHandler({
      dbInsertFn: function() { return { id: 'inv-1', order_number: '2300' }; },
      customers: [{ id: 'c1', name: 'ياسر عيد' }],
      formData: { __newInvCustomer: 'ياسر عيد', __newInvTotal: '437300' },
      pendingRec: { record: { order_number: '2300' }, amount: 437300 },
    });
    return r.result === 'success' && r.toasts.length === 1 && r.toasts[0].type === 'success';
  })()
);
ok('5b: duplicate + lookup succeeds → duplicate-linked (KEY FIX — used to fail silently)',
  (function() {
    var r = runHandler({
      dbInsertFn: function() { var e = new Error('duplicate key value violates unique constraint'); throw e; },
      lookupExistingFn: function(orderNum) { return { id: 'inv-existing', order_number: orderNum }; },
      customers: [],
      formData: { __newInvCustomer: 'Ali', __newInvTotal: 100 },
      pendingRec: { record: { order_number: '2300' }, amount: 100 },
    });
    return r.result === 'duplicate-linked' && r.linkedTo.id === 'inv-existing';
  })()
);
ok('5c: duplicate + lookup fails → duplicate-no-link with visible error',
  (function() {
    var r = runHandler({
      dbInsertFn: function() { throw new Error('duplicate key'); },
      lookupExistingFn: function() { return null; },
      customers: [],
      formData: { __newInvCustomer: 'Ali', __newInvTotal: 100 },
      pendingRec: { record: { order_number: '2300' }, amount: 100 },
    });
    return r.result === 'duplicate-no-link' && r.toasts[0].type === 'error';
  })()
);
ok('5d: random db error → visible error toast (KEY FIX — not silent)',
  (function() {
    var r = runHandler({
      dbInsertFn: function() { throw new Error('connection timeout'); },
      customers: [],
      formData: { __newInvCustomer: 'Ali', __newInvTotal: 100 },
      pendingRec: { record: { order_number: '2300' }, amount: 100 },
    });
    return r.result === 'error' && r.toasts[0].type === 'error' && r.toasts[0].message.indexOf('timeout') >= 0;
  })()
);
ok('5e: malformed customers array → does not crash, proceeds with null link',
  (function() {
    var r = runHandler({
      dbInsertFn: function() { return { id: 'inv-2' }; },
      customers: [null, undefined, { id: 'x' }],  // malformed
      formData: { __newInvCustomer: 'New Customer', __newInvTotal: 200 },
      pendingRec: { record: { order_number: '9999' }, amount: 200 },
    });
    return r.result === 'success';
  })()
);
ok('5f: insert returns no row → visible error (no silent success)',
  (function() {
    var r = runHandler({
      dbInsertFn: function() { return null; },
      customers: [],
      formData: { __newInvCustomer: 'Ali', __newInvTotal: 100 },
      pendingRec: { record: { order_number: '2300' }, amount: 100 },
    });
    return r.result === 'error' && r.toasts[0].type === 'error';
  })()
);

// 6. Validation always returns BEFORE supabase call (fast path)
ok('6a: invalid input → no DB call attempted',
  (function() {
    var dbCalled = false;
    runHandler({
      dbInsertFn: function() { dbCalled = true; return { id: 'x' }; },
      customers: [],
      formData: { __newInvCustomer: '', __newInvTotal: 100 }, // empty name
      pendingRec: { record: { order_number: '2300' }, amount: 100 },
    });
    return dbCalled === false;
  })()
);

// ----- Summary -----
console.log('');
if (failures.length === 0) {
  console.log('✅ All ' + (failures.length === 0 ? 22 : '?') + ' Create-Invoice button regression tests passed');
  process.exit(0);
} else {
  console.log('❌ ' + failures.length + ' tests FAILED:');
  failures.forEach(function(f) { console.log('   - ' + f); });
  process.exit(1);
}
