// v55.83-SP — payment requests drawn from a transfer to RTM Capital / NextTrade (pure helpers, no database).
// Max, Nov 15 2026: "they should not go beyond the amount you transfer to Nextrade or RTM, and take into account
//   their professional fees ... Even if you have to split or partially pay a bill."
//   "each vendor ... the number of bills, and the amount that you pay for the total."
// Money is compared in cents. Nothing here guesses.

function cents(x) { return Math.round((Number(x) || 0) * 100); }
function dollars(c) { return Math.round(c) / 100; }

// What is left on a transfer: its amount, less every bill payment recorded against it, less the service
// fees of the requests attached to it.
export function fundingLeft(amount, billsPaid, fees) {
  var a = cents(amount), b = cents(billsPaid), f = cents(fees);
  return { amount: dollars(a), bills: dollars(b), fees: dollars(f), used: dollars(b + f), remaining: dollars(a - b - f), fully_used: a - b - f === 0, over: a - b - f < 0 };
}

// Does a request (its bills + its service fee) fit what is left on the transfer?
export function requestFit(remaining, billsTotal, fee) {
  var r = cents(remaining), b = cents(billsTotal), f = cents(fee);
  var total = b + f;
  return { total: dollars(total), bills: dollars(b), fee: dollars(f), left_after: dollars(r - total), fits: total <= r, exact: total === r, over_by: total > r ? dollars(total - r) : 0,
    room_for_bills: dollars(Math.max(0, r - f)) };
}

// The request, vendor by vendor — what RTM / NextTrade is asked to send to each one.
// lines: [{ amount, bill: { vendor_name, bill_number, total_amount } }] → [{ ref, vendor, bills, amount, partial }]
export function requestByVendor(label, lines) {
  var order = [], by = {};
  (lines || []).forEach(function (l) {
    var v = String((l && l.bill && l.bill.vendor_name) || 'Unknown vendor');
    var k = v.toUpperCase().replace(/\s+/g, ' ').trim();
    if (!by[k]) { by[k] = { vendor: v, bills: 0, cents: 0, partial: 0, bill_numbers: [] }; order.push(k); }
    by[k].bills++; by[k].cents += cents(l.amount);
    if (l && l.bill && l.bill.bill_number) { by[k].bill_numbers.push(String(l.bill.bill_number)); }
    if (l && l.bill && l.bill.total_amount != null && cents(l.amount) < cents(l.bill.total_amount)) { by[k].partial++; }
  });
  order.sort(function (a, b) { return by[a].vendor.localeCompare(by[b].vendor); });
  return order.map(function (k, i) {
    return { ref: String(label || '') + '/' + (i + 1), vendor: by[k].vendor, bills: by[k].bills, amount: dollars(by[k].cents), partial: by[k].partial, bill_numbers: by[k].bill_numbers };
  });
}

export function payeeKey(x) { return String(x == null ? '' : x).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
