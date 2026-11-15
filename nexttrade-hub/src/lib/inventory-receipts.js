// v55.83-IH — single source of truth for which inventory_stock_receipts statuses are "as good as
// deleted" and must NOT count toward stock / received qty. Inventory Overview and the Inventory
// Report Center both excluded these, but each hard-coded its own copy of the list — exactly the
// drift that caused the GX Overview-vs-Report reconciliation bug. Import this in both so they can
// never disagree again.
//
// Excluded:
//   cancelled      — voided receipt, as good as deleted
//   pending_detail — logged but not physically counted yet (expected/placeholder qty)
//   merged         — folded into another receipt
//   reversed       — reversal of a prior receipt
export var INVALID_RECEIPT_STATUSES = ['cancelled', 'pending_detail', 'merged', 'reversed'];

// True when a receipt should count toward stock / received qty. A row with no status is treated
// as countable (legacy rows predate the status column).
export function isCountableReceipt(r) {
  if (!r) { return false; }
  if (!r.status) { return true; }
  return INVALID_RECEIPT_STATUSES.indexOf(r.status) === -1;
}
