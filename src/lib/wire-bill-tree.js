// v55.83-VK — the bill picker of a wire to a company (NextTrade / RTM) as a tree (Max, 19 Nov 2026: "the nextrade bills should
// be filterable and aggregated together where you can pay all in the tree or pay specific in the tree to wire";
// "when i am selecting bills for a wire i should be able to have them filter by nextrade if i am wiring to nextrade").
// Pure: which bills to list, how they group, and what ticking a whole group does. No money moves here — ticking only fills
// the wire draft exactly like ticking each bill by hand; the server checks every amount again on save.
// Safe on server and browser. SWC-safe (var + concatenation).
function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// a bill can be ticked when it is validated (or already ticked) — the same rule the single tick uses
export function canTick(bill, picks) { return !!bill && (bill.validation_status === 'validated' || (picks && picks[bill.id] != null)); }

// onlyTheirs = true → only bills already marked "paid through" that company, plus any other bill already ticked on this wire
export function wireBillsToShow(bills, picks, onlyTheirs) {
  var all = bills || [];
  if (!onlyTheirs) { return all; }
  return all.filter(function (b) { return !b.needs_mark || (picks && picks[b.id] != null); });
}

// [{ vendor, bills: [...], count, open, ticked, tickable, pay }] sorted by vendor name; bills keep their order
export function groupByVendor(bills, picks) {
  var by = {}; var order = [];
  (bills || []).forEach(function (b) {
    var v = String(b.vendor_name || '(no vendor)');
    if (!by[v]) { by[v] = { vendor: v, bills: [], count: 0, open: 0, ticked: 0, tickable: 0, pay: 0 }; order.push(v); }
    var g = by[v]; g.bills.push(b); g.count++; g.open = r2(g.open + (Number(b.open) || 0));
    if (canTick(b, picks)) { g.tickable++; }
    if (picks && picks[b.id] != null) { g.ticked++; g.pay = r2(g.pay + (Number(String(picks[b.id]).replace(/,/g, '')) || 0)); }
  });
  order.sort(function (a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0; });
  return order.map(function (v) { return by[v]; });
}

export function groupTotals(bills, picks) {
  var t = { count: 0, open: 0, ticked: 0, tickable: 0, pay: 0 };
  (bills || []).forEach(function (b) {
    t.count++; t.open = r2(t.open + (Number(b.open) || 0));
    if (canTick(b, picks)) { t.tickable++; }
    if (picks && picks[b.id] != null) { t.ticked++; t.pay = r2(t.pay + (Number(String(picks[b.id]).replace(/,/g, '')) || 0)); }
  });
  return t;
}

// Tick (on = true) or untick every bill of a group. Ticking fills each with what is still owed on it, never touches a bill
// already ticked (an amount typed by hand stays), and skips bills that are not validated yet.
export function tickGroup(picks, bills, on) {
  var pk = Object.assign({}, picks || {});
  (bills || []).forEach(function (b) {
    if (on) { if (pk[b.id] == null && b.validation_status === 'validated' && Number(b.open) > 0.005) { pk[b.id] = String(b.open); } }
    else if (pk[b.id] != null) { delete pk[b.id]; }
  });
  return pk;
}
