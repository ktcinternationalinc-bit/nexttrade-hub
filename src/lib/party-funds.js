// v55.83 — FUNDS WITH RTM / NEXTTRADE: the ONE calculation (Max, 20 Nov 2026).
// Money KTC sends RTM or NextTrade is FUNDING. Internally it is not an expense by itself:
//   • the part applied to underlying bills is counted ONCE, in those bills' own categories and periods — never again as a fee;
//   • only an EXPLICITLY designated "services rendered" amount is a professional-fee expense;
//   • what is not used yet stays held (unused / awaiting allocation, or reserved for a request) — it never reduces profit.
// The TAX presentation is separate: the full original transfer, once, on its payment date (no change when funds are used later).
// Pure and read-only: it only reads records that already exist. RTM and NextTrade never mix. Every figure is traced to an
// ORIGINAL transfer (a KTC money-out bank line marked for that company). Safe on server and browser. SWC-safe.
//
// THREE views that are never mixed (Codex 20 Nov 12:36 / 13:02) — every subtotal has its OWN row list that adds up to it:
//   period  — what moved between `from` and `to`                       → period.applied_rows, period.fee_rows
//   as_of   — the position at the end of `to` (dated records only)     → transfers[].as_of_rows, .as_of_fee_rows
//   current — today: everything ever recorded, MINUS reservations      → transfers[].lifetime_rows, .lifetime_fee_rows
// Reservations carry no date, so they are shown ONLY in `current`, never labelled as a past period's balance.
function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
function key(x) { return String(x == null ? '' : x).trim().toLowerCase(); }
function day(x) { return String(x == null ? '' : x).substring(0, 10); }
function inRange(d, from, to) { return !!d && (!from || d >= from) && (!to || d <= to); }
function sum(rows, f) { var s = 0; (rows || []).forEach(function (r) { s += Number(r[f]) || 0; }); return r2(s); }
// WHICH COMPANY A BANK LINE IS MONEY SENT TO — the ONE identity rule, shared by this helper and every screen (Codex 20 Nov 13:07).
//   'marked'    — a person stamped the company on the line (third_party_payer). Established.
//   'bank_text' — nobody stamped it, but the bank's own text says it is a transfer TO one of the destination accounts Max named
//                 (RTM ending 9909, NextTrade ending 2061: "Online Transfer to CHK ...9909"). Treated as money sent to that company —
//                 so it is never a fee by default — and FLAGGED until a person confirms it. A category never identifies a company.
export var FUNDING_DESTINATIONS = [{ suffix: '9909', payer: 'RTM Capital' }, { suffix: '2061', payer: 'NextTrade Industries' }];
export function fundingPayerOfText(text) {
  var t = String(text || '');
  for (var i = 0; i < FUNDING_DESTINATIONS.length; i++) {
    var d = FUNDING_DESTINATIONS[i];
    if (new RegExp('\\bto\\s+(?:chk|checking|sav|savings)\\b[^0-9]{0,8}' + d.suffix + '(?![0-9])', 'i').test(t)) { return d.payer; }
  }
  return null;
}
// the bank's own transaction number inside the line's text ("… transaction#: 30116993096 …"), or null
export function bankRefOf(text) { var m = /transaction\s*#\s*:?\s*([0-9]{6,})/i.exec(String(text || '')); return m ? m[1] : null; }
export function fundingIdentity(line) {
  var l = line || {};
  if (l.direction === 'in') { return null; }
  if (String(l.third_party_payer || '').trim()) { return { payer: String(l.third_party_payer).trim(), basis: 'marked' }; }
  var byText = fundingPayerOfText(String(l.name || '') + ' ' + String(l.merchant_name || ''));
  return byText ? { payer: byText, basis: 'bank_text' } : null;
}
var CLOSED = { attached: 1, cancelled: 1, reversed: 1, complete: 1 }; // a funded request in any other state still only RESERVES money

// o: { parties: [{ name }], bankLines: [{ id, date, amount_abs, third_party_payer, name, direction }], pays: [vendor_bill_payments],
//      bills: [vendor_bills] | { id: bill }, requests: [{ id, status, funding_txn_id, fee_amount, sent_date, lines: [{ bill_id, amount, is_open }] }],
//      entries: [party_money_entries], from, to }   (from / to: YYYY-MM-DD, both optional)
export function partyFundsBreakdown(o) {
  o = o || {}; var from = o.from || null; var to = o.to || null;
  var billById = {}; if (Array.isArray(o.bills)) { o.bills.forEach(function (b) { billById[b.id] = b; }); } else { billById = o.bills || {}; }
  return (o.parties || []).map(function (party) {
    var pk = key(party.name);
    var idOf = {}; var lines = (o.bankLines || []).filter(function (t) { var who = fundingIdentity(t); if (!who || key(who.payer) !== pk) { return false; } idOf[t.id] = who.basis; return true; })
      .sort(function (a, b) { return day(a.date) < day(b.date) ? -1 : day(a.date) > day(b.date) ? 1 : String(a.id) < String(b.id) ? -1 : 1; });
    var transfers = lines.map(function (t) { return { id: t.id, date: day(t.date), reference: t.name || '', sent: r2(Math.abs(Number(t.amount_abs != null ? t.amount_abs : t.amount) || 0)), identity: idOf[t.id], lifetime_rows: [], lifetime_fee_rows: [], reserved_now: 0, reserved_rows: [] }; });
    var tById = {}; transfers.forEach(function (t) { tById[t.id] = t; });
    // THE SAME TRANSFER SEEN TWICE (one bank account connected twice gives two bank lines with the bank's own transaction number):
    // it is ONE transfer. The stamped line is kept (else the first); the other is listed, counted nowhere, and anything recorded
    // against it (a bill payment, a fee, a request) follows to the kept line — nothing is dropped, nothing is counted twice.
    var duplicates = []; var seenRef = {};
    transfers = transfers.filter(function (t) {
      var ref = bankRefOf(t.reference); if (!ref) { return true; }
      var k = ref + '|' + t.sent; var first = seenRef[k];
      if (!first) { seenRef[k] = t; return true; }
      var keep = first; var drop = t;
      if (first.identity !== 'marked' && t.identity === 'marked') { keep = t; drop = first; seenRef[k] = t; }
      duplicates.push({ id: drop.id, date: drop.date, sent: drop.sent, bank_reference: ref, same_as: keep.id });
      Object.keys(tById).forEach(function (id) { if (tById[id] === drop) { tById[id] = keep; } });
      if (keep === t) { return true; }
      return false;
    }).filter(function (t) { return !duplicates.some(function (d) { return d.id === t.id; }); });
    var looseFees = []; // explicit fees that name no transfer (older pool-level entries): reported apart, never spread over transfers

    // applied to underlying bills: the allocated PORTIONS (payment rows on the transfer's own bank line), one row each
    (o.pays || []).forEach(function (p) {
      var t = tById[p.bank_transaction_id]; if (!t || p.voided === true) { return; }
      var b = billById[p.bill_id] || {};
      t.lifetime_rows.push({ transfer_id: t.id, transfer_date: t.date, payment_id: p.id || null, paid_date: day(p.paid_date || t.date), portion: r2(p.amount), bill_id: p.bill_id,
        vendor: b.vendor_name || '(bill)', bill_number: b.bill_number || null, bill_total: b.total_amount != null ? r2(b.total_amount) : null, release_number: b.release_number || null,
        // facts ABOUT the bill only. Where and when the report recognizes this cost is NOT decided here — the report must resolve it.
        source_bill: { category: b.category || 'uncategorized', bill_date: day(b.bill_date) || null, recognition: 'unverified' } });
    });
    // BILLS PAID THROUGH THIS COMPANY WITH NO SOURCE TRANSFER NAMED: the bill is marked "paid through" the company and has a live
    // payment, but that payment is on no bank line of ours (recorded as "paid for us" without saying from which transfer), or on a
    // bank line that is not one of this company's transfers. They are real bill payments (the bill's own cost is counted where the
    // report counts it), but they take from NO transfer here — so held funds are overstated by them until a person links them.
    var unlinked = [];
    (o.pays || []).forEach(function (p) {
      if (p.voided === true || tById[p.bank_transaction_id]) { return; }
      var b = billById[p.bill_id]; if (!b || key(b.paid_via) !== pk) { return; }
      unlinked.push({ payment_id: p.id || null, paid_date: day(p.paid_date), portion: r2(p.amount), bill_id: p.bill_id, vendor: b.vendor_name || '(bill)', bill_number: b.bill_number || null,
        bill_total: b.total_amount != null ? r2(b.total_amount) : null, release_number: b.release_number || null, method: p.method || null,
        on_bank_line: p.bank_transaction_id || null, // null = no bank line at all; an id = a line that is not one of this company's transfers
        source_bill: { category: b.category || 'uncategorized', bill_date: day(b.bill_date) || null, recognition: 'unverified' } });
    });
    // explicit services rendered: (a) the fee of a request already sent from the transfer, (b) fee entries of the advances ledger
    function feeRow(t, amount, date, why, id) { var a = r2(amount); if (!a) { return; } var row = { transfer_id: t ? t.id : null, date: day(date), amount: a, why: why, id: id }; if (t) { t.lifetime_fee_rows.push(row); } else { looseFees.push(row); } }
    // (Codex 20 Nov 13:37) a wire that was SENT and matched to its bank line carries its explicit fee whether it was a request
    // drawn from an earlier transfer (funding_txn_id) or an ordinary wire that is itself the transfer (bank_transaction_id, no
    // funding_txn_id) — the same rule wire-funding-server.js uses. Each wire is read ONCE even if it reaches us twice.
    var seenWire = {};
    (o.requests || []).forEach(function (w) {
      if (!w || w.id == null || seenWire[w.id]) { return; } seenWire[w.id] = true;
      if (w.status === 'attached') {
        var ta = tById[w.funding_txn_id] || tById[w.bank_transaction_id] || null;
        if (ta) { feeRow(ta, w.fee_amount, w.sent_date || ta.date, w.funding_txn_id ? 'service fee on a request' : 'service fee on a wire', 'request:' + w.id); }
        return;
      }
      // only a request drawn from an EARLIER transfer reserves held money; an ordinary wire not sent yet has sent nothing
      var t = tById[w.funding_txn_id] || null; if (!t) { return; }
      if (CLOSED[w.status]) { return; }
      var held = r2(w.fee_amount); (w.lines || []).forEach(function (l) { if (l.is_open !== false) { held = r2(held + (Number(l.amount) || 0)); } });
      if (held) { t.reserved_now = r2(t.reserved_now + held); t.reserved_rows.push({ request_id: w.id, status: w.status, amount: held, fee: r2(w.fee_amount) }); } // bills AND fee: the whole commitment
    });
    (o.entries || []).forEach(function (e) {
      if (key(e.party) !== pk || e.bucket !== 'fee') { return; }
      var t = tById[e.source_bank_transaction_id || e.bank_transaction_id] || null;
      feeRow(t, e.amount, e.entry_date || (t && t.date) || e.created_at, e.reason || 'services rendered', 'entry:' + e.id);
    });

    var per = { funds_sent: 0, applied_rows: [], fee_rows: [], opening_held: 0 };
    var asOf = { funds_sent: 0, applied_to_bills: 0, services_rendered: 0 };
    var cur = { funds_sent: 0, applied_to_bills: 0, services_rendered: 0, reserved: 0 };
    var unresolved = false; var byText = { count: 0, sent: 0 };
    transfers.forEach(function (t) {
      t.counted_as_of = !to || t.date <= to;
      if (t.identity === 'bank_text') { byText.count++; byText.sent = r2(byText.sent + t.sent); }
      t.as_of_rows = t.lifetime_rows.filter(function (r) { return !to || r.paid_date <= to; });
      t.as_of_fee_rows = t.lifetime_fee_rows.filter(function (r) { return !to || r.date <= to; });
      t.as_of = { applied_to_bills: sum(t.as_of_rows, 'portion'), services_rendered: sum(t.as_of_fee_rows, 'amount') };
      t.as_of.held = t.counted_as_of ? r2(t.sent - t.as_of.applied_to_bills - t.as_of.services_rendered) : 0;
      t.current = { applied_to_bills: sum(t.lifetime_rows, 'portion'), services_rendered: sum(t.lifetime_fee_rows, 'amount'), reserved: t.reserved_now };
      t.current.unused = r2(t.sent - t.current.applied_to_bills - t.current.services_rendered - t.current.reserved); // negative only if the records disagree — shown, never hidden
      if (t.as_of.held < -0.005 || t.current.unused < -0.005) { unresolved = true; }
      if (inRange(t.date, from, to)) { per.funds_sent = r2(per.funds_sent + t.sent); }
      if (from && t.date < from) { per.opening_held = r2(per.opening_held + t.sent); }
      if (t.counted_as_of) { asOf.funds_sent = r2(asOf.funds_sent + t.sent); }
      asOf.applied_to_bills = r2(asOf.applied_to_bills + t.as_of.applied_to_bills); asOf.services_rendered = r2(asOf.services_rendered + t.as_of.services_rendered);
      cur.funds_sent = r2(cur.funds_sent + t.sent); cur.applied_to_bills = r2(cur.applied_to_bills + t.current.applied_to_bills);
      cur.services_rendered = r2(cur.services_rendered + t.current.services_rendered); cur.reserved = r2(cur.reserved + t.current.reserved);
      t.lifetime_rows.forEach(function (r) { if (inRange(r.paid_date, from, to)) { per.applied_rows.push(r); } if (from && r.paid_date < from) { per.opening_held = r2(per.opening_held - r.portion); } });
      t.lifetime_fee_rows.forEach(function (r) { if (inRange(r.date, from, to)) { per.fee_rows.push(r); } if (from && r.date < from) { per.opening_held = r2(per.opening_held - r.amount); } });
      delete t.reserved_now;
    });
    var looseInPeriod = looseFees.filter(function (r) { return inRange(r.date, from, to); });
    if (looseFees.length) { unresolved = true; }
    if (unlinked.length) { unresolved = true; }
    var unlinkedPeriod = unlinked.filter(function (r) { return inRange(r.paid_date, from, to); });
    var unlinkedAsOf = unlinked.filter(function (r) { return !to || r.paid_date <= to; });
    var applied = sum(per.applied_rows, 'portion'); var fees = sum(per.fee_rows, 'amount');
    var closing = r2(per.opening_held + per.funds_sent - applied - fees);
    var asOfHeld = r2(asOf.funds_sent - asOf.applied_to_bills - asOf.services_rendered);
    return {
      party: party.name, transfers: transfers,
      // PERIOD: flows only. opening_held + funds_sent − applied_to_bills − services_rendered = closing_held
      period: { from: from, to: to, opening_held: per.opening_held, funds_sent: per.funds_sent, applied_to_bills: applied, services_rendered: fees, closing_held: closing,
        applied_rows: per.applied_rows, fee_rows: per.fee_rows,
        fee_deduction: r2(fees + sum(looseInPeriod, 'amount')), // INTERNAL: the only amount that reduces profit as a professional fee in this period
        fees_without_a_transfer: sum(looseInPeriod, 'amount'), loose_fee_rows: looseInPeriod,
        tax_professional_fees: per.funds_sent },                 // TAX presentation: the full original transfers of the period, once
      // AS OF the end of `to`: dated records only. held = funds sent − applied to bills − services rendered (reservations are NOT in here)
      as_of: { date: to, funds_sent: asOf.funds_sent, applied_to_bills: asOf.applied_to_bills, services_rendered: asOf.services_rendered, held: asOfHeld },
      // CURRENT (today, whatever dates were asked for): held today = reserved + unused, nothing overlaps
      current: { funds_sent: cur.funds_sent, applied_to_bills: cur.applied_to_bills, services_rendered: cur.services_rendered, reserved: cur.reserved,
        unused: r2(cur.funds_sent - cur.applied_to_bills - cur.services_rendered - cur.reserved) },
      arithmetic_ok: Math.abs(r2(closing - asOfHeld)) < 0.005,   // the sums agree with each other — says NOTHING about whether the records are right
      // transfers recognized only from the bank's text (not stamped by a person): counted as money sent, and listed here to be confirmed
      identity_to_confirm: byText,
      // the same bank transfer present as a second bank line: NOT counted; listed so a person can mark the copy as a duplicate
      duplicate_bank_lines: duplicates, duplicate_bank_lines_total: sum(duplicates, 'sent'),
      // paid through the company but linked to no transfer: NOT taken from any transfer above, NOT a fee — listed to be linked.
      // period = paid in the dates asked · as_of = paid up to `to` · lifetime = all. Each total is the sum of its own list.
      paid_without_a_transfer: { period_total: sum(unlinkedPeriod, 'portion'), period_rows: unlinkedPeriod, as_of_total: sum(unlinkedAsOf, 'portion'), as_of_rows: unlinkedAsOf,
        lifetime_total: sum(unlinked, 'portion'), lifetime_rows: unlinked },
      needs_reconciliation: unresolved,                           // more used than sent on some transfer, a fee that names no transfer, or a bill paid through the company with no transfer named
    };
  });
}

// The plain sentences for the pop-up, from REAL computed amounts (x = one company's result).
export function feeExplanation(x, money) {
  var f = money || function (n) { return '$' + r2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var p = x.period; var held = r2(p.closing_held);
  var s = 'Only ' + f(p.fee_deduction) + ' is deducted here as a professional fee. The ' + f(p.applied_to_bills) + ' allocated to underlying bills is not deducted again here; those costs are accounted for separately in their proper categories. ';
  s += held >= 0 ? 'The ' + f(held) + ' still held at the end of this period does not reduce internal profit.' : 'More was used than was sent by ' + f(-held) + ' — needs reconciliation.';
  return s;
}
// Today's position, said separately (it is NOT the period's balance): what is reserved for requests not sent yet, and what is free to use.
export function currentFundsWords(x, money) {
  var f = money || function (n) { return '$' + r2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var c = x.current;
  if (c.unused < -0.005) { return 'Today: more is used or reserved than was sent, by ' + f(-c.unused) + ' — needs reconciliation.'; }
  return 'Today: ' + f(c.unused) + ' unused and available' + (c.reserved > 0.005 ? ', and ' + f(c.reserved) + ' reserved for requests not sent yet (held — not paid, not an expense)' : '') + '.';
}
