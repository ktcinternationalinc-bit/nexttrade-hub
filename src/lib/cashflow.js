// v55.83-PB — Cash-flow math (Max, Nov 5): "see how money will move in and
// out for a period of time... compare what funds coming in to pay bills".
// Pure functions so the launch test can exercise the real math.

export function billOpenBalance(bill, payments) {
  var paid = 0;
  for (var i = 0; i < (payments || []).length; i++) {
    var p = payments[i];
    if (p && p.bill_id === bill.id && p.voided !== true) { paid += Number(p.amount) || 0; }
  }
  var open = (Number(bill.total_amount) || 0) - paid;
  return { paid: Math.round(paid * 100) / 100, open: Math.round(open * 100) / 100 };
}

export function billStatus(bill, payments) {
  if (bill.record_status === 'void') { return 'VOID'; }
  var b = billOpenBalance(bill, payments);
  if (b.open <= 0.005) { return 'PAID'; }
  if (b.paid > 0.005) { return 'PARTIAL'; }
  return 'OPEN';
}

// Period cash-flow: what CAME IN and WENT OUT (settled bank reality), and what
// is EXPECTED in and due out (open AR vs open bills) inside [from, to].
// invoices: [{open_balance, due_date, invoice_date}] already US-scoped+live.
// bankTx: [{direction,'in'|'out', amount_abs, date, pending}] US-scoped.
export function cashflowSummary(opts) {
  var from = opts.from || '0000-01-01';
  var to = opts.to || '9999-12-31';
  function inPeriod(d) { return !!d && d >= from && d <= to; }

  var actualIn = 0, actualOut = 0, actualInN = 0, actualOutN = 0;
  (opts.bankTx || []).forEach(function (t) {
    if (!t || t.pending === true || !inPeriod(t.date)) { return; }
    if (t.direction === 'in') { actualIn += Number(t.amount_abs) || 0; actualInN++; }
    else if (t.direction === 'out') { actualOut += Number(t.amount_abs) || 0; actualOutN++; }
  });

  var expectedIn = 0, expectedInN = 0;
  (opts.invoices || []).forEach(function (inv) {
    var open = Number(inv.open_balance) || 0;
    if (open <= 0.005) { return; }
    var due = inv.due_date || inv.invoice_date;
    if (inPeriod(due)) { expectedIn += open; expectedInN++; }
  });

  var dueOut = 0, dueOutN = 0, overdueOut = 0;
  (opts.openBills || []).forEach(function (b) {
    var open = Number(b.open) || 0;
    if (open <= 0.005) { return; }
    if (inPeriod(b.due_date || b.bill_date)) { dueOut += open; dueOutN++; }
    if ((b.due_date || '9999') < (opts.today || '0000')) { overdueOut += open; }
  });

  function r2(x) { return Math.round(x * 100) / 100; }
  return {
    actual_in: r2(actualIn), actual_in_count: actualInN,
    actual_out: r2(actualOut), actual_out_count: actualOutN,
    actual_net: r2(actualIn - actualOut),
    expected_in: r2(expectedIn), expected_in_count: expectedInN,
    due_out: r2(dueOut), due_out_count: dueOutN,
    overdue_out: r2(overdueOut),
    projected_net: r2(expectedIn - dueOut),
  };
}
