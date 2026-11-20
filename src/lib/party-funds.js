// v55.83 — FUNDS WITH RTM / NEXTTRADE: the ONE calculation (Max, 20 Nov 2026).
// Money KTC sends RTM or NextTrade is FUNDING. Internally it is not an expense by itself:
//   • the part applied to underlying bills is counted ONCE, in those bills' own categories and periods — never again as a fee;
//   • only an EXPLICITLY designated "services rendered" amount is a professional-fee expense;
//   • what is not used yet stays available (unused / awaiting allocation) — it never reduces profit, in any month.
// The TAX presentation is separate: the full original transfer, once, on its payment date (no change when funds are used later).
// Pure and read-only: it only reads records that already exist. RTM and NextTrade never mix. Every figure is traced to an
// ORIGINAL transfer (a KTC money-out bank line marked for that company). Safe on server and browser. SWC-safe.
function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
function key(x) { return String(x == null ? '' : x).trim().toLowerCase(); }
function day(x) { return String(x == null ? '' : x).substring(0, 10); }
function inRange(d, from, to) { return !!d && (!from || d >= from) && (!to || d <= to); }
var CLOSED = { attached: 1, cancelled: 1, reversed: 1, complete: 1 }; // a funded request in any other state still only RESERVES money

// o: { parties: [{ name }], bankLines: [{ id, date, amount_abs, third_party_payer, name, direction }], pays: [vendor_bill_payments],
//      bills: [vendor_bills] | { id: bill }, requests: [{ id, status, funding_txn_id, bank_transaction_id, fee_amount, sent_date, lines: [{ bill_id, amount, is_open }] }],
//      entries: [party_money_entries], from, to }   (from / to: YYYY-MM-DD, both optional; "as of" = to)
export function partyFundsBreakdown(o) {
  o = o || {}; var from = o.from || null; var to = o.to || null;
  var billById = {}; if (Array.isArray(o.bills)) { o.bills.forEach(function (b) { billById[b.id] = b; }); } else { billById = o.bills || {}; }
  return (o.parties || []).map(function (party) {
    var pk = key(party.name);
    var lines = (o.bankLines || []).filter(function (t) { return key(t.third_party_payer) === pk && t.direction !== 'in'; })
      .sort(function (a, b) { return day(a.date) < day(b.date) ? -1 : day(a.date) > day(b.date) ? 1 : String(a.id) < String(b.id) ? -1 : 1; });
    var lineIds = {}; lines.forEach(function (t) { lineIds[t.id] = true; });
    var per = { funds_sent: 0, applied_to_bills: 0, services_rendered: 0, opening_held: 0, closing_held: 0 };
    var asOf = { funds_sent: 0, applied_to_bills: 0, services_rendered: 0, reserved: 0, unused: 0 };
    var periodRows = []; var feeRows = [];
    function addFee(t, amount, date, why, id) {
      var a = r2(amount); if (!a) { return; }
      var d = day(date); var row = { transfer_id: t ? t.id : null, date: d, amount: a, why: why, id: id || null, in_period: inRange(d, from, to) };
      feeRows.push(row);
      if (t && (!to || d <= to)) { t._fees = r2(t._fees + a); }
      if (row.in_period) { per.services_rendered = r2(per.services_rendered + a); }
      if (!to || d <= to) { asOf.services_rendered = r2(asOf.services_rendered + a); }
      if (from && d < from) { per.opening_held = r2(per.opening_held - a); }
    }
    var transfers = lines.map(function (t) { return { id: t.id, date: day(t.date), reference: t.name || '', sent: r2(Math.abs(Number(t.amount_abs != null ? t.amount_abs : t.amount) || 0)), _bills: 0, _fees: 0, _reserved: 0, rows: [] }; });
    var tById = {}; transfers.forEach(function (t) { tById[t.id] = t; });
    transfers.forEach(function (t) {
      if (inRange(t.date, from, to)) { per.funds_sent = r2(per.funds_sent + t.sent); }
      if (!to || t.date <= to) { asOf.funds_sent = r2(asOf.funds_sent + t.sent); }
      if (from && t.date < from) { per.opening_held = r2(per.opening_held + t.sent); }
    });
    // applied to underlying bills: the allocated PORTIONS (payment rows on the transfer's own bank line), one row each
    (o.pays || []).forEach(function (p) {
      var t = tById[p.bank_transaction_id]; if (!t || p.voided === true) { return; }
      var b = billById[p.bill_id] || {}; var d = day(p.paid_date || t.date); var am = r2(p.amount);
      var row = { transfer_id: t.id, transfer_date: t.date, payment_id: p.id || null, paid_date: d, portion: am, bill_id: p.bill_id, vendor: b.vendor_name || '(bill)', bill_number: b.bill_number || null,
        bill_date: day(b.bill_date) || null, category: b.category || 'uncategorized', release_number: b.release_number || null, bill_total: b.total_amount != null ? r2(b.total_amount) : null,
        counted_in: { category: b.category || 'uncategorized', month: (day(b.bill_date) || d).substring(0, 7) }, // where this cost is recognized internally — once
        in_period: inRange(d, from, to) };
      t.rows.push(row);
      if (!to || d <= to) { t._bills = r2(t._bills + am); asOf.applied_to_bills = r2(asOf.applied_to_bills + am); }
      if (row.in_period) { per.applied_to_bills = r2(per.applied_to_bills + am); periodRows.push(row); }
      if (from && d < from) { per.opening_held = r2(per.opening_held - am); }
    });
    // explicit services rendered: (a) the fee of a request that was sent from the transfer, (b) fee entries of the advances ledger
    (o.requests || []).forEach(function (w) {
      var src = w.funding_txn_id || null; var t = tById[src] || null; if (!t) { return; }
      if (w.status === 'attached') { addFee(t, w.fee_amount, w.sent_date || t.date, 'service fee on a request', 'request:' + w.id); return; }
      if (CLOSED[w.status]) { return; }
      var held = r2(w.fee_amount); (w.lines || []).forEach(function (l) { if (l.is_open !== false) { held = r2(held + (Number(l.amount) || 0)); } });
      t._reserved = r2(t._reserved + held); // bills AND fee of a request not sent yet: the whole commitment
    });
    var unsourced = 0;
    (o.entries || []).forEach(function (e) {
      if (key(e.party) !== pk || e.bucket !== 'fee') { return; }
      var src = e.source_bank_transaction_id || e.bank_transaction_id || null; var t = tById[src] || null;
      var d = day(e.entry_date || (t && t.date) || e.created_at);
      if (!t) { unsourced = r2(unsourced + (Number(e.amount) || 0)); }
      addFee(t, e.amount, d, e.reason || 'services rendered', 'entry:' + e.id);
    });
    transfers.forEach(function (t) {
      t.applied_to_bills = t._bills; t.services_rendered = t._fees; t.reserved = t._reserved;
      t.unused = r2(t.sent - t._bills - t._fees - t._reserved); // can be negative only if the records disagree — shown, never hidden
      t.counted_as_of = !to || t.date <= to;
      if (t.counted_as_of) { asOf.reserved = r2(asOf.reserved + t.reserved); }
      delete t._bills; delete t._fees; delete t._reserved;
    });
    asOf.unused = r2(asOf.funds_sent - asOf.applied_to_bills - asOf.services_rendered - asOf.reserved);
    per.closing_held = r2(per.opening_held + per.funds_sent - per.applied_to_bills - per.services_rendered);
    return {
      party: party.name, transfers: transfers,
      // the period: flows only (what moved between from and to)
      period: { from: from, to: to, funds_sent: per.funds_sent, applied_to_bills: per.applied_to_bills, services_rendered: per.services_rendered,
        opening_held: per.opening_held, closing_held: per.closing_held, applied_rows: periodRows,
        fee_deduction: per.services_rendered,      // INTERNAL: the only amount that reduces profit as a professional fee in this period
        tax_professional_fees: per.funds_sent },   // TAX presentation: the full original transfers of the period, once
      // the balance as of `to`: closing held = reserved + unused (nothing overlaps)
      as_of: { date: to, funds_sent: asOf.funds_sent, applied_to_bills: asOf.applied_to_bills, services_rendered: asOf.services_rendered, reserved: asOf.reserved, unused: asOf.unused,
        held: r2(asOf.reserved + asOf.unused) },
      fee_rows: feeRows, fees_without_a_transfer: r2(unsourced),
      reconciles: Math.abs(r2(asOf.funds_sent - asOf.applied_to_bills - asOf.services_rendered - asOf.reserved - asOf.unused)) < 0.005 && Math.abs(r2(per.closing_held - asOf.reserved - asOf.unused)) < 0.005,
    };
  });
}

// The plain sentence for the pop-up, from REAL computed amounts (p = one party's .period).
export function feeExplanation(p, money) {
  var f = money || function (n) { return '$' + r2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var held = r2(p.closing_held);
  return 'Only ' + f(p.fee_deduction) + ' is deducted here as a professional fee. The ' + f(p.applied_to_bills) + ' allocated to underlying bills is not deducted again here; those costs are accounted for separately in their proper categories. '
    + (held >= 0 ? 'The unused ' + f(held) + ' does not reduce internal profit.' : 'More was used than was sent by ' + f(-held) + ' — needs reconciliation.');
}
