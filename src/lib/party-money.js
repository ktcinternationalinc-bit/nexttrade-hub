// v55.83-TX — advance / fee entries for NextTrade and RTM, worked out from the append-only party_money_entries rows.
// Pure (no database): used by the advances route, the P&L and the tests. SWC-safe.
function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }

// { 'nexttrade industries': { advance, fee } } — the running balances (the database guarantees neither is ever below zero)
export function partyBalances(entries) {
  var out = {};
  (entries || []).forEach(function (e) {
    var k = String(e.party || '').toLowerCase(); var b = out[k] || (out[k] = { advance: 0, fee: 0 });
    if (e.bucket === 'advance') { b.advance = r2(b.advance + Number(e.amount)); } else if (e.bucket === 'fee') { b.fee = r2(b.fee + Number(e.amount)); }
  });
  return out;
}

// What the P&L must change for one period [from, to] (dates YYYY-MM-DD).
// TAX VIEW (one professional-fee line): the whole payment is booked under the bank line's category today. From it:
//   • advance split off a payment in the period → NOT an expense: moved out of the line's category into "advance (asset)"
//   • advance → fee in the period → professional fee · fee → advance in the period → back out of professional fees
//   • advance applied to a bill in the period → professional fee (the bill is now paid by money already sent)
// INTERNAL VIEW: bills paid from the advance count in the bills' REAL categories (like bills paid via RTM); the extra fee
// stays a fee. Advances never count as spending until applied or converted.
// entries: party_money_entries rows; lineCat: { bank_transaction_id: classification of that bank line }
// lineDate: { bank_transaction_id: date } — a split is dated by its bank line (when the money left)
// v55.83-UD (Codex 11:40) — a STARTING BALANCE (opening_balance) is money sent to NextTrade / RTM BEFORE the Hub, already booked as
// paid back then. Using it later (paying a bill from the advance, or advance → fee) is NOT a new professional fee in the tax view.
// The advance is one pool, so the starting balance is used FIRST (it is the oldest money): each later use takes from what is left
// of it, and only the rest counts. Worked out over the WHOLE ledger in date order, then counted in the period. The amount covered
// by the starting balance in the period is reported as used_from_opening (information only).
// Each company's money is tracked in four parts, in date order over the WHOLE ledger:
//   O = advance from the starting balance · N = advance from payments in the Hub · FO = fees made from O · FN = every other fee.
//   • a payment split adds to N (advance) or FN (fee) · a starting balance adds to O (a correction takes from O)
//   • paying a bill from the advance takes from O first, then N — only the N part is a new professional fee
//   • advance → fee takes from O first (→ FO, not a new fee), then N (→ FN, a new fee)
//   • fee → advance gives back FN first (→ N, reverses a fee that was counted), then FO (→ O, never counted, so nothing to reverse)
// So a round trip (advance → fee → advance) always nets to zero, in any periods. share[] holds the opening part of each move.
function openingShares(entries) {
  var share = {}; var st = {};
  function S(p) { return st[p] || (st[p] = { O: 0, N: 0, FO: 0, FN: 0 }); }
  (entries || []).slice().sort(function (a, b) { return String(a.entry_date || '').localeCompare(String(b.entry_date || '')) || String(a.created_at || '').localeCompare(String(b.created_at || '')) || String(a.id || '').localeCompare(String(b.id || '')); })
    .forEach(function (e) {
      var s = S(String(e.party || '').toLowerCase()); var amt = r2(e.amount); var use;
      if (e.kind === 'opening_balance') { s.O = Math.max(0, r2(s.O + amt)); return; }
      if (e.kind === 'payment_split') { if (e.bucket === 'advance') { s.N = r2(s.N + amt); } else if (e.bucket === 'fee') { s.FN = r2(s.FN + amt); } return; }
      if (e.kind === 'apply_to_bill' && e.bucket === 'advance' && amt < 0) { use = Math.min(s.O, -amt); s.O = r2(s.O - use); s.N = r2(s.N - (-amt - use)); share['e:' + e.id] = use; return; }
      if (e.kind === 'advance_to_fee' && e.bucket === 'advance' && amt < 0) { use = Math.min(s.O, -amt); s.O = r2(s.O - use); s.FO = r2(s.FO + use); s.N = r2(s.N - (-amt - use)); s.FN = r2(s.FN + (-amt - use)); share['a:' + e.action_id] = r2((share['a:' + e.action_id] || 0) + use); return; }
      if (e.kind === 'fee_to_advance' && e.bucket === 'fee' && amt < 0) { var back = -amt; var fromN = Math.min(s.FN, back); s.FN = r2(s.FN - fromN); s.N = r2(s.N + fromN); var fromO = Math.min(s.FO, r2(back - fromN)); s.FO = r2(s.FO - fromO); s.O = r2(s.O + fromO); share['b:' + e.action_id] = r2((share['b:' + e.action_id] || 0) + fromO); }
    });
  return share;
}
export function periodAdjustments(entries, from, to, lineCat, lineDate) {
  var inP = function (d) { return !!d && d >= from && d <= to; };
  var out = { advance_out_of_category: {}, advance_held: 0, fee_from_advance: 0, fee_back_to_advance: 0, applied_to_bills: 0, split_fee: 0, used_from_opening: 0, by_party: {} };
  var share = openingShares(entries);
  (entries || []).forEach(function (e) {
    var party = String(e.party || ''); var bp = out.by_party[party] || (out.by_party[party] = { advance_held: 0, split_fee: 0, fee_from_advance: 0, fee_back_to_advance: 0, applied_to_bills: 0 });
    var amt = r2(e.amount);
    if (e.kind === 'payment_split') {
      var d = (lineDate && lineDate[e.bank_transaction_id]) || e.entry_date;
      if (!inP(d)) { return; }
      if (e.bucket === 'advance') {
        var k = (lineCat && lineCat[e.bank_transaction_id]) || 'uncategorized';
        out.advance_out_of_category[k] = r2((out.advance_out_of_category[k] || 0) + amt);
        out.advance_held = r2(out.advance_held + amt); bp.advance_held = r2(bp.advance_held + amt);
      } else { out.split_fee = r2(out.split_fee + amt); bp.split_fee = r2(bp.split_fee + amt); }
      return;
    }
    if (!inP(e.entry_date)) { return; }
    if (e.kind === 'advance_to_fee' && e.bucket === 'fee') { var sh0 = share['a:' + e.action_id] || 0; out.used_from_opening = r2(out.used_from_opening + sh0); out.fee_from_advance = r2(out.fee_from_advance + amt - sh0); bp.fee_from_advance = r2(bp.fee_from_advance + amt - sh0); }
    if (e.kind === 'fee_to_advance' && e.bucket === 'advance') { var sh2 = share['b:' + e.action_id] || 0; out.used_from_opening = r2(out.used_from_opening - sh2); out.fee_back_to_advance = r2(out.fee_back_to_advance + amt - sh2); bp.fee_back_to_advance = r2(bp.fee_back_to_advance + amt - sh2); }
    if (e.kind === 'apply_to_bill') { var sh1 = share['e:' + e.id] || 0; out.used_from_opening = r2(out.used_from_opening + sh1); out.applied_to_bills = r2(out.applied_to_bills - amt - sh1); bp.applied_to_bills = r2(bp.applied_to_bills - amt - sh1); }
  });
  // net change to the professional-fee line in the tax view (from money already sent in earlier periods)
  out.professional_fee_change = r2(out.fee_from_advance - out.fee_back_to_advance + out.applied_to_bills);
  return out;
}

export var KIND_WORDS = { payment_split: 'split from a payment', apply_to_bill: 'used to pay a bill', advance_to_fee: 'advance → fee', fee_to_advance: 'fee → advance', opening_balance: 'starting balance (held before the Hub)' };

// v55.83-TX (Codex P1-3 + recheck 17 Nov) — which advance entries this person may see. DISCLOSURE POLICY:
// an advance is ONE pool per company. Once any money from a PRIVATE bank account is in a company's pool, every later move
// out of that pool (a bill paid from the advance, advance → fee, fee → advance) could carry private money and, with the
// visible public funding, lets someone work out the private amount. So for a person who may NOT see private accounts,
// that company's WHOLE advance history and balance are hidden (shown as 'includes money from a private account'),
// not just the private lines. Companies with no private funding are shown in full. A line whose account cannot be
// resolved counts as private (fails closed). scope = privateScope(...) result; lineAcct = { bank line id: account id }.
// Returns { visible: [...], hiddenParty: { 'nexttrade industries': true } }.
export function entriesVisibility(entries, scope, lineAcct) {
  var out = { visible: [], hiddenParty: {} };
  if (!scope || scope.all) { out.visible = (entries || []).slice(); return out; }
  (entries || []).forEach(function (e) {
    if (!e.bank_transaction_id) { return; }
    var acct = (lineAcct || {})[e.bank_transaction_id];
    if (acct === undefined || acct === null || scope.hidden[acct]) { out.hiddenParty[String(e.party || '').toLowerCase()] = true; }
  });
  (entries || []).forEach(function (e) { if (!out.hiddenParty[String(e.party || '').toLowerCase()]) { out.visible.push(e); } });
  return out;
}
