// v55.83-SY — PRODUCT / CUSTOMER / INVOICE PROFITABILITY: the calculation engine.
// Max, Nov 16 2026 (his written rules, in order):
//   "customer invoices show transportation revenue; vendor bills show transportation expense"
//   "at 2.5 lb per yard, quantity in yards is multiplied by 2.5 to get pounds; price per yard is divided by 2.5"
//   "Actual Purchase Costs Are the Primary Source ... Never attach the full value of every matching purchase bill to
//    every sales invoice ... Historic reports must not silently change because a later purchase has a different price."
//   "Commission Comes From NexPac Bills ... using the actual commission amounts recorded on the bills."
//   "Inbound expense = normalized pounds × $0.02 ... Standard inbound allowance"
//   "Brokerage and Bonded Charges: Houston Only ... Unknown origin must be flagged, not assumed to be Houston."
//   "Allocation totals must remain unchanged when grouping or filtering." · "Missing costs must remain visibly unknown."
//
// Pure functions. No database, no dates read from the clock, nothing written anywhere. The route feeds it rows and
// stores what it decides. Every split is done ONCE per release, to the cent, BEFORE any grouping or filter.
//
// This report never changes an invoice, a bill, inventory or an accounting entry.

export var INBOUND_ALLOWANCE_PER_LB = 0.02;
// Max, Nov 16: "bonded should add $200 for all shipments from Houston USA" — a STANDARD charge per Houston release (shipment), split
// across the goods on that release by pounds. Canada and unknown origin get none.
export var BONDED_PER_HOUSTON_RELEASE = 200;
export var PRICING_BASES = ['EXW', 'CNF', 'TRUCKING_INCLUDED'];
// Business reporting weights (Max): not a physical conversion between yards and metres.
// Kilograms are a real conversion (Max, Nov 16: "1 kg is 2.20462 lbs - convert everything to LBS"); yards and linear metres are business weights.
export var KG_TO_LB = 2.20462;
// Max, Nov 16: "also need to add sold by tons. 1 ton = 1000 kgs or 2204.62 lbs" — a METRIC ton (tonne), never a 2,000 lb US ton.
export var TON_TO_LB = 2204.62;
export var DEFAULT_UNIT_FACTORS = { lb: 1, kg: KG_TO_LB, t: TON_TO_LB, yd: 2.5, lm: 2.5 };

function cents(x) { return Math.round((Number(x) || 0) * 100); }
function money(c) { return Math.round(c) / 100; }
export function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
export function r4(x) { return Math.round((Number(x) || 0) * 10000) / 10000; }

export function nameKey(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9&]+/g, ' ').replace(/\s+/g, ' ').trim(); }
export function relKey(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

// 'Yards' / 'yd' / 'YDS' → yd · 'linear meter' / 'LM' / 'm' → lm · 'lbs' / 'pounds' → lb · anything else → '' (unknown, never guessed)
export function unitKey(u) {
  var t = String(u || '').toLowerCase().replace(/[^a-z]/g, '');
  if (t === 'lb' || t === 'lbs' || t === 'pound' || t === 'pounds') { return 'lb'; }
  if (t === 'kg' || t === 'kgs' || t === 'kilo' || t === 'kilos' || t === 'kilogram' || t === 'kilograms' || t === 'kilogramme' || t === 'kilogrammes') { return 'kg'; }
  if (t === 't' || t === 'mt' || t === 'ton' || t === 'tons' || t === 'tonne' || t === 'tonnes' || t === 'metricton' || t === 'metrictons' || t === 'metrictonne' || t === 'metrictonnes') { return 't'; }
  if (t === 'yd' || t === 'yds' || t === 'yard' || t === 'yards') { return 'yd'; }
  if (t === 'lm' || t === 'm' || t === 'meter' || t === 'meters' || t === 'metre' || t === 'metres' || t === 'linearmeter' || t === 'linearmeters' || t === 'linearmetre' || t === 'linearmetres' || t === 'lmeter') { return 'lm'; }
  return '';
}
// pounds per one unit, or null when the unit is unknown. A product can carry its own factor ({ 'product key': { yd: 2.4 } }).
export function unitFactor(unit, productKey, factors) {
  var u = unitKey(unit);
  if (!u) { return null; }
  var f = factors || {};
  var per = f.byProduct && productKey && f.byProduct[productKey];
  if (per && per[u] > 0) { return Number(per[u]); }
  var base = f.units || DEFAULT_UNIT_FACTORS;
  return base[u] > 0 ? Number(base[u]) : null;
}
export function toPounds(qty, unit, productKey, factors) {
  var f = unitFactor(unit, productKey, factors);
  if (f === null) { return null; }
  return (Number(qty) || 0) * f;
}
// $ per original unit → $ per pound ($0.30 / yd ÷ 2.5 = $0.12 / lb)
export function pricePerPound(pricePerUnit, unit, productKey, factors) {
  var f = unitFactor(unit, productKey, factors);
  if (f === null) { return null; }
  return (Number(pricePerUnit) || 0) / f;
}

// Split an amount across weights TO THE CENT: the parts always add back to the amount (largest remainders get the odd cents).
export function allocate(amount, weights) {
  var total = 0; var i;
  for (i = 0; i < weights.length; i++) { total += Math.max(0, Number(weights[i]) || 0); }
  var c = cents(amount); var out = []; var used = 0; var rema = [];
  if (!(total > 0) || !weights.length) { return weights.map(function () { return 0; }); }
  for (i = 0; i < weights.length; i++) {
    var exact = c * (Math.max(0, Number(weights[i]) || 0) / total);
    var fl = Math.floor(exact + 1e-9);
    out.push(fl); used += fl; rema.push({ i: i, r: exact - fl });
  }
  rema.sort(function (a, b) { return b.r - a.r || a.i - b.i; });
  for (i = 0; i < c - used; i++) { out[rema[i % rema.length].i] += 1; }
  return out.map(money);
}

// v55.83-TD (Max, Nov 16: "overweight surcharge on Elite's invoice — it's an extra shipping cost") — surcharges and container extras
// charged to the customer are TRANSPORTATION REVENUE, not a product. A person can still mark any description either way.
var TRANSPORT_RX = /ship|freight|forward|truck|deliver|courier|cartage|drayage|overweight|over-weight|surcharge|demurrage|detention|chassis|شحن|توصيل/i;
export function isTransportLine(description) { return TRANSPORT_RX.test(String(description || '')); }
// CNF / C&F / CIF wording SUGGESTS the basis. A person confirms it. No wording and no transport line proves nothing.
export function suggestBasis(text, hasTransportLine) {
  var t = String(text || '');
  if (/\bcnf\b|\bc\s*&\s*f\b|\bcfr\b|\bcif\b/i.test(t)) { return 'CNF'; }
  if (/\bexw\b|ex[\s-]?works/i.test(t)) { return 'EXW'; }
  if (/(trucking|delivery|delivered|freight)\s+(is\s+)?includ|\bdelivered\s+price\b|\bddp\b|\bdap\b/i.test(t)) { return 'TRUCKING_INCLUDED'; }
  if (hasTransportLine) { return 'EXW'; }
  return null;
}

// A bill that covers several releases: store each release's share. Explicit shares must add up to the bill; otherwise
// the split is by pounds. Returns { shares: { RELKEY: amount }, method, problem }.
export function splitBillAcrossReleases(bill, poundsByRelease) {
  var rels = (bill.releases || []).map(function (x) { return { rel: relKey(x.release), share: x.share }; }).filter(function (x) { return !!x.rel; });
  var seen = {}; var dup = false;
  rels = rels.filter(function (x) { if (seen[x.rel]) { dup = true; return false; } seen[x.rel] = true; return true; });
  var amount = r2(bill.amount);
  if (!rels.length) { return { shares: {}, method: 'none', problem: 'no_release' }; }
  var explicit = rels.every(function (x) { return x.share !== null && x.share !== undefined && x.share !== ''; });
  var shares = {}; var problem = dup ? 'duplicate_release_link' : null;
  if (explicit) {
    var sum = 0; rels.forEach(function (x) { shares[x.rel] = r2(x.share); sum += cents(x.share); });
    if (sum !== cents(amount)) { return { shares: {}, method: 'explicit', problem: 'shares_do_not_add_up' }; }
    return { shares: shares, method: 'explicit', problem: problem };
  }
  if (rels.length === 1) { shares[rels[0].rel] = amount; return { shares: shares, method: 'single', problem: problem }; }
  var w = rels.map(function (x) { return Number(poundsByRelease[x.rel]) || 0; });
  if (w.some(function (v) { return !(v > 0); })) { return { shares: {}, method: 'pounds', problem: 'release_pounds_missing' }; }
  var parts = allocate(amount, w);
  rels.forEach(function (x, ix) { shares[x.rel] = parts[ix]; });
  return { shares: shares, method: 'pounds', problem: problem };
}

// WHERE A RELEASE SHIPPED FROM (Max, Nov 16: "you will know from houston as it would be on invoice or start with a release number of 1002-").
// A release number that starts with 1002- is Houston. The word Houston on the invoice is Houston. Any other prefix is looked up in
// the prefix list a person maintains; a prefix nobody has mapped is UNKNOWN and is flagged — never assumed to be Houston.
// Max, Nov 16: "1001- represent shipped out of Canada".
export var DEFAULT_ORIGIN_PREFIXES = { '1002': 'HOUSTON', '1001': 'CANADA' };
export function releasePrefix(release) { var m = String(release || '').trim().match(/^([A-Za-z0-9]+)\s*-/); return m ? m[1].toUpperCase() : ''; }
export function releaseOrigin(release, invoiceText, prefixes) {
  var map = prefixes || DEFAULT_ORIGIN_PREFIXES;
  var pre = releasePrefix(release);
  if (pre && map[pre]) { return { origin: String(map[pre]).toUpperCase(), source: 'release prefix ' + pre + '-' }; }
  if (/\bhouston\b/i.test(String(invoiceText || ''))) { return { origin: 'HOUSTON', source: 'invoice wording' }; }
  return { origin: '', source: pre ? 'prefix ' + pre + '- is not mapped' : 'no release prefix' };
}

// Brokerage / bonded pool with no release link: equal shares across the ELIGIBLE Houston releases a person confirmed.
// Canada (and any non-Houston origin) gets zero. Unknown origin is flagged and gets nothing — never assumed Houston.
export function houstonPoolAllocation(amount, releases) {
  var eligible = []; var unknown = []; var excluded = []; var seen = {};
  (releases || []).forEach(function (x) {
    var k = relKey(x.release); if (!k || seen[k]) { return; } seen[k] = true;
    var o = String(x.origin || '').trim().toUpperCase();
    if (!o) { unknown.push(k); } else if (o === 'HOUSTON') { eligible.push(k); } else { excluded.push(k); }
  });
  var shares = {};
  if (eligible.length) { var parts = allocate(amount, eligible.map(function () { return 1; })); eligible.forEach(function (k, ix) { shares[k] = parts[ix]; }); }
  return { shares: shares, eligible: eligible, excluded: excluded, unknown_origin: unknown, method: 'equal_across_confirmed_houston_releases', unallocated: eligible.length ? 0 : r2(amount) };
}

// WHICH PURCHASES COST THIS SALE. Linking descriptions says WHAT the product is; this decides WHICH bill lines apply.
//   1 'release'       — bill lines (linked descriptions) on a bill that carries the SAME release number as the sale
//   2 'window'        — quantity-weighted actual cost of linked bill lines dated in the N days up to the invoice date
//   3 'last_purchase' — the most recent linked purchase before the invoice date
//   4 'manual'        — an explicitly typed fallback, labelled
//   5 null            — MISSING. Never zero.
// It returns a RATE per pound. The sale is charged rate × its own pounds — never a whole bill.
// billLines: [{ bill_id, bill_number, vendor, bill_date, release, description, qty, unit, cost_amount, commission_amount }]
export function resolveCost(q, billLines, opts) {
  var o = opts || {}; var windowDays = o.windowDays > 0 ? o.windowDays : 90;
  var want = {}; (q.billNameKeys || []).forEach(function (k) { want[k] = true; });
  var rels = {}; (q.releases || []).forEach(function (r) { var k = relKey(r); if (k) { rels[k] = true; } });
  var cand = [];
  (billLines || []).forEach(function (l) {
    if (!want[nameKey(l.description)]) { return; }
    var lb = toPounds(l.qty, l.unit, q.productKey, o.factors);
    if (lb === null || !(lb > 0)) { return; }
    // the product's cost on the bill: cost_amount (commission vendors) or, when that is empty, the line's printed amount.
    // No number, not a number, zero or negative = the cost is UNKNOWN. It is never turned into $0.
    var rawCost = (l.cost_amount !== null && l.cost_amount !== undefined && l.cost_amount !== '') ? l.cost_amount : l.amount;
    var costN = (rawCost === null || rawCost === undefined || rawCost === '') ? NaN : Number(rawCost);
    var commRaw = l.commission_amount; var commN = (commRaw === null || commRaw === undefined || commRaw === '') ? 0 : Number(commRaw);
    cand.push({ l: l, lb: lb, cost: costN, comm: commN, bad: !(costN > 0) || isNaN(commN) || commN < 0 });
  });
  function rate(rows, method) {
    var lb = 0, cost = 0, comm = 0; var bad = rows.filter(function (x) { return x.bad; });
    rows.forEach(function (x) { lb += x.lb; if (!x.bad) { cost += x.cost; comm += x.comm; } });
    // one applicable purchase line without a usable cost makes the whole rate unknown — a partial rate would look exact and be wrong
    return { base_per_lb: bad.length ? null : cost / lb, commission_per_lb: bad.length ? null : comm / lb, method: method, pounds_bought: lb,
      cost_unknown: bad.length > 0, missing_cost_lines: bad.map(function (x) { return { bill_id: x.l.bill_id, bill_number: x.l.bill_number || null, description: x.l.description }; }),
      sources: rows.map(function (x) { return { bill_id: x.l.bill_id, bill_number: x.l.bill_number || null, vendor: x.l.vendor || null, bill_date: x.l.bill_date || null, description: x.l.description, qty: Number(x.l.qty) || 0, unit: x.l.unit || null, pounds: x.lb, cost: x.bad ? null : r2(x.cost), commission: x.bad ? null : r2(x.comm) }; }) };
  }
  var onRel = cand.filter(function (x) { return rels[relKey(x.l.release)] === true; });
  if (onRel.length) { return rate(onRel, 'release'); }
  var d = String(q.invoiceDate || '').substring(0, 10);
  if (d) {
    var t1 = Date.parse(d + 'T00:00:00Z'); var t0 = t1 - windowDays * 86400000;
    var before = cand.filter(function (x) { var t = Date.parse(String(x.l.bill_date || '').substring(0, 10) + 'T00:00:00Z'); return !isNaN(t) && t <= t1; });
    var inWin = before.filter(function (x) { return Date.parse(String(x.l.bill_date).substring(0, 10) + 'T00:00:00Z') >= t0; });
    if (inWin.length) { var rw = rate(inWin, 'window'); rw.window_days = windowDays; return rw; }
    if (before.length) {
      var last = before.map(function (x) { return String(x.l.bill_date).substring(0, 10); }).sort().pop();
      return rate(before.filter(function (x) { return String(x.l.bill_date).substring(0, 10) === last; }), 'last_purchase');
    }
  }
  if (q.manual && q.manual.base_per_lb !== null && q.manual.base_per_lb !== undefined && q.manual.base_per_lb !== '' && Number(q.manual.base_per_lb) > 0) {
    return { base_per_lb: Number(q.manual.base_per_lb) || 0, commission_per_lb: Number(q.manual.commission_per_lb) || 0, method: 'manual', pounds_bought: 0, sources: [], note: q.manual.note || null };
  }
  return null;
}

// THE CELLS. One cell = one invoice line on one release. Everything else is a sum of cells.
// input: {
//   invoices: [{ id, number, date, customer, basis, embedded_transport, releases: [..], lines: [{ id, description, qty, unit, unit_price,
//               amount, transport (bool, optional), release_pounds: { REL: pounds } (only for an invoice on 2+ releases) }] }],
//   groupOf: function (description) → { id, name } | null,
//   costOf: function (invoice, line, cell) → resolveCost result | null,
//   outbound: { REL: { actual: amount | null, estimate: amount | null, bills: [...] } },
//   brokerage: { REL: amount }, bonded: { REL: amount }, factors
// }
export function buildCells(input) {
  var cells = []; var flags = []; var unallocated = [];
  var factors = input.factors || {};
  function flag(kind, inv, extra) { flags.push(Object.assign({ kind: kind, invoice_id: inv ? inv.id : null, invoice: inv ? inv.number : null }, extra || {})); }

  (input.invoices || []).forEach(function (inv) {
    var rels = []; var seenR = {};
    (inv.releases || []).forEach(function (r) { var k = relKey(r); if (k && !seenR[k]) { seenR[k] = true; rels.push(k); } });
    if (!rels.length) { flag('release_missing', inv); }
    var basis = PRICING_BASES.indexOf(inv.basis) >= 0 ? inv.basis : null;
    if (!basis) { flag('basis_missing', inv); }

    var goods = []; var tLines = 0;
    (inv.lines || []).forEach(function (ln) {
      var amt = ln.amount !== null && ln.amount !== undefined ? Number(ln.amount) || 0 : (Number(ln.qty) || 0) * (Number(ln.unit_price) || 0);
      var isT = ln.transport === true || (ln.transport !== false && isTransportLine(ln.description));
      if (isT) { tLines += cents(amt); return; }
      var g = input.groupOf ? input.groupOf(ln.description) : null;
      var pKey = g ? 'g:' + g.id : 'n:' + nameKey(ln.description);
      var lb = toPounds(ln.qty, ln.unit, pKey, factors);
      if (lb === null) { flag('unit_unknown', inv, { line: ln.description, unit: ln.unit || null }); }
      goods.push({ ln: ln, amt: amt, lb: lb, g: g, pKey: pKey });
    });

    // each goods line on its release(s)
    var mine = [];
    goods.forEach(function (gl) {
      var parts = [];
      if (rels.length <= 1) { parts.push({ rel: rels[0] || '', lb: gl.lb }); }
      else {
        var rp = gl.ln.release_pounds || null; var sum = 0; var ok = !!rp;
        if (ok) { rels.forEach(function (k) { var v = Number(rp[k]) || 0; if (v > 0) { parts.push({ rel: k, lb: v }); sum += v; } }); }
        if (!ok || !parts.length || (gl.lb !== null && Math.abs(sum - gl.lb) > 0.5)) {
          flag('release_split_missing', inv, { line: gl.ln.description, pounds: gl.lb, assigned: sum });
          parts = [{ rel: '', lb: gl.lb }];
        }
      }
      var amtParts = allocate(gl.amt, parts.map(function (p) { return p.lb === null ? 1 : p.lb; }));
      parts.forEach(function (p, ix) {
        var c = { invoice_id: inv.id, invoice: inv.number, invoice_date: inv.date, customer: inv.customer || null, line_id: gl.ln.id || null,
          description: gl.ln.description, group_id: gl.g ? gl.g.id : null, product: gl.g ? gl.g.name : String(gl.ln.description || '').trim(), product_key: gl.pKey,
          release: p.rel, basis: basis, orig_qty: Number(gl.ln.qty) || 0, orig_unit: gl.ln.unit || null, orig_unit_price: Number(gl.ln.unit_price) || 0,
          unit_factor: unitFactor(gl.ln.unit, gl.pKey, factors), pounds: p.lb, invoiced: amtParts[ix], flags: [] };
        if (p.lb === null) { c.flags.push('unit_unknown'); }
        cells.push(c); mine.push(c);
      });
    });

    // TRANSPORTATION REVENUE — what we charged the customer. Never a vendor bill.
    var weightsI = mine.map(function (c) { return c.pounds === null ? 0 : c.pounds; });
    // a split by pounds is only possible when EVERY goods line on the invoice has its pounds; otherwise it stays unresolved
    var weightsOk = mine.length > 0 && mine.every(function (c) { return c.pounds !== null && c.pounds > 0; });
    var lineT = money(tLines);
    var embedded = null; var embeddedSource = null;
    var manual = inv.embedded_transport;
    var hasManual = manual !== null && manual !== undefined && manual !== '';
    if (basis === 'CNF' || basis === 'TRUCKING_INCLUDED') {
      if (hasManual) {
        embedded = r2(manual); embeddedSource = 'manual';
        var goodsTotal = 0; mine.forEach(function (c) { goodsTotal += cents(c.invoiced); });
        if (cents(embedded) > goodsTotal) { flag('embedded_exceeds_goods', inv, { embedded: embedded, goods: money(goodsTotal) }); embedded = null; embeddedSource = null; }
      }
      if (embedded === null && !(tLines > 0)) { flag('transport_not_separated', inv); }
    } else if (hasManual && Number(manual) !== 0) {
      // EXW / no basis: a typed amount cannot invent revenue the invoice does not carry
      flag('manual_transport_ignored_not_inclusive', inv, { entered: r2(manual) });
    }
    var embParts = embedded !== null ? allocate(embedded, weightsI) : mine.map(function () { return 0; });
    var lineParts = allocate(lineT, weightsI);
    mine.forEach(function (c, ix) {
      c.embedded_transport = embedded !== null ? embParts[ix] : 0;
      c.goods_revenue = r2(c.invoiced - c.embedded_transport);
      c.transport_revenue = r2(lineParts[ix] + c.embedded_transport);
      if (!weightsOk && (lineT > 0 || embedded !== null)) {
        c.transport_revenue = null; c.flags.push('allocation_unresolved_missing_weight');
        if (embedded !== null) { c.embedded_transport = null; c.goods_revenue = null; } // the goods price cannot be separated either
      }
      c.transport_source = lineT > 0 && embedded !== null ? 'invoice line + manual' : (lineT > 0 ? 'invoice line' : (embedded !== null ? 'manual' : null));
      c.goods_price_confirmed = !!basis && !((basis === 'CNF' || basis === 'TRUCKING_INCLUDED') && embedded === null && !(tLines > 0));
      if (!c.goods_price_confirmed) { c.flags.push(basis ? 'transport_not_separated' : 'basis_missing'); }
      if (!c.release) { c.flags.push('release_missing'); }
    });
    if (!weightsOk && lineT > 0) { unallocated.push({ what: 'transport_revenue', invoice_id: inv.id, invoice: inv.number, amount: lineT, why: 'a goods line on this invoice has no weight' }); flag('allocation_unresolved_missing_weight', inv, { what: 'transportation charged on the invoice', amount: lineT }); }
    if (!weightsOk && embedded !== null) { unallocated.push({ what: 'embedded_transport', invoice_id: inv.id, invoice: inv.number, amount: embedded, why: 'a goods line on this invoice has no weight' }); flag('allocation_unresolved_missing_weight', inv, { what: 'transportation inside the price', amount: embedded }); }
  });

  // COSTS that belong to a RELEASE — split once across ALL goods on that release, by pounds
  var byRel = {};
  cells.forEach(function (c) { if (c.release) { (byRel[c.release] = byRel[c.release] || []).push(c); } });
  function spread(field, perRelease, statusField) {
    cells.forEach(function (c) { c[field] = c.release && perRelease && Object.prototype.hasOwnProperty.call(perRelease, c.release) ? 0 : (statusField ? null : 0); });
    Object.keys(byRel).forEach(function (rel) {
      if (!perRelease || !Object.prototype.hasOwnProperty.call(perRelease, rel)) { return; }
      var v = perRelease[rel]; if (v === null || v === undefined) { byRel[rel].forEach(function (c) { c[field] = null; }); return; }
      if (Number(v) !== 0 && !byRel[rel].every(function (c) { return c.pounds !== null && c.pounds > 0; })) {
        // not every product on this release has its pounds → nobody is charged yet; the amount is reported as unallocated
        byRel[rel].forEach(function (c) { c[field] = null; if (c.flags.indexOf('allocation_unresolved_missing_weight') < 0) { c.flags.push('allocation_unresolved_missing_weight'); } });
        unallocated.push({ what: field, release: rel, amount: r2(v), why: 'a product on this release has no weight' });
        flags.push({ kind: 'allocation_unresolved_missing_weight', release: rel, what: field, amount: r2(v) });
        return;
      }
      var parts = allocate(v, byRel[rel].map(function (c) { return c.pounds === null ? 0 : c.pounds; }));
      byRel[rel].forEach(function (c, ix) { c[field] = parts[ix]; });
    });
  }
  var outAmt = {}; var outKind = {};
  Object.keys(byRel).forEach(function (rel) {
    var o = (input.outbound || {})[rel];
    if (o && o.actual !== null && o.actual !== undefined) { outAmt[rel] = r2(o.actual); outKind[rel] = 'actual'; }
    else if (o && o.estimate !== null && o.estimate !== undefined && o.estimate !== '') { outAmt[rel] = r2(o.estimate); outKind[rel] = 'estimate'; } // an estimate is REPLACED by the bill, never added to it
    else { outAmt[rel] = null; outKind[rel] = 'unknown'; }
  });
  spread('outbound_cost', outAmt, true);
  spread('brokerage', input.brokerage || {}, false);
  spread('bonded', input.bonded || {}, false);

  cells.forEach(function (c) {
    c.outbound_kind = c.release ? outKind[c.release] : 'unknown';
    if (!c.release) { c.outbound_cost = null; }
    var cost = (c.pounds !== null && input.costOf) ? input.costOf({ id: c.invoice_id, date: c.invoice_date, releases: c.release ? [c.release] : [] }, c) : null;
    c.cost_method = cost ? cost.method : null; c.cost_sources = cost ? (cost.sources || []) : [];
    var costKnown = !!cost && cost.base_per_lb !== null && cost.base_per_lb !== undefined && Number(cost.base_per_lb) > 0 && !isNaN(Number(cost.commission_per_lb));
    c.base_cost_per_lb = costKnown ? r4(cost.base_per_lb) : null; c.commission_per_lb = costKnown ? r4(cost.commission_per_lb) : null;
    c.base_cost = costKnown && c.pounds !== null ? r2(c.pounds * cost.base_per_lb) : null;
    c.commission = costKnown && c.pounds !== null ? r2(c.pounds * cost.commission_per_lb) : null;
    c.missing_cost_lines = cost && cost.missing_cost_lines ? cost.missing_cost_lines : [];
    if (cost && cost.cost_unknown) { c.flags.push('purchase_line_without_cost'); }
    c.inbound_allowance = c.pounds !== null ? r2(c.pounds * INBOUND_ALLOWANCE_PER_LB) : null;
    if (c.base_cost === null) { c.flags.push('cost_missing'); }
    if (c.cost_method === 'manual') { c.flags.push('cost_manual'); }
    if (c.outbound_kind === 'unknown') { c.flags.push('outbound_bill_missing'); }
    if (c.outbound_kind === 'estimate') { c.flags.push('outbound_estimate'); }
    var known = cents(c.goods_revenue) + cents(c.transport_revenue) - cents(c.base_cost) - cents(c.commission) - cents(c.inbound_allowance) - cents(c.outbound_cost) - cents(c.brokerage) - cents(c.bonded);
    c.profit = money(known);
    // "Do not label a margin complete while required costs remain missing."
    c.complete = c.base_cost !== null && c.commission !== null && c.pounds !== null && c.pounds > 0 && c.outbound_kind === 'actual' && c.outbound_cost !== null &&
      c.goods_revenue !== null && c.transport_revenue !== null && c.brokerage !== null && c.bonded !== null && c.goods_price_confirmed && !!c.release &&
      c.flags.indexOf('allocation_unresolved_missing_weight') < 0 && c.flags.indexOf('purchase_line_without_cost') < 0;
    c.transport_profit = c.outbound_cost === null ? null : r2(c.transport_revenue - c.outbound_cost);
  });
  return { cells: cells, flags: flags, unallocated: unallocated };
}

// Sum cells by any key. Averages are ALWAYS total ÷ total pounds — never an average of averages.
var SUM_FIELDS = ['invoiced', 'goods_revenue', 'transport_revenue', 'base_cost', 'commission', 'inbound_allowance', 'outbound_cost', 'brokerage', 'bonded', 'profit'];
export function summarize(cells, keyFn, labelFn) {
  var map = {}; var order = [];
  (cells || []).forEach(function (c) {
    var k = keyFn(c);
    var row = map[k];
    if (!row) { row = map[k] = { key: k, label: labelFn ? labelFn(c) : k, pounds: 0, cells: 0, complete: true, weight_missing: false, unknown: {}, invoices: {}, releases: {}, names: {}, estimate: false }; SUM_FIELDS.forEach(function (f) { row[f] = 0; }); row._c = {}; SUM_FIELDS.forEach(function (f) { row._c[f] = 0; }); order.push(k); }
    row.cells++; if (c.pounds !== null && c.pounds > 0) { row.pounds += c.pounds; } else { row.weight_missing = true; }
    SUM_FIELDS.forEach(function (f) { if (c[f] === null || c[f] === undefined) { row.unknown[f] = true; } else { row._c[f] += cents(c[f]); } });
    if (!c.complete) { row.complete = false; }
    if (c.outbound_kind === 'estimate') { row.estimate = true; }
    row.invoices[c.invoice_id] = true; if (c.release) { row.releases[c.release] = true; }
    row.names[String(c.description || '').trim()] = true;
  });
  return order.map(function (k) {
    var row = map[k];
    SUM_FIELDS.forEach(function (f) { row[f] = money(row._c[f]); });
    delete row._c;
    row.pounds = Math.round(row.pounds * 1000) / 1000;
    // an average needs ALL of the revenue AND all of the pounds behind it; part of either = no average shown
    row.avg_goods_price_per_lb = row.pounds > 0 && !row.weight_missing && !row.unknown.goods_revenue ? r4(row.goods_revenue / row.pounds) : null;
    row.avg_base_cost_per_lb = row.pounds > 0 && !row.weight_missing && !row.unknown.base_cost ? r4(row.base_cost / row.pounds) : null;
    row.pounds_incomplete = row.weight_missing;
    // v55.83-TC (Max, Nov 16: "Avg Cost All / LB - adding the commission and inbound allowance") — goods cost + commission + inbound
    // allowance, ÷ pounds. Only when all three are fully known and every weight is there; otherwise no average is shown.
    row.avg_all_cost_per_lb = row.pounds > 0 && !row.weight_missing && !row.unknown.base_cost && !row.unknown.commission && !row.unknown.inbound_allowance ? r4((row.base_cost + row.commission + row.inbound_allowance) / row.pounds) : null;
    row.total_cost = r2(row.base_cost + row.commission + row.inbound_allowance + row.outbound_cost + row.brokerage + row.bonded);
    row.transport_profit = row.unknown.outbound_cost ? null : r2(row.transport_revenue - row.outbound_cost);
    row.invoice_count = Object.keys(row.invoices).length; row.release_list = Object.keys(row.releases).sort(); row.name_list = Object.keys(row.names).sort();
    delete row.invoices; delete row.releases; delete row.names;
    row.unknown_fields = Object.keys(row.unknown); delete row.unknown;
    return row;
  });
}

// Every total must trace back: the cells of any view add up to the same grand totals as the cells themselves.
export function reconcile(cells, rows) {
  var a = {}, b = {};
  SUM_FIELDS.forEach(function (f) { a[f] = 0; b[f] = 0; });
  (cells || []).forEach(function (c) { SUM_FIELDS.forEach(function (f) { a[f] += cents(c[f]); }); });
  (rows || []).forEach(function (r) { SUM_FIELDS.forEach(function (f) { b[f] += cents(r[f]); }); });
  var off = SUM_FIELDS.filter(function (f) { return a[f] !== b[f]; });
  return { ok: off.length === 0, off: off };
}
