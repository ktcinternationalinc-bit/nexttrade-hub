// ============================================================
// Treasury → Create-Invoice customer-linking regression tests
//
// Scenario reproduced from production (Apr 22, 2026):
// User enters a treasury cash_in with order# that doesn't exist.
// The "Order Not Found → Create Invoice Now" flow should auto-link
// the invoice to an existing customer whenever the treasury desc
// exactly matches a customer name. Previously invoices were silently
// saved with customer_id: null even when the name was verbatim.
//
// These are pure unit tests of the resolver logic — they do not hit
// Supabase. The goal is to lock in the three fixes in page.jsx:
//
//   FIX 1: modal-open auto-match populates __newInvCustomerId
//   FIX 2: dropdown hides once __newInvCustomerId is set
//   FIX 3: save-time belt-and-suspenders exact-match fallback
// ============================================================

var assert = require('assert');

// Shared resolver logic — mirrors the code in page.jsx. Keep in sync if
// the page.jsx implementation changes.
function resolveCustomerIdByExactName(customers, rawName) {
  var name = String(rawName || '').trim();
  if (!name) return null;
  var hit = customers.find(function(c) { return String(c.name || '').trim() === name; });
  return hit ? hit.id : null;
}

function simulateModalOpen(formData, pendingRec, customers) {
  var descText = String(formData.desc || '').trim();
  var resolvedId = resolveCustomerIdByExactName(customers, descText);
  return {
    __creatingInvoice: true,
    __newInvCustomer: descText,
    __newInvCustomerId: resolvedId,
    __newInvTotal: pendingRec.amount,
    __newInvDate: pendingRec.record.transaction_date || '2026-04-22',
  };
}

function simulateSaveClick(formState, customers) {
  var name = String(formState.__newInvCustomer || '').trim();
  var resolvedCustomerId = formState.__newInvCustomerId || null;
  if (!resolvedCustomerId) {
    resolvedCustomerId = resolveCustomerIdByExactName(customers, name);
  }
  return {
    customer_name: name,
    customer_id: resolvedCustomerId,
  };
}

// -----------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------
var CUSTOMERS = [
  { id: 'cust-yasser', name: 'ياسر عباده' },
  { id: 'cust-ahmed',  name: 'احمد محمد' },
  { id: 'cust-mostafa', name: 'مصطفى عبد الباقي' },
];

var PENDING = {
  record: { order_number: '2300', transaction_date: '2026-04-01' },
  amount: 113992.4,
};

// -----------------------------------------------------------------
// Test 1 — FIX 1: exact match on modal open pre-links customer_id
// -----------------------------------------------------------------
(function testAutoLinkOnExactMatchOnOpen() {
  var formData = { desc: 'ياسر عباده' };
  var state = simulateModalOpen(formData, PENDING, CUSTOMERS);
  assert.strictEqual(state.__newInvCustomer, 'ياسر عباده');
  assert.strictEqual(state.__newInvCustomerId, 'cust-yasser',
    'BUG REGRESSION: customer_id must be auto-populated when treasury desc exactly matches existing customer');
  console.log('✓ FIX 1a: exact match on modal open pre-links customer_id');
})();

// -----------------------------------------------------------------
// Test 2 — FIX 1: non-match on open leaves customer_id null
// -----------------------------------------------------------------
(function testNoAutoLinkWhenNoMatch() {
  var formData = { desc: 'شخص جديد لا يوجد' };
  var state = simulateModalOpen(formData, PENDING, CUSTOMERS);
  assert.strictEqual(state.__newInvCustomer, 'شخص جديد لا يوجد');
  assert.strictEqual(state.__newInvCustomerId, null,
    'customer_id must stay null when no exact match exists');
  console.log('✓ FIX 1b: no-match leaves customer_id null (new customer path)');
})();

// -----------------------------------------------------------------
// Test 3 — FIX 1: whitespace-only diff still matches (trim both sides)
// -----------------------------------------------------------------
(function testWhitespaceTrimMatch() {
  var formData = { desc: '  ياسر عباده  ' };
  var state = simulateModalOpen(formData, PENDING, CUSTOMERS);
  assert.strictEqual(state.__newInvCustomerId, 'cust-yasser',
    'Leading/trailing whitespace must not defeat the auto-link');
  console.log('✓ FIX 1c: whitespace-tolerant matching');
})();

// -----------------------------------------------------------------
// Test 4 — FIX 1: partial/substring match does NOT auto-link (avoid false positives)
// -----------------------------------------------------------------
(function testPartialMatchDoesNotAutoLink() {
  var formData = { desc: 'ياسر' }; // substring of 'ياسر عباده'
  var state = simulateModalOpen(formData, PENDING, CUSTOMERS);
  assert.strictEqual(state.__newInvCustomerId, null,
    'Substring matches must not auto-link — user must explicitly pick from dropdown');
  console.log('✓ FIX 1d: substring does not auto-link (prevents false positives)');
})();

// -----------------------------------------------------------------
// Test 5 — FIX 3: save-time fallback catches orphan when user typed exact name but skipped dropdown
// -----------------------------------------------------------------
(function testSaveTimeFallback() {
  // User typed the name verbatim but never clicked the dropdown — __newInvCustomerId is null
  var formState = { __newInvCustomer: 'ياسر عباده', __newInvCustomerId: null };
  var result = simulateSaveClick(formState, CUSTOMERS);
  assert.strictEqual(result.customer_id, 'cust-yasser',
    'BUG REGRESSION: save-time fallback must resolve exact name to customer_id');
  console.log('✓ FIX 3a: save-time fallback prevents silent orphan invoices');
})();

// -----------------------------------------------------------------
// Test 6 — FIX 3: explicit dropdown pick always wins over fallback
// -----------------------------------------------------------------
(function testExplicitPickWinsOverFallback() {
  var formState = {
    __newInvCustomer: 'ياسر عباده',
    __newInvCustomerId: 'cust-yasser', // user clicked the dropdown
  };
  var result = simulateSaveClick(formState, CUSTOMERS);
  assert.strictEqual(result.customer_id, 'cust-yasser',
    'Explicitly picked customer_id must be preserved');
  console.log('✓ FIX 3b: explicit dropdown pick preserved');
})();

// -----------------------------------------------------------------
// Test 7 — FIX 3: truly new customer name stays unlinked (new customer path intact)
// -----------------------------------------------------------------
(function testNewCustomerPathPreserved() {
  var formState = { __newInvCustomer: 'عميل جديد لا يوجد', __newInvCustomerId: null };
  var result = simulateSaveClick(formState, CUSTOMERS);
  assert.strictEqual(result.customer_id, null,
    'New customer must remain unlinked — no phantom matches');
  assert.strictEqual(result.customer_name, 'عميل جديد لا يوجد');
  console.log('✓ FIX 3c: truly new customer stays unlinked');
})();

// -----------------------------------------------------------------
// Test 8 — FIX 2 semantics: once __newInvCustomerId is set, dropdown should hide
// (This is a UI test — we verify the conditional logic returns false here)
// -----------------------------------------------------------------
(function testDropdownHidesWhenLinked() {
  function shouldShowDropdown(state) {
    return !!(state.__newInvCustomer && state.__newInvCustomer.length >= 2 && !state.__newInvCustomerId);
  }
  assert.strictEqual(shouldShowDropdown({ __newInvCustomer: 'ياسر عباده', __newInvCustomerId: 'cust-yasser' }), false,
    'Dropdown must hide once customer is linked');
  assert.strictEqual(shouldShowDropdown({ __newInvCustomer: 'ياسر', __newInvCustomerId: null }), true,
    'Dropdown must show when typing without a link');
  assert.strictEqual(shouldShowDropdown({ __newInvCustomer: 'ي', __newInvCustomerId: null }), false,
    'Dropdown must not show below 2-character threshold');
  console.log('✓ FIX 2: dropdown visibility rule validated');
})();

console.log('\n✅ All 8 Treasury→Invoice customer-link regression tests passed');
