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
// v55.83-VY (Max, Nov 20 2026, through Codex: "For Max's identified RTM destination ending 9909 and NextTrade destination ending
// 2061, unallocated funds default internally to unused / awaiting allocation, NOT a fee") — a money-out bank line that says it
// is a transfer TO one of these accounts is money sent to that company, also when nobody stamped the company on the line.
// Only the destination written in the bank's own text counts ("Online Transfer to CHK ...9909"); a category never does.
export var FUNDING_DESTINATIONS = [{ suffix: '9909', payer: 'RTM Capital' }, { suffix: '2061', payer: 'NextTrade Industries' }];
export function fundingPayerOfText(text) {
  var t = String(text || '');
  for (var i = 0; i < FUNDING_DESTINATIONS.length; i++) {
    var d = FUNDING_DESTINATIONS[i];
    if (new RegExp('\\bto\\s+(?:chk|checking|sav|savings)\\b[^0-9]{0,8}' + d.suffix + '(?![0-9])', 'i').test(t)) { return d.payer; }
  }
  return null;
}
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
      var splits = o.splits || {}; // v55.83-TX — { bank line id: { fee, advance } } split off by a person (party_money_entries)
      (o.lines || []).forEach(function (t) {
        if (partyKeyOf(t.payer) !== pk || !inP(t.date) || eraOf(party, t.date) !== era) { return; }
        // v55.83-TX — an ADVANCE split off this payment is not spending: it leaves the line's category (the server moves it to
        // a not-P&L 'advance held' row in both views), so the block counts only the rest of the payment
        var spA = splits[t.id] ? r2(splits[t.id].advance) : 0; if (spA) { advanceHeld = r2(advanceHeld + spA); }
        var a = r2(r2(t.amount) - spA); payTotal = r2(payTotal + a); payCount++; mine.push(t);
        var k = t.classification || 'uncategorized';
        if (!payByCat[k]) { payByCat[k] = { key: k, label: catLabels[k] || k, total: 0 }; }
        payByCat[k].total = r2(payByCat[k].total + a);
      });
      var allocByCat = {}, allocTotal = 0, rows = [];
      (o.pays || []).forEach(function (p) {
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
      if (!(payCount > 0 || allocTotal > 0 || advApplied > 0)) { return; }
      // bills / service fee / waiting — line by line, only for lines from provider_from on
      // v55.83-VY (Max, Nov 20: "Only explicit Services rendered designation creates that fee expense") — every fee a person booked
      // on these transfers (on a request, or split off the payment), whichever date the line has. The rows of the Income
      // Statement are NOT changed by it (older entries stay as booked); P&L by period uses this figure for its own deduction.
      var explicitFees = 0;
      mine.forEach(function (t) {
        var feeE = 0; (o.requests || []).forEach(function (w) { if (w.bank_transaction_id === t.id && w.status === 'attached' && w.funding_txn_id) { feeE += Number(w.fee_amount) || 0; } });
        explicitFees = r2(explicitFees + feeE + r2((splits[t.id] || {}).fee));
      });
      mine.forEach(function (t) {
        if (!isSplitLine(party, t.date)) { return; }
        var used = 0; (o.pays || []).forEach(function (p) { if (p.bank_transaction_id === t.id && p.voided !== true) { used += Number(p.amount) || 0; } });
        var fee = 0; (o.requests || []).forEach(function (w) { if (w.bank_transaction_id === t.id && w.status === 'attached' && w.funding_txn_id) { fee += Number(w.fee_amount) || 0; } });
        var spT = splits[t.id] || {}; var spFee = r2(spT.fee); var spAdv = r2(spT.advance); // v55.83-TX
        feesBooked = r2(feesBooked + fee + spFee);
        waiting = r2(waiting + Math.max(0, r2(Number(t.amount) - used - fee - spFee - spAdv)));
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
        fees_booked: feesBooked, waiting: waiting, remainder_other: r2(remainder - feesBooked - waiting), rows: rows,
        advance_held: advanceHeld, advance_applied: advApplied, explicit_fees: explicitFees, // v55.83-TX · VW
        // v55.83-VY — the transfers themselves, and how much of them nobody has marked with the company yet
        lines: mine.map(function (t) { return { id: t.id, date: t.date, amount: r2(t.amount), who: t.who || '', marked: t.marked !== false }; }),
        unmarked_total: r2(mine.reduce(function (a, t) { return a + (t.marked === false ? Number(t.amount) || 0 : 0); }, 0)) };
      if (advApplied > 0) {
        var profKey = o.profKey || 'professional_fees';
        blk.payments_by_cat.push({ key: profKey, label: catLabels[profKey] || 'Professional fees', total: advApplied, from_advance: true });
        Object.keys(advByCat).forEach(function (k) {
          var hitA = blk.allocations_by_cat.filter(function (x) { return x.key === k; })[0];
          if (hitA) { hitA.total = r2(hitA.total + advByCat[k].total); hitA.count += advByCat[k].count; } else { blk.allocations_by_cat.push(advByCat[k]); }
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
  return rows;
}
