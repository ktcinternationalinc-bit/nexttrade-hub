// v55.83-XX — 🟦 NEXTRADE BILLS, GROUPED + PAID (Max, 23 Nov 2026: "Nextrade bills need to be grouped by each type like the other ktc bills
// / no need to validate these bills / will be available for only Nextrade payments wires / also will be able to use available balance for
// nextrade that we enter in the beginning and can use for any wires going forward or payment until all done. we can use actual ktc
// transfers or use the existing nextrade balance.")
// Pure (browser + server, no imports): it only arranges what the screen already has. No amount is changed; a group's "still owed" is a
// plain sum in whole cents of the bills in it that are shown with their amount. A payroll bill shown without its amount (🔒, the
// person has no "Payroll / salaries: view") adds NOTHING to any total, the same way the panel's overall "Still owed" is withheld today.

function cents(x) { return Math.round((Number(x) || 0) * 100); }

// one row of the company-books nextrade_bills answer: { link, bill, line, paid, state?, payroll_restricted? }
export function nextradeRowState(r) {
  var b = (r && r.bill) || {}; var l = (r && r.link) || {};
  if (l.status !== 'active') { return 'voided'; }
  if (b.record_status && b.record_status !== 'active') { return b.record_status; }
  if (r.payroll_restricted) { return r.state === 'paid' ? 'paid' : 'owed'; }
  return (Number(r.paid) || 0) >= (Number(b.total_amount) || 0) - 0.005 ? 'paid' : 'owed';
}

// What is still owed on one row, in cents — null when it must not be counted (payroll hidden, voided link, void bill)
export function rowOwedCents(r) {
  if (!r || r.payroll_restricted || !r.bill || r.bill.total_amount == null) { return null; }
  if (!r.link || r.link.status !== 'active' || r.bill.record_status !== 'active') { return null; }
  return Math.max(0, cents(r.bill.total_amount) - cents(r.paid));
}

// Groups by the bill's KTC category (the same keys and labels as the Bills screen: catLabelOf = { key: label }). A bill with no category
// is its own group ("No KTC category yet"). Groups in A → Z order of the label, the no-category group last. Each group:
// { key, label, rows, count, owed_count, owed_cents, hidden }  — hidden = payroll rows shown without an amount (not in owed_cents).
export var NO_CATEGORY_LABEL = 'No KTC category yet — set it in Nextrade → Category mapping';
export function groupNextradeBills(rows, catLabelOf) {
  var labels = catLabelOf || {}; var by = {}; var order = [];
  (rows || []).forEach(function (r) {
    // v55.83-ZD — every payroll bill (marked by the server with its reasons, for the super admin only) is in ONE "Payroll" group
    var isPay = !!(r && Array.isArray(r.payroll_reasons) && r.payroll_reasons.length);
    var k = isPay ? '__payroll' : String((r && r.bill && r.bill.category) || '');
    var g = by[k];
    if (!g) { g = by[k] = { key: k, label: isPay ? 'Payroll' : (k ? (labels[k] || k.replace(/_/g, ' ')) : NO_CATEGORY_LABEL), payroll: isPay || undefined, rows: [], count: 0, owed_count: 0, owed_cents: 0, hidden: 0 }; order.push(k); }
    g.rows.push(r); g.count += 1;
    var st = nextradeRowState(r);
    if (st === 'owed') { g.owed_count += 1; }
    if (r && r.payroll_restricted) { if (st === 'owed') { g.hidden += 1; } return; }
    var oc = rowOwedCents(r); if (oc != null) { g.owed_cents += oc; }
  });
  return order.map(function (k) { return by[k]; }).sort(function (a, b) {
    if (a.key === '__payroll') { return -1; } if (b.key === '__payroll') { return 1; } // ZD: Payroll first
    if (!a.key !== !b.key) { return a.key ? -1 : 1; }
    var x = String(a.label).toLowerCase(); var y = String(b.label).toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

// The starting balance "Pay ▸ From the NextTrade starting balance" uses: the OLDEST one (as-of date, then id) that still has money left.
export function oldestStartingBalance(sbs) {
  var best = null;
  (sbs || []).forEach(function (sb) {
    if (!sb || !(Number(sb.left) > 0.005)) { return; }
    if (!best || String(sb.as_of || '') < String(best.as_of || '') || (String(sb.as_of || '') === String(best.as_of || '') && String(sb.id) < String(best.id))) { best = sb; }
  });
  return best;
}

// From the party-funds "funds" answer: which NextTrade starting balance to pay from, or why it cannot be done (in plain words).
export function startingBalanceToPay(funds, partyName, source) {
  var j = funds || {};
  if (j.can_starting_balance !== true) { return { ok: false, why: 'Only the super admin can pay bills from the NextTrade starting balance.' }; }
  if (j.starting_balances_installed !== true) { return { ok: false, why: 'Paying from the starting balance is not switched on yet (sql/v55-83-XO-starting-balance.sql).' }; }
  var want = String(partyName || 'NextTrade Industries').toLowerCase();
  var p = null;
  (j.parties || []).forEach(function (x) { var n = String((x && x.party) || '').toLowerCase(); if (!p && n === want) { p = x; } });
  if (!p) { (j.parties || []).forEach(function (x) { if (!p && /next\s*trade/i.test(String((x && x.party) || ''))) { p = x; } }); }
  if (!p) { return { ok: false, why: 'NextTrade is not in the funds list.' }; }
  var balances = (p.starting_balances || []).filter(function (b) { return (b.source === 'managed_sales') === (source === 'managed_sales'); });
  var sb = oldestStartingBalance(balances);
  if (!sb) {
    if (source === 'managed_sales') { return { ok: false, party: p, why: 'The NextTrade-managed sales balance has no funds available.' }; }
    var any = balances.length > 0;
    return { ok: false, party: p, why: 'There is no NextTrade starting balance with money left' + (any ? ' (every one is used up)' : ' (none has been entered)') + '. Pay this bill from a KTC transfer to NextTrade instead.' };
  }
  return { ok: true, party: p, sb: sb };
}

// The amount to tick on the starting-balance form for one bill: what is still owed on it, but never more than is left on the balance.
export function openingPickAmount(bill, sbLeft) {
  var o = cents(bill && bill.open); var l = cents(sbLeft);
  if (!(o > 0) || !(l > 0)) { return null; }
  return (Math.min(o, l) / 100).toFixed(2);
}

// The two ways to pay a Nextrade bill (the chooser under Pay ▸). The starting balance is the super admin's only, as in XO.
export function nextradePayChoices(isSuper) {
  var out = [{ key: 'transfer', label: 'From a KTC transfer to NextTrade', hint: 'Opens Wires → ＋ New wire to NextTrade Industries with this bill ticked. You pick the transfer it is paid from; the usual check and two signatures follow.' }];
  if (isSuper === true) {
    out.push({ key: 'managed_sales', label: 'From NextTrade-managed sales', hint: 'Uses posted sales receipts held by NextTrade for KTC.' });
    out.push({ key: 'opening', label: 'From the NextTrade starting balance', hint: 'Opens the oldest manual starting balance with funds available and this bill selected.' });
  }
  return out;
}
export var NEXTRADE_OPEN_WIRE_EVENT = 'hub-open-nextrade-wire';
export var NEXTRADE_PAY_OPENING_EVENT = 'hub-pay-nextrade-opening';
