// v55.83-VK — the bill picker of a wire to a company (NextTrade / RTM) as a tree (Max, 19 Nov 2026: "the nextrade bills should
// be filterable and aggregated together where you can pay all in the tree or pay specific in the tree to wire";
// "when i am selecting bills for a wire i should be able to have them filter by nextrade if i am wiring to nextrade").
// Pure: which bills to list, how they group, and what ticking a whole group does. No money moves here — ticking only fills
// the wire draft exactly like ticking each bill by hand; the server checks every amount again on save.
// Safe on server and browser. SWC-safe (var + concatenation).
import { wireReady } from './wire-audit'; // v55.83-XX — a Nextrade bill on a NextTrade wire needs no validation step
function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// a bill can be ticked when it is validated (or already ticked) — the same rule the single tick uses
// v55.83-XX — or when it is a Nextrade bill the server offered on a wire to NextTrade ("Nextrade bill - no validation needed")
export function canTick(bill, picks) { return !!bill && (wireReady(bill) || (picks && picks[bill.id] != null)); }

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
    if (on) { if (pk[b.id] == null && wireReady(b) && Number(b.open) > 0.005) { pk[b.id] = String(b.open); } } // XX: + Nextrade bills
    else if (pk[b.id] != null) { delete pk[b.id]; }
  });
  return pk;
}

// v55.83-XX — "Pay ▸ From a KTC transfer to NextTrade" opens a new NextTrade wire with ONE bill ticked for what is still owed on it.
// Only a bill the server listed as tickable is ticked; otherwise the reason is given and nothing is ticked. The transfer is never picked.
export function presetPick(picks, bills, billId) {
  var pk = Object.assign({}, picks || {});
  var b = (bills || []).filter(function (x) { return x && String(x.id) === String(billId); })[0];
  if (!billId) { return { picks: pk, ticked: false, why: null }; }
  if (!b) { return { picks: pk, ticked: false, why: 'That bill is not in the list of open bills for this wire (it may already be paid or fully on another wire). Refresh the Nextrade bills.' }; }
  if (!canTick(b, pk)) { return { picks: pk, ticked: false, why: 'That bill cannot be ticked yet (it needs validating first).' }; }
  if (!(Number(b.open) > 0.005)) { return { picks: pk, ticked: false, why: 'Nothing is left to pay on that bill.' }; }
  if (pk[b.id] == null) { pk[b.id] = String(b.open); }
  return { picks: pk, ticked: true, why: null, bill: b };
}
