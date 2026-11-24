// v55.83-YH — Canada historical archive (Max, 24 Nov 2026).
// PURE helpers, no imports: safe for the browser AND for server routes.
//
// The old Cambridge (Ontario) workbook kept Canada by GOODS NAME and weight, with no SKU, so the
// Canadian side was never migrated the way the USA side was. This archive keeps that history —
// goods received and goods shipped, in pounds, by goods type and month (Jun 2021 – Apr 2024) — and
// ties each old Canadian goods name to a CURRENT CGT goods type so comparisons are like for like.
//
// It is a READ-ONLY archive for comparison and reports. Nothing here reads or changes live
// inventory, bills, invoices, bank lines or P&L.

export var ARCHIVE_FORMAT = 'ktc-canada-history-v1';

// The 24 goods columns of the old Cambridge sheets, in the workbook's own order.
export var CANADA_GOODS = ['Seconds Auto', 'Thirds Auto', 'Obsolete', 'Inspected', 'PVC Black on Black/Grey', 'PVC Non Woven',
  'Box Seconds', 'Drylam', 'Decking', 'Roofing', 'Pool', 'TPO Rolls', 'TPO Scrap', 'TPO Chips', 'Foam', 'PVC Film Rolls',
  'PVC GAYLORDS', 'Mixed', 'Other', 'Morbern', 'Trim', 'Fabric', 'Paper', 'Vintex'];

// Today's CGT goods types as the warehouse system names them (its CGT sales summary columns).
export var CURRENT_CGT_TYPES = ['Seconds Canada', 'Thirds Canada', 'Obsoletes Canada', 'Paper Canada', 'Roofing', 'Pool Canada',
  'Box Seconds', 'PVC', 'TPO', 'Fabrics Canada', 'Boat Decking', 'Others', 'BALES', 'DRYLAM', 'Seconds USA', 'Thirds USA', 'Obsoletes USA', 'Paper'];
// 'Boat Decking' and 'Others' are the names Max gave on 24 Nov 2026 for the Canadian goods that had no match.

// Link: old Canadian goods name -> current CGT goods type. A name that is NOT here is UNMATCHED:
// it stays under its own old name until Max decides. Never guessed.
// A link is only a PROPOSAL (shown as such) unless the name is in MAX_DECIDED_GOODS below.
export var DEFAULT_GOODS_MAP = {
  'Seconds Auto': 'Seconds Canada',
  'Thirds Auto': 'Thirds Canada',
  'Obsolete': 'Obsoletes Canada',
  'Paper': 'Paper Canada',
  'Roofing': 'Roofing',
  'Pool': 'Pool Canada',
  'Box Seconds': 'Box Seconds',
  'Drylam': 'DRYLAM',
  'TPO Rolls': 'TPO',
  'TPO Scrap': 'TPO',
  'TPO Chips': 'TPO',
  // Max, 24 Nov 2026: these two PVC names count as Seconds Canada; PVC Film Rolls and PVC GAYLORDS stay PVC.
  'PVC Black on Black/Grey': 'Seconds Canada',
  'PVC Non Woven': 'Seconds Canada',
  'PVC Film Rolls': 'PVC',
  'PVC GAYLORDS': 'PVC',
  'Fabric': 'Fabrics Canada',
  // Max, 24 Nov 2026: "Inspected- seconds, Decking-Boat Decking, Foam- pvc ... all the rest under OTHERS".
  'Inspected': 'Seconds Canada',
  'Decking': 'Boat Decking',
  'Foam': 'PVC',
  'Mixed': 'Others',
  'Other': 'Others',
  'Morbern': 'Others',
  'Trim': 'Others',
  'Vintex': 'Others'
};

// The names Max himself decided (24 Nov 2026). Every other link above is still only proposed.
export var MAX_DECIDED_GOODS = ['PVC Black on Black/Grey', 'PVC Non Woven', 'PVC Film Rolls', 'PVC GAYLORDS', 'Inspected', 'Decking', 'Foam',
  'Mixed', 'Other', 'Morbern', 'Trim', 'Vintex'];

// What the workbook itself says about how complete it is (11.23.xlsm, read 24 Nov 2026). Months are 'YYYY-MM'.
// From Nov 2023 the Canadian side was moving to the new inventory system: Scan In rows are marked
// "In New Inventory System" and carry no weight (none at all in Dec 2023), and Scan Out has releases
// with no weight. So from that month the archive is INCOMPLETE on both sides, not zero.
export var ARCHIVE_SOURCE_NOTES = { received_incomplete_from: '2023-11', shipped_incomplete_from: '2023-11' };

// What a line on the old "Scan In" sheet really was. Only 'received' is goods coming in.
export var ENTRY_KINDS = ['received', 'opening', 'conversion', 'adjustment', 'disposal'];
export var KIND_LABELS = {
  received: 'Received',
  opening: 'Starting stock (25 Jun 2021)',
  conversion: 'Winding (re-graded, not new goods)',
  adjustment: 'Stock count correction',
  disposal: 'Thrown away / disposed'
};

export function entryKindOf(reference, invoiceText) {
  var s = (String(reference == null ? '' : reference) + ' ' + String(invoiceText == null ? '' : invoiceText)).toLowerCase();
  if (s.indexOf('starting inventory') >= 0) { return 'opening'; }
  if (s.indexOf('winding production') >= 0) { return 'conversion'; }
  if (s.indexOf('reconciliation') >= 0) { return 'adjustment'; }
  if (s.indexOf('disposal') >= 0 || s.indexOf('trashed') >= 0) { return 'disposal'; }
  return 'received';
}

function isDate(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v); }
function isNum(v) { return typeof v === 'number' && isFinite(v); }
function r3(n) { return Math.round(n * 1000) / 1000; }

// Checks the archive file before anything is stored. Returns { ok, errors[], receipts, shipments }.
export function validateArchiveFile(obj) {
  var errors = [];
  if (!obj || typeof obj !== 'object') { return { ok: false, errors: ['The file is not a Canada history archive.'] }; }
  if (obj.format !== ARCHIVE_FORMAT) { errors.push('Wrong file type (expected ' + ARCHIVE_FORMAT + ').'); }
  var rec = Array.isArray(obj.receipts) ? obj.receipts : null;
  var shp = Array.isArray(obj.shipments) ? obj.shipments : null;
  if (!rec || !shp) { errors.push('The file has no receipts or no shipments list.'); return { ok: false, errors: errors }; }
  if (!rec.length || !shp.length) { errors.push('The receipts or the shipments list is empty.'); }
  var i; var r;
  for (i = 0; i < rec.length && errors.length < 10; i++) {
    r = rec[i] || {};
    if (CANADA_GOODS.indexOf(r.goods_name) < 0) { errors.push('Receipt line ' + (i + 1) + ': unknown goods name "' + r.goods_name + '".'); }
    else if (ENTRY_KINDS.indexOf(r.entry_kind) < 0) { errors.push('Receipt line ' + (i + 1) + ': unknown kind "' + r.entry_kind + '".'); }
    else if (!isNum(r.weight_lb) || r.weight_lb === 0) { errors.push('Receipt line ' + (i + 1) + ': weight is not a number.'); }
    else if (r.entry_kind === 'received' && r.weight_lb < 0) { errors.push('Receipt line ' + (i + 1) + ': a received weight cannot be negative.'); }
    else if (r.entry_date !== null && !isDate(r.entry_date)) { errors.push('Receipt line ' + (i + 1) + ': bad date.'); }
    else if (r.entry_kind === 'received' && !isDate(r.entry_date)) { errors.push('Receipt line ' + (i + 1) + ': a received line needs a date.'); }
  }
  for (i = 0; i < shp.length && errors.length < 10; i++) {
    r = shp[i] || {};
    if (CANADA_GOODS.indexOf(r.goods_name) < 0) { errors.push('Shipment line ' + (i + 1) + ': unknown goods name "' + r.goods_name + '".'); }
    else if (!isNum(r.weight_lb) || r.weight_lb <= 0) { errors.push('Shipment line ' + (i + 1) + ': weight must be above zero.'); }
    else if (!isDate(r.ship_date)) { errors.push('Shipment line ' + (i + 1) + ': bad date.'); }
    else if (!/^1001-/.test(String(r.release_no || ''))) { errors.push('Shipment line ' + (i + 1) + ': release "' + r.release_no + '" is not a Canada (1001-) release.'); }
  }
  return { ok: errors.length === 0, errors: errors, receipts: rec, shipments: shp };
}

// decisions: rows { goods_name, cgt_type, decided_at } — the LATEST per goods name wins.
// cgt_type '' or null in a decision = "keep it unmatched, under its own name".
export function effectiveGoodsMap(decisions) {
  var map = {}; var src = {}; var when = {};
  var i; var k;
  for (i = 0; i < CANADA_GOODS.length; i++) {
    k = CANADA_GOODS[i];
    if (DEFAULT_GOODS_MAP[k]) { map[k] = DEFAULT_GOODS_MAP[k]; src[k] = MAX_DECIDED_GOODS.indexOf(k) >= 0 ? 'decided' : 'proposed'; } else { map[k] = ''; src[k] = 'unmatched'; }
  }
  var list = Array.isArray(decisions) ? decisions : [];
  for (i = 0; i < list.length; i++) {
    var d = list[i] || {};
    if (CANADA_GOODS.indexOf(d.goods_name) < 0) { continue; }
    var t = String(d.decided_at || '');
    if (when[d.goods_name] !== undefined && t < when[d.goods_name]) { continue; }
    when[d.goods_name] = t;
    var v = String(d.cgt_type == null ? '' : d.cgt_type).trim();
    map[d.goods_name] = v;
    src[d.goods_name] = v ? 'decided' : 'decided-unmatched';
  }
  return { map: map, source: src };
}

export function unmatchedGoods(eff) {
  var out = []; var i;
  for (i = 0; i < CANADA_GOODS.length; i++) { if (!eff.map[CANADA_GOODS[i]]) { out.push(CANADA_GOODS[i]); } }
  return out;
}

function monthsBetween(first, last) {
  var out = []; if (!first || !last) { return out; }
  var y = Number(first.slice(0, 4)); var m = Number(first.slice(5, 7));
  var ly = Number(last.slice(0, 4)); var lm = Number(last.slice(5, 7));
  var guard = 0;
  while ((y < ly || (y === ly && m <= lm)) && guard < 600) {
    out.push(y + '-' + (m < 10 ? '0' + m : '' + m));
    m++; if (m > 12) { m = 1; y++; }
    guard++;
  }
  return out;
}
function monthEnd(ym) { var y = Number(ym.slice(0, 4)); var m = Number(ym.slice(5, 7)); var d = new Date(Date.UTC(y, m, 0)).getUTCDate(); return ym + '-' + (d < 10 ? '0' + d : '' + d); }

// How far each side of the archive really goes. Received and shipped are SEPARATE: the workbook stops
// recording receipts before it stops recording shipments. These are the first / last RECORD dates in the
// archive, not a checked cut-off. Per month and side the status is:
//   'ok'      inside the records
//   'partial' the first or last month of the records (not a whole month), or a month the workbook itself
//             marks as moving to the new system (notes.*_incomplete_from)
//   'na'      outside the records, or a month inside them with no record at all: NOT zero — unknown.
export function archiveCoverage(receipts, shipments, months, notes) {
  var rec = Array.isArray(receipts) ? receipts : []; var shp = Array.isArray(shipments) ? shipments : [];
  var n = notes || {};
  var rf = null; var rl = null; var sf = null; var sl = null; var rM = {}; var sM = {}; var i; var d;
  for (i = 0; i < rec.length; i++) { if (!rec[i] || rec[i].entry_kind !== 'received' || !rec[i].entry_date) { continue; } d = rec[i].entry_date; rM[d.slice(0, 7)] = 1; if (!rf || d < rf) { rf = d; } if (!rl || d > rl) { rl = d; } }
  for (i = 0; i < shp.length; i++) { if (!shp[i] || !shp[i].ship_date) { continue; } d = shp[i].ship_date; sM[d.slice(0, 7)] = 1; if (!sf || d < sf) { sf = d; } if (!sl || d > sl) { sl = d; } }
  function side(first, last, has, incompleteFrom) {
    var st = []; var gaps = []; var j; var ym;
    for (j = 0; j < months.length; j++) {
      ym = months[j];
      if (!first || ym < first.slice(0, 7) || ym > last.slice(0, 7)) { st.push('na'); continue; }
      if (!has[ym]) { st.push('na'); gaps.push(ym); continue; }
      if ((ym === first.slice(0, 7) && first.slice(8, 10) !== '01') || (ym === last.slice(0, 7) && last !== monthEnd(ym)) || (incompleteFrom && ym >= incompleteFrom)) { st.push('partial'); continue; }
      st.push('ok');
    }
    return { first: first, last: last, incomplete_from: incompleteFrom && last && incompleteFrom <= last.slice(0, 7) ? incompleteFrom : null, gap_months: gaps, status: st };
  }
  return { received: side(rf, rl, rM, n.received_incomplete_from || null), shipped: side(sf, sl, sM, n.shipped_incomplete_from || null) };
}

var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function monthLabel(ym) { return MON[Number(ym.slice(5, 7)) - 1] + ' ' + ym.slice(2, 4); }
export function dayLabel(d) { if (!d) { return ''; } return Number(d.slice(8, 10)) + ' ' + MON[Number(d.slice(5, 7)) - 1] + ' ' + d.slice(0, 4); }

// The sentences the screen and any report must show next to the figures.
export function coverageNotes(cov) {
  var out = []; if (!cov) { return out; }
  var r = cov.received; var s = cov.shipped;
  if (r && r.first) {
    out.push('Received: records from ' + dayLabel(r.first) + ' to ' + dayLabel(r.last) + '. No receipt data in this archive after ' + dayLabel(r.last) + '.');
    if (r.incomplete_from) { out.push('Received is incomplete from ' + monthLabel(r.incomplete_from) + ': the workbook marks receipts as moved to the new inventory system and gives no weight for them.'); }
    if (r.gap_months.length) { out.push('No received weight at all is recorded for ' + r.gap_months.map(monthLabel).join(', ') + ' — shown as N/A, not zero.'); }
  }
  if (s && s.first) {
    out.push('Shipped: shipment records through ' + dayLabel(s.last) + ' (from ' + dayLabel(s.first) + '), dated by the confirmed loading date.');
    if (s.incomplete_from) { out.push('Shipped is incomplete from ' + monthLabel(s.incomplete_from) + ': some releases in the workbook have no weight.'); }
    if (s.gap_months.length) { out.push('No shipped weight at all is recorded for ' + s.gap_months.map(monthLabel).join(', ') + ' — shown as N/A, not zero.'); }
  }
  out.push('These are the first and last record dates in the workbook, not a checked cut-off. Where there is no data the figure is N/A, never zero.');
  return out;
}

// Groups the archive. opts.by = 'cgt' (current CGT goods type; unmatched names keep their own
// name and are flagged) or 'goods' (the old Canadian names as written).
// Each group has the same shape the warehouse CGT cards use for their history chart:
//   { labels, inbound, outbound, yearly:[{year,in,out}], total_in, total_out }  — pounds.
// Only 'received' lines count as inbound. Starting stock, winding, corrections and disposals are
// reported next to it (other), never mixed into "received".
// COVERAGE travels with every group: inbound / outbound hold null (not 0) for a month with no data on that
// side, inbound_status / outbound_status say 'ok' | 'partial' | 'na' per month, and each year row carries
// in_partial / out_partial (the year is not a whole recorded year) and null when the whole year is unknown.
// total_in / total_out are the RECORDED totals. opts.notes: source notes (default ARCHIVE_SOURCE_NOTES; null = none).
export function buildCanadaHistory(receipts, shipments, eff, opts) {
  var by = (opts && opts.by) === 'goods' ? 'goods' : 'cgt';
  var rec = Array.isArray(receipts) ? receipts : [];
  var shp = Array.isArray(shipments) ? shipments : [];
  var map = (eff && eff.map) || {};
  function keyOf(goods) { if (by === 'goods') { return goods; } return map[goods] ? map[goods] : goods; }
  var groups = {}; var order = [];
  function g(goods) {
    var k = keyOf(goods);
    if (!groups[k]) {
      groups[k] = { key: k, matched: !!map[goods], goods: [], inM: {}, outM: {}, total_in: 0, total_out: 0,
        other: { opening: 0, conversion: 0, adjustment: 0, disposal: 0 }, customers: {}, undated_other: 0 };
      order.push(k);
    }
    if (groups[k].goods.indexOf(goods) < 0) { groups[k].goods.push(goods); }
    return groups[k];
  }
  var first = null; var last = null;
  function seen(d) { if (!d) { return; } var ym = d.slice(0, 7); if (!first || ym < first) { first = ym; } if (!last || ym > last) { last = ym; } }
  var i; var r; var grp; var ym;
  for (i = 0; i < rec.length; i++) {
    r = rec[i]; if (!r || CANADA_GOODS.indexOf(r.goods_name) < 0) { continue; }
    grp = g(r.goods_name);
    var w = Number(r.weight_lb) || 0;
    if (r.entry_kind === 'received') {
      if (!r.entry_date) { continue; }
      ym = r.entry_date.slice(0, 7); seen(r.entry_date);
      grp.inM[ym] = (grp.inM[ym] || 0) + w; grp.total_in += w;
    } else if (grp.other[r.entry_kind] !== undefined) {
      grp.other[r.entry_kind] += w;
      if (!r.entry_date) { grp.undated_other += w; }
    }
  }
  for (i = 0; i < shp.length; i++) {
    r = shp[i]; if (!r || CANADA_GOODS.indexOf(r.goods_name) < 0 || !r.ship_date) { continue; }
    grp = g(r.goods_name);
    var w2 = Number(r.weight_lb) || 0;
    ym = r.ship_date.slice(0, 7); seen(r.ship_date);
    grp.outM[ym] = (grp.outM[ym] || 0) + w2; grp.total_out += w2;
    var c = String(r.customer == null ? '' : r.customer).trim() || '(no customer written)';
    grp.customers[c] = (grp.customers[c] || 0) + w2;
  }
  var months = monthsBetween(first, last);
  var cov = archiveCoverage(rec, shp, months, (opts && opts.notes !== undefined) ? opts.notes : ARCHIVE_SOURCE_NOTES);
  var inSt = cov.received.status; var outSt = cov.shipped.status;
  // a calendar year is whole only when all 12 of its months are 'ok' on that side
  function yearFlags(st) { var o = {}; var q; for (q = 0; q < months.length; q++) { var yy = months[q].slice(0, 4); if (!o[yy]) { o[yy] = { okN: 0, dataN: 0 }; } if (st[q] === 'ok') { o[yy].okN++; } if (st[q] !== 'na') { o[yy].dataN++; } } return o; }
  var inY = yearFlags(inSt); var outY = yearFlags(outSt);
  var out = [];
  var tin = 0; var tout = 0;
  for (i = 0; i < order.length; i++) {
    grp = groups[order[i]];
    var inbound = []; var outbound = []; var yr = {}; var yrOrder = []; var j;
    for (j = 0; j < months.length; j++) {
      var a = r3(grp.inM[months[j]] || 0); var b = r3(grp.outM[months[j]] || 0);
      inbound.push(inSt[j] === 'na' ? null : a); outbound.push(outSt[j] === 'na' ? null : b);
      var y = months[j].slice(0, 4);
      if (!yr[y]) { yr[y] = { year: y, in: 0, out: 0 }; yrOrder.push(y); }
      yr[y].in += a; yr[y].out += b;
    }
    var yearly = [];
    for (j = 0; j < yrOrder.length; j++) {
      var yk = yrOrder[j];
      yearly.push({ year: yk, in: inY[yk].dataN ? r3(yr[yk].in) : null, out: outY[yk].dataN ? r3(yr[yk].out) : null, in_partial: inY[yk].okN < 12, out_partial: outY[yk].okN < 12 });
    }
    var cust = Object.keys(grp.customers).map(function (n) { return { customer: n, lb: r3(grp.customers[n]) }; });
    cust.sort(function (p, q) { return q.lb - p.lb || (p.customer < q.customer ? -1 : 1); });
    tin += grp.total_in; tout += grp.total_out;
    out.push({ key: grp.key, matched: grp.matched, goods: grp.goods, months: months, labels: months.map(monthLabel),
      inbound: inbound, outbound: outbound, inbound_status: inSt, outbound_status: outSt, coverage: cov, yearly: yearly, total_in: r3(grp.total_in), total_out: r3(grp.total_out),
      other: { opening: r3(grp.other.opening), conversion: r3(grp.other.conversion), adjustment: r3(grp.other.adjustment), disposal: r3(grp.other.disposal) },
      undated_other: r3(grp.undated_other), customers: cust });
  }
  out.sort(function (p, q) { return (q.total_in + q.total_out) - (p.total_in + p.total_out) || (p.key < q.key ? -1 : 1); });
  return { by: by, months: months, first_month: first, last_month: last, coverage: cov, notes: coverageNotes(cov), groups: out, total_in: r3(tin), total_out: r3(tout) };
}

export function fmtLb(n) {
  var v = Math.round(Number(n) || 0);
  var s = String(Math.abs(v)); var o = '';
  while (s.length > 3) { o = ',' + s.slice(-3) + o; s = s.slice(0, -3); }
  return (v < 0 ? '-' : '') + s + o;
}
