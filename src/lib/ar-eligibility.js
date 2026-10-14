// v55.83-BK — THE single source of truth for "does this invoice count toward AR?"
// Used by the dashboard, AR aging, overdue, customer balances, top-customer
// widgets, and Customer AR History so the rule can never drift between screens.
//
// AR-eligible = an APPROVED receivable:
//   • NOT void / cancelled / archived / deleted
//   • NOT a Wave DRAFT  (drafts are unapproved — excluded)
//   • Unsent (Wave "SAVED"), Sent, Overdue, Partial, Unpaid, Overpaid → INCLUDED
//   • Hub-created invoices (no Wave status): must be approval_status === 'approved'
//
// Currency is a SEPARATE axis — callers still keep EGP/USD apart; this only
// decides status eligibility.
export function isArEligible(inv) {
  if (!inv) { return false; }
  var rs = inv.record_status;
  if (rs === 'void' || rs === 'cancelled' || rs === 'archived' || rs === 'deleted') { return false; }
  var ws = inv.wave_status;
  if (ws) { return ws !== 'DRAFT'; }            // Wave invoice: only true drafts excluded
  // v55.83-OT (Max, Oct 14): "these should include ALL invoices that have been
  // entered in the KTC systems, whether they have been pushed to wave or not."
  // His team's real invoices live as approval_status=draft (the approval flow
  // is optional in practice) — 65 of 75 US invoices were invisible on the
  // dashboard because of the old approved-only rule. Hub-entered = it counts.
  return true;                                    // Hub-created: entered = counts
}

export function arCurrencyOf(inv) { return (inv && inv.currency) || 'USD'; }
