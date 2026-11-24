// v55.83-YD / YF (Codex 24 Nov: "include the refund in shared allocation/readback calculations so staff see zero available") — a bank line
// taken WHOLE as a vendor credit refund (YD) or paired with cash taken to the bank (YF) has nothing left to allocate. The database refuses
// any other allocation on it (hub_bank_line_exclusive_guard); this file makes the Hub's own allocation figures say the same, with the
// reason. The same text ships in YD and YF. Before their database steps the tables are missing: that, and only that, reads as "no such use".
// SWC-safe: var + concatenation.
function missing(err) { return !!err && (/does not exist|schema cache|Could not find/i.test(String(err.message || '')) || err.code === '42P01'); }

// → { use: 'vendor_refund' | 'cash_deposit' | null, label, error }
export async function exclusiveUseOf(db, txnId) {
  if (!txnId) { return { use: null }; }
  var v = await db.from('vendor_credit_applications').select('id, voided, kind').eq('kind', 'refund').eq('bank_transaction_id', txnId);
  if (v.error && !missing(v.error)) { return { use: null, error: 'Could not check vendor credit refunds (' + v.error.message + ').' }; }
  if (!v.error && (v.data || []).some(function (x) { return x.voided !== true; })) { return { use: 'vendor_refund', label: 'Vendor credit refund — undo the refund first (Bills → Vendor credits).' }; }
  var c = await db.from('cash_entries').select('id, voided').eq('deposit_bank_transaction_id', txnId);
  if (c.error && !missing(c.error)) { return { use: null, error: 'Could not check cash deposits (' + c.error.message + ').' }; }
  if (!c.error && (c.data || []).some(function (x) { return x.voided !== true; })) { return { use: 'cash_deposit', label: 'Cash taken to the bank — undo that cash deposit first (Accounting → Cash on Hand).' }; }
  return { use: null };
}

// the allocation summary for a line taken whole: nothing left; complete; the reason said
export function withExclusiveUse(summary, ex) {
  if (!summary || summary.missing || !ex || !ex.use) { return summary; }
  return Object.assign({}, summary, { allocated: summary.total, remaining: 0, complete: true, hasPiecewise: true, overAllocated: false, exclusive: ex.use, exclusive_label: ex.label });
}

// which of these bank lines already have ANY use (the same list as the database's hub_bank_line_other_use): for the pickers, so a line in
// use is never offered. → { taken: { id: 'reason' }, error }. Optional tables missing = no such use.
export async function occupiedLines(db, ids) {
  var taken = {}; var list = (ids || []).filter(Boolean);
  var checks = [
    ['accounting_invoice_payments', 'bank_transaction_id', 'bank_transaction_id, voided, sync_status', function (x) { return x.voided !== true && x.sync_status !== 'void'; }, 'a customer payment'],
    ['payment_matches', 'bank_transaction_id', 'bank_transaction_id, voided', function (x) { return x.voided !== true; }, 'matched to an invoice'],
    ['bank_transaction_splits', 'bank_transaction_id', 'bank_transaction_id', function () { return true; }, 'split into lines'],
    ['unapplied_deposits', 'bank_transaction_id', 'bank_transaction_id, status', function (x) { return !x.status || x.status === 'open'; }, 'parked as an unapplied deposit'],
    ['customer_credits', 'source_transaction_id', 'source_transaction_id, status', function (x) { return !x.status || x.status === 'open'; }, 'an open customer credit'],
    ['party_money_entries', 'bank_transaction_id', 'bank_transaction_id, kind', function (x) { return x.kind === 'refund'; }, 'money back from RTM / NextTrade'],
    ['vendor_credit_applications', 'bank_transaction_id', 'bank_transaction_id, voided, kind', function (x) { return x.kind === 'refund' && x.voided !== true; }, 'a vendor credit refund'],
    ['cash_entries', 'deposit_bank_transaction_id', 'deposit_bank_transaction_id, voided', function (x) { return x.voided !== true; }, 'cash taken to the bank']];
  for (var i = 0; i < list.length; i += 200) {
    var part = list.slice(i, i + 200);
    for (var k = 0; k < checks.length; k++) {
      var c = checks[k];
      var q = await db.from(c[0]).select(c[2]).in(c[1], part);
      if (q.error) { if (missing(q.error)) { continue; } return { taken: null, error: 'Could not check what the bank lines are used for (' + c[0] + ': ' + q.error.message + ').' }; }
      (q.data || []).forEach(function (x) { if (c[3](x) && !taken[x[c[1]]]) { taken[x[c[1]]] = c[4]; } });
    }
  }
  return { taken: taken, error: null };
}
