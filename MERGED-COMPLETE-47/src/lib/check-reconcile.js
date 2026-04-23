// ============================================================
// CHECK RECONCILE EVALUATOR (pure function, fully testable)
// ============================================================
//
// Given a check + the current invoices/treasury arrays, returns
// an evaluation describing what should happen if the user collects
// this check. Modes:
//
//   'no_invoice'         — check has no invoice link → fall back to creating treasury
//   'already_linked'     — a treasury row already points back via source_check_id
//   'candidate_match'    — found N treasury rows on the invoice with EXACT matching amount
//                          (zero tolerance — face value must be exact)
//   'no_match'           — no candidate found; user must choose how to record collection
//
// EXACT-amount matching (0 tolerance) — printed face value of a check is unambiguous.
//
// Returns:
//   { mode, checkAmount, invoice?, candidates?, existingTreasury?, message }

export function evaluateCheckReconcile(chk, invoices, treasury) {
  invoices = Array.isArray(invoices) ? invoices : [];
  treasury = Array.isArray(treasury) ? treasury : [];

  if (!chk) {
    return { mode: 'no_invoice', checkAmount: 0, message: 'No check provided.' };
  }
  const amt = Number(chk.amount || 0);

  // Find linked invoice
  let inv = null;
  if (chk.invoice_id) inv = invoices.find(i => i.id === chk.invoice_id) || null;
  if (!inv && chk.order_number) {
    const target = String(chk.order_number).trim();
    inv = invoices.find(i => String(i.order_number || '').trim() === target) || null;
  }
  if (!inv) {
    return { mode: 'no_invoice', checkAmount: amt, message: 'Check has no linked invoice.' };
  }

  // Already explicitly linked? — a treasury row points back to this check via source_check_id
  const existing = treasury.find(t => t.source_check_id === chk.id);
  if (existing) {
    return {
      mode: 'already_linked',
      checkAmount: amt,
      invoice: inv,
      existingTreasury: existing,
      message: 'Already linked to a treasury entry — closing this check will NOT create a new one.'
    };
  }

  // Candidate matches: treasury rows on this invoice whose inflow EXACTLY equals the check amount
  // and which are not yet tied to a different check.
  const candidates = treasury.filter(t => {
    if (t.linked_invoice_id !== inv.id) return false;
    if (t.is_bank_placeholder) return false;
    if (t.source_check_id) return false;
    if (String(t.description || '').includes('[bank confirmation')) return false;
    const inflow = Number(t.cash_in || 0) + Number(t.bank_in || 0);
    return inflow === amt;
  });

  if (candidates.length > 0) {
    return {
      mode: 'candidate_match',
      checkAmount: amt,
      invoice: inv,
      candidates,
      message: candidates.length === 1
        ? 'Found 1 treasury entry matching the check amount exactly.'
        : 'Found ' + candidates.length + ' treasury entries matching the check amount exactly.'
    };
  }

  return {
    mode: 'no_match',
    checkAmount: amt,
    invoice: inv,
    message: 'No existing treasury entry on this invoice matches the check amount of ' + amt + ' exactly.'
  };
}
