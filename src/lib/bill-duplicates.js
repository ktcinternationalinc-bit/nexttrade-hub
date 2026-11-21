// v55.83-WZ — DUPLICATE BILLS (Max, 21 Nov 2026: "i don't want any duplicate bills. it needs to be blocked from the get go with
// messages"). One identity for a bill: the same vendor (written any way: "NexPac Corp." = "NEXPAC CORPORATION") and the same bill
// number (dashes, spaces and case ignored) in the same company's books. It mirrors public.hub_bill_number_key() in
// sql/v55-83-WZ-same-number-bills.sql, which refuses a second active copy in the database. This file lists the pairs that were
// already in the Hub before that rule, so a person can keep one and void the others. Pure. var + concat.

var DROP = ['INCORPORATED', 'CORPORATION', 'COMPANY', 'LIMITED', 'INC', 'LLC', 'LTD', 'CORP', 'CO', 'LLP', 'LP', 'THE'];

// the same normalisation as the SQL function; null when the vendor or the number is empty
export function billNumberKey(vendor, number) {
  var n = String(number || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  var v = String(vendor || '').toUpperCase().replace(/&/g, ' AND ').replace(/[^A-Z0-9 ]/g, ' ');
  v = ' ' + v.replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '') + ' ';
  DROP.forEach(function (w) { v = v.split(' ' + w + ' ').join(' '); });
  v = v.replace(/\s+/g, '');
  if (!v || !n) { return null; }
  return v + '|' + n;
}
function live(b) { return !b.record_status || b.record_status === 'active'; }
function isCredit(b) { return /^credit/i.test(String(b.bill_type || '')); }
// the one identity of a payable bill: company + vendor + number (null for a credit document, an inactive bill, no vendor or no number)
export function billIdentity(b) { if (!b || !live(b) || isCredit(b)) { return null; } var k = billNumberKey(b.vendor_name, b.bill_number); return k ? String(b.wave_business_id || '') + '#' + k : null; }

// bills: [{ id, vendor_name, bill_number, bill_date, total_amount, record_status, wave_business_id, bill_type, disputed,
//           validation_status, release_number, created_at, attachment_path }]
// paidOf: { bill_id: dollars paid (live payments) }, wireOf: { bill_id: { label, status } } (an open, not cancelled wire)
// → [{ key, vendor, number, copies: [{ ...bill, paid, wire, can_void, why_not }] }] — only groups with 2+ active copies
export function duplicateGroups(bills, paidOf, wireOf) {
  var by = {};
  (bills || []).forEach(function (b) {
    if (!live(b) || isCredit(b)) { return; }
    var k = billNumberKey(b.vendor_name, b.bill_number); if (!k) { return; }
    var gk = String(b.wave_business_id || '') + '#' + k;
    (by[gk] = by[gk] || []).push(b);
  });
  var out = [];
  Object.keys(by).forEach(function (gk) {
    var list = by[gk]; if (list.length < 2) { return; }
    var copies = list.map(function (b) {
      var paid = Number((paidOf || {})[b.id]) || 0; var wire = (wireOf || {})[b.id] || null;
      var why = paid > 0.005 ? 'money was recorded on it — undo the payment first' : (wire ? 'it is on wire ' + wire.label + ' (' + wire.status + ') — take it off that wire first' : null);
      return Object.assign({}, b, { paid: Math.round(paid * 100) / 100, wire: wire, can_void: !why, why_not: why });
    }).sort(function (a, c) { return String(a.created_at || '').localeCompare(String(c.created_at || '')); });
    out.push({ key: gk, vendor: list[0].vendor_name || '', number: list[0].bill_number || '', copies: copies });
  });
  return out.sort(function (a, c) { return String(a.vendor).localeCompare(String(c.vendor)) || String(a.number).localeCompare(String(c.number)); });
}

// Keeping one copy: which others can be voided now, and which cannot (and why). Nothing is ever deleted.
export function keepPlan(group, keepId) {
  var g = group || { copies: [] }; var keep = null; var voidIds = []; var blocked = [];
  g.copies.forEach(function (c) { if (c.id === keepId) { keep = c; } });
  if (!keep) { return { ok: false, error: 'Pick the copy to keep.' }; }
  g.copies.forEach(function (c) { if (c.id === keepId) { return; } if (c.can_void) { voidIds.push(c.id); } else { blocked.push({ id: c.id, why: c.why_not }); } });
  return { ok: true, keep: keep, void_ids: voidIds, blocked: blocked, reason: 'duplicate of ' + (keep.vendor_name || '') + ' #' + (keep.bill_number || '') + ' entered ' + String(keep.created_at || '').substring(0, 10) + ' (kept)' };
}
