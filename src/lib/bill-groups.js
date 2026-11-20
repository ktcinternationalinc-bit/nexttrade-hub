// v55.83-VU — Bills: grouped by vendor, with search and sorting (Max, Nov 20 2026: "In the billing section, we should be able to
// group under every different vendor ... then you can drill down ... filter, search ... sort by the invoice date, by the invoice
// number for each grouping ... show all and also filter it and sort by the date and the number").
// Pure: it only arranges the bills the screen already has (after its own Open / Paid / type / direction filters). No amount is
// changed; a group's totals are plain sums of its bills, in whole cents.

function cents(x) { return Math.round((Number(x) || 0) * 100); }
function norm(x) { return String(x === null || x === undefined ? '' : x).toLowerCase().trim(); }

// One vendor = one group. The same name typed with other capitals or extra spaces is the same vendor.
export function vendorKey(name) { return norm(name).replace(/\s+/g, ' ') || '(no vendor)'; }

// Search: every word typed must be found somewhere in the bill — vendor, bill number, release / warehouse reference, category,
// type, notes, dates or an amount. An empty search keeps everything.
export function searchBills(bills, q, catLabelOf) {
  var words = norm(q).split(/\s+/).filter(function (w) { return !!w; });
  if (!words.length) { return (bills || []).slice(); }
  var labels = catLabelOf || {};
  return (bills || []).filter(function (b) {
    var amounts = [b.total_amount, b.open, b.paid].map(function (v) { var n = Number(v); return isNaN(n) ? '' : n.toFixed(2) + ' ' + String(Math.round(n * 100) / 100); }).join(' ');
    var hay = norm([b.vendor_name, b.bill_number, b.release_number, b.other_reference, b.warehouse_reference, b.category, labels[b.category], b.bill_type, b.shipment_direction, b.paid_via, b.notes, b.bill_date, b.due_date, amounts].join(' '));
    var plain = hay.replace(/[$,]/g, '');
    return words.every(function (w) { return hay.indexOf(w) >= 0 || plain.indexOf(w.replace(/[$,]/g, '')) >= 0; });
  });
}

// Bill numbers sort the way a person reads them: INV-9 before INV-10, and a bill with no number last.
function numberCompare(a, b) {
  var x = String(a || ''); var y = String(b || '');
  if (!x && !y) { return 0; } if (!x) { return 1; } if (!y) { return -1; }
  return x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' });
}
var TYPE_ORDER = { trucking: 1, shipping: 2, bonded_brokerage: 3, supplier: 4 };
export var BILL_SORTS = [
  { key: 'due', label: 'due date' }, { key: 'bill_date', label: 'bill date' }, { key: 'bill_number', label: 'bill number' }, { key: 'vendor', label: 'vendor' },
  { key: 'amount', label: 'amount' }, { key: 'open', label: 'open balance' }, { key: 'type', label: 'type of bill' }, { key: 'direction', label: 'inbound / outbound' }
];
// sortBy = one of BILL_SORTS; dir = 'asc' | 'desc'. A missing date goes last in both directions. Ties: due date, then bill number.
export function sortBills(bills, sortBy, dir) {
  var d = dir === 'desc' ? -1 : 1;
  function dateCmp(x, y) { var a = String(x || ''); var b = String(y || ''); if (!a && !b) { return 0; } if (!a) { return 1; } if (!b) { return -1; } return d * a.localeCompare(b); }
  function main(a, b) {
    if (sortBy === 'bill_date') { return dateCmp(a.bill_date, b.bill_date); }
    if (sortBy === 'bill_number') { var na = String(a.bill_number || ''); var nb = String(b.bill_number || ''); if (!na || !nb) { return numberCompare(na, nb); } return d * numberCompare(na, nb); }
    if (sortBy === 'vendor') { return d * vendorKey(a.vendor_name).localeCompare(vendorKey(b.vendor_name)); }
    if (sortBy === 'amount') { return d * (cents(a.total_amount) - cents(b.total_amount)); }
    if (sortBy === 'open') { return d * (cents(a.open) - cents(b.open)); }
    if (sortBy === 'type') { return d * ((TYPE_ORDER[a.bill_type] || 9) - (TYPE_ORDER[b.bill_type] || 9)); }
    if (sortBy === 'direction') { return d * String(a.shipment_direction || 'z').localeCompare(String(b.shipment_direction || 'z')); }
    return dateCmp(a.due_date, b.due_date);
  }
  return (bills || []).map(function (b, i) { return { b: b, i: i }; }).sort(function (p, q) {
    return main(p.b, q.b) || String(p.b.due_date || '').localeCompare(String(q.b.due_date || '')) || numberCompare(p.b.bill_number, q.b.bill_number) || (p.i - q.i);
  }).map(function (p) { return p.b; });
}

// Groups in A → Z order of the vendor; each keeps its bills in the order given (so sort first, then group).
// today = 'YYYY-MM-DD' for the late count. Totals count ACTIVE bills only (a voided bill is listed but adds nothing).
// dir = 'desc' lists the vendors Z → A (used when the list is sorted by vendor, last → first); anything else A → Z.
export function groupByVendor(bills, today, dir) {
  var by = {}; var order = [];
  (bills || []).forEach(function (b) {
    var k = vendorKey(b.vendor_name);
    var g = by[k]; if (!g) { g = by[k] = { key: k, vendor: String(b.vendor_name || '').trim() || '(no vendor)', bills: [], count: 0, total_cents: 0, paid_cents: 0, open_cents: 0, late: 0, duplicates: 0, earliest_due: '' }; order.push(k); }
    g.bills.push(b); g.count += 1;
    if (b.record_status !== 'active') { return; }
    g.total_cents += cents(b.total_amount); g.paid_cents += cents(b.paid); g.open_cents += cents(b.open);
    var isOpen = Number(b.open) > 0.005;
    if (isOpen && b.due_date && today && b.due_date < today) { g.late += 1; }
    if (isOpen && b.due_date && (!g.earliest_due || b.due_date < g.earliest_due)) { g.earliest_due = b.due_date; }
    if (b.dup_flag) { g.duplicates += 1; }
  });
  var d = dir === 'desc' ? -1 : 1;
  return order.map(function (k) { return by[k]; }).sort(function (a, b) { return d * (a.key < b.key ? -1 : (a.key > b.key ? 1 : 0)); });
}
