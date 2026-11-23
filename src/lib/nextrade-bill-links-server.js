// v55.83-XX — WHICH KTC BILLS ARE "NEXTRADE BILLS" (Max, 23 Nov 2026: "Nextrade bills need to be grouped by each type like the other
// ktc bills / no need to validate these bills / will be available for only Nextrade payments wires / also will be able to use available
// balance for nextrade that we enter in the beginning").
// A Nextrade bill = a vendor_bills row with an ACTIVE company_bill_links row for the NextTrade company (the bill made, or attached, when a
// Nextrade expense line was categorized — src/lib/nextrade-bills-server.js). It is always looked up HERE, on the server, from the links
// table; a flag sent by a screen is never trusted.
//   • the table not installed yet (TW SQL not run) = no bill is a Nextrade bill (nothing is exempt, nothing is refused);
//   • any other read error = { ok: false } — the caller FAILS CLOSED: the bill is NOT exempt from validation, and a payment / paid-via
//     change that depends on the answer is refused with "could not check".
// Server only. SWC-safe (var + concatenation).
import { NEXTRADE_COMPANY_ID } from './companies';

function missingTable(e) { return /does not exist|schema cache|Could not find the table/i.test(String((e && e.message) || '')); }

// { ok: true, ids: { billId: true } } | { ok: false, ids: {}, error }
export async function nextradeBillIds(db, billIds) {
  var want = []; var seen = {};
  (billIds || []).forEach(function (x) { var k = x == null ? '' : String(x); if (k && !seen[k]) { seen[k] = true; want.push(k); } });
  var out = {};
  if (!want.length) { return { ok: true, ids: out }; }
  for (var i = 0; i < want.length; i += 200) {
    var part = want.slice(i, i + 200); var r;
    try { r = await db.from('company_bill_links').select('bill_id, company_id, status').eq('company_id', NEXTRADE_COMPANY_ID).eq('status', 'active').in('bill_id', part); }
    catch (e) { return { ok: false, ids: {}, error: (e && e.message) || 'read failed' }; }
    if (!r || r.error) {
      if (r && missingTable(r.error)) { return { ok: true, ids: {}, missing: true }; }
      return { ok: false, ids: {}, error: (r && r.error && r.error.message) || 'read failed' };
    }
    (r.data || []).forEach(function (l) { if (l && l.bill_id && l.status === 'active' && l.company_id === NEXTRADE_COMPANY_ID) { out[String(l.bill_id)] = true; } });
  }
  return { ok: true, ids: out };
}

// Marks each bill object of the list (or { id → bill } map) with nextrade_bill: true when it is one; clears the mark otherwise (a failed
// lookup leaves NOTHING marked — fail closed). Returns the lookup result.
export async function markNextradeBills(db, bills) {
  var list = Array.isArray(bills) ? bills : Object.keys(bills || {}).map(function (k) { return bills[k]; });
  list = list.filter(function (b) { return !!b && !!b.id; });
  var r = await nextradeBillIds(db, list.map(function (b) { return b.id; }));
  list.forEach(function (b) { if (r.ok && r.ids[String(b.id)]) { b.nextrade_bill = true; } else if (b.nextrade_bill !== undefined) { delete b.nextrade_bill; } });
  return r;
}

export var NEXTRADE_PAY_POINTER = 'Pay it on a wire to NextTrade Industries (Accounting → 🏦 Wires → ＋ New wire), or from the NextTrade starting balance (Bills → 🏦 Funds with RTM / NextTrade → Pay bills from it).';
