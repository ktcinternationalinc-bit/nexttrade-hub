// ============================================================
// v55.82-B — Treasury workflow QA fixes
//
// Max reported (May 9, 2026):
//   "Recheck code in Treasury when adding transaction without invoice,
//    then adding invoice, when submitting receiving [some] error.
//    Examine very thoroughly for gaps, error messages, bugs."
//
// Findings + fixes covered by this test file:
//
//   #1 EDIT-PATH AUTO-LINK GAP (root cause of Max's report)
//      handleSaveTreasuryEdit wrote a new order# but never set
//      linked_invoice_id. Row stayed unlinked even when a matching
//      invoice existed. Inspector showed orphaned rows. Invoice's
//      outstanding never moved.
//      FIX: detect order# change, look up matching invoice, set
//      linked_invoice_id, recalc both old and new invoice. Tests 1a–1g.
//
//   #1b ALERT() → TOAST() in handleSaveTreasuryEdit, handleDeleteTreasury,
//      unlinkTreasury. Native browser alerts on mobile feel like
//      browser errors not app feedback. Tests 1h–1j (source-grep).
//
//   #2 ORPHAN-INVOICE on inline-create 23505
//      finalizePendingTreasury surfaced raw SQL on unique-constraint
//      hits. Invoice stayed in DB as orphan. Tests 2a–2c.
//
//   #3 INCOME-NEEDS-ORDER# moved into persistent banner
//      Was a one-shot corner toast, now an entry in treasuryFormErrors.
//      Tests 3a–3d.
//
//   #4 EDIT MODAL link-status indicator
//      Live "✓ Will link to X" / "⚠ No match" chip under order# input.
//      Tests 4a–4c (source-grep — UI rendering only).
//
//   #6 closePendingTreasuryModal cleanup completeness
//      Now also wipes __newInvCustomerAutoLinked and __newInvSearch.
//      Tests 6a–6b.
// ============================================================

var assert = require('assert');
var fs = require('fs');
var path = require('path');

var failures = [];
function ok(label, cond, hint) {
  if (cond) { console.log('✓ ' + label); }
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

var pageSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'page.jsx'), 'utf8');

// =====================================================================
// FIX #1 — Edit-path auto-link
//
// Mirrors the new logic in handleSaveTreasuryEdit. Returns:
//   { writtenLinkedInvoiceId: <id|null|"unchanged">, recalcCalls: [...] }
// =====================================================================

function simulateHandleSaveTreasuryEdit(original, updates, invoices) {
  var oldOrderTrim = String((original && original.order_number) || '').trim();
  var hasOrderInUpdates = Object.prototype.hasOwnProperty.call(updates, 'order_number');
  var newOrderTrim = hasOrderInUpdates
    ? String(updates.order_number || '').trim()
    : oldOrderTrim;
  var orderChanged = newOrderTrim !== oldOrderTrim;
  var oldLinkedInvoiceId = (original && original.linked_invoice_id) || null;
  var newLinkedInvoiceId = oldLinkedInvoiceId;
  var matchingInvoice = null;
  var resolvedUpdates = Object.assign({}, updates);

  if (orderChanged) {
    if (!newOrderTrim) {
      resolvedUpdates.linked_invoice_id = null;
      newLinkedInvoiceId = null;
    } else {
      matchingInvoice = (invoices || []).find(function(i) {
        return String(i.order_number || '').trim() === newOrderTrim;
      });
      if (matchingInvoice) {
        resolvedUpdates.linked_invoice_id = matchingInvoice.id;
        newLinkedInvoiceId = matchingInvoice.id;
      } else {
        resolvedUpdates.linked_invoice_id = null;
        newLinkedInvoiceId = null;
      }
    }
  }

  // Recalc tracking
  var recalcCalls = [];
  if (oldLinkedInvoiceId && oldLinkedInvoiceId !== newLinkedInvoiceId) {
    recalcCalls.push(oldLinkedInvoiceId);
  }
  if (newLinkedInvoiceId) {
    var moneyFields = ['cash_in', 'cash_out', 'bank_in', 'bank_out', 'expected_amount'];
    var amountChanged = original && moneyFields.some(function(f) {
      if (!Object.prototype.hasOwnProperty.call(updates, f)) return false;
      return Number(updates[f] || 0) !== Number(original[f] || 0);
    });
    var newlyLinked = oldLinkedInvoiceId !== newLinkedInvoiceId;
    if (amountChanged || newlyLinked) {
      recalcCalls.push(newLinkedInvoiceId);
    }
  }

  return {
    resolvedUpdates: resolvedUpdates,
    matchingInvoice: matchingInvoice,
    recalcCalls: recalcCalls,
    writtenLinkedInvoiceId: Object.prototype.hasOwnProperty.call(resolvedUpdates, 'linked_invoice_id')
      ? resolvedUpdates.linked_invoice_id
      : oldLinkedInvoiceId,
  };
}

var INVOICES = [
  { id: 'inv-A', order_number: '1234', customer_name: 'Shawar Home', total_amount: 5000 },
  { id: 'inv-B', order_number: '5678', customer_name: 'Hammad Co', total_amount: 8000 },
];

// 1a — Editing a row to ADD a matching order# auto-links the invoice.
//      THIS IS THE FIX FOR MAX'S REPRODUCTION.
ok('1a: edit row to add matching order# → linked_invoice_id is set [MAX BUG]',
  (function() {
    var original = { id: 't1', order_number: '', linked_invoice_id: null, cash_in: 5000, cash_out: 0 };
    var r = simulateHandleSaveTreasuryEdit(original, { order_number: '1234' }, INVOICES);
    return r.writtenLinkedInvoiceId === 'inv-A' && r.matchingInvoice && r.matchingInvoice.id === 'inv-A';
  })(),
  'this is the case Max reported as broken — must auto-link to inv-A'
);

// 1b — That edit ALSO recalcs the newly-linked invoice
ok('1b: newly-linked invoice gets recalcInvoiceCollected on save',
  (function() {
    var original = { id: 't1', order_number: '', linked_invoice_id: null, cash_in: 5000, cash_out: 0 };
    var r = simulateHandleSaveTreasuryEdit(original, { order_number: '1234' }, INVOICES);
    return r.recalcCalls.indexOf('inv-A') >= 0;
  })()
);

// 1c — Editing order# to a NEW different invoice unlinks the old one
//      AND links the new one. BOTH invoices get recalced.
ok('1c: re-link from inv-A to inv-B → both invoices recalced',
  (function() {
    var original = { id: 't1', order_number: '1234', linked_invoice_id: 'inv-A', cash_in: 5000, cash_out: 0 };
    var r = simulateHandleSaveTreasuryEdit(original, { order_number: '5678' }, INVOICES);
    return r.writtenLinkedInvoiceId === 'inv-B'
      && r.recalcCalls.indexOf('inv-A') >= 0
      && r.recalcCalls.indexOf('inv-B') >= 0;
  })()
);

// 1d — Clearing the order# unlinks the row AND recalcs the old invoice
ok('1d: clearing order# → linked_invoice_id null, old invoice recalced',
  (function() {
    var original = { id: 't1', order_number: '1234', linked_invoice_id: 'inv-A', cash_in: 5000, cash_out: 0 };
    var r = simulateHandleSaveTreasuryEdit(original, { order_number: '' }, INVOICES);
    return r.writtenLinkedInvoiceId === null && r.recalcCalls.indexOf('inv-A') >= 0;
  })()
);

// 1e — Order# changed to non-matching string → linked_invoice_id null,
//      old invoice recalced. Save still proceeds (don't block edits).
ok('1e: order# changed to typo → unlinked, save still proceeds',
  (function() {
    var original = { id: 't1', order_number: '1234', linked_invoice_id: 'inv-A', cash_in: 5000, cash_out: 0 };
    var r = simulateHandleSaveTreasuryEdit(original, { order_number: '99999' }, INVOICES);
    return r.writtenLinkedInvoiceId === null
      && !r.matchingInvoice                          // undefined or null both fine
      && r.recalcCalls.indexOf('inv-A') >= 0;
  })()
);

// 1f — Editing only the AMOUNT on an already-linked row → recalc fires
//      for the linked invoice (existing v55.42 behavior preserved).
ok('1f: amount-only edit on linked row → invoice recalc preserved',
  (function() {
    var original = { id: 't1', order_number: '1234', linked_invoice_id: 'inv-A', cash_in: 5000, cash_out: 0 };
    var r = simulateHandleSaveTreasuryEdit(original, { cash_in: 3000 }, INVOICES);
    return r.recalcCalls.indexOf('inv-A') >= 0
      && r.writtenLinkedInvoiceId === 'inv-A';
  })()
);

// 1g — Order# unchanged + no money change → no recalc fires
ok('1g: pure category/description edit → no recalc (no-op)',
  (function() {
    var original = { id: 't1', order_number: '1234', linked_invoice_id: 'inv-A', cash_in: 5000, cash_out: 0 };
    var r = simulateHandleSaveTreasuryEdit(original, { description: 'updated desc' }, INVOICES);
    return r.recalcCalls.length === 0;
  })()
);

// 1h — handleSaveTreasuryEdit no longer uses native alert() in catch
ok('1h: handleSaveTreasuryEdit catch uses toast.error not alert',
  /handleSaveTreasuryEdit[\s\S]{0,7000}toast\.error\('Save error/.test(pageSrc),
  'must use toast.error for the save-failure path'
);

// 1i — handleDeleteTreasury catch uses toast.error
ok('1i: handleDeleteTreasury catch uses toast.error not alert',
  /handleDeleteTreasury[\s\S]{0,3000}toast\.error\('Delete error/.test(pageSrc),
  'must use toast.error for the delete-failure path'
);

// 1j — unlinkTreasury catch uses toast.error
ok('1j: unlinkTreasury catch uses toast.error not alert',
  /unlinkTreasury[\s\S]{0,3000}toast\.error\('Unlink error/.test(pageSrc)
);

// =====================================================================
// FIX #2 — finalizePendingTreasury graceful 23505 handling
// =====================================================================

// 2a — code path detects pgcode 23505
ok('2a: finalizePendingTreasury checks for pgcode === \'23505\'',
  /finalizePendingTreasury[\s\S]{0,4000}pgcode === '23505'/.test(pageSrc),
  'unique-violation must be detected so we can show recovery hint instead of raw SQL'
);

// 2b — code path also matches "duplicate key value" / "unique constraint" text
ok('2b: finalizePendingTreasury also pattern-matches duplicate-key text',
  /finalizePendingTreasury[\s\S]{0,4000}\/duplicate key value\/i\.test/.test(pageSrc)
  && /finalizePendingTreasury[\s\S]{0,4000}\/unique constraint\/i\.test/.test(pageSrc)
);

// 2c — banner message is friendly, not a raw error.message dump
ok('2c: 23505 path sets a friendly banner, not raw SQL',
  /A matching cash\/bank entry already exists/.test(pageSrc),
  'red banner now explains what happened in plain language'
);

// =====================================================================
// FIX #3 — Income-needs-Order# in persistent banner
// =====================================================================

// 3a — handleAddTreasury validation block now checks income+no-order#
ok('3a: validation block pushes orderNumber error for income with no order#',
  /preIsIncome &&[\s\S]{0,400}preOrderTrim/.test(pageSrc),
  'check must run during validation (errs collection), not as a late toast'
);

// 3b — non-order income categories still bypass the gate
ok('3b: validation honors non-order income category exception',
  /preNonOrderIncomeCats[\s\S]{0,200}Owner Contribution/.test(pageSrc),
  'category list must include Owner Contribution, Refund, Loan, etc.'
);

// 3c — error label points at the orderNumber field for scroll-into-view
ok('3c: error entry uses field=\'orderNumber\' so scrollIntoView works',
  /preIsIncome[\s\S]{0,1200}field: 'orderNumber'/.test(pageSrc)
);

// 3d — bilingual message present
ok('3d: error message is bilingual (English + Arabic)',
  /Required for Cash IN[\s\S]{0,300}مطلوب لربط الدفعة بفاتورة عميل/.test(pageSrc)
);

// =====================================================================
// FIX #4 — Edit modal link-status chip
// =====================================================================

// 4a — edit modal computes match by trimmed order#
ok('4a: Edit modal renders "Will link on save" chip when match exists',
  /Will link on save/.test(pageSrc),
  'live indicator under the order# input'
);

// 4b — no-match warning is shown
ok('4b: Edit modal renders "No matching invoice" warning when no match',
  /No matching invoice/.test(pageSrc)
);

// 4c — empty-order indicator is shown
ok('4c: Edit modal renders "row will be saved unlinked" hint when blank',
  /row will be saved unlinked/.test(pageSrc)
);

// =====================================================================
// FIX #6 — closePendingTreasuryModal cleanup
// =====================================================================

// 6a — strip __newInvCustomerAutoLinked
ok('6a: closePendingTreasuryModal deletes __newInvCustomerAutoLinked',
  /closePendingTreasuryModal[\s\S]{0,2000}delete next\.__newInvCustomerAutoLinked/.test(pageSrc),
  'auto-link flag must not survive a modal close'
);

// 6b — strip __newInvSearch
ok('6b: closePendingTreasuryModal deletes __newInvSearch',
  /closePendingTreasuryModal[\s\S]{0,2000}delete next\.__newInvSearch/.test(pageSrc),
  'search seed must not survive a modal close'
);

// =====================================================================
// Final
// =====================================================================

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' test' + (failures.length === 1 ? '' : 's') + ' failed:');
  failures.forEach(function(f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.82-B Treasury workflow tests passed (' +
  (pageSrc.split('\n').length) + '-line page.jsx scanned)');
