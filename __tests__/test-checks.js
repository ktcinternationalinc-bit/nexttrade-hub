// Test runner for check reconcile evaluator
// Run with: node test-checks.js

const path = require('path');
const fs = require('fs');

// Load the evaluator (transpile ES module syntax to CommonJS-style)
const src = fs.readFileSync('/home/claude/nexttrade/src/lib/check-reconcile.js', 'utf8');
const transformed = src
  .replace(/export function/g, 'function')
  + '\nmodule.exports = { evaluateCheckReconcile };';
const tmpPath = '/tmp/check-reconcile-test.js';
fs.writeFileSync(tmpPath, transformed);
const { evaluateCheckReconcile } = require(tmpPath);

// ============================================================
// TEST INFRASTRUCTURE
// ============================================================
let passed = 0, failed = 0;
const failures = [];

function assert(condition, name, detail) {
  if (condition) {
    passed++;
    console.log('  ✓', name);
  } else {
    failed++;
    failures.push({ name, detail });
    console.log('  ✗', name);
    if (detail) console.log('     ', detail);
  }
}

function group(title) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(title);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

// ============================================================
// FIXTURE BUILDERS
// ============================================================
let nextId = 1;
const id = (prefix) => prefix + '-' + (nextId++);

function makeCheck(overrides) {
  return Object.assign({
    id: id('chk'),
    customer_name: 'Test Customer',
    amount: 100000,
    check_number: '12345',
    bank_name: 'CIB',
    order_number: '2280',
    invoice_id: null,
    status: 'pending',
    check_date: '2026-04-01',
    due_date: '2026-04-15',
  }, overrides || {});
}

function makeInvoice(overrides) {
  return Object.assign({
    id: id('inv'),
    order_number: '2280',
    customer_name: 'Test Customer',
    total_amount: 200000,
    total_collected: 0,
    outstanding: 200000,
  }, overrides || {});
}

function makeTreasury(overrides) {
  return Object.assign({
    id: id('tx'),
    transaction_date: '2026-04-15',
    order_number: '',
    description: '',
    cash_in: 0, cash_out: 0,
    bank_in: 0, bank_out: 0,
    linked_invoice_id: null,
    source_check_id: null,
    is_bank_placeholder: false,
    matched_bank_txn_id: null,
    cash_method: null,
  }, overrides || {});
}

// ============================================================
// SCENARIO 1: Check with no invoice link at all
// ============================================================
group('SCENARIO 1: Check with no invoice link');
{
  const chk = makeCheck({ order_number: null, invoice_id: null });
  const result = evaluateCheckReconcile(chk, [], []);
  assert(result.mode === 'no_invoice', 'mode is no_invoice', 'got: ' + result.mode);
  assert(result.checkAmount === 100000, 'checkAmount preserved');
  assert(result.invoice === undefined, 'no invoice attached');
}

// ============================================================
// SCENARIO 2: Check has order_number but no invoice exists for it
// ============================================================
group('SCENARIO 2: Check order# does not match any invoice');
{
  const chk = makeCheck({ order_number: '9999' });
  const inv = makeInvoice({ order_number: '2280' });
  const result = evaluateCheckReconcile(chk, [inv], []);
  assert(result.mode === 'no_invoice', 'mode is no_invoice when order# does not match');
}

// ============================================================
// SCENARIO 3: Check linked via invoice_id directly
// ============================================================
group('SCENARIO 3: Check linked via invoice_id');
{
  const inv = makeInvoice({ id: 'inv-direct', order_number: '5555' });
  const chk = makeCheck({ invoice_id: 'inv-direct', order_number: null });
  const result = evaluateCheckReconcile(chk, [inv], []);
  assert(result.mode === 'no_match', 'invoice found but no treasury → no_match');
  assert(result.invoice && result.invoice.id === 'inv-direct', 'invoice attached correctly');
}

// ============================================================
// SCENARIO 4: Check already linked via source_check_id
// ============================================================
group('SCENARIO 4: Check already explicitly linked');
{
  const chk = makeCheck({ id: 'chk-A' });
  const inv = makeInvoice();
  const tx = makeTreasury({
    cash_in: 100000,
    linked_invoice_id: inv.id,
    source_check_id: 'chk-A',
  });
  const result = evaluateCheckReconcile(chk, [inv], [tx]);
  assert(result.mode === 'already_linked', 'mode is already_linked');
  assert(result.existingTreasury && result.existingTreasury.id === tx.id, 'returns existing treasury');
}

// ============================================================
// SCENARIO 5: Bank already deposited — single exact match (the COMMON case)
// ============================================================
group('SCENARIO 5: Bank deposit exists, exact amount match');
{
  const chk = makeCheck({ amount: 100000 });
  const inv = makeInvoice();
  const bankTx = makeTreasury({
    bank_in: 100000,
    linked_invoice_id: inv.id,
    matched_bank_txn_id: 'bank-001',
    description: 'CIB deposit auto-matched',
  });
  const result = evaluateCheckReconcile(chk, [inv], [bankTx]);
  assert(result.mode === 'candidate_match', 'mode is candidate_match');
  assert(result.candidates.length === 1, 'exactly 1 candidate');
  assert(result.candidates[0].id === bankTx.id, 'bank row is the candidate');
}

// ============================================================
// SCENARIO 6: PARTIAL PAYMENT — cash + check on same invoice (THE BUG MAX FLAGGED)
// Customer paid 100k cash on day 1, then check for 100k for the rest of 200k invoice
// ============================================================
group('SCENARIO 6: Partial payment — cash already on invoice, separate check');
{
  const inv = makeInvoice({ total_amount: 200000 });
  // 100k cash payment on day 1 (NOT this check)
  const cashTx = makeTreasury({
    cash_in: 100000,
    linked_invoice_id: inv.id,
    description: 'Customer cash payment day 1',
  });
  const chk = makeCheck({ amount: 100000 });
  const result = evaluateCheckReconcile(chk, [inv], [cashTx]);
  // The cash row matches the check amount EXACTLY, so it WILL appear as a candidate.
  // This is the correct behavior — the user must look at it and either:
  //  (a) confirm "yes that cash payment IS this check" → attach
  //  (b) reject "no that was a separate cash payment, create new" → use the "none of above" radio
  assert(result.mode === 'candidate_match', 'mode is candidate_match');
  assert(result.candidates.length === 1, '1 candidate because cash amount equals check amount');
  console.log('     [Note: User must manually confirm — cash + check happen to share amount]');
  console.log('     [The "none of above" radio is the safety valve here]');
}

// ============================================================
// SCENARIO 7: Multiple candidates — two payments on same invoice both match check amount
// ============================================================
group('SCENARIO 7: Multiple exact-amount candidates');
{
  const inv = makeInvoice({ total_amount: 500000 });
  const tx1 = makeTreasury({ cash_in: 100000, linked_invoice_id: inv.id, transaction_date: '2026-03-01', description: 'Cash payment 1' });
  const tx2 = makeTreasury({ cash_in: 100000, linked_invoice_id: inv.id, transaction_date: '2026-04-01', description: 'Cash payment 2' });
  const tx3 = makeTreasury({ bank_in: 100000, linked_invoice_id: inv.id, transaction_date: '2026-04-10', description: 'Bank deposit', matched_bank_txn_id: 'b1' });
  const chk = makeCheck({ amount: 100000 });
  const result = evaluateCheckReconcile(chk, [inv], [tx1, tx2, tx3]);
  assert(result.mode === 'candidate_match', 'mode is candidate_match');
  assert(result.candidates.length === 3, 'three candidates surfaced (got ' + result.candidates.length + ')');
}

// ============================================================
// SCENARIO 8: Treasury already tied to ANOTHER check — must be excluded
// ============================================================
group('SCENARIO 8: Existing treasury tied to another check is excluded');
{
  const inv = makeInvoice();
  const otherCheckTx = makeTreasury({
    cash_in: 100000,
    linked_invoice_id: inv.id,
    source_check_id: 'chk-OTHER',  // already tied to a different check
  });
  const chk = makeCheck({ amount: 100000 });
  const result = evaluateCheckReconcile(chk, [inv], [otherCheckTx]);
  assert(result.mode === 'no_match', 'no candidate — the only matching row is taken');
  assert(!result.candidates || result.candidates.length === 0, 'no candidates surfaced');
}

// ============================================================
// SCENARIO 9: Bank placeholder is excluded (still awaiting statement)
// ============================================================
group('SCENARIO 9: Bank placeholder excluded from candidates');
{
  const inv = makeInvoice();
  const placeholder = makeTreasury({
    is_bank_placeholder: true,
    expected_amount: 100000,
    linked_invoice_id: inv.id,
  });
  const chk = makeCheck({ amount: 100000 });
  const result = evaluateCheckReconcile(chk, [inv], [placeholder]);
  assert(result.mode === 'no_match', 'placeholder excluded — no candidates');
}

// ============================================================
// SCENARIO 10: Bank confirmation dedup row is excluded
// ============================================================
group('SCENARIO 10: Bank confirmation dedup excluded');
{
  const inv = makeInvoice();
  const dedupRow = makeTreasury({
    bank_in: 100000,
    linked_invoice_id: inv.id,
    description: '[bank confirmation - dedup of original cash]',
  });
  const chk = makeCheck({ amount: 100000 });
  const result = evaluateCheckReconcile(chk, [inv], [dedupRow]);
  assert(result.mode === 'no_match', 'dedup row excluded');
}

// ============================================================
// SCENARIO 11: ZERO TOLERANCE — 99,999 must NOT match a 100,000 check
// ============================================================
group('SCENARIO 11: Zero tolerance — 99,999 does not match 100,000');
{
  const inv = makeInvoice();
  const closeTx = makeTreasury({
    bank_in: 99999,
    linked_invoice_id: inv.id,
    matched_bank_txn_id: 'b1',
  });
  const chk = makeCheck({ amount: 100000 });
  const result = evaluateCheckReconcile(chk, [inv], [closeTx]);
  assert(result.mode === 'no_match', 'amount off by 1 → no candidate');
}
{
  const inv = makeInvoice();
  const closeTx = makeTreasury({
    bank_in: 100001,
    linked_invoice_id: inv.id,
    matched_bank_txn_id: 'b1',
  });
  const chk = makeCheck({ amount: 100000 });
  const result = evaluateCheckReconcile(chk, [inv], [closeTx]);
  assert(result.mode === 'no_match', 'amount off by 1 (other direction) → no candidate');
}

// ============================================================
// SCENARIO 12: Treasury with cash_in + bank_in summed must match
// ============================================================
group('SCENARIO 12: cash_in + bank_in summed for matching');
{
  const inv = makeInvoice();
  const splitTx = makeTreasury({
    cash_in: 30000,
    bank_in: 70000,
    linked_invoice_id: inv.id,
  });
  const chk = makeCheck({ amount: 100000 });
  const result = evaluateCheckReconcile(chk, [inv], [splitTx]);
  // 30k + 70k = 100k exactly → should match
  assert(result.mode === 'candidate_match', 'sum of cash_in+bank_in = 100k matches');
  assert(result.candidates.length === 1, 'exactly 1 candidate');
}

// ============================================================
// SCENARIO 13: Treasury on a DIFFERENT invoice doesn't pollute
// ============================================================
group('SCENARIO 13: Treasury on different invoice ignored');
{
  const inv = makeInvoice({ id: 'inv-A', order_number: '1111' });
  const otherInv = makeInvoice({ id: 'inv-B', order_number: '2222' });
  const otherInvoiceTx = makeTreasury({
    cash_in: 100000,
    linked_invoice_id: 'inv-B',  // wrong invoice
  });
  const chk = makeCheck({ order_number: '1111', amount: 100000 });
  const result = evaluateCheckReconcile(chk, [inv, otherInv], [otherInvoiceTx]);
  assert(result.mode === 'no_match', 'treasury on different invoice ignored');
}

// ============================================================
// SCENARIO 14: Order# matching is whitespace-tolerant
// ============================================================
group('SCENARIO 14: Order# whitespace tolerance');
{
  const inv = makeInvoice({ order_number: ' 2280 ' });
  const chk = makeCheck({ order_number: '2280', invoice_id: null });
  const result = evaluateCheckReconcile(chk, [inv], []);
  assert(result.invoice && result.invoice.id === inv.id, 'whitespace in order_number tolerated');
}

// ============================================================
// SCENARIO 15: invoice_id takes precedence over order_number
// ============================================================
group('SCENARIO 15: invoice_id takes precedence over order_number');
{
  const invA = makeInvoice({ id: 'inv-A', order_number: '1111' });
  const invB = makeInvoice({ id: 'inv-B', order_number: '2222' });
  const chk = makeCheck({ invoice_id: 'inv-A', order_number: '2222' });  // mismatched on purpose
  const result = evaluateCheckReconcile(chk, [invA, invB], []);
  assert(result.invoice && result.invoice.id === 'inv-A', 'invoice_id wins over order_number');
}

// ============================================================
// SCENARIO 16: Empty/null/undefined inputs
// ============================================================
group('SCENARIO 16: Defensive — null/undefined safe');
{
  const r1 = evaluateCheckReconcile(null, [], []);
  assert(r1.mode === 'no_invoice', 'null check handled');
  const r2 = evaluateCheckReconcile(makeCheck(), null, null);
  assert(r2.mode === 'no_invoice', 'null arrays handled (no invoice match)');
  const r3 = evaluateCheckReconcile({ amount: 100 }, [], []);
  assert(r3.mode === 'no_invoice', 'check with no order/invoice handled');
}

// ============================================================
// SCENARIO 17: Zero-amount check (edge case)
// ============================================================
group('SCENARIO 17: Zero-amount check');
{
  const inv = makeInvoice();
  const zeroTx = makeTreasury({ cash_in: 0, linked_invoice_id: inv.id });
  const chk = makeCheck({ amount: 0 });
  const result = evaluateCheckReconcile(chk, [inv], [zeroTx]);
  // 0 === 0 — technically matches. Should this be allowed?
  if (result.mode === 'candidate_match') {
    console.log('     [INFO: zero-amount check matches zero-amount tx — likely a real-world non-issue]');
  }
  assert(true, 'zero-amount handled without crash');
}

// ============================================================
// SCENARIO 18: Decimal amounts must match exactly
// ============================================================
group('SCENARIO 18: Decimal amounts');
{
  const inv = makeInvoice();
  const tx = makeTreasury({ cash_in: 100000.50, linked_invoice_id: inv.id });
  const chk = makeCheck({ amount: 100000.50 });
  const result = evaluateCheckReconcile(chk, [inv], [tx]);
  assert(result.mode === 'candidate_match', 'exact decimal match works');
  assert(result.candidates.length === 1, '1 candidate');
}
{
  const inv = makeInvoice();
  const tx = makeTreasury({ cash_in: 100000.50, linked_invoice_id: inv.id });
  const chk = makeCheck({ amount: 100000.51 });
  const result = evaluateCheckReconcile(chk, [inv], [tx]);
  assert(result.mode === 'no_match', '0.01 decimal off → no match (zero tolerance)');
}

// ============================================================
// SCENARIO 19: Re-evaluation after attach is idempotent
// (Once a treasury row gets source_check_id stamped, re-evaluating goes to already_linked)
// ============================================================
group('SCENARIO 19: Re-evaluation after attach is idempotent');
{
  const inv = makeInvoice();
  const chk = makeCheck({ id: 'chk-X' });
  // Initially: candidate_match
  const tx = makeTreasury({ bank_in: 100000, linked_invoice_id: inv.id, matched_bank_txn_id: 'b1' });
  const r1 = evaluateCheckReconcile(chk, [inv], [tx]);
  assert(r1.mode === 'candidate_match', 'first eval: candidate');

  // Simulate attach — stamp source_check_id
  tx.source_check_id = 'chk-X';
  const r2 = evaluateCheckReconcile(chk, [inv], [tx]);
  assert(r2.mode === 'already_linked', 'after attach: already_linked');
  assert(r2.existingTreasury.id === tx.id, 'points to the same row');
}

// ============================================================
// SCENARIO 20: Check amount > total invoice (overpayment scenario)
// ============================================================
group('SCENARIO 20: Check exceeds invoice total');
{
  const inv = makeInvoice({ total_amount: 50000 });
  const chk = makeCheck({ amount: 100000 });
  const result = evaluateCheckReconcile(chk, [inv], []);
  assert(result.mode === 'no_match', 'no candidates exist → no_match (handler will create new)');
  // Note: handler doesn't currently warn about overpayment. Possible enhancement.
}

// ============================================================
// SCENARIO 21: Check on a customer's MULTIPLE invoices, only one matches
// ============================================================
group('SCENARIO 21: Multiple customer invoices');
{
  const inv1 = makeInvoice({ id: 'inv-1', order_number: '2280', total_amount: 100000 });
  const inv2 = makeInvoice({ id: 'inv-2', order_number: '2281', total_amount: 200000 });
  const tx1 = makeTreasury({ cash_in: 100000, linked_invoice_id: 'inv-1' });  // matches but on inv-1
  const tx2 = makeTreasury({ cash_in: 100000, linked_invoice_id: 'inv-2' });  // matches but on inv-2
  const chk = makeCheck({ order_number: '2281', amount: 100000 });  // explicitly for 2281
  const result = evaluateCheckReconcile(chk, [inv1, inv2], [tx1, tx2]);
  assert(result.mode === 'candidate_match', 'should find candidate');
  assert(result.candidates.length === 1, 'only the inv-2 candidate, not inv-1');
  assert(result.candidates[0].id === tx2.id, 'correct invoice candidate');
}

// ============================================================
// FINAL REPORT
// ============================================================
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('TEST RESULTS');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failures.length > 0) {
  console.log('\nFAILURES:');
  failures.forEach(f => console.log('  -', f.name, f.detail ? '(' + f.detail + ')' : ''));
  process.exit(1);
}
console.log('\n✅ ALL TESTS PASSED');
