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
// v55.83-WF (Max 21 Nov, relayed by the simple-fixes session: "o225 is a rtm account so a transfer to rtm..we should probably connect that too"):
// RTM has a second account ending 0225.
export var FUNDING_DESTINATIONS = [{ suffix: '9909', payer: 'RTM Capital' }, { suffix: '0225', payer: 'RTM Capital' }, { suffix: '2061', payer: 'NextTrade Industries' }];
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
// v55.83-WF (simple-fixes session, 21 Nov): WHICH LINES of a supplier bill an allocated portion covers — goods are counted through
// bill lines (a product's cost per pound comes from linked lines), so each allocated row says it, in cents, never guessed:
//   whole_bill  — the portion is the whole bill and its lines add up to it: every line with its own amount
//   from_lines  — a part of a bill that has ONE line: that line, for the portion
//   unresolved  — a part of a bill with several lines (no record says which), lines that do not add up to the bill, or lines not read
//   no_lines    — the bill has no lines (transport and other bills counted from the whole bill)
// billLines: [{ id, bill_id, amount }] or null when they could not be read.
export function billLineSplit(portion, billTotal, billLines) {
  if (billLines === null || billLines === undefined) { return { line_split: 'unresolved', lines: [], why: 'bill lines not read' }; }
  var pc = Math.round((Number(portion) || 0) * 100); var tc = billTotal == null ? null : Math.round((Number(billTotal) || 0) * 100);
  if (!billLines.length) { return { line_split: 'no_lines', lines: [] }; }
  var ls = billLines.map(function (l) { return { bill_line_id: l.id, amount_cents: Math.round((Number(l.amount) || 0) * 100) }; });
  var sum = ls.reduce(function (a, l) { return a + l.amount_cents; }, 0);
  if (tc !== null && pc === tc && sum === tc) { return { line_split: 'whole_bill', lines: ls }; }
  if (ls.length === 1 && pc > 0 && pc <= ls[0].amount_cents) { return { line_split: 'from_lines', lines: [{ bill_line_id: ls[0].bill_line_id, amount_cents: pc }] }; }
  return { line_split: 'unresolved', lines: [], why: sum !== tc ? 'the lines do not add up to the bill' : 'part of a bill with several lines — no record says which lines' };
}
// v55.83-XO — STARTING BALANCES (Max 21-22 Nov 2026: "a previous balance to nextrade that we will pay bills from"; using it is
// "b- NEW EXPENSE WHEN USED AFTER 6/1/2026"). o.openings = party_opening_balances rows (a correction is its own row with
// corrects_id). A starting balance is a SOURCE next to the transfers — never money sent: held = amount (with corrections) − bills
// paid from it (vendor_bill_payments.party_opening_id). It counts in what is held (period opening / closing, as_of, current),
// NEVER in funds_sent. Tax presentation: the bills paid from it dated on or after STARTING_BALANCE_TAX_FROM are added to the
// period's tax line (a new expense when used); the internal view is unchanged (those bills count in their own categories).
export var STARTING_BALANCE_TAX_FROM = '2026-06-01';
// v55.83-XO (Codex 22 Nov 14:52 P1) — WHO MAY SEE A STARTING BALANCE: the ONE rule every response that exposes the calculation
// uses (the Funds route lists only these; the report route withholds its spending block when one it may not see is in its dates).
// A balance marked "only me" (visible_to_staff = false) is for the super admin only; a correction follows its balance.
export var HIDDEN_STARTING_BALANCE_REASON = 'includes a starting balance only the super admin may see';
export function canSeeStartingBalance(sb, isSuperAdmin) { return isSuperAdmin === true || !!(sb && sb.visible_to_staff === true); }
// the starting balances (rows of party_opening_balances, corrections left out) this caller may NOT see that count in a report
// ending on `to` (as of that date or earlier: they are in its held figures, and any use of them in it).
// v55.83-XO (Codex 22 Nov 18:29 P1) — `pays` (optional, vendor_bill_payments with party_opening_id): a hidden balance also counts
// when a live bill payment from it is dated on / before `to`, even if its as-of date is later (the period's held figures move by it).
export function hiddenStartingBalances(openings, isSuperAdmin, to, pays) {
  var usedBy = {}; (pays || []).forEach(function (p) { if (p && p.voided !== true && p.party_opening_id && (!to || day(p.paid_date) <= to)) { usedBy[p.party_opening_id] = true; } });
  var rootOf = {}; (openings || []).forEach(function (c) { if (c.corrects_id) { rootOf[c.id] = c.corrects_id; } });
  Object.keys(usedBy).forEach(function (id) { if (rootOf[id]) { usedBy[rootOf[id]] = true; } });
  return (openings || []).filter(function (b) { return !b.corrects_id && Number(b.amount) > 0 && !canSeeStartingBalance(b, isSuperAdmin) && (!to || day(b.as_of) <= to || !!usedBy[b.id]); });
}
// v55.83-XO (Codex 22 Nov 18:29 P1) — THE WHOLE FUNDS ANSWER, AS THIS CALLER MAY SEE IT, whatever dates were asked for.
// funds = partyFundsBreakdown(...) for the report's dates. The super admin gets it unchanged. For anyone else, a company with a
// starting balance they may not see keeps ONLY what that balance does not touch:
//   • the hidden balance is left out entirely (amount, original, corrections, reason, uses, bill rows, ids);
//   • `current` (today: whole history) includes it, so it is WITHHELD (null + current_withheld says why) — never recomputed without it;
//   • needs_reconciliation is said from the transfers and the balances the caller may see (an over-used hidden balance is a
//     current fact of the hidden balance);
//   • period / as_of figures are kept only when the hidden balance is not in them (as of after `to`, no use dated on / before `to`).
// `restricted` = how many hidden balances DO count in these dates: the caller must then withhold the whole report figures
// (the explicit restricted state), because the period / as_of figures include them.
export function partyFundsForViewer(funds, isSuperAdmin, to) {
  if (isSuperAdmin === true || !Array.isArray(funds)) { return { funds: funds, restricted: 0 }; }
  var restricted = 0;
  var out = funds.map(function (f) {
    var all = (f && f.starting_balances) || [];
    var hidden = all.filter(function (s) { return !canSeeStartingBalance(s, false); });
    if (!hidden.length) { return f; }
    hidden.forEach(function (s) { if (!to || !s.as_of || s.as_of <= to || (s.lifetime_rows || []).some(function (r) { return !r.paid_date || r.paid_date <= to; })) { restricted++; } });
    var shown = all.filter(function (s) { return canSeeStartingBalance(s, false); });
    var x = Object.assign({}, f, { starting_balances: shown, hidden_starting_balances: hidden.length, current: null, current_withheld: HIDDEN_STARTING_BALANCE_REASON,
      needs_reconciliation: f.transfers_need_reconciliation === true || shown.some(function (s) { return s.over_used === true; }) });
    return x;
  });
  return { funds: out, restricted: restricted };
}
export function partyFundsBreakdown(o) {
  o = o || {}; var from = o.from || null; var to = o.to || null;
  var linesOfBill = null; if (Array.isArray(o.billLines)) { linesOfBill = {}; o.billLines.forEach(function (l) { (linesOfBill[l.bill_id] = linesOfBill[l.bill_id] || []).push(l); }); }
  var billById = {}; if (Array.isArray(o.bills)) { o.bills.forEach(function (b) { billById[b.id] = b; }); } else { billById = o.bills || {}; }
  var obAll = Array.isArray(o.openings) ? o.openings : []; var obKnown = {}; obAll.forEach(function (b) { obKnown[b.id] = true; }); // v55.83-XO
  return (o.parties || []).map(function (party) {
    var pk = key(party.name); var refundDateFallback = false; // v55.83-XR
    // v55.83-XO — this company's starting balances, each with its corrections folded in (same date, same visibility)
    var starting = obAll.filter(function (b) { return !b.corrects_id && key(b.party) === pk && Number(b.amount) > 0; })
      .sort(function (a, b) { return day(a.as_of) < day(b.as_of) ? -1 : day(a.as_of) > day(b.as_of) ? 1 : String(a.id) < String(b.id) ? -1 : 1; })
      .map(function (b) { return { id: b.id, kind: 'starting_balance', as_of: day(b.as_of), original: r2(b.amount), corrections: 0, correction_rows: [], amount: r2(b.amount), reason: b.reason || '', visible_to_staff: b.visible_to_staff === true, lifetime_rows: [] }; });
    var sbById = {}; starting.forEach(function (s) { sbById[s.id] = s; });
    obAll.forEach(function (c) { var s = c.corrects_id ? sbById[c.corrects_id] : null; if (!s) { return; } s.correction_rows.push({ id: c.id, amount: r2(c.amount), reason: c.reason || '', created_at: c.created_at || null }); s.corrections = r2(s.corrections + (Number(c.amount) || 0)); s.amount = r2(s.amount + (Number(c.amount) || 0)); });
    var idOf = {}; var lines = (o.bankLines || []).filter(function (t) { var who = fundingIdentity(t); if (!who || key(who.payer) !== pk) { return false; } idOf[t.id] = who.basis; return true; })
      .sort(function (a, b) { return day(a.date) < day(b.date) ? -1 : day(a.date) > day(b.date) ? 1 : String(a.id) < String(b.id) ? -1 : 1; });
    var transfers = lines.map(function (t) { return { id: t.id, date: day(t.date), reference: t.name || '', sent: r2(Math.abs(Number(t.amount_abs != null ? t.amount_abs : t.amount) || 0)), identity: idOf[t.id], lifetime_refund_rows: [], lifetime_rows: [], lifetime_fee_rows: [], reserved_now: 0, reserved_rows: [] }; });
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
      var spl = billLineSplit(p.amount, b.total_amount, linesOfBill ? (linesOfBill[p.bill_id] || []) : null);
      t.lifetime_rows.push({ transfer_id: t.id, transfer_date: t.date, payment_id: p.id || null, paid_date: day(p.paid_date || t.date), portion: r2(p.amount), bill_id: p.bill_id,
        line_split: spl.line_split, lines: spl.lines, line_split_why: spl.why || null,
        vendor: b.vendor_name || '(bill)', bill_number: b.bill_number || null, bill_total: b.total_amount != null ? r2(b.total_amount) : null, release_number: b.release_number || null,
        // facts ABOUT the bill only. Where and when the report recognizes this cost is NOT decided here — the report must resolve it.
        source_bill: { category: b.category || 'uncategorized', bill_date: day(b.bill_date) || null, recognition: 'unverified' } });
    });
    // v55.83-XO — bills paid FROM A STARTING BALANCE (the payment names the balance, not a bank line): one row each
    (o.pays || []).forEach(function (p) {
      if (p.voided === true || !p.party_opening_id) { return; }
      var s = sbById[p.party_opening_id]; if (!s) { return; }
      var b = billById[p.bill_id] || {};
      s.lifetime_rows.push({ source: 'starting_balance', starting_balance_id: s.id, starting_balance_as_of: s.as_of, payment_id: p.id || null, paid_date: day(p.paid_date), portion: r2(p.amount), bill_id: p.bill_id,
        vendor: b.vendor_name || '(bill)', bill_number: b.bill_number || null, bill_total: b.total_amount != null ? r2(b.total_amount) : null, release_number: b.release_number || null, method: p.method || null,
        source_bill: { category: b.category || 'uncategorized', bill_date: day(b.bill_date) || null, recognition: 'unverified' } });
    });
    // BILLS PAID THROUGH THIS COMPANY WITH NO SOURCE TRANSFER NAMED: the bill is marked "paid through" the company and has a live
    // payment, but that payment is on no bank line of ours (recorded as "paid for us" without saying from which transfer), or on a
    // bank line that is not one of this company's transfers. They are real bill payments (the bill's own cost is counted where the
    // report counts it), but they take from NO transfer here — so held funds are overstated by them until a person links them.
    var unlinked = [];
    (o.pays || []).forEach(function (p) {
      if (p.voided === true || tById[p.bank_transaction_id]) { return; }
      if (p.party_opening_id && obKnown[p.party_opening_id]) { return; } // v55.83-XO — paid from a starting balance: its source IS named
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
      // v55.83-WF B2 — MONEY BACK from the company (a refund) lowers what its transfer holds; it is never a fee and never a bill
      // v55.83-XR (Codex 09:01 / 09:54 P2) — a refund is DATED by the money-in bank line it arrived on (posted_date, else date): the same
      // date the cash report uses, so period / opening / as-of balances agree with it. The date a person typed stays as `entered`
      // (audit). Only when that bank date could not be read does the typed date stand in, and the result says so (refund_date_basis).
      if (key(e.party) === pk && e.bucket === 'refund' && e.kind === 'refund') {
        var tR = tById[e.source_bank_transaction_id] || null;
        if (tR) {
          var bankD = e.bank_transaction_id && o.refundLineDates ? o.refundLineDates[e.bank_transaction_id] : null;
          if (!bankD) { refundDateFallback = true; }
          tR.lifetime_refund_rows.push({ transfer_id: tR.id, date: day(bankD || e.entry_date || e.created_at), entered: day(e.entry_date || e.created_at), date_basis: bankD ? 'bank' : 'entered', amount: r2(e.amount), incoming_line: e.bank_transaction_id || null, id: 'entry:' + e.id, why: e.reason || 'money back' });
        }
        return;
      }
      if (key(e.party) !== pk || e.bucket !== 'fee') { return; }
      if (e.wire_package_id) { return; } // v55.83-WF: an entry that points at a wire is a NOTE about that wire's fee — the wire carries the fee, once (same rule as the database)
      var t = tById[e.source_bank_transaction_id || e.bank_transaction_id] || null;
      feeRow(t, e.amount, e.entry_date || (t && t.date) || e.created_at, e.reason || 'services rendered', 'entry:' + e.id);
    });

    var per = { funds_sent: 0, applied_rows: [], fee_rows: [], refund_rows: [], opening_held: 0 };
    var asOf = { funds_sent: 0, applied_to_bills: 0, services_rendered: 0, refunds: 0 };
    var cur = { funds_sent: 0, applied_to_bills: 0, services_rendered: 0, reserved: 0, refunds: 0 };
    var unresolved = false; var byText = { count: 0, sent: 0 };
    transfers.forEach(function (t) {
      t.counted_as_of = !to || t.date <= to;
      if (t.identity === 'bank_text') { byText.count++; byText.sent = r2(byText.sent + t.sent); }
      t.as_of_rows = t.lifetime_rows.filter(function (r) { return !to || r.paid_date <= to; });
      t.as_of_fee_rows = t.lifetime_fee_rows.filter(function (r) { return !to || r.date <= to; });
      t.as_of_refund_rows = t.lifetime_refund_rows.filter(function (r) { return !to || r.date <= to; });
      t.as_of = { applied_to_bills: sum(t.as_of_rows, 'portion'), services_rendered: sum(t.as_of_fee_rows, 'amount'), refunds: sum(t.as_of_refund_rows, 'amount') };
      t.as_of.held = t.counted_as_of ? r2(t.sent - t.as_of.refunds - t.as_of.applied_to_bills - t.as_of.services_rendered) : 0;
      t.current = { applied_to_bills: sum(t.lifetime_rows, 'portion'), services_rendered: sum(t.lifetime_fee_rows, 'amount'), refunds: sum(t.lifetime_refund_rows, 'amount'), reserved: t.reserved_now };
      t.current.unused = r2(t.sent - t.current.refunds - t.current.applied_to_bills - t.current.services_rendered - t.current.reserved); // negative only if the records disagree — shown, never hidden
      if (t.as_of.held < -0.005 || t.current.unused < -0.005) { unresolved = true; }
      if (inRange(t.date, from, to)) { per.funds_sent = r2(per.funds_sent + t.sent); }
      if (from && t.date < from) { per.opening_held = r2(per.opening_held + t.sent); }
      if (t.counted_as_of) { asOf.funds_sent = r2(asOf.funds_sent + t.sent); }
      asOf.applied_to_bills = r2(asOf.applied_to_bills + t.as_of.applied_to_bills); asOf.services_rendered = r2(asOf.services_rendered + t.as_of.services_rendered); asOf.refunds = r2(asOf.refunds + t.as_of.refunds);
      cur.funds_sent = r2(cur.funds_sent + t.sent); cur.applied_to_bills = r2(cur.applied_to_bills + t.current.applied_to_bills);
      cur.services_rendered = r2(cur.services_rendered + t.current.services_rendered); cur.reserved = r2(cur.reserved + t.current.reserved); cur.refunds = r2(cur.refunds + t.current.refunds);
      t.lifetime_rows.forEach(function (r) { if (inRange(r.paid_date, from, to)) { per.applied_rows.push(r); } if (from && r.paid_date < from) { per.opening_held = r2(per.opening_held - r.portion); } });
      t.lifetime_fee_rows.forEach(function (r) { if (inRange(r.date, from, to)) { per.fee_rows.push(r); } if (from && r.date < from) { per.opening_held = r2(per.opening_held - r.amount); } });
      t.lifetime_refund_rows.forEach(function (r) { if (inRange(r.date, from, to)) { per.refund_rows.push(r); } if (from && r.date < from) { per.opening_held = r2(per.opening_held - r.amount); } });
      delete t.reserved_now;
    });
    // v55.83-XO — the starting balances, in the same three views. Never in funds_sent.
    var sbPer = { added_rows: [], use_rows: [] }; var sbAsOf = { amount: 0, used: 0 }; var sbCur = { amount: 0, used: 0 };
    if (looseFees.length || unlinked.length) { unresolved = true; }
    var unresolvedTransfers = unresolved; // v55.83-XO (Codex 18:29 P1): the flag WITHOUT the starting balances, so a viewer projection never reads a hidden one
    starting.forEach(function (s) {
      s.counted_as_of = !to || s.as_of <= to;
      s.as_of_rows = s.lifetime_rows.filter(function (r) { return !to || r.paid_date <= to; });
      s.as_of_view = { amount: s.counted_as_of ? s.amount : 0, used: sum(s.as_of_rows, 'portion') }; s.as_of_view.held = r2(s.as_of_view.amount - s.as_of_view.used);
      s.current = { used: sum(s.lifetime_rows, 'portion') }; s.current.held = r2(s.amount - s.current.used);
      s.over_used = s.as_of_view.held < -0.005 || s.current.held < -0.005;
      if (s.over_used) { unresolved = true; }
      if (from && s.as_of < from) { per.opening_held = r2(per.opening_held + s.amount); }
      if (inRange(s.as_of, from, to)) { sbPer.added_rows.push({ starting_balance_id: s.id, as_of: s.as_of, amount: s.amount }); }
      s.lifetime_rows.forEach(function (r) { if (inRange(r.paid_date, from, to)) { sbPer.use_rows.push(r); } if (from && r.paid_date < from) { per.opening_held = r2(per.opening_held - r.portion); } });
      sbAsOf.amount = r2(sbAsOf.amount + s.as_of_view.amount); sbAsOf.used = r2(sbAsOf.used + s.as_of_view.used);
      sbCur.amount = r2(sbCur.amount + s.amount); sbCur.used = r2(sbCur.used + s.current.used);
    });
    var sbAdded = sum(sbPer.added_rows, 'amount'); var sbUsed = sum(sbPer.use_rows, 'portion');
    var sbTax = sum(sbPer.use_rows.filter(function (r) { return r.paid_date >= STARTING_BALANCE_TAX_FROM; }), 'portion');
    var looseInPeriod = looseFees.filter(function (r) { return inRange(r.date, from, to); });
    if (looseFees.length) { unresolved = true; }
    if (unlinked.length) { unresolved = true; }
    var unlinkedPeriod = unlinked.filter(function (r) { return inRange(r.paid_date, from, to); });
    var unlinkedAsOf = unlinked.filter(function (r) { return !to || r.paid_date <= to; });
    var applied = sum(per.applied_rows, 'portion'); var fees = sum(per.fee_rows, 'amount');
    var refunds = sum(per.refund_rows, 'amount');
    // v55.83-XO: + a starting balance dated in the period − bills paid from a starting balance in the period (both 0 without one)
    var closing = r2(per.opening_held + per.funds_sent + sbAdded - refunds - applied - fees - sbUsed);
    var asOfHeld = r2(asOf.funds_sent - asOf.refunds - asOf.applied_to_bills - asOf.services_rendered + sbAsOf.amount - sbAsOf.used);
    return {
      party: party.name, transfers: transfers,
      // v55.83-XO — the starting balances (NOT money sent): amount with corrections, bills paid from each, what each still holds
      starting_balances: starting.map(function (s) { var x = Object.assign({}, s, { as_of_figures: s.as_of_view }); delete x.as_of_view; return x; }),
      // PERIOD: flows only. opening_held + funds_sent + starting_balance_added − refunds − applied_to_bills − services_rendered
      //         − from_starting_balance = closing_held   (the two starting-balance terms are 0 when there is none)
      period: { from: from, to: to, opening_held: per.opening_held, funds_sent: per.funds_sent, refunds: refunds, applied_to_bills: applied, services_rendered: fees, closing_held: closing,
        applied_rows: per.applied_rows, fee_rows: per.fee_rows, refund_rows: per.refund_rows,
        fee_deduction: r2(fees + sum(looseInPeriod, 'amount')), // INTERNAL: the only amount that reduces profit as a professional fee in this period
        fees_without_a_transfer: sum(looseInPeriod, 'amount'), loose_fee_rows: looseInPeriod,
        starting_balance_added: sbAdded, starting_balance_added_rows: sbPer.added_rows,      // v55.83-XO: a starting balance as of a date in the period (held, never sent)
        from_starting_balance: sbUsed, from_starting_balance_rows: sbPer.use_rows,            // v55.83-XO: bills paid from a starting balance in the period
        tax_from_starting_balance: sbTax,                                                     // v55.83-XO: the part dated on / after 1 June 2026 (Max's (b))
        // TAX presentation (Max 20 Nov + 22 Nov Option 1): the full transfers of the period, once, + (XO) starting-balance uses on / after 1 June 2026, LESS money the company returned in the period (XR, dated by its money-in bank line)
        tax_professional_fees: r2(per.funds_sent + sbTax - refunds), tax_transfers_sent: per.funds_sent, tax_money_back: refunds },
      // AS OF the end of `to`: dated records only. held = funds sent − applied to bills − services rendered (+ starting balances left; reservations are NOT in here)
      as_of: { date: to, funds_sent: asOf.funds_sent, refunds: asOf.refunds, applied_to_bills: asOf.applied_to_bills, services_rendered: asOf.services_rendered, held: asOfHeld,
        starting_balance: sbAsOf.amount, from_starting_balance: sbAsOf.used, starting_balance_held: r2(sbAsOf.amount - sbAsOf.used) },
      // CURRENT (today, whatever dates were asked for): held today = reserved + unused, nothing overlaps (unused includes what starting balances still hold)
      current: { funds_sent: cur.funds_sent, refunds: cur.refunds, applied_to_bills: cur.applied_to_bills, services_rendered: cur.services_rendered, reserved: cur.reserved,
        unused: r2(cur.funds_sent - cur.refunds - cur.applied_to_bills - cur.services_rendered - cur.reserved + sbCur.amount - sbCur.used),
        starting_balance: sbCur.amount, from_starting_balance: sbCur.used, starting_balance_held: r2(sbCur.amount - sbCur.used) },
      refund_date_basis: refundDateFallback ? 'entered_where_bank_date_missing' : 'bank', // v55.83-XR
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
      transfers_need_reconciliation: unresolvedTransfers,          // v55.83-XO: the same, starting balances left out (partyFundsForViewer uses it)
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
  if (!c) { return 'Today: not shown — it ' + (x.current_withheld || HIDDEN_STARTING_BALANCE_REASON) + '.'; } // v55.83-XO: withheld by partyFundsForViewer
  if (c.unused < -0.005) { return 'Today: more is used or reserved than was sent, by ' + f(-c.unused) + ' — needs reconciliation.'; }
  return 'Today: ' + f(c.unused) + ' unused and available' + (c.reserved > 0.005 ? ', and ' + f(c.reserved) + ' reserved for requests not sent yet (held — not paid, not an expense)' : '') + '.';
}
