// v55.83-SR — the P&L breakdown of money sent to a paid-through company (RTM Capital, NextTrade Industries).
// Max, Nov 15 2026: "the whole transfer is one professional fee with the bills listed underneath … the breakdown of that
// underneath in the PL will go under uncategorized … this will be a specific service fee" · "NextTrade follows RTM from now
// on; older entries stay as booked".
//
// A company has an optional provider_from date. A bank line (or bill payment) dated BEFORE it keeps the company's
// original treatment; dated on/after it, the company is treated like a service provider: one line by its category, and
// underneath: bills paid · service fee (on requests) · uncategorized, waiting for bills.
// Pure. Every block conserves its total: payments = covered bills + (service fee + waiting + other).
function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
// v55.83-VY — WHICH company a bank line is money sent to is decided in ONE place: src/lib/party-funds.js (Codex 13:07).
export { FUNDING_DESTINATIONS, fundingPayerOfText, fundingIdentity } from './party-funds';
import { STARTING_BALANCE_TAX_FROM } from './party-funds'; // v55.83-XO — the one date rule for starting-balance uses
export function partyKeyOf(x) { return String(x || '').trim().toLowerCase(); }

// 'advance' = money sent ahead to a related company (not an expense until its bills are linked); 'provider' = one line
export function eraOf(party, date) {
  var p = party || {};
  if (p.kind !== 'affiliate') { return 'provider'; }
  if (p.provider_from && date && String(date) >= String(p.provider_from)) { return 'provider'; }
  return 'advance';
}
// is this line broken into bills / service fee / waiting? — only from the company's provider_from date
export function isSplitLine(party, date) { var p = party || {}; return !!(p.provider_from && date && String(date) >= String(p.provider_from)); }

// o: { parties, lines:[{id,date,amount,classification,payer}], pays:[{bill_id,amount,paid_date,bank_transaction_id,method,voided}],
//      billById:{id:{vendor_name,bill_number,category,paid_via}}, requests:[{bank_transaction_id,fee_amount,status,funding_txn_id}],
//      catLabels, kindOf, from, to }
export function buildPaidThroughBlocks(o) {
  var catLabels = o.catLabels || {}; var kindOf = o.kindOf || function () { return 'expense'; };
  var from = o.from, to = o.to; var out = [];
  var inP = function (d) { return !!d && d >= from && d <= to; };
  (o.parties || []).forEach(function (party) {
    var pk = partyKeyOf(party.name);
    ['advance', 'provider'].forEach(function (era) {
      var payTotal = 0, payCount = 0, payByCat = {}; var feesBooked = 0, waiting = 0; var mine = []; var advanceHeld = 0;
      var moneyBack = 0, mbRows = [], backSame = 0; // v55.83-XR
      var splits = o.splits || {}; // v55.83-TX — { bank line id: { fee, advance } } split off by a person (party_money_entries)
      (o.lines || []).forEach(function (t) {
        if (partyKeyOf(t.payer) !== pk || !inP(t.date) || eraOf(party, t.date) !== era) { return; }
        // v55.83-TX — an ADVANCE split off this payment is not spending: it leaves the line's category (the server moves it to
        // a not-P&L 'advance held' row in both views), so the block counts only the rest of the payment
        var spA = splits[t.id] ? r2(splits[t.id].advance) : 0; if (spA) { advanceHeld = r2(advanceHeld + spA); }
        var a = r2(r2(t.amount) - spA);
        // v55.83-XR (Codex 09:54 P2) — MONEY BACK (a negative line: the company returned unused funds). It comes out of the tax line
        // it was taken off (payments_by_cat, net), but it is NOT a payment, a fee or a negative fee: it is a funds movement,
        // shown as its own not-P&L row (remainderRows) so returning unused money never moves internal profit.
        if (t.money_back === true) { moneyBack = r2(moneyBack - a); mbRows.push({ id: t.id, date: t.date, amount: r2(0 - a), transfer_id: t.transfer_id || null, who: t.who || '' }); mine.push(t); }
        else { payTotal = r2(payTotal + a); payCount++; mine.push(t); }
        var k = t.classification || 'uncategorized';
        if (!payByCat[k]) { payByCat[k] = { key: k, label: catLabels[k] || k, total: 0 }; }
        payByCat[k].total = r2(payByCat[k].total + a);
      });
      var allocByCat = {}, allocTotal = 0, rows = [];
      (o.pays || []).forEach(function (p) {
        if (p.party_opening_id) { return; } // v55.83-XO — paid from a starting balance: counted below, never from this period's transfers
        if (p.method !== 'rtm' || p.voided === true || !inP(p.paid_date)) { return; }
        var b = (o.billById || {})[p.bill_id];
        if (!b || partyKeyOf(b.paid_via || 'RTM Capital') !== pk || eraOf(party, p.paid_date) !== era) { return; }
        var k = b.category || 'uncategorized'; var am = r2(p.amount);
        if (!allocByCat[k]) { allocByCat[k] = { key: k, label: catLabels[k] || k, kind: kindOf(k), count: 0, total: 0 }; }
        allocByCat[k].count++; allocByCat[k].total = r2(allocByCat[k].total + am); allocTotal = r2(allocTotal + am);
        if (rows.length < 300) { rows.push({ date: p.paid_date, who: b.vendor_name || '(bill)', ref: b.bill_number || '—', category: k, amount: am, bill_id: p.bill_id, bill_date: b.bill_date || null, release: b.release_number || null, bill_total: b.total_amount === undefined ? null : r2(b.total_amount), bank_line: p.bank_transaction_id || null }); }
      });
      // v55.83-TX — bills paid FROM THE ADVANCE in the period: in the tax view they are professional fees (the server adds them
      // to that line); the real-cost view moves them into the bills' real categories (payments_by_cat out, allocations in)
      var advByCat = {}, advApplied = 0;
      (o.pays || []).forEach(function (p) {
        if (p.method !== 'advance' || p.voided === true || !inP(p.paid_date)) { return; }
        var b = (o.billById || {})[p.bill_id];
        if (!b || partyKeyOf(b.paid_via) !== pk || eraOf(party, p.paid_date) !== era) { return; }
        var k = b.category || 'uncategorized'; var am = r2(p.amount);
        if (!advByCat[k]) { advByCat[k] = { key: k, label: catLabels[k] || k, kind: kindOf(k), count: 0, total: 0 }; }
        advByCat[k].count++; advByCat[k].total = r2(advByCat[k].total + am); advApplied = r2(advApplied + am);
        if (rows.length < 300) { rows.push({ date: p.paid_date, who: b.vendor_name || '(bill)', ref: (b.bill_number || '—') + ' · from the advance', category: k, amount: am }); }
      });
      // v55.83-XO (Max's (b)) — bills paid FROM A STARTING BALANCE on / after 1 June 2026: in the tax view they are professional
      // fees on their paid date (the server adds them to that line, from the shared calculation); the real-cost view takes them
      // back out of it (payments_by_cat) and puts the bills into their real categories — same as the advance above, totals never move
      var sbByCat = {}, sbApplied = 0, sbCount = 0;
      (o.pays || []).forEach(function (p) {
        if (!p.party_opening_id || p.voided === true || !inP(p.paid_date) || String(p.paid_date) < STARTING_BALANCE_TAX_FROM) { return; }
        var b = (o.billById || {})[p.bill_id];
        if (!b || partyKeyOf(b.paid_via) !== pk || eraOf(party, p.paid_date) !== era) { return; }
        var k = b.category || 'uncategorized'; var am = r2(p.amount);
        if (!sbByCat[k]) { sbByCat[k] = { key: k, label: catLabels[k] || k, kind: kindOf(k), count: 0, total: 0 }; }
        sbByCat[k].count++; sbByCat[k].total = r2(sbByCat[k].total + am); sbApplied = r2(sbApplied + am); sbCount++;
        if (rows.length < 300) { rows.push({ date: p.paid_date, who: b.vendor_name || '(bill)', ref: (b.bill_number || '—') + ' · from the starting balance', category: k, amount: am, bill_id: p.bill_id }); }
      });
      if (!(payCount > 0 || allocTotal > 0 || advApplied > 0 || sbApplied > 0 || mbRows.length > 0)) { return; }
      // bills / service fee / waiting — line by line, only for lines from provider_from on
      // v55.83-VY (Max, Nov 20: "Only explicit Services rendered designation creates that fee expense") — every fee a person booked
      // on these transfers (on a request, or split off the payment), whichever date the line has. The rows of the Income
      // Statement are NOT changed by it (older entries stay as booked); P&L by period uses this figure for its own deduction.
      var explicitFees = 0;
      mine.forEach(function (t) {
        var feeE = 0; (o.requests || []).forEach(function (w) { if (w.bank_transaction_id === t.id && w.status === 'attached' && w.funding_txn_id) { feeE += Number(w.fee_amount) || 0; } });
        explicitFees = r2(explicitFees + feeE + r2((splits[t.id] || {}).fee));
      });
      // v55.83-XR — money back in this window of a transfer ALSO in this window: it lowers that transfer's unused part (waiting, or the
      // remainder), so the same money is not shown twice; only money back of EARLIER transfers needs its own "returned" row
      mine.forEach(function (t) { if (t.money_back !== true) { backSame = r2(backSame + r2((o.refunds || {})[t.id])); } });
      mine.forEach(function (t) {
        if (t.money_back === true || !isSplitLine(party, t.date)) { return; }
        var used = 0; (o.pays || []).forEach(function (p) { if (p.bank_transaction_id === t.id && p.voided !== true) { used += Number(p.amount) || 0; } });
        var fee = 0; (o.requests || []).forEach(function (w) { if (w.bank_transaction_id === t.id && w.status === 'attached' && w.funding_txn_id) { fee += Number(w.fee_amount) || 0; } });
        var spT = splits[t.id] || {}; var spFee = r2(spT.fee); var spAdv = r2(spT.advance); // v55.83-TX
        feesBooked = r2(feesBooked + fee + spFee);
        var back = r2((o.refunds || {})[t.id]); // v55.83-XR — money back of this transfer in the same window: no longer waiting for bills
        waiting = r2(waiting + Math.max(0, r2(Number(t.amount) - used - fee - spFee - spAdv - back)));
      });
      var remainder = r2(payTotal - allocTotal);
      var twoEras = party.kind === 'affiliate' && !!party.provider_from;
      var blk = { key: party.name + (twoEras && era === 'advance' ? '|before' : ''), payer: party.name, kind: era === 'advance' ? 'affiliate' : 'service_provider', era: era,
        era_note: twoEras ? (era === 'advance' ? 'before ' + party.provider_from : 'from ' + party.provider_from) : null,
        remainder_label: era === 'advance' ? party.remainder_label : (party.kind === 'affiliate' ? party.name + ' service fee (payments − covered bills)' : party.remainder_label),
        payments_total: payTotal, payments_count: payCount,
        payments_by_cat: Object.keys(payByCat).map(function (k) { return payByCat[k]; }),
        allocations_by_cat: Object.keys(allocByCat).map(function (k) { return allocByCat[k]; }).sort(function (x, y) { return y.total - x.total; }),
        allocations_total: allocTotal, service_fee: remainder,
        fees_booked: feesBooked, waiting: waiting, remainder_other: r2(remainder - feesBooked - waiting - backSame), rows: rows,
        // v55.83-XR — money back: all of it in this window (money_back), the part that lowered this window's own transfers (back_same),
        // and the rest = the not-P&L "money returned" row (money_back_other). Rows: remainder_other + fees + waiting − money_back_other
        // = payments − covered bills − money back, exactly what payments_by_cat takes out of the tax line.
        money_back: moneyBack, back_same: backSame, money_back_other: r2(moneyBack - backSame), money_back_rows: mbRows,
        advance_held: advanceHeld, advance_applied: advApplied, explicit_fees: explicitFees, // v55.83-TX · VW
        // v55.83-VY — the transfers themselves, and how much of them nobody has marked with the company yet
        lines: mine.filter(function (t) { return t.money_back !== true; }).map(function (t) { return { id: t.id, date: t.date, amount: r2(t.amount), who: t.who || '', marked: t.marked !== false }; }),
        unmarked_total: r2(mine.reduce(function (a, t) { return a + (t.marked === false ? Number(t.amount) || 0 : 0); }, 0)) };
      if (advApplied > 0) {
        var profKey = o.profKey || 'professional_fees';
        blk.payments_by_cat.push({ key: profKey, label: catLabels[profKey] || 'Professional fees', total: advApplied, from_advance: true });
        Object.keys(advByCat).forEach(function (k) {
          var hitA = blk.allocations_by_cat.filter(function (x) { return x.key === k; })[0];
          if (hitA) { hitA.total = r2(hitA.total + advByCat[k].total); hitA.count += advByCat[k].count; } else { blk.allocations_by_cat.push(advByCat[k]); }
        });
      }
      blk.starting_balance_applied = sbApplied; // v55.83-XO
      if (sbApplied > 0) {
        var profKeyS = o.profKey || 'professional_fees';
        blk.payments_by_cat.push({ key: profKeyS, label: catLabels[profKeyS] || 'Professional fees', total: sbApplied, count: sbCount, from_starting_balance: true });
        Object.keys(sbByCat).forEach(function (k) {
          var hitS = blk.allocations_by_cat.filter(function (x) { return x.key === k; })[0];
          if (hitS) { hitS.total = r2(hitS.total + sbByCat[k].total); hitS.count += sbByCat[k].count; } else { blk.allocations_by_cat.push(sbByCat[k]); }
        });
      }
      out.push(blk);
    });
  });
  return out;
}

// the rows that replace the single "remainder" row in the broken-down view; they always add up to block.service_fee
export function remainderRows(block) {
  var b = block || {}; var rows = [];
  var keyBase = '__pt_' + String(b.key || b.payer || 'rtm').toLowerCase().replace(/[^a-z0-9]+/g, '_');
  var kind = b.kind === 'affiliate' ? 'not_pnl' : 'expense';
  var fees = r2(b.fees_booked), waiting = r2(b.waiting);
  var other = (b.fees_booked == null && b.waiting == null) ? r2(b.service_fee) : r2(b.remainder_other);
  if (Math.abs(other) > 0.005) { rows.push({ key: keyBase, label: b.remainder_label || 'RTM service fee (payments − covered bills)', kind: kind, count: b.payments_count || 0, total: other }); }
  if (Math.abs(fees) > 0.005) { rows.push({ key: keyBase + '_fee', label: (b.payer || 'RTM') + ' service fee (on requests)', kind: 'expense', count: 0, total: fees }); }
  if (Math.abs(waiting) > 0.005) { rows.push({ key: keyBase + '_waiting', label: (b.payer || 'RTM') + ' — uncategorized, waiting for bills (stays professional fees)', kind: 'expense', count: 0, total: waiting, waiting: true }); }
  // v55.83-XR (Codex 09:01 / 09:54) — money the company RETURNED (of transfers before this window): a funds movement, never a fee or a
  // negative fee. Not P&L. Each line names its money-in bank line and the transfer it belongs to.
  var back = r2(b.money_back_other);
  if (Math.abs(back) > 0.005) { rows.push({ key: keyBase + '_returned', label: 'Money returned by ' + (b.payer || 'RTM') + ' (lowers the funds it holds; not income, not an expense)', kind: 'not_pnl', count: (b.money_back_rows || []).length, total: r2(0 - back), money_back: true, money_back_rows: b.money_back_rows || [] }); }
  return rows;
}
