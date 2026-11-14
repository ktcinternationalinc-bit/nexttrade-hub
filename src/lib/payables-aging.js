// v55.83-SJ — "what we owe, by age" (accounts payable aging). Pure: reads the Bills list, writes nothing.
// A bill with no due date is aged from its bill date.
function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
function days(a, b) { var x = new Date(String(a || '').substring(0, 10) + 'T00:00:00Z').getTime(); var y = new Date(String(b).substring(0, 10) + 'T00:00:00Z').getTime(); return isNaN(x) || isNaN(y) ? null : Math.floor((y - x) / 86400000); }
export var AGING_COLS = [['current', 'Not due yet'], ['d1_30', '1–30 days late'], ['d31_60', '31–60'], ['d61_90', '61–90'], ['d90', 'Over 90']];

export function payablesAging(bills, today) {
  var t = today || new Date().toISOString().substring(0, 10);
  var by = {}; var tot = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90: 0, total: 0, bills: 0 };
  (bills || []).forEach(function (b) {
    if (!b || b.record_status === 'void' || b.record_status === 'deleted') { return; }
    if (b.status !== 'OPEN' && b.status !== 'PARTIAL' && b.status !== 'DISPUTED') { return; }
    var open = r2(b.open); if (!(open > 0)) { return; }
    var late = days(b.due_date || b.bill_date, t);
    var k = late == null || late <= 0 ? 'current' : late <= 30 ? 'd1_30' : late <= 60 ? 'd31_60' : late <= 90 ? 'd61_90' : 'd90';
    var v = String(b.vendor_name || '—');
    var row = by[v] || (by[v] = { vendor: v, current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90: 0, total: 0, bills: 0, disputed: 0, on_wire: 0 });
    row[k] = r2(row[k] + open); row.total = r2(row.total + open); row.bills++;
    if (b.status === 'DISPUTED') { row.disputed = r2(row.disputed + open); }
    if (b.wire_state) { row.on_wire = r2(row.on_wire + (Number(b.wire_state.amount) || 0)); }
    tot[k] = r2(tot[k] + open); tot.total = r2(tot.total + open); tot.bills++;
  });
  var rows = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.total - a.total || a.vendor.localeCompare(b.vendor); });
  return { rows: rows, totals: tot, as_of: t };
}
