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

// v55.83-YO — THE NEW SYSTEM AFTER THE ARCHIVE (Max / Codex 24 Nov 2026: the Canadian records after Jan 2024 are in the
// NT Warehouse; connect them so periods can be compared, not just "N/A").
// Other spellings a warehouse CGT grade may use for an archive type (compared ignoring case, spaces and punctuation).
// A USA grade never matches. Kept in step with the warehouse app's resources/data/canada-history-flow.json.
export var CGT_TYPE_ALIASES = {
  'Seconds Canada': ['Second Canada'], 'Thirds Canada': ['Third Canada'], 'Obsoletes Canada': ['Obsolete Canada', 'Obsoletes CA'],
  'Paper Canada': [], 'Roofing': ['Roofing Canada'], 'Pool Canada': [], 'Box Seconds': ['Box Second', 'Box Seconds Canada'],
  'PVC': ['PVC Canada'], 'TPO': ['TPO Canada'], 'Fabrics Canada': ['Fabric Canada'], 'DRYLAM': ['Drylam Canada'],
  'Boat Decking': ['Decking', 'Boat Decking Canada'], 'Others': ['Others Canada']
};
export function gradeKey(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ''); }
// the archive / CGT type a warehouse grade name stands for, or '' when it is not one of them
export function archiveTypeForGrade(gradeName) {
  var k = gradeKey(gradeName); if (!k) { return ''; }
  var names = Object.keys(CGT_TYPE_ALIASES); var i; var j;
  for (i = 0; i < names.length; i++) {
    if (gradeKey(names[i]) === k) { return names[i]; }
    for (j = 0; j < CGT_TYPE_ALIASES[names[i]].length; j++) { if (gradeKey(CGT_TYPE_ALIASES[names[i]][j]) === k) { return names[i]; } }
  }
  return '';
}

// flow = what the server read from the warehouse ("grade flow"), already reduced to the Canadian side:
//   { state: 'ok', rows_in: [{ grade, type, warehouse, ym, lb }], rows_out: [...], first_in, last_in, first_out, last_out ('YYYY-MM-DD'),
//     through: 'YYYY-MM' (the month the warehouse answered in), site, generated_at, scope }
//   or { state: 'unavailable' | 'not_configured', reason }.
// Adds to a by-CGT-type history (buildCanadaHistory(..., {by:'cgt'})) the new system's own months, kept APART from the
// archive (sys_inbound / sys_outbound next to inbound / outbound), with a status per month and side:
//   'ok'        the warehouse was read and the month is inside its records — a 0 here is a real zero
//   'na'        before the new system's first record on that side — nothing to know there
//   'unchecked' the warehouse was not read (not set up, not reachable, or it cannot answer this yet) — unknown, not zero
// Overlap (both sources have figures, Nov 2023 – Apr 2024): the old workbook gives NO weight for the rows it marks as
// moved to the new system, so the two do not repeat each other; they are shown side by side and the months are listed.
export function mergeWarehouseFlow(hist, flow) {
  if (!hist || hist.by !== 'cgt') { return hist; }
  var ok = !!(flow && flow.state === 'ok');
  var months = hist.months.slice();
  var lastYm = months.length ? months[months.length - 1] : null;
  var through = ok && flow.through ? flow.through : null;
  if (through && lastYm && through > lastYm) { months = monthsBetween(months[0], through); }
  var nArch = hist.months.length; var n = months.length;
  var firstIn = ok && flow.first_in ? String(flow.first_in).slice(0, 7) : null;
  var firstOut = ok && flow.first_out ? String(flow.first_out).slice(0, 7) : null;
  var inBy = {}; var outBy = {}; var unmatched = {}; var matched = {};
  // Codex 24 Nov (YO P2): a Canadian warehouse grade that is not linked to a goods type keeps its pounds here, under
  // its own name — never dropped, never guessed into a type. The cards are then a PARTIAL total and say so.
  var unmapped = {}; var feedIn = 0; var feedOut = 0; var outsideIn = 0; var outsideOut = 0;
  var monthSet = {}; var mi;
  for (mi = 0; mi < months.length; mi++) { monthSet[months[mi]] = 1; }
  function add(target, rows, side) {
    var i;
    for (i = 0; i < (rows || []).length; i++) {
      var r = rows[i]; if (!r || !r.ym) { continue; }
      var lb = Number(r.lb) || 0;
      if (side === 'in') { feedIn += lb; } else { feedOut += lb; }
      var t = archiveTypeForGrade(r.grade);
      if (!t) {
        var gname = String(r.grade);
        unmatched[gname] = 1;
        if (!unmapped[gname]) { unmapped[gname] = { grade: gname, warehouses: [], in_lb: 0, out_lb: 0, months: {} }; }
        var u = unmapped[gname];
        var wn = String(r.warehouse == null ? '' : r.warehouse); if (wn && u.warehouses.indexOf(wn) < 0) { u.warehouses.push(wn); }
        if (!u.months[r.ym]) { u.months[r.ym] = { ym: r.ym, in_lb: 0, out_lb: 0 }; }
        if (side === 'in') { u.in_lb += lb; u.months[r.ym].in_lb += lb; } else { u.out_lb += lb; u.months[r.ym].out_lb += lb; }
        continue;
      }
      matched[String(r.grade)] = t;
      // a linked row in a month the page does not draw (before the archive's first month) is counted, not lost
      if (!monthSet[r.ym]) { if (side === 'in') { outsideIn += lb; } else { outsideOut += lb; } continue; }
      if (!target[t]) { target[t] = {}; }
      target[t][r.ym] = (target[t][r.ym] || 0) + lb;
    }
  }
  if (ok) { add(inBy, flow.rows_in, 'in'); add(outBy, flow.rows_out, 'out'); }
  var unmappedList = Object.keys(unmapped).sort().map(function (k) {
    var u = unmapped[k]; var ms = Object.keys(u.months).sort();
    return { grade: u.grade, warehouses: u.warehouses.sort(), in_lb: r3(u.in_lb), out_lb: r3(u.out_lb), first_month: ms[0], last_month: ms[ms.length - 1],
      months: ms.map(function (m) { return { ym: m, in_lb: r3(u.months[m].in_lb), out_lb: r3(u.months[m].out_lb) }; }) };
  });
  var unIn = 0; var unOut = 0; unmappedList.forEach(function (u) { unIn += u.in_lb; unOut += u.out_lb; });
  function statusList(first) {
    var st = []; var j;
    for (j = 0; j < n; j++) { st.push(!ok ? 'unchecked' : (!first || months[j] < first ? 'na' : 'ok')); }
    return st;
  }
  var sysInSt = statusList(firstIn); var sysOutSt = statusList(firstOut);
  var overlap = []; var j;
  for (j = 0; j < nArch; j++) { if (ok && ((sysInSt[j] === 'ok' && hist.groups.length && hist.groups[0].inbound_status[j] !== 'na') || (sysOutSt[j] === 'ok' && hist.groups.length && hist.groups[0].outbound_status[j] !== 'na'))) { overlap.push(months[j]); } }
  var have = {}; var groups = []; var sIn = 0; var sOut = 0;
  function one(g, key) {
    var inbound = []; var outbound = []; var inSt = []; var outSt = []; var sysIn = []; var sysOut = []; var yr = {}; var order = []; var q;
    var tIn = 0; var tOut = 0;
    for (q = 0; q < n; q++) {
      var a = (g && q < nArch) ? g.inbound[q] : null; var b = (g && q < nArch) ? g.outbound[q] : null;
      inbound.push(a); outbound.push(b);
      inSt.push(q < nArch ? hist.coverage.received.status[q] : 'na'); outSt.push(q < nArch ? hist.coverage.shipped.status[q] : 'na');
      var si = sysInSt[q] === 'ok' ? r3((inBy[key] && inBy[key][months[q]]) || 0) : null;
      var so = sysOutSt[q] === 'ok' ? r3((outBy[key] && outBy[key][months[q]]) || 0) : null;
      sysIn.push(si); sysOut.push(so); tIn += si || 0; tOut += so || 0;
      var y = months[q].slice(0, 4);
      if (!yr[y]) { yr[y] = { year: y, in: null, out: null, sys_in: null, sys_out: null, in_ok: 0, out_ok: 0, in_cov: 0, out_cov: 0 }; order.push(y); }
      if (a !== null) { yr[y].in = (yr[y].in || 0) + a; } if (b !== null) { yr[y].out = (yr[y].out || 0) + b; }
      if (si !== null) { yr[y].sys_in = (yr[y].sys_in || 0) + si; } if (so !== null) { yr[y].sys_out = (yr[y].sys_out || 0) + so; }
      if (inSt[q] === 'ok') { yr[y].in_ok++; } if (outSt[q] === 'ok') { yr[y].out_ok++; }
      // a month is covered on one side when the archive OR the new system has a complete record of it
      if (inSt[q] === 'ok' || sysInSt[q] === 'ok') { yr[y].in_cov++; } if (outSt[q] === 'ok' || sysOutSt[q] === 'ok') { yr[y].out_cov++; }
    }
    var yearly = order.map(function (y) {
      var v = yr[y];
      // a year is whole on one side only when each of its 12 months is covered by the archive or by the new system
      return { year: y, in: v.in === null ? null : r3(v.in), out: v.out === null ? null : r3(v.out), sys_in: v.sys_in === null ? null : r3(v.sys_in), sys_out: v.sys_out === null ? null : r3(v.sys_out),
        in_partial: v.in_ok < 12, out_partial: v.out_ok < 12,
        in_whole_year: v.in_cov >= 12, out_whole_year: v.out_cov >= 12,
        sys_checked: ok };
    });
    sIn += tIn; sOut += tOut;
    return { key: key, matched: g ? g.matched : true, goods: g ? g.goods : [], months: months, labels: months.map(monthLabel),
      inbound: inbound, outbound: outbound, inbound_status: inSt, outbound_status: outSt,
      sys_inbound: sysIn, sys_outbound: sysOut, sys_inbound_status: sysInSt, sys_outbound_status: sysOutSt,
      coverage: hist.coverage, yearly: yearly, total_in: g ? g.total_in : 0, total_out: g ? g.total_out : 0,
      sys_total_in: ok ? r3(tIn) : null, sys_total_out: ok ? r3(tOut) : null,
      other: g ? g.other : { opening: 0, conversion: 0, adjustment: 0, disposal: 0 }, undated_other: g ? g.undated_other : 0, customers: g ? g.customers : [], archive: !!g };
  }
  hist.groups.forEach(function (g) { have[g.key] = 1; groups.push(one(g, g.key)); });
  // a Canadian type that exists only in the new system (no archive lines) still gets its card
  Object.keys(inBy).concat(Object.keys(outBy)).forEach(function (t) { if (!have[t]) { have[t] = 1; groups.push(one(null, t)); } });
  var notes = hist.notes.slice();
  if (ok) {
    notes.push('New system (NT Warehouse, read ' + String(flow.generated_at || '').slice(0, 10) + ' from ' + (flow.site || 'the warehouse') + '): scanned in from ' + dayLabel(flow.first_in) + ' to ' + dayLabel(flow.last_in) + ', shipped from ' + dayLabel(flow.first_out) + ' to ' + dayLabel(flow.last_out) + '. Inside those dates a blank month is a real zero.');
    if (flow.scope) { notes.push(flow.scope); }
    if (unmappedList.length) { notes.unshift('PARTIAL TOTAL: ' + unmappedList.length + ' Canadian warehouse grade' + (unmappedList.length === 1 ? ' is' : 's are') + ' not linked to a goods type (' + unmappedList.map(function (u) { return u.grade; }).join(', ') + '). Their ' + fmtLb(unIn) + ' lb received and ' + fmtLb(unOut) + ' lb shipped are NOT in the cards — they are listed under “Warehouse grades not linked to a goods type”.'); }
    if (Array.isArray(flow.scope_unknown) && flow.scope_unknown.length) { notes.push('Could not tell whether these warehouse grades are Canadian (the warehouse list names no Canadian warehouse), so they are in no total: ' + flow.scope_unknown.map(function (x) { return x.grade; }).join(', ') + '.'); }
    if (overlap.length) { notes.push('Both sources have figures for ' + monthLabel(overlap[0]) + ' to ' + monthLabel(overlap[overlap.length - 1]) + ': the old workbook has no weight for the goods it marks as moved to the new system, so the two are shown side by side and added, not repeated.'); }
  } else {
    notes.push('New system (NT Warehouse) after the archive: NOT CHECKED — ' + ((flow && flow.reason) || 'the warehouse was not read') + ' Those months are unknown, not zero.');
  }
  return { by: 'cgt', months: months, first_month: hist.first_month, last_month: months[n - 1], coverage: hist.coverage, notes: notes, groups: groups,
    total_in: hist.total_in, total_out: hist.total_out, sys_state: ok ? 'ok' : ((flow && flow.state) || 'unavailable'), sys_total_in: ok ? r3(sIn) : null, sys_total_out: ok ? r3(sOut) : null,
    // sys_total_* = what the cards add up to (linked grades only). The Canadian total the warehouse sent is
    // sys_feed_total_* = cards + not linked + linked rows outside the drawn months; sys_reconciles says it adds up.
    sys_unmapped: ok ? unmappedList : [], sys_unmapped_total_in: ok ? r3(unIn) : null, sys_unmapped_total_out: ok ? r3(unOut) : null,
    sys_outside_months_in: ok ? r3(outsideIn) : null, sys_outside_months_out: ok ? r3(outsideOut) : null,
    sys_feed_total_in: ok ? r3(feedIn) : null, sys_feed_total_out: ok ? r3(feedOut) : null,
    sys_partial_mapping: ok && unmappedList.length > 0,
    sys_reconciles: ok ? (Math.abs(sIn + unIn + outsideIn - feedIn) < 0.01 && Math.abs(sOut + unOut + outsideOut - feedOut) < 0.01) : null,
    sys_excluded: ok ? (flow.excluded || null) : null, sys_scope_unknown: ok ? (flow.scope_unknown || []) : [],
    sys_first_in: ok ? flow.first_in : null, sys_last_in: ok ? flow.last_in : null, sys_first_out: ok ? flow.first_out : null, sys_last_out: ok ? flow.last_out : null,
    overlap_months: overlap, sys_grades_matched: matched, sys_grades_unmatched: Object.keys(unmatched).sort() };
}

// v55.83-YK — SALES HISTORY (Max, 24 Nov 2026: "make sure you are pulling the sales history as well for canada").
// One row per Canadian release that shipped: date, customer, goods and pounds from the archive, plus — when the
// Hub's own books hold a KTC invoice with that release number — the invoice number(s) and dollars.
// invoices: rows { release_number, invoice_number, invoice_date, total_amount } or null (dollars not allowed / not read).
// The dollars are READ from the invoices as they stand; nothing is written, and a release with no KTC invoice in the
// Hub has ktc_total = null (unknown here — it was invoiced elsewhere or prepaid), never 0.
export function releaseKey(v) { return String(v == null ? '' : v).toUpperCase().replace(/\s+/g, ''); }
export function buildCanadaSales(shipments, invoices, eff) {
  var shp = Array.isArray(shipments) ? shipments : [];
  var map = (eff && eff.map) || {};
  var hasMoney = Array.isArray(invoices);
  var inv = {}; var i; var k;
  if (hasMoney) {
    for (i = 0; i < invoices.length; i++) {
      var iv = invoices[i]; if (!iv) { continue; }
      k = releaseKey(iv.release_number); if (!k) { continue; }
      if (!inv[k]) { inv[k] = []; }
      inv[k].push({ invoice_number: String(iv.invoice_number == null ? '' : iv.invoice_number), invoice_date: iv.invoice_date || null, total: Number(iv.total_amount) || 0 });
    }
  }
  var rows = {}; var order = [];
  for (i = 0; i < shp.length; i++) {
    var r = shp[i]; if (!r || !r.ship_date || CANADA_GOODS.indexOf(r.goods_name) < 0) { continue; }
    k = releaseKey(r.release_no);
    if (!rows[k]) {
      rows[k] = { key: k, release_no: String(r.release_no || ''), ship_date: r.ship_date, customer: String(r.customer == null ? '' : r.customer).trim() || '(no customer written)',
        nextrade_invoice: r.nextrade_invoice || null, lines: [], total_lb: 0, ktc_invoices: null, ktc_total: null, usd_per_lb: null };
      order.push(k);
    }
    var w = Number(r.weight_lb) || 0;
    rows[k].lines.push({ goods_name: r.goods_name, cgt_type: map[r.goods_name] || '', weight_lb: w });
    rows[k].total_lb += w;
    if (r.ship_date > rows[k].ship_date) { rows[k].ship_date = r.ship_date; }
  }
  var out = []; var withInv = 0; var money = 0; var lbWithInv = 0; var lbAll = 0;
  for (i = 0; i < order.length; i++) {
    var row = rows[order[i]];
    row.total_lb = r3(row.total_lb); lbAll += row.total_lb;
    if (hasMoney && inv[row.key]) {
      var t = 0; var j;
      for (j = 0; j < inv[row.key].length; j++) { t += inv[row.key][j].total; }
      row.ktc_invoices = inv[row.key];
      row.ktc_total = Math.round(t * 100) / 100;
      row.usd_per_lb = row.total_lb > 0 ? Math.round(row.ktc_total / row.total_lb * 10000) / 10000 : null;
      withInv++; money += row.ktc_total; lbWithInv += row.total_lb;
    }
    out.push(row);
  }
  out.sort(function (a, b) { return a.ship_date < b.ship_date ? 1 : (a.ship_date > b.ship_date ? -1 : (a.key < b.key ? -1 : 1)); });
  return { money_shown: hasMoney, rows: out, releases: out.length, total_lb: r3(lbAll),
    with_ktc_invoice: hasMoney ? withInv : null, without_ktc_invoice: hasMoney ? out.length - withInv : null,
    ktc_total: hasMoney ? Math.round(money * 100) / 100 : null, lb_with_ktc_invoice: hasMoney ? r3(lbWithInv) : null };
}
export function fmtUsd(n) {
  var v = Math.round((Number(n) || 0) * 100); var neg = v < 0; v = Math.abs(v);
  var cents = v % 100; return (neg ? '-' : '') + '$' + fmtLb(Math.floor(v / 100)) + '.' + (cents < 10 ? '0' + cents : '' + cents);
}

export function fmtLb(n) {
  var v = Math.round(Number(n) || 0);
  var s = String(Math.abs(v)); var o = '';
  while (s.length > 3) { o = ',' + s.slice(-3) + o; s = s.slice(0, -3); }
  return (v < 0 ? '-' : '') + s + o;
}
