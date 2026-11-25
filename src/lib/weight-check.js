// v55.83-XB — BILL-TO-WAREHOUSE WEIGHT CHECK: the rules (Max, 21 Nov 2026; plan + Codex plan feedback 21 Nov 10:16).
//
// "compare what suppliers billed (quantity and weight per bill line and reference) with what was actually scanned into the
//  NextTrade warehouse, and give every discrepancy an audited decision."
//
// Pure functions, no database, no network: the route, the screens and the tests all run THESE rules. Client-safe.
// SWC-safe: var + string concatenation only.
//
// Rules (plan revision 2, Codex 10:16):
//  • References are compared in TYPED PAIRS only (bill other_reference ↔ receipt cgt_reference / reference_number, NexPac bill
//    number ↔ receipt nexpac_bill, container ↔ container_trailer_number). A release number is never used for a receipt.
//    Normalising removes case, spaces and # . - / _ only; every digit, leading zeros included, is kept.
//  • A link counts only when a PERSON confirmed it. The Hub proposes; it never guesses.
//  • Bills and receipts that are linked form ONE group; figures are compared per warehouse product over the WHOLE group, so a
//    part bill is never compared with a whole receipt and each scan row is counted once (parent rows only, by id).
//  • Received weight = scan_in_logs.weight (lb, scanned). pl_weight (packing list, kg) is shown as declared, never as received.
//    Scanned-out rows stay counted on their receipt. A draft receipt is provisional.
//  • Units: lb, kg (2.20462), METRIC ton (2204.62). A bare TON / TN / ST is "ton type unknown". Yards are compared with yards;
//    pounds for a yard line only with a factor APPROVED for this check on the product mapping (never the P&L estimate).
//  • No tolerance is assumed: until Max approves one, "Matched" is never shown — exact equality shows "Equal".
//  • Decisions are kept against a stable item key + a COMPARISON FINGERPRINT that leaves out what does not change the
//    comparison (scanned-out flags, refresh times, updated_at, regenerated bill-line ids, line order).

export var WC_BUILD = 'v55.83-XB';
export var LB_PER_KG = 2.20462;
export var LB_PER_METRIC_TON = 2204.62;
export var YD_PER_M = 1.0936133;

// ---------------------------------------------------------------- references
export function normRef(s) {
  var t = String(s == null ? '' : s).toUpperCase().trim();
  t = t.replace(/^(NO\.?|NUMBER|REF\.?|#)\s*[:#]?\s*/, '');
  return t.replace(/[\s#.\-\/_]+/g, '');
}
function vendorKey(name) { return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\b(inc|corp|corporation|ltd|llc|co|company|the)\b/g, ' ').replace(/\s+/g, ' ').trim(); }
export { vendorKey };
export function isNexpac(vendorName) { return vendorKey(vendorName).indexOf('nexpac') >= 0; }

// a container number is 4 letters + 7 digits (ISO 6346)
var CONTAINER_RX = /^[A-Z]{4}\d{7}$/;
export var REF_PAIRS = [
  { key: 'cgt_reference', label: 'bill reference = receipt CGT reference', bill: function (b) { return b.other_reference; }, wh: function (r) { return r.info && r.info.cgt_reference; } },
  { key: 'reference_number', label: 'bill reference = receipt Reference No', bill: function (b) { return b.other_reference; }, wh: function (r) { return r.reference_number; } },
  { key: 'nexpac_bill', label: 'NexPac bill number = receipt NEXPAC Bill', bill: function (b) { return isNexpac(b.vendor_name) ? b.bill_number : null; }, wh: function (r) { return r.nexpac_bill; } },
  { key: 'container', label: 'container number = receipt container / trailer', bill: function (b) { var v = normRef(b.other_reference); return CONTAINER_RX.test(v) ? b.other_reference : null; }, wh: function (r) { return r.info && r.info.container_trailer_number; } }
];
export var BASIS_LABEL = { cgt_reference: 'CGT reference', reference_number: 'Reference No', nexpac_bill: 'NexPac bill number', container: 'Container', manual: 'Chosen by a person' };

// the bill's own references, typed (what the Hub may look for in the warehouse)
export function billReferences(bill) {
  var out = [];
  REF_PAIRS.forEach(function (p) { var v = p.bill(bill); var n = normRef(v); if (n) { out.push({ basis: p.key, raw: String(v), norm: n }); } });
  return out;
}

// receipts = stored receipt versions (data objects). → { candidates: [{ receipt_key, receipt_id, bases:[…], bill_value, receipt_value }], ambiguous, reason }
export function proposeLinks(bill, receipts) {
  var byKey = {};
  (receipts || []).forEach(function (r) {
    if (!r || r.state === 'removed') { return; }
    REF_PAIRS.forEach(function (p) {
      var bv = normRef(p.bill(bill)); var wv = normRef(p.wh(r));
      if (!bv || !wv || bv !== wv) { return; }
      var k = receiptKey(r);
      var c = byKey[k] || (byKey[k] = { receipt_key: k, receipt_id: r.id, source: r.source, reference_number: r.reference_number || null, bases: [], bill_value: String(p.bill(bill)), receipt_value: String(p.wh(r)) });
      if (c.bases.indexOf(p.key) < 0) { c.bases.push(p.key); }
    });
  });
  var list = Object.keys(byKey).sort().map(function (k) { return byKey[k]; });
  var reason = null;
  if (list.length > 1) { reason = 'the bill’s references point to ' + list.length + ' different receipts — a person must choose'; }
  return { candidates: list, ambiguous: list.length > 1, reason: reason };
}
export function receiptKey(r) { return String(r.source || 'nextrade') + ':' + String(r.id); }

// ---------------------------------------------------------------- numbers and units
// '1,250.5' → 1250.5 · '' / null → missing · '12 lbs' (weight only) → 12 · anything else → unreadable (never 0)
export function parseNum(raw, allowLbSuffix) {
  if (raw === null || raw === undefined) { return { value: null, problem: 'missing' }; }
  if (typeof raw === 'number') { return isFinite(raw) ? { value: raw, problem: null } : { value: null, problem: 'unreadable' }; }
  var s = String(raw).trim();
  if (!s) { return { value: null, problem: 'missing' }; }
  var t = s.replace(/,/g, '').replace(/\s+/g, '');
  if (allowLbSuffix) { t = t.replace(/(lbs?|pounds?)$/i, ''); }
  if (!/^-?\d+(\.\d+)?$/.test(t)) { return { value: null, problem: 'unreadable' }; }
  var v = Number(t);
  if (v < 0) { return { value: null, problem: 'negative' }; }
  return { value: v, problem: null };
}
function r3(n) { return Math.round(n * 1000) / 1000; }
export { r3 };

// a bill line's unit → { kind: 'weight', toLb, label } | { kind: 'length', toYd, label } | { kind: 'unknown', reason }
export function billUnit(unit) {
  var u = String(unit || '').toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!u) { return { kind: 'unknown', reason: 'the bill line has no unit' }; }
  if (/^(LB|LBS|POUND|POUNDS)$/.test(u)) { return { kind: 'weight', toLb: 1, label: 'lb' }; }
  if (/^(KG|KGS|KILO|KILOS|KILOGRAM|KILOGRAMS)$/.test(u)) { return { kind: 'weight', toLb: LB_PER_KG, label: 'kg (× ' + LB_PER_KG + ' lb)' }; }
  if (/^(MT|T|TONNE|TONNES|METRIC TON|METRIC TONS|METRIC TONNE)$/.test(u)) { return { kind: 'weight', toLb: LB_PER_METRIC_TON, label: 'metric ton (× ' + LB_PER_METRIC_TON + ' lb)' }; }
  if (/^(TON|TONS|TN|ST|SHORT TON|SHORT TONS|LONG TON)$/.test(u)) { return { kind: 'unknown', reason: 'ton type unknown (metric or short ton?) — not converted' }; }
  if (/^(YD|YDS|YARD|YARDS)$/.test(u)) { return { kind: 'length', toYd: 1, label: 'yd' }; }
  if (/^(M|LM|MTR|MTRS|METER|METERS|METRE|METRES|LINEAR METER|LINEAR METERS|LINEAR METRE|LINEAR METRES)$/.test(u)) { return { kind: 'length', toYd: YD_PER_M, label: 'metre (× ' + YD_PER_M + ' yd)' }; }
  return { kind: 'unknown', reason: 'unit "' + String(unit) + '" is not known' };
}

// the receipt's declared unit for the "yards" column (USA receipts store it on the extra info; Canada rows are yards)
export function receiptLengthUnit(receipt) {
  var u = String((receipt && receipt.info && receipt.info.uom) || '').toLowerCase().trim();
  if (!u || /^(yard|yards|yd|yds)$/.test(u)) { return { toYd: 1, label: u ? 'yards' : 'yards (no unit stated — Canada screen)' }; }
  if (/^(meter|meters|metre|metres|m)$/.test(u)) { return { toYd: YD_PER_M, label: 'metres' }; }
  return { toYd: null, label: u }; // lb / kg / pieces / pallets / units in the quantity column: not a length
}

// ---------------------------------------------------------------- products
// a warehouse scan row's product (ids as stored; names from the lookups)
export function logProduct(log) {
  return { product_type: str(log.product_type), cgt: str(log.cgt), nt: str(log.nt), color: str(log.color) };
}
function str(v) { return v === null || v === undefined || v === '' ? null : String(v); }
export function productLabel(p, lookups) {
  var L = lookups || {};
  function nm(tab, id) { var t = L[tab] || {}; return id == null ? null : (t[id] || ('#' + id)); }
  return [nm('product_types', p.product_type), nm('cgt_grades', p.cgt) ? 'CGT ' + nm('cgt_grades', p.cgt) : null, nm('nt_grades', p.nt) ? 'NT ' + nm('nt_grades', p.nt) : null, nm('colors', p.color)].filter(Boolean).join(' · ') || '(no product on the scan)';
}
// does an approved mapping's warehouse product cover this scan row? (a field left empty on the mapping = any)
export function mapCovers(map, p) {
  var any = false;
  var ks = ['product_type', 'cgt', 'nt', 'color'];
  for (var i = 0; i < ks.length; i++) {
    var want = str(map['wh_' + ks[i]]); if (want === null) { continue; }
    any = true; if (want !== p[ks[i]]) { return false; }
  }
  return any; // a mapping with no warehouse field at all covers nothing
}
export function mapProductKey(map) { return ['product_type', 'cgt', 'nt', 'color'].map(function (k) { return k + '=' + (str(map['wh_' + k]) || '*'); }).join('|'); }
// the bill line's own key for a mapping: vendor + item key + unit (normalised)
export function billItemKey(line) { return String(line.item_key || String(line.description || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()).substring(0, 120); }
export function findMap(maps, vendorName, line) {
  var v = vendorKey(vendorName); var ik = billItemKey(line); var un = String(line.unit || '').toUpperCase().trim();
  var hits = (maps || []).filter(function (m) { return m.state === 'active' && m.vendor_key === v && m.item_key === ik && String(m.bill_unit || '').toUpperCase().trim() === un; });
  return hits.length === 1 ? { map: hits[0] } : (hits.length > 1 ? { conflict: true } : { none: true });
}

// ---------------------------------------------------------------- canonical form + fingerprints
// stable JSON (keys sorted) — the same input always gives the same text, whatever the order the rows arrived in
export function canonical(x) {
  if (x === null || x === undefined) { return 'null'; }
  if (typeof x === 'number') { return isFinite(x) ? String(Math.round(x * 100000) / 100000) : 'null'; }
  if (typeof x === 'boolean') { return x ? 'true' : 'false'; }
  if (typeof x === 'string') { return JSON.stringify(x); }
  if (Array.isArray(x)) { return '[' + x.map(canonical).join(',') + ']'; }
  var ks = Object.keys(x).sort();
  return '{' + ks.filter(function (k) { return x[k] !== undefined; }).map(function (k) { return JSON.stringify(k) + ':' + canonical(x[k]); }).join(',') + '}';
}

// ---------------------------------------------------------------- groups
// links = the CURRENT confirmed links (latest row per bill+receipt wins; rejected = not linked)
export function currentLinks(linkRows) {
  var last = {};
  (linkRows || []).slice().sort(function (a, b) { return String(a.at || '').localeCompare(String(b.at || '')); }).forEach(function (l) { last[l.bill_id + '|' + l.source + ':' + l.receipt_id] = l; });
  return Object.keys(last).map(function (k) { return last[k]; }).filter(function (l) { return l.state === 'confirmed'; });
}
// bills ↔ receipts connected components. → [{ key, bill_ids[], receipt_keys[], links[] }]
export function buildGroups(links) {
  var parent = {};
  function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
  function add(x) { if (parent[x] === undefined) { parent[x] = x; } }
  function join(a, b) { add(a); add(b); var ra = find(a); var rb = find(b); if (ra !== rb) { parent[ra] = rb; } }
  (links || []).forEach(function (l) { join('b:' + l.bill_id, 'r:' + l.source + ':' + l.receipt_id); });
  var comp = {};
  Object.keys(parent).forEach(function (n) { var r = find(n); (comp[r] = comp[r] || []).push(n); });
  return Object.keys(comp).map(function (r) {
    var nodes = comp[r];
    var billIds = nodes.filter(function (n) { return n.indexOf('b:') === 0; }).map(function (n) { return n.substring(2); }).sort();
    var rks = nodes.filter(function (n) { return n.indexOf('r:') === 0; }).map(function (n) { return n.substring(2); }).sort();
    return { key: 'g:' + rks.join(','), bill_ids: billIds, receipt_keys: rks, links: (links || []).filter(function (l) { return billIds.indexOf(String(l.bill_id)) >= 0; }) };
  }).sort(function (a, b) { return a.key.localeCompare(b.key); });
}

// ---------------------------------------------------------------- the comparison of one group
// input: { group, bills: {id: bill}, linesByBill: {id: [lines]}, receipts: {receipt_key: stored version data | {state:'removed'}},
//          maps, tolerance (approved row or null), lookups, hiddenBillIds: {id:true} (visibility), feed: { ok, error } }
// → items[]: { item_key, kind, outcome, outcome_words, figures, inputs (fingerprint input), reasons[], bill_ids, receipt_keys, … }
export function compareGroup(inp) {
  var g = inp.group; var items = [];
  var hidden = inp.hiddenBillIds || {};
  var hiddenIn = g.bill_ids.filter(function (id) { return hidden[id]; });
  var recs = g.receipt_keys.map(function (k) { return { key: k, data: inp.receipts[k] || null }; });
  var linkIn = g.links.map(function (l) { return [String(l.bill_id), l.source + ':' + l.receipt_id, l.basis, normRef(l.bill_value), normRef(l.receipt_value)]; }).sort(cmpArr);
  var base = { group_key: g.key, bill_ids: g.bill_ids.slice(), receipt_keys: g.receipt_keys.slice() };
  if (hiddenIn.length) {
    items.push(Object.assign({}, base, { item_key: g.key + '|limited', kind: 'group', outcome: 'limited_access', reasons: ['part of this group is a bill outside your access — no verified result is given'], hidden_count: hiddenIn.length, figures: null, inputs: null }));
    return items;
  }
  var missing = recs.filter(function (r) { return !r.data; });
  if (missing.length) {
    items.push(Object.assign({}, base, { item_key: g.key + '|unavailable', kind: 'group', outcome: 'warehouse_unavailable', reasons: ['the warehouse has not been read for ' + missing.map(function (r) { return 'receipt ' + r.key; }).join(', ') + ' — Warehouse unavailable / not checked'], figures: null, inputs: null }));
    return items;
  }
  var removed = recs.filter(function (r) { return r.data.state === 'removed'; });
  var incompleteRead = recs.filter(function (r) { return r.data.read_complete === false; });
  var drafts = recs.filter(function (r) { return r.data.state !== 'removed' && Number(r.data.is_draf) === 1; });

  // warehouse rows: parent scan rows of every linked receipt, once each (by id)
  var seenLog = {}; var logs = [];
  recs.forEach(function (r) {
    if (r.data.state === 'removed') { return; }
    var lu = receiptLengthUnit(r.data);
    (r.data.logs || []).slice().sort(function (a, b) { return Number(a.id) - Number(b.id); }).forEach(function (l) {
      if (seenLog[l.id]) { return; } seenLog[l.id] = true;
      var w = parseNum(l.weight, true); var y = parseNum(l.yards, false); var ro = parseNum(l.roll_count != null ? l.roll_count : l.rolls, false);
      var plw = parseNum(l.pl_weight, false);
      logs.push({ id: Number(l.id), receipt_key: r.key, skew: l.skew_number || null, pallet: l.pallet_id || null, p: logProduct(l), lb: w.value, lb_problem: w.problem,
        yd: (y.value != null && lu.toYd != null) ? r3(y.value * lu.toYd) : null, yd_raw: y.value, yd_unit: lu.label, yd_problem: y.problem,
        rolls: ro.value, pl_kg: plw.value, scanned_out: Number(l.is_scan_out) === 1, sold_by: String(l.unit || '').toUpperCase() === 'W' ? 'weight' : 'length' });
    });
  });

  // bill product lines of every bill in the group, each with its approved mapping
  var lines = [];
  g.bill_ids.forEach(function (bid) {
    var b = inp.bills[bid] || {};
    (inp.linesByBill[bid] || []).forEach(function (ln) {
      if (ln.line_kind && ln.line_kind !== 'item') { return; }
      var u = billUnit(ln.unit); var q = parseNum(ln.qty, false);
      var fm = findMap(inp.maps, b.vendor_name, ln);
      lines.push({ bill_id: bid, bill_number: b.bill_number || null, vendor: b.vendor_name || null, line_no: ln.line_no, line_id: ln.id || null, description: ln.description || '', item_key: billItemKey(ln), qty: q.value, qty_problem: q.problem, unit: ln.unit || null, u: u, fm: fm });
    });
  });

  var used = {}; // log id → product key that counted it (no scan counted for two products)
  var byProduct = {}; var order = [];
  lines.forEach(function (ln) {
    if (!ln.fm.map) {
      items.push(Object.assign({}, base, { item_key: g.key + '|b:' + ln.bill_id + ':' + ln.item_key + ':' + String(ln.unit || '').toUpperCase(), kind: 'line', outcome: 'cannot_compare',
        reasons: [ln.fm.conflict ? 'two approved product mappings fit this bill line — fix the mappings' : 'no approved product mapping for “' + ln.description + '” (' + (ln.unit || 'no unit') + ')'],
        bill_line: lineOut(ln), bill_lines: [lineOut(ln)], figures: null, needs_mapping: !ln.fm.conflict,
        inputs: { item_key: g.key + '|b:' + ln.bill_id + ':' + ln.item_key + ':' + String(ln.unit || '').toUpperCase(), why: ln.fm.conflict ? 'map_conflict' : 'no_map', bill_lines: [[ln.bill_id, vendorKey(ln.vendor), String(ln.description || '').toLowerCase().replace(/\s+/g, ' ').trim(), ln.qty, String(ln.unit || '').toUpperCase().trim()]], links: linkIn } }));
      return;
    }
    var pk = mapProductKey(ln.fm.map);
    if (!byProduct[pk]) { byProduct[pk] = { map: ln.fm.map, lines: [], maps: {} }; order.push(pk); }
    byProduct[pk].lines.push(ln); byProduct[pk].maps[ln.fm.map.id] = ln.fm.map;
  });

  // Codex 11:12 P1 — resolve scan → product BEFORE any total: a scan that fits two DIFFERENT mapped products of this group (e.g. a
  // broad "product 7, any grade" and a specific "product 7, grade 2") is never counted for both; EVERY product it fits is blocked
  // (Cannot compare — mapping conflict) until the mappings are fixed. Whatever the order of the bill lines.
  var coversOf = {}; // log id → [product keys whose mapping covers it]
  logs.forEach(function (l) { coversOf[l.id] = order.filter(function (pk) { return mapCovers(byProduct[pk].map, l.p); }); });
  var conflictWith = {}; // product key → { other product key: [log ids] }
  logs.forEach(function (l) { var cs = coversOf[l.id]; if (cs.length < 2) { return; } cs.forEach(function (a) { cs.forEach(function (b) { if (a !== b) { var m = conflictWith[a] || (conflictWith[a] = {}); (m[b] = m[b] || []).push(l.id); } }); }); });
  order.forEach(function (pk) {
    var P = byProduct[pk];
    var mapsUsed = Object.keys(P.maps).sort().map(function (id) { var m = P.maps[id]; return { id: m.id, version: m.version, lb_per_yd: m.lb_factor_approved ? Number(m.lb_per_yd) : null }; });
    var mine = logs.filter(function (l) { return coversOf[l.id].indexOf(pk) >= 0; });
    var reasons = []; var flags = [];
    mine.forEach(function (l) { used[l.id] = pk; });
    var conflict = conflictWith[pk] ? Object.keys(conflictWith[pk]).sort().map(function (other) { return { product: byProduct[other].map.wh_label || other, scans: conflictWith[pk][other] }; }) : null;
    if (conflict) { reasons.push('mapping conflict: ' + conflict.map(function (c) { return 'scan(s) ' + c.scans.join(', ') + ' also fit “' + c.product + '”'; }).join('; ') + ' — the same goods would be counted twice; fix the product mappings (Mappings & tolerance) before this can be compared'); }
    var kinds = {}; P.lines.forEach(function (ln) { kinds[ln.u.kind] = true; });
    var unknownLines = P.lines.filter(function (ln) { return ln.u.kind === 'unknown' || ln.qty == null; });
    var billedLb = 0; var billedYd = 0;
    P.lines.forEach(function (ln) { if (ln.qty == null) { return; } if (ln.u.kind === 'weight') { billedLb += ln.qty * ln.u.toLb; } else if (ln.u.kind === 'length') { billedYd += ln.qty * ln.u.toYd; } });
    billedLb = r3(billedLb); billedYd = r3(billedYd);
    var recLb = null, recYd = null, recRolls = null, recPlKg = null;
    if (mine.length) {
      recLb = mine.every(function (l) { return l.lb != null; }) ? r3(mine.reduce(function (s, l) { return s + l.lb; }, 0)) : null;
      recYd = mine.every(function (l) { return l.yd != null; }) ? r3(mine.reduce(function (s, l) { return s + l.yd; }, 0)) : null;
      recRolls = mine.every(function (l) { return l.rolls != null; }) ? mine.reduce(function (s, l) { return s + l.rolls; }, 0) : null;
      recPlKg = mine.every(function (l) { return l.pl_kg != null; }) ? r3(mine.reduce(function (s, l) { return s + l.pl_kg; }, 0)) : null;
    }
    // which figures are compared
    var basis = null; var billed = null; var received = null; var unitWord = null; var conversion = null;
    if (unknownLines.length) { reasons.push(unknownLines.map(function (ln) { return 'line ' + ln.line_no + ' of bill ' + (ln.bill_number || '?') + ': ' + (ln.qty == null ? 'no readable quantity' : ln.u.reason); }).join('; ')); }
    else if (kinds.weight && kinds.length) { reasons.push('this product is billed partly by weight and partly by length — the two cannot be added'); }
    else if (kinds.weight) {
      basis = 'lb'; billed = billedLb; unitWord = 'lb'; conversion = P.lines.map(function (ln) { return ln.u.label; }).filter(uniqF).join(', ');
      if (mine.length && recLb == null) { reasons.push(mine.filter(function (l) { return l.lb == null; }).length + ' scan row(s) have no readable weight'); }
      received = recLb;
    } else if (kinds.length) {
      basis = 'yd'; billed = billedYd; unitWord = 'yd'; conversion = P.lines.map(function (ln) { return ln.u.label; }).filter(uniqF).join(', ');
      if (mine.length && recYd == null) { reasons.push('the receipt does not give a readable length in yards / metres for every scan row'); }
      received = recYd;
    }
    var lbFactor = (basis === 'yd' && mapsUsed.length === 1 && mapsUsed[0].lb_per_yd) ? mapsUsed[0].lb_per_yd : null;
    var diff = (billed != null && received != null) ? r3(received - billed) : null;
    var pct = (diff != null && billed) ? Math.round(diff / billed * 10000) / 100 : null;
    var tol = inp.tolerance || null;
    var outcome; var words;
    if (removed.length) { outcome = 'cannot_compare'; reasons.unshift('receipt ' + removed.map(function (r) { return r.key; }).join(', ') + ' was not found in the warehouse any more (confirmed by an id lookup)'); }
    else if (incompleteRead.length) { outcome = 'cannot_compare'; reasons.unshift('the warehouse answer for ' + incompleteRead.map(function (r) { return r.key; }).join(', ') + ' was incomplete — recheck'); }
    else if (conflict) { outcome = 'mapping_conflict'; }
    else if (!mine.length) { outcome = 'product_missing'; }
    else if (reasons.length || basis === null || diff === null) { outcome = 'cannot_compare'; }
    else if (drafts.length) { outcome = 'incomplete'; }
    else if (tol && withinTolerance(diff, billed, tol)) { outcome = 'matched'; }
    else if (!tol && diff === 0) { outcome = 'equal'; }
    else { outcome = 'discrepancy'; }
    // Max 25 Nov: a bill above what was scanned is never allowed — say so plainly
    if (outcome === 'discrepancy' && diff != null && diff < 0) { reasons.unshift('billed MORE than was scanned into the warehouse (' + Math.abs(diff) + ' ' + (unitWord || '') + ') — never allowed, no tolerance'); }
    // v55.83-ZB (Max 25 Nov: "yards and yards and weight and weight comparison"): two checks side by side, NO conversion between
    // them. Weight = billed lb vs scanned lb; Yards = billed yd vs the receipt's yards. A side with no figure says so ("not on the
    // bill" / "not recorded") — never a mismatch. Each check has its own result under the same one-way rule; the % tolerance
    // applies to both, the lb allowance only to weight.
    var lengthOnly = kinds.length && !kinds.weight && !unknownLines.length; var weightOnly = kinds.weight && !kinds.length && !unknownLines.length;
    var declaredYd = null; var declaredAll = recs.length > 0 && recs.every(function (r) { return r.data.state !== 'removed' && r.data.info && parseNum(r.data.info.declared_quantity, false).value != null && receiptLengthUnit(r.data).toYd != null; });
    if (declaredAll) { declaredYd = r3(recs.reduce(function (s, r) { return s + parseNum(r.data.info.declared_quantity, false).value * receiptLengthUnit(r.data).toYd; }, 0)); }
    var checks = {
      weight: oneCheck('lb', weightOnly ? billedLb : null, mine.length ? recLb : null, tol, true),
      yards: oneCheck('yd', lengthOnly ? billedYd : null, mine.length ? recYd : null, tol, false)
    };
    if (checks.weight.billed == null) { checks.weight.note = kinds.length ? 'not on the bill (billed in yards)' : 'not on the bill'; }
    else if (checks.weight.received == null) { checks.weight.note = mine.length ? 'the scale weight is not readable for every scan row' : 'not scanned'; }
    if (checks.yards.billed == null) { checks.yards.note = kinds.weight ? 'not on the bill (billed by weight)' : 'not on the bill'; }
    else if (checks.yards.received == null) { checks.yards.note = mine.length ? 'not recorded on the receipt' : 'not scanned'; }
    // Codex 25 Nov: the receipt's row yards are typed at scan-in; when they add up exactly to the packing-list quantity they may be
    // copied, not measured — said plainly (information; Max decided the yards are compared)
    if (checks.yards.received != null && declaredYd != null && Math.abs(checks.yards.received - declaredYd) < 0.005) { checks.yards.copied_note = 'the warehouse yards equal the packing-list quantity (' + declaredYd + ' yd) — they may have been copied from it, not measured'; }
    if (recPlKg != null) { checks.weight.packing_list_lb = r3(recPlKg * LB_PER_KG); checks.weight.scale_vs_packing_list_lb = recLb != null ? r3(recLb - recPlKg * LB_PER_KG) : null; }
    // a check that has both figures and fails makes the product REVIEW even when the other one passes
    if ((outcome === 'matched' || outcome === 'equal') && (checks.weight.result === 'discrepancy' || checks.yards.result === 'discrepancy')) {
      outcome = 'discrepancy';
      ['weight', 'yards'].forEach(function (k) { var c = checks[k]; if (c.result === 'discrepancy') { reasons.push(k + ': billed ' + c.billed + ' ' + c.unit + ' vs ' + c.received + ' ' + c.unit + ' in the warehouse'); } });
    }
    if (flags.length) { reasons = reasons.concat(flags); }
    var inputs = {
      item_key: g.key + '|p:' + pk,
      receipts: recs.map(function (r) { return [r.key, r.data.state === 'removed' ? 'removed' : (Number(r.data.is_draf) === 1 ? 'draft' : 'final'), r.data.read_complete === false ? 'incomplete' : 'complete']; }),
      logs: mine.map(function (l) { return [l.id, l.receipt_key, l.lb, l.yd, l.rolls, canonical(l.p)]; }).sort(cmpArr),
      bill_lines: P.lines.map(function (ln) { return [ln.bill_id, vendorKey(ln.vendor), String(ln.description || '').toLowerCase().replace(/\s+/g, ' ').trim(), ln.qty, String(ln.unit || '').toUpperCase().trim()]; }).sort(cmpArr),
      links: linkIn, maps: mapsUsed, basis: basis,
      tolerance: tol ? { id: tol.id, version: tol.version } : null,
      conflict: conflict ? conflict.map(function (c) { return [c.product, c.scans.slice().sort()]; }) : null
    };
    items.push(Object.assign({}, base, {
      item_key: inputs.item_key, kind: 'product', product_key: pk, product_label: P.map.wh_label || pk, outcome: outcome, reasons: reasons,
      provisional: drafts.length > 0,
      figures: { basis: basis, unit: unitWord, billed: billed, received: received, diff: diff, pct: pct, billed_lb: kinds.weight ? billedLb : null, billed_yd: kinds.length ? billedYd : null,
        received_lb: recLb, received_yd: recYd, received_rolls: recRolls, declared_pl_kg: recPlKg, conversion: conversion,
        lb_factor: lbFactor, billed_lb_by_factor: lbFactor && billedYd ? r3(billedYd * lbFactor) : null, received_lb_vs_factor: lbFactor && recLb != null && billedYd ? r3(recLb - billedYd * lbFactor) : null,
        scans: mine.length, scanned_out: mine.filter(function (l) { return l.scanned_out; }).length, checks: checks },
      bill_lines: P.lines.map(lineOut), scan_rows: mine, inputs: inputs
    }));
  });

  // warehouse rows of these receipts that no bill line of the group asked for (information only — never "unbilled")
  var extra = logs.filter(function (l) { return !used[l.id]; });
  if (extra.length && !removed.length) {
    var byP = {}; extra.forEach(function (l) { var k = canonical(l.p); (byP[k] = byP[k] || []).push(l); });
    Object.keys(byP).sort().forEach(function (k) {
      var rows = byP[k];
      items.push(Object.assign({}, base, { item_key: g.key + '|wh:' + k, kind: 'warehouse_only', outcome: 'warehouse_only', product_label: productLabel(rows[0].p, inp.lookups),
        reasons: ['in the warehouse receipt, not on the linked bill(s) — it may be billed elsewhere'], scan_rows: rows,
        figures: { received_lb: rows.every(function (l) { return l.lb != null; }) ? r3(rows.reduce(function (s, l) { return s + l.lb; }, 0)) : null, scans: rows.length }, inputs: null }));
    });
  }
  return items;
}
// one side-by-side check (v55.83-ZB): billed vs warehouse in ONE unit; result matched / equal / discrepancy, or not_recorded
function oneCheck(unit, billed, received, tol, isWeight) {
  var d = (billed != null && received != null) ? r3(received - billed) : null;
  var t = tol ? (isWeight ? tol : { pct: tol.pct, lb: null }) : null;
  var res = d === null ? 'not_recorded' : (t && withinTolerance(d, billed, t) ? 'matched' : (!t && d === 0 ? 'equal' : 'discrepancy'));
  return { unit: unit, billed: billed, received: received, diff: d, pct: (d != null && billed) ? Math.round(d / billed * 10000) / 100 : null, result: res, note: null,
    over: d != null && d < -1e-9 };
}
function lineOut(ln) { return { bill_id: ln.bill_id, bill_number: ln.bill_number, line_no: ln.line_no, line_id: ln.line_id, description: ln.description, qty: ln.qty, unit: ln.unit, conversion: ln.u.label || ln.u.reason || null }; }
function uniqF(x, i, a) { return a.indexOf(x) === i; }
function cmpArr(a, b) { var x = canonical(a); var y = canonical(b); return x < y ? -1 : (x > y ? 1 : 0); }

// v55.83-YX (Max 25 Nov): ONE-WAY. diff = scanned − billed. A bill may be BELOW what was scanned by up to the approved
// tolerance (packaging / gross vs net); a bill ABOVE what was scanned is NEVER within tolerance — not by one pound.
export function withinTolerance(diff, billed, tol) {
  if (!tol) { return false; }
  if (Number(diff) < -1e-9) { return false; }
  var lim = 0;
  if (tol.lb != null) { lim = Math.max(lim, Number(tol.lb)); }
  if (tol.pct != null && billed) { lim = Math.max(lim, Math.abs(billed) * Number(tol.pct) / 100); }
  return Math.abs(diff) <= lim + 1e-9;
}

// a bill with no confirmed link: proposals to confirm, or no receipt (only when the warehouse was actually read)
export function unlinkedBillItem(bill, proposal, feedOk) {
  var key = 'b:' + bill.id + '|unlinked';
  if (!feedOk) { return { item_key: key, kind: 'bill', outcome: 'warehouse_unavailable', bill_ids: [bill.id], receipt_keys: [], reasons: ['Warehouse unavailable / not checked'], figures: null, inputs: null }; }
  if (proposal && proposal.candidates.length) {
    return { item_key: key, kind: 'bill', outcome: 'cannot_compare', bill_ids: [bill.id], receipt_keys: [], candidates: proposal.candidates,
      reasons: [proposal.ambiguous ? proposal.reason : 'a receipt with the same reference was found — a person must confirm the link'], figures: null, needs_link: true,
      inputs: { item_key: key, refs: billReferences(bill).map(function (r) { return [r.basis, r.norm]; }), candidates: proposal.candidates.map(function (c) { return c.receipt_key; }).sort(), searched: 'proposals' } };
  }
  if (!billReferences(bill).length) { return { item_key: key, kind: 'bill', outcome: 'cannot_compare', bill_ids: [bill.id], receipt_keys: [], reasons: ['the bill has no reference to look for — choose the receipt by hand'], figures: null, needs_link: true, inputs: { item_key: key, refs: [], searched: 'no_reference' } }; }
  return { item_key: key, kind: 'bill', outcome: 'no_receipt', bill_ids: [bill.id], receipt_keys: [], reasons: ['no warehouse receipt carries this bill’s reference (' + billReferences(bill).map(function (r) { return BASIS_LABEL[r.basis] + ' ' + r.raw; }).join(', ') + ')'],
    figures: null, inputs: { item_key: key, refs: billReferences(bill).map(function (r) { return [r.basis, r.norm]; }), searched: 'none_found' } };
}

export var OUTCOME_WORDS = {
  matched: 'Matched (within the approved tolerance)', equal: 'Equal', discrepancy: 'Weight / quantity discrepancy', no_receipt: 'No receipt found',
  product_missing: 'Billed product missing from the receipt', incomplete: 'Receipt incomplete — scan-in still a draft (provisional)',
  cannot_compare: 'Cannot compare', warehouse_unavailable: 'Warehouse unavailable / not checked', limited_access: 'Limited access — part of this group is hidden',
  mapping_conflict: 'Cannot compare — two product mappings fit the same scans',
  warehouse_only: 'In the warehouse, not on the linked bill(s)'
};
export var COMPARABLE_OUTCOMES = { matched: 1, equal: 1, discrepancy: 1, product_missing: 1, no_receipt: 1, incomplete: 1 };

// ---------------------------------------------------------------- decisions
export var DECISION_KINDS = ['validate_match', 'accept_discrepancy', 'report_issue', 'resolve', 'reopen'];
export var DECISION_PERM = { validate_match: 'bills.weight_check.validate', accept_discrepancy: 'bills.weight_check.accept', report_issue: 'bills.weight_check.validate', resolve: 'bills.weight_check.resolve' };
export var STATE_WORDS = {
  unreviewed: 'Not reviewed', validated: 'Reviewed — match validated', accepted: 'Reviewed — discrepancy accepted', issue_open: 'Issue reported — open',
  resolved: 'Issue resolved', needs_revalidation: 'Needs revalidation — the figures changed since the decision', reopened: 'Reopened — not reviewed',
  // Codex 11:12 P1 — not decidable right now, but NOT done: they stay outstanding and keep a report open
  not_checked: 'Not checked — the warehouse could not be read', limited: 'Blocked — part of this group is outside your access', blocked: 'Blocked — fix the product mappings first'
};
// which decisions an outcome allows
export function allowedDecisions(outcome) {
  if (outcome === 'matched' || outcome === 'equal') { return ['validate_match', 'report_issue']; }
  if (outcome === 'warehouse_only' || outcome === 'warehouse_unavailable' || outcome === 'limited_access' || outcome === 'mapping_conflict') { return []; }
  return ['accept_discrepancy', 'report_issue'];
}
// Codex 11:12 P1 — "needs attention" (counts toward a report being complete) is apart from "can be decided now". Only an
// information row (warehouse goods not on the linked bill) needs nothing. Unread, unavailable, limited and blocked items stay
// outstanding until they can be compared and decided.
export function needsAttention(item) { return item.outcome !== 'warehouse_only'; }
export function blockedState(outcome) { return outcome === 'warehouse_unavailable' ? 'not_checked' : outcome === 'limited_access' ? 'limited' : outcome === 'mapping_conflict' ? 'blocked' : null; }
export var BLOCKED_STATES = { not_checked: 1, limited: 1, blocked: 1 };
// decisions (this item, any order) + the CURRENT fingerprint → { state, decision, issue, changed }
export function decisionState(decisions, currentFp) {
  var ds = (decisions || []).slice().sort(function (a, b) { return String(a.at || '').localeCompare(String(b.at || '')) || String(a.id || '').localeCompare(String(b.id || '')); });
  var state = 'unreviewed'; var last = null; var issue = null;
  ds.forEach(function (d) {
    if (d.kind === 'reopen') { state = 'reopened'; last = d; issue = null; return; }
    if (d.kind === 'report_issue') { state = 'issue_open'; last = d; issue = d; return; }
    if (d.kind === 'resolve') { if (issue) { state = 'resolved'; last = d; } return; }
    if (d.kind === 'validate_match') { state = 'validated'; last = d; issue = null; return; }
    if (d.kind === 'accept_discrepancy') { state = 'accepted'; last = d; issue = null; return; }
  });
  var changed = false;
  if ((state === 'validated' || state === 'accepted' || state === 'resolved') && last && currentFp && last.comparison_fp !== currentFp) { changed = true; state = 'needs_revalidation'; }
  return { state: state, decision: last, issue: issue, changed: changed, history: ds };
}
export function isOutstanding(state) { return !(state === 'validated' || state === 'accepted' || state === 'resolved'); }
export function needsDecision(item) { return allowedDecisions(item.outcome).length > 0; }

// what changed between the inputs of the decision and now (field by field, plain words)
export function diffInputs(a, b) {
  var out = [];
  if (!a || !b) { return ['the comparison could not be rebuilt in the same form']; }
  function idx(list, keyLen) { var m = {}; (list || []).forEach(function (r) { m[canonical(r.slice(0, keyLen))] = r; }); return m; }
  var la = idx(a.logs, 2); var lb = idx(b.logs, 2);
  Object.keys(la).forEach(function (k) { var x = la[k]; var y = lb[k]; if (!y) { out.push('scan row ' + x[0] + ' (receipt ' + x[1] + ') is no longer counted'); } else if (canonical(x) !== canonical(y)) { out.push('scan row ' + x[0] + ': weight ' + fmt(x[2]) + ' → ' + fmt(y[2]) + ' lb, length ' + fmt(x[3]) + ' → ' + fmt(y[3]) + ' yd, rolls ' + fmt(x[4]) + ' → ' + fmt(y[4]) + (x[5] !== y[5] ? ', product changed' : '')); } });
  Object.keys(lb).forEach(function (k) { if (!la[k]) { out.push('scan row ' + lb[k][0] + ' (receipt ' + lb[k][1] + ') is new'); } });
  var ba = (a.bill_lines || []).map(canonical); var bb = (b.bill_lines || []).map(canonical);
  ba.forEach(function (x, i) { if (bb.indexOf(x) < 0) { var r = a.bill_lines[i]; out.push('bill line removed or changed: “' + r[2] + '” ' + fmt(r[3]) + ' ' + (r[4] || '')); } });
  bb.forEach(function (x, i) { if (ba.indexOf(x) < 0) { var r = b.bill_lines[i]; out.push('bill line added or changed: “' + r[2] + '” ' + fmt(r[3]) + ' ' + (r[4] || '')); } });
  if (canonical(a.links) !== canonical(b.links)) { out.push('the confirmed bill ↔ receipt links changed'); }
  if (canonical(a.receipts) !== canonical(b.receipts)) { out.push('receipt status changed (' + (a.receipts || []).map(function (r) { return r.join(' '); }).join(', ') + ' → ' + (b.receipts || []).map(function (r) { return r.join(' '); }).join(', ') + ')'); }
  if (canonical(a.maps) !== canonical(b.maps)) { out.push('the product mapping or its conversion changed'); }
  if (canonical(a.tolerance) !== canonical(b.tolerance)) { out.push('the tolerance changed'); }
  if (a.basis !== b.basis) { out.push('the comparison basis changed (' + a.basis + ' → ' + b.basis + ')'); }
  if (canonical(a.refs) !== canonical(b.refs)) { out.push('the bill’s references changed'); }
  if (!out.length && canonical(a) !== canonical(b)) { out.push('the comparison changed'); }
  return out;
}
function fmt(v) { return v == null ? '—' : String(v); }

// ---------------------------------------------------------------- reports
// itemStates: [{ needs_attention, state }] — a report is Complete only when every item that needs attention is decided
// (validated / accepted / resolved). Not checked, limited and blocked items keep it open and are counted apart.
export function reportStatus(itemStates) {
  var list = (itemStates || []).filter(function (s) { return s.needs_attention && isOutstanding(s.state); });
  var open = list.length; var blocked = list.filter(function (s) { return BLOCKED_STATES[s.state]; }).length;
  var words = open === 0 ? 'Complete — every item decided'
    : 'Open — ' + open + ' item' + (open === 1 ? '' : 's') + ' outstanding' + (blocked ? ' (' + blocked + ' not checked or blocked)' : '');
  return { open: open, blocked: blocked, complete: open === 0, words: words };
}
// the default list: unreviewed, unresolved, needs-revalidation AND not-checked / blocked items
export function defaultFilter(row) { return row.needs_attention && isOutstanding(row.state); }

export var CSV_COLUMNS = ['report', 'bill_number', 'vendor', 'bill_date', 'reference', 'receipts', 'warehouse', 'product', 'billed', 'received', 'unit', 'diff', 'diff_pct', 'conversion', 'outcome', 'state', 'reviewer', 'decided_at', 'reason', 'source'];
export function csvCell(v) { var s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) { s = "'" + s; } return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
export function toCsv(rows) { return [CSV_COLUMNS.join(',')].concat((rows || []).map(function (r) { return CSV_COLUMNS.map(function (c) { return csvCell(r[c]); }).join(','); })).join('\r\n'); }
