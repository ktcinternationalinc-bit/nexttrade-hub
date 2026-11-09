// v55.83-RG — Saved order reconciliations (Max, Nov 8 15:32): "for order
// reconciliation needs to keep record of each one completed.. save it and it
// needs to be manually reconciled and approved."
//
// Pure functions (the launch test runs them). A saved run = a frozen snapshot
// of the report + one resolution per exception line. Lifecycle:
//   open → (every exception line resolved with a note) → RECONCILED by one
//   person → APPROVED by a DIFFERENT person → locked forever.
// Exception lines = orders with no invoice + invoices with no order. Open
// balances are kept in the snapshot for the record (they stay flagged until
// paid, on the AR side) but do not need a line-by-line resolution.

function nk(x) { return String(x == null ? '' : x).toUpperCase().replace(/\s+/g, '').trim(); }

export function reconLines(snapshot) {
  var s = snapshot || {}; var out = [];
  (s.orders_without_invoice || []).forEach(function (o) {
    out.push({ key: 'noinv:' + nk(o.release_number), kind: 'order_without_invoice', ref: o.release_number, who: o.customer || '', date: o.order_date || null, amount: null });
  });
  (s.invoices_without_order || []).forEach(function (v) {
    out.push({ key: 'noorder:' + (v.system || '') + ':' + nk(v.ref), kind: 'invoice_without_order', ref: v.ref, who: v.customer || '', date: v.invoice_date || null, amount: v.total_amount == null ? null : Number(v.total_amount) });
  });
  // the same key twice (duplicate rows in a report) is ONE line to resolve
  var seen = {}; return out.filter(function (l) { if (seen[l.key]) { return false; } seen[l.key] = true; return true; });
}

export function reconProgress(snapshot, lines) {
  var all = reconLines(snapshot); var res = lines || {}; var done = 0;
  all.forEach(function (l) { var r = res[l.key]; if (r && r.resolved === true && String(r.note || '').trim().length >= 3) { done += 1; } });
  return { total: all.length, resolved: done, open: all.length - done, complete: done === all.length };
}

// What may happen next to a saved run, and why not. actorId = who is asking.
export function reconNext(run, actorId) {
  var r = run || {}; var p = reconProgress(r.snapshot, r.lines);
  if (r.status === 'approved') { return { can_edit: false, can_reconcile: false, can_approve: false, why: 'Approved — locked.' }; }
  if (r.status === 'reconciled') {
    var same = !!(actorId && r.reconciled_by && actorId === r.reconciled_by);
    return { can_edit: false, can_reconcile: false, can_approve: !same, why: same ? 'You reconciled it — a DIFFERENT person must approve.' : '' };
  }
  return { can_edit: true, can_reconcile: p.complete, can_approve: false, why: p.complete ? '' : (p.open + ' line(s) still need a resolution note.') };
}

export var RECON_STATUS_LABEL = { open: '🟡 open — resolving lines', reconciled: '🔵 reconciled — awaiting approval', approved: '✅ approved' };
