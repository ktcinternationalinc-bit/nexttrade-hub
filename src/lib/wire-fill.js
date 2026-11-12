// v55.83-SC — Max, Nov 12 09:40: "i would like to have a feature where i can tell the system to build a wire for a certain
//  amount and that it will select from validated approved bills to create the wire for that amount including splitting to
//  make partial payments to get to the amount i want to wire."
// Pure. target = the WHOLE wire (bills + the party's service fee). Oldest due first (then oldest bill date); the last bill is
// paid in part so the wire lands exactly on the amount. It only PROPOSES ticks — the person can change any of them, and the
// wire still needs the check and both signatures.
function cents(x) { return Math.round((Number(String(x == null ? '' : x).replace(/,/g, '')) || 0) * 100); }

// bills: [{ id, vendor_name, open, due_date, bill_date, validation_status, on_package, needs_mark }]
// opts: { fee (dollars), vendor (only this vendor), vendors ([names] — only these vendors; empty = every vendor) }
// v55.83-SE (Max Nov 12 09:56, screenshot "No validated open bills to choose from" with 3 validated bills listed): bills not yet
// marked "paid through" this party ARE chosen too — ticking one marks it, exactly as ticking by hand does. And: "we should
// choose the vendor or vendors in which we need to send the wire to".
export function fillVendors(bills) {
  var by = {}; (bills || []).forEach(function (b) { if (b.validation_status === 'validated' && !b.on_package && cents(b.open) > 0) { by[b.vendor_name] = (by[b.vendor_name] || 0) + cents(b.open); } });
  return Object.keys(by).sort().map(function (v) { return { vendor: v, open: by[v] / 100 }; });
}
export function fillToAmount(bills, target, opts) {
  var o = opts || {};
  var want = cents(target); var fee = cents(o.fee);
  if (!(want > 0)) { return { ok: false, error: 'Type the amount you want to wire (a number like 25000).' }; }
  if (fee >= want) { return { ok: false, error: 'The service fee is as much as the whole wire — nothing is left for bills.' }; }
  var room = want - fee;
  var usable = (bills || []).filter(function (b) {
    return b.validation_status === 'validated' && !b.on_package && cents(b.open) > 0 && (!o.vendor || b.vendor_name === o.vendor) && (!(o.vendors && o.vendors.length) || o.vendors.indexOf(b.vendor_name) >= 0);
  }).sort(function (a, b) {
    if (!!a.needs_mark !== !!b.needs_mark) { return a.needs_mark ? 1 : -1; } // bills already paid through this party first
    return String(a.due_date || a.bill_date || '9999').localeCompare(String(b.due_date || b.bill_date || '9999')) || String(a.bill_date || '').localeCompare(String(b.bill_date || '')) || String(a.id).localeCompare(String(b.id));
  });
  if (!usable.length) { return { ok: false, error: (o.vendors && o.vendors.length) || o.vendor ? 'No validated open bills for the vendor(s) you chose.' : 'No validated open bills to choose from — validate the bills first.' }; }
  var picks = {}; var used = 0; var partial = null; var count = 0;
  for (var i = 0; i < usable.length && used < room; i++) {
    var open = cents(usable[i].open); var take = Math.min(open, room - used);
    picks[usable[i].id] = (take / 100).toFixed(2); used += take; count++;
    if (take < open) { partial = { id: usable[i].id, vendor_name: usable[i].vendor_name, bill_number: usable[i].bill_number, paid: take / 100, of: open / 100 }; }
  }
  return { ok: true, picks: picks, count: count, bills_total: used / 100, fee: fee / 100, total: (used + fee) / 100, short: (room - used) / 100, partial: partial };
}
