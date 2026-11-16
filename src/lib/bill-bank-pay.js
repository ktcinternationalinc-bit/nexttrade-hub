// v55.83-TH — PAY BILLS FROM ONE BANK LINE (Max, Nov 16 2026):
//   "cannot pay something in past without it being matched to a bank transaction. The bank transaction can be 20000 and you
//    keep linking bills to it until it reaches that amount...and the last bill will need to be partially paid if does not reach
//    exactly the 20000"
// Pure, no database. SWC-safe (var + concat).
function c(x) { return Math.round((Number(x) || 0) * 100); }
function m(cents) { return Math.round(cents) / 100; }

// remaining on a bank line = its amount minus every non-voided bill payment already linked to it
export function bankLineRemaining(amountAbs, linkedPayments) {
  var used = 0; (linkedPayments || []).forEach(function (p) { if (p && p.voided !== true) { used += c(p.amount); } });
  return { amount: m(c(amountAbs)), used: m(used), remaining: m(Math.max(0, c(amountAbs) - used)) };
}

// Fill bills in the order given: each gets its whole open balance until the bank line runs out; the bill where it runs out gets
// the part that is left (a PARTIAL payment); bills after that get nothing. picks = [{ bill_id, open }] (open = bill's open balance)
export function allocateBankLine(remaining, picks) {
  var left = c(remaining); var out = [];
  (picks || []).forEach(function (p) {
    var open = Math.max(0, c(p.open)); var take = Math.min(open, left);
    out.push({ bill_id: p.bill_id, open: m(open), amount: m(take), partial: take > 0 && take < open, nothing_left: take === 0 });
    left -= take;
  });
  return { lines: out, allocated: m(c(remaining) - left), left: m(left) };
}

// What the server accepts. bank = { amount_abs, direction, pending }, used = already linked, rows = [{ bill_id, amount, open, active, on_wire }]
export function checkBankPayment(bank, used, rows) {
  var errs = [];
  if (!bank) { return { ok: false, errors: ['Pick the bank transaction that paid these bills.'] }; }
  if (bank.direction !== 'out') { errs.push('A bill is paid by MONEY OUT — that bank transaction is money in.'); }
  if (bank.pending === true) { errs.push('That bank transaction is still pending — link it once it settles.'); }
  if (!rows || !rows.length) { errs.push('Tick at least one bill.'); }
  var total = 0; var seen = {};
  (rows || []).forEach(function (r) {
    var who = r.label || r.bill_id;
    if (seen[r.bill_id]) { errs.push(who + ' is listed twice.'); } seen[r.bill_id] = true;
    if (!(c(r.amount) > 0)) { errs.push(who + ': the amount must be more than zero.'); }
    if (r.active === false) { errs.push(who + ' is void or deleted.'); }
    if (r.on_wire) { errs.push(who + ' is on wire ' + r.on_wire + ' — it is paid when that wire is attached to its bank line.'); }
    if (c(r.amount) > c(r.open)) { errs.push(who + ': $' + m(c(r.amount)).toFixed(2) + ' is more than its open balance $' + m(c(r.open)).toFixed(2) + '.'); }
    total += c(r.amount);
  });
  var room = c(bank.amount_abs) - c(used);
  if (total > room) { errs.push('These bills add up to $' + m(total).toFixed(2) + ', but only $' + m(Math.max(0, room)).toFixed(2) + ' of this bank transaction is still free.'); }
  return { ok: errs.length === 0, errors: errs, total: m(total), left_after: m(Math.max(0, room - total)) };
}
