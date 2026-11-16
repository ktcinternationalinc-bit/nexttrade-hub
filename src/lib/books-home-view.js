// v55.83-SS — small view helpers for the Books home (pure).
// Max, Nov 15 2026 (phone screenshot): the "Due in this period" line was one long run of dark red text on the dark page,
// one entry per bill; and the rows behind a card showed two of nine columns on a phone.
function cents(n) { return Math.round((Number(n) || 0) * 100); }
// bills due → one line per vendor: how many bills, the total, the first and last due date. Same money, to the cent.
export function groupBillsDue(list) {
  var by = {}, order = [];
  (list || []).forEach(function (b) {
    var name = String((b && b.vendor_name) || 'Unknown vendor').trim() || 'Unknown vendor';
    var k = name.toUpperCase().replace(/\s+/g, ' ');
    if (!by[k]) { by[k] = { vendor: name, count: 0, cents: 0, first_due: null, last_due: null }; order.push(k); }
    var g = by[k]; g.count++; g.cents += cents(b && b.open);
    var d = b && b.due_date ? String(b.due_date) : null;
    if (d) { if (!g.first_due || d < g.first_due) { g.first_due = d; } if (!g.last_due || d > g.last_due) { g.last_due = d; } }
  });
  var groups = order.map(function (k) { var g = by[k]; return { vendor: g.vendor, count: g.count, total: g.cents / 100, first_due: g.first_due, last_due: g.last_due }; })
    .sort(function (a, b) { return b.total - a.total || a.vendor.localeCompare(b.vendor); });
  var tot = 0, n = 0; groups.forEach(function (g) { tot += cents(g.total); n += g.count; });
  return { groups: groups, total: tot / 100, count: n };
}

// v55.83-ST — the rows behind an aging card. drill: { bucket, kind } for one window, { bucket, kind:'cum' } for the running
// position up to a window, or { buckets:[…], kind } for several windows at once (TOTAL OVERDUE = all four late windows;
// before this it opened only "1–30 days late").
export function agingDrillRows(rows, drill, bucketOrder) {
  var d = drill || {}; var order = bucketOrder || [];
  var cumIdx = order.indexOf(d.bucket);
  var all = (rows || []).filter(function (r) {
    if (d.buckets) { return d.buckets.indexOf(r.bucket) >= 0 && r.kind === d.kind; }
    if (d.kind === 'cum') { return order.indexOf(r.bucket) <= cumIdx; }
    return r.bucket === d.bucket && r.kind === d.kind;
  }).sort(function (a, b) { return b.amount - a.amount; });
  var c = 0; all.forEach(function (r) { c += (d.kind === 'cum' && r.kind === 'out' ? -1 : 1) * cents(r.amount); });
  return { rows: all, sum: c / 100 };
}
