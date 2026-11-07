// v55.83-PD — Cash forecast aging (Max, Nov 6): "what's coming in the next 30
// days, 30 to 60, 60 to 90, or 90 plus... bills that we owe same thing...
// shortages that we're expecting... are we in the plus or minus paying our
// bills... by clicking in those cards we should see the underlying numbers".
//
// HONESTY RULE: money already past its due date is NOT "coming in the next
// 30 days" — it gets its own LATE buckets, aged 1-30/31-60/61-90/90+ (Max,
// Nov 6: "late 1-30 days. 30-60. 60-90. 90+. same with bills"), so old AR
// can't dress up as near-term cash. Date basis: due_date, falling back to
// invoice/bill date.
// Pure functions; the launch test runs the real math.

export var BUCKETS = ['L90+', 'L61-90', 'L31-60', 'L1-30', 'D0-30', 'D31-60', 'D61-90', 'D90+'];
// L* = already LATE, bucketed by how many days past due (Max, Nov 6: "late
// 1-30 days. 30-60. 60-90. 90+. same with bills"). D* = coming due ahead.
// Reading order: oldest debt first, then the future.

export function bucketOf(dueDate, today) {
  if (!dueDate) { return 'L90+'; } // no date = no promise: oldest bucket, never future cash
  var days = Math.round((Date.parse(dueDate) - Date.parse(today)) / 86400000);
  if (days < 0) {
    var late = -days;
    if (late <= 30) { return 'L1-30'; }
    if (late <= 60) { return 'L31-60'; }
    if (late <= 90) { return 'L61-90'; }
    return 'L90+';
  }
  if (days <= 30) { return 'D0-30'; }
  if (days <= 60) { return 'D31-60'; }
  if (days <= 90) { return 'D61-90'; }
  return 'D90+';
}

function r2(x) { return Math.round(x * 100) / 100; }

// invoices: [{open_balance, due_date, invoice_date, ...}] — already open-only.
// bills:    [{open, due_date, bill_date, ...}] — already open-only.
export function forecastBuckets(invoices, bills, today) {
  var out = {};
  BUCKETS.forEach(function (b) { out[b] = { ar: 0, ar_count: 0, ap: 0, ap_count: 0, net: 0 }; });
  (invoices || []).forEach(function (v) {
    var open = Number(v.open_balance) || 0;
    if (open <= 0.005) { return; }
    var b = bucketOf(v.due_date || v.invoice_date, today);
    out[b].ar = r2(out[b].ar + open); out[b].ar_count++;
  });
  (bills || []).forEach(function (b2) {
    var open = Number(b2.open) || 0;
    if (open <= 0.005) { return; }
    var b = bucketOf(b2.due_date || b2.bill_date, today);
    out[b].ap = r2(out[b].ap + open); out[b].ap_count++;
  });
  var running = 0;
  BUCKETS.forEach(function (b) {
    out[b].net = r2(out[b].ar - out[b].ap);
    running = r2(running + out[b].net);
    out[b].running = running; // cumulative position: can we pay the bills as they come due?
  });
  return out;
}

// Tag every row with its bucket so drill-downs sum EXACTLY to the cards.
export function tagRows(invoices, bills, today) {
  var rows = [];
  (invoices || []).forEach(function (v) {
    var open = Number(v.open_balance) || 0;
    if (open <= 0.005) { return; }
    rows.push({ kind: 'in', bucket: bucketOf(v.due_date || v.invoice_date, today),
      ref: v.invoice_number || v.id, who: v.customer || '', date: v.due_date || v.invoice_date || '',
      amount: r2(open), source: 'Invoice' + (v.due_date ? ' · due ' + v.due_date : ' · no due date, dated ' + (v.invoice_date || '?')) });
  });
  (bills || []).forEach(function (b2) {
    var open = Number(b2.open) || 0;
    if (open <= 0.005) { return; }
    rows.push({ kind: 'out', bucket: bucketOf(b2.due_date || b2.bill_date, today),
      ref: b2.bill_number || b2.id, who: b2.vendor_name || '', date: b2.due_date || b2.bill_date || '',
      amount: r2(open), source: 'Bill' + (b2.due_date ? ' · due ' + b2.due_date : ' · no due date') });
  });
  return rows;
}
