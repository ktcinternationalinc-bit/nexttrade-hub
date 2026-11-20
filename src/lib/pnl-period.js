// v55.83-VL — Profitability → P&L by period (Max, Nov 19 2026: "we need a click in to see the breakdown of each month for each
// category" · "I need the goods profit and transport profit next to each other").
// Pure helpers over the SAME cells the period table adds up (one cell = one invoice line with its costs). Money is added in whole
// cents. A figure that is not known yet (null / undefined) is never treated as zero: it is counted in `missing` and left out.

function cents(x) { return Math.round(Number(x) * 100); }
function known(x) { return !(x === null || x === undefined || x === ''); }

// which period a date belongs to. g = 'week' | 'month' | 'quarter' | 'year'
export function bucketOf(d, g) {
  var s0 = String(d || '').substring(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(s0)) { return { key: 'zz', label: 'no date' }; }
  var yy = +s0.substring(0, 4); var mm = +s0.substring(5, 7); var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (g === 'year') { return { key: String(yy), label: String(yy) }; }
  if (g === 'quarter') { var qn = Math.floor((mm - 1) / 3) + 1; return { key: yy + '-Q' + qn, label: 'Q' + qn + ' ' + yy }; }
  if (g === 'month') { return { key: s0.substring(0, 7), label: MON[mm - 1] + ' ' + yy }; }
  var dt = new Date(Date.UTC(yy, mm - 1, +s0.substring(8, 10))); var back = (dt.getUTCDay() + 6) % 7; dt = new Date(dt.getTime() - back * 86400000);
  var k = dt.toISOString().substring(0, 10); return { key: k, label: 'Week of ' + MON[dt.getUTCMonth()] + ' ' + dt.getUTCDate() + ', ' + dt.getUTCFullYear() };
}

// v55.83-VT (Codex 12:06) — the row of the period table, added up in ONE tested place (it was inside the screen). Unchanged sums;
// new: combined_cost = the shipping amount kept as one combined figure (not divided into trucking / freight), so that
// transport charged − trucking − freight − combined = transport profit holds on the numbers shown.
export var PERIOD_FIELDS = ['goods_revenue', 'goods_cost', 'goods_profit', 'transport_revenue', 'trucking_cost', 'freight_cost', 'transport_profit', 'profit', 'uncounted_revenue'];
export function blankPeriodRow(key, label) { var r = { key: key, label: label, lines: 0, pounds: 0, incomplete: 0, uncounted: 0, combined_cost: 0, miss: {} }; PERIOD_FIELDS.forEach(function (f) { r[f] = 0; }); return r; }
export function addPeriodCell(row, c) {
  row.lines++; row.pounds += Number(c.pounds) || 0;
  var gc = [c.base_cost, c.commission, c.inbound_allowance, c.brokerage, c.bonded];
  var v = { goods_revenue: c.goods_revenue, goods_cost: gc.some(function (x) { return x === null || x === undefined; }) ? null : gc.reduce(function (s0, x) { return s0 + Number(x); }, 0), goods_profit: c.goods_profit,
    transport_revenue: c.transport_revenue, trucking_cost: c.trucking_cost, freight_cost: c.freight_cost, transport_profit: c.transport_profit, profit: c.profit, uncounted_revenue: c.uncounted_revenue || 0 };
  PERIOD_FIELDS.forEach(function (f) { if (v[f] === null || v[f] === undefined) { row.miss[f] = (row.miss[f] || 0) + 1; } else { row[f] += Math.round(Number(v[f]) * 100); } });
  if (known(c.shipping_combined_share)) { row.combined_cost += Math.round(Number(c.shipping_combined_share) * 100); }
  if (!c.complete) { row.incomplete++; }
  if (c.uncounted_lines) { row.uncounted++; }
  return row;
}
// total profit is ALWAYS goods profit + transport profit (each over the lines whose costs are known)
export function settlePeriodRow(r) { r.profit = r.goods_profit + r.transport_profit; return r; }

// the lines of the breakdown, in the order they are shown
var CATEGORIES = [
  { key: 'goods_revenue', label: 'Goods sold', group: 'goods', kind: 'in' },
  { key: 'base_cost', label: 'Cost of the goods (suppliers)', group: 'goods', kind: 'out' },
  { key: 'commission', label: 'Commission', group: 'goods', kind: 'out' },
  { key: 'inbound_allowance', label: 'Inbound allowance', group: 'goods', kind: 'out' },
  { key: 'brokerage', label: 'Brokerage', group: 'goods', kind: 'out' },
  { key: 'bonded', label: 'Bonded', group: 'goods', kind: 'out' },
  { key: 'goods_profit', label: 'GOODS PROFIT', group: 'goods', kind: 'profit' },
  { key: 'transport_revenue', label: 'Transport charged to customers', group: 'transport', kind: 'in' },
  { key: 'trucking_cost', label: 'Trucking (our cost)', group: 'transport', kind: 'out' },
  { key: 'freight_cost', label: 'Freight / shipping (our cost)', group: 'transport', kind: 'out' },
  { key: 'shipping_combined_share', label: 'Shipping kept as one combined amount (not divided)', group: 'transport', kind: 'out', optional: true },
  { key: 'transport_profit', label: 'TRANSPORT PROFIT', group: 'transport', kind: 'profit' }
];

// One period opened up. cells = the cells of that period (already filtered). Returns:
//   categories: one row per category — { key, label, group, kind, cents, missing, lines }
//   products / customers: [{ name, lines, pounds, goods_profit, transport_profit, profit, missing }] (cents), biggest profit first
//   total: { goods_profit, transport_profit, profit } (cents) — profit is ALWAYS goods profit + transport profit
//   hidden: true when the profit figures were not sent to this person (no permission) — then no profit is worked out at all
// forceHidden = the server said this person may not see profit (can_see_margin false): hidden even when there are no cells at all.
export function periodBreakdown(cells, forceHidden) {
  var list = cells || [];
  var hidden = forceHidden === true || list.some(function (c) { return c.goods_profit === undefined || c.profit === undefined; });
  var cats = CATEGORIES.map(function (d) {
    var row = { key: d.key, label: d.label, group: d.group, kind: d.kind, cents: 0, missing: 0, lines: 0 };
    list.forEach(function (c) { var v = c[d.key]; if (!known(v)) { if (!d.optional) { row.missing += 1; } return; } row.cents += cents(v); row.lines += 1; });
    if (hidden && d.kind === 'profit') { row.cents = null; }
    return row;
  }).filter(function (row) { var d0 = CATEGORIES.filter(function (x) { return x.key === row.key; })[0]; return !(d0.optional && row.cents === 0); });
  function group(field, fallback) {
    var by = {}; var order = [];
    list.forEach(function (c) {
      var name = String(c[field] || '').trim() || fallback;
      var r = by[name]; if (!r) { r = by[name] = { name: name, lines: 0, pounds: 0, goods_profit: 0, transport_profit: 0, profit: 0, missing: 0 }; order.push(name); }
      r.lines += 1; r.pounds += Number(c.pounds) || 0;
      if (known(c.goods_profit)) { r.goods_profit += cents(c.goods_profit); } else { r.missing += 1; }
      if (known(c.transport_profit)) { r.transport_profit += cents(c.transport_profit); } else { r.missing += 1; }
    });
    return order.map(function (n) { var r = by[n]; r.profit = r.goods_profit + r.transport_profit; if (hidden) { r.goods_profit = null; r.transport_profit = null; r.profit = null; } return r; })
      .sort(function (a, b) { return hidden ? b.pounds - a.pounds : ((b.profit - a.profit) || (a.name < b.name ? -1 : 1)); });
  }
  var gp = cats.filter(function (x) { return x.key === 'goods_profit'; })[0].cents; var tp = cats.filter(function (x) { return x.key === 'transport_profit'; })[0].cents;
  return { hidden: hidden, lines: list.length, pounds: list.reduce(function (a, c) { return a + (Number(c.pounds) || 0); }, 0), categories: cats,
    products: group('product', '(no product name)'), customers: group('customer', '(no customer)'),
    total: hidden ? { goods_profit: null, transport_profit: null, profit: null } : { goods_profit: gp, transport_profit: tp, profit: gp + tp } };
}

// v55.83-VQ (Max, Nov 19 2026: "when it says 26 lines not known yet ... it needs to be user-friendly. What does this mean? How do
// I go and fix it? ... you click on it and it takes you to those lines that are unknown that you can fix").
// The sale lines of a period whose profit cannot be counted yet, each with WHAT is missing in plain words, and the reasons
// grouped with HOW to fix them and which screen to open. Nothing is guessed: a line is listed only for a figure it really lacks.
var FIX = [
  { key: 'pounds', title: 'No weight', how: 'The unit on the invoice line has no pounds, so nothing can be worked out per pound. Set the pounds for that unit or product.', go: 'setup', goLabel: 'Open Set-up: names, units and supplier links' },
  { key: 'base_cost', title: 'No supplier cost', how: 'No supplier bill is linked to this product and no cost was typed for it. Link the supplier bill to the product, or type its cost per pound.', go: 'setup', goLabel: 'Open Set-up: names, units and supplier links' },
  { key: 'transport_revenue', title: 'Transport charged not known', how: 'The shipping terms of the invoice could not be worked out (for example a CNF price with no shipping amount). Open the invoice line and set its terms.', go: 'invoice', goLabel: 'Open By invoice' },
  { key: 'trucking_cost', title: 'Trucking cost not known', how: 'There is no trucking bill and no estimate for the release of this sale. Enter the estimate, or attach the bill to the release.', go: 'containers', goLabel: 'Open Containers (shipping cost)' },
  { key: 'freight_cost', title: 'Freight cost not known', how: 'There is no freight / shipping bill and no estimate for the release of this sale. Enter the estimate, or attach the bill to the release.', go: 'containers', goLabel: 'Open Containers (shipping cost)' },
  { key: 'other', title: 'Not complete', how: 'Something else on this line is missing. Open the invoice to see what.', go: 'invoice', goLabel: 'Open By invoice' }
];
export function linesToFix(cells, forceHidden) {
  var list = cells || [];
  if (forceHidden === true || list.some(function (c) { return c.goods_profit === undefined || c.profit === undefined; })) { return { hidden: true, rows: [], reasons: [], total: list.length }; }
  var count = {}; var rows = [];
  list.forEach(function (c) {
    var miss = [];
    if (!known(c.pounds)) { miss.push('pounds'); } else if (!known(c.base_cost)) { miss.push('base_cost'); }
    if (!known(c.transport_revenue)) { miss.push('transport_revenue'); }
    var comb = known(c.shipping_total_unsplit); // v55.83-VS — a combined transportation cost is known money: its parts are not "missing"
    if (!known(c.trucking_cost) && !comb) { miss.push('trucking_cost'); }
    if (!known(c.freight_cost) && !comb) { miss.push('freight_cost'); }
    if (!miss.length && (!known(c.goods_profit) || !known(c.transport_profit))) { miss.push('other'); }
    if (!miss.length) { return; }
    miss.forEach(function (k) { count[k] = (count[k] || 0) + 1; });
    rows.push({ invoice_id: c.invoice_id || null, invoice: c.invoice || '', invoice_date: c.invoice_date || '', customer: c.customer || '', product: c.product || c.description || '', release: c.release_raw || c.release || '',
      sold_for: known(c.goods_revenue) ? Number(c.goods_revenue) : null, missing: miss, missing_text: miss.map(function (k) { return FIX.filter(function (f) { return f.key === k; })[0].title; }).join(' · ') });
  });
  rows.sort(function (a, b) { return (b.sold_for || 0) - (a.sold_for || 0); });
  return { hidden: false, total: list.length, rows: rows, reasons: FIX.filter(function (f) { return count[f.key]; }).map(function (f) { return { key: f.key, title: f.title, how: f.how, go: f.go, goLabel: f.goLabel, count: count[f.key] }; }) };
}

// v55.83-VS (Max, Nov 20: "needs MUCH more clarity on what to fix exactly. manual is accepted unless bill overturns it. but needs
// more user friendly to resolve and to update after resolved" · "it needs to be clear as to what remains open") — the same missing
// figures as linesToFix, but as a short list of THINGS TO DO: one row per release (shipping), per product (weight / supplier cost)
// or per invoice (no release number, terms). A shipping figure that exists — a bill, a typed figure or an estimate, also 0 — is
// known and is never listed; only a part with nothing at all is open.
export function openTasks(cells, forceHidden) {
  var list = cells || [];
  if (forceHidden === true || list.some(function (c) { return c.goods_profit === undefined || c.profit === undefined; })) { return { hidden: true, tasks: [], lines: 0, combined: [] }; }
  var map = {}; var order = []; var lineSet = {}; var combined = {}; var combinedList = [];
  function add(key, base, c, i) {
    var t = map[key]; if (!t) { t = map[key] = Object.assign({ key: key, lines: 0, sold_for: 0, invoices: [], _inv: {}, _seen: {} }, base); order.push(key); }
    if (t._seen[i]) { return; } t._seen[i] = true;
    t.lines++; t.sold_for += known(c.goods_revenue) ? Number(c.goods_revenue) : 0; lineSet[i] = true;
    var iv = String(c.invoice || ''); if (iv && !t._inv[iv]) { t._inv[iv] = true; t.invoices.push({ invoice: iv, invoice_id: c.invoice_id || null }); }
  }
  list.forEach(function (c, i) {
    var rel = String(c.release_raw || c.release || ''); var prod = String(c.product || c.description || '(no product name)'); var inv = String(c.invoice || '');
    if (!known(c.pounds)) { add('pounds:' + prod, { kind: 'pounds', action: 'unit', product: prod, names: [String(c.description || prod)], title: prod + ' — no weight', how: 'The Hub does not know what “' + String(c.description || prod) + '” is sold in, so nothing can be worked out per pound. Pick its unit here.' }, c, i); if (map['pounds:' + prod].names.indexOf(String(c.description || prod)) < 0) { map['pounds:' + prod].names.push(String(c.description || prod)); } }
    else if (!known(c.base_cost)) { add('base_cost:' + prod, { kind: 'base_cost', action: c.group_id ? 'cost' : 'setup', product: prod, group_id: c.group_id || null, title: prod + ' — no supplier cost', how: c.group_id ? 'No supplier bill is linked to this product and no cost is typed for it. Type what it costs us per POUND here (used until a supplier bill is linked to it).' : 'This description is not under a product yet, so it has no cost. In Set-up, tick it and put it under a product; then its cost can be typed.' }, c, i); }
    if (!known(c.transport_revenue)) { add('terms:' + inv, { kind: 'transport_revenue', action: 'open_invoice', invoice: inv, invoice_id: c.invoice_id || null, title: 'Invoice ' + inv + ' — the shipping charged cannot be worked out', how: 'Either the shipping terms of the invoice are not set (for example a CNF price with no shipping amount), or a goods line on it has no weight to share the shipping by. Open its row in By invoice: set the terms, and check every line has a unit.' }, c, i); }
    var noT = !known(c.trucking_cost); var noF = !known(c.freight_cost);
    // Codex 07:00 — a null share is NOT proof that the money is missing. The source decides what the row says and whether typing
    // is offered: typing is offered ONLY when the release has no bill, no typed figure, no estimate and no single total.
    var splitMissing = (c.flags || []).indexOf('release_split_missing') >= 0;
    if ((noT || noF) && !rel && splitMissing) { add('relsplit:' + inv, { kind: 'release_split', action: 'open_invoice', invoice: inv, invoice_id: c.invoice_id || null, title: 'Invoice ' + inv + ' — on ' + (c.releases_on_invoice || 'several') + ' releases, pounds not divided between them', how: 'The release numbers on the invoice are right — leave them. Open its row in By invoice and type how many pounds went on each release; then each release’s shipping cost can be shared.' }, c, i); }
    else if ((noT || noF) && !rel) { add('norelease:' + inv, { kind: 'no_release', action: 'open_invoice', invoice: inv, invoice_id: c.invoice_id || null, title: 'Invoice ' + inv + ' — no release number', how: 'Without a release number its trucking and freight cannot be found. Open the invoice and put the release number on it. If it is a test invoice, void it.' }, c, i); }
    // Max to Codex, Nov 20 — a combined transportation cost is KNOWN: it is used as it is, nobody has to divide it, and it is
    // not a thing to fix. It is only counted for the grey note under the list.
    else if ((noT || noF) && known(c.shipping_total_unsplit)) { if (!combined[rel]) { combined[rel] = true; combinedList.push({ release: rel, amount: Number(c.shipping_total_unsplit) }); } }
    else {
      [['trucking', noT, c.trucking_kind, c.trucking_from], ['freight', noF, c.freight_kind, c.freight_from]].forEach(function (x) {
        if (!x[1]) { return; }
        if (x[2]) { var wb = (c.weight_blockers || []); var wn = wb.map(function (b) { return '“' + b.name + '”' + (b.invoice ? ' (invoice ' + b.invoice + ')' : (b.older ? ' (on an older invoice of this release)' : '')); }).join(', ');
          add('alloc:' + rel, { kind: 'not_shared', action: wb.length ? 'unit' : 'setup', release: rel, names: wb.map(function (b) { return b.name; }), blockers: wb, title: 'Release ' + rel + ' — its shipping cost is known, but cannot be shared between its sale lines', how: 'The trucking / freight figure is already there — do not type it again. It is shared by pounds, and ' + (wb.length ? wn + ' on this release has no unit, so its pounds are not known. Pick the unit here.' : 'a product on this release has no weight. Give that product its unit in Set-up.') }, c, i); return; }
        add(x[0] + ':' + rel, { kind: x[0], action: 'type', part: x[0], release: rel, title: 'Release ' + rel + ' — no ' + x[0] + ' cost', how: 'There is no ' + (x[0] === 'trucking' ? 'trucking' : 'freight / shipping') + ' bill, no typed figure and no estimate for this release. Type the ' + x[0] + ' cost here — type 0 if there was none. A ' + x[0] + ' bill for this release replaces it when it arrives.' }, c, i);
      });
    }
    if (!lineSet[i] && (!known(c.goods_profit) || !known(c.transport_profit))) { add('other:' + inv, { kind: 'other', action: 'open_invoice', invoice: inv, invoice_id: c.invoice_id || null, title: 'Invoice ' + inv + ' — not complete', how: 'Something else on this invoice is missing. Open it to see what.' }, c, i); }
  });
  var RANK = { trucking: 1, freight: 1, no_release: 2, release_split: 2, not_shared: 3, base_cost: 3, pounds: 3, transport_revenue: 4, unsplit_total: 5, other: 6 };
  var tasks = order.map(function (k) { var t = map[k]; delete t._inv; delete t._seen; return t; }).sort(function (a, b) { return (RANK[a.kind] - RANK[b.kind]) || (b.sold_for - a.sold_for) || (a.key < b.key ? -1 : 1); });
  return { hidden: false, tasks: tasks, lines: Object.keys(lineSet).length, combined: combinedList };
}

// v55.83-VQ (Codex 22:20) — EVERY period between two dates, also the ones with no sales (a month with rent and payroll but no
// invoice is still a month of the P&L). [{ key, label }] in date order; empty when either date is missing or they are reversed.
export function bucketsBetween(from, to, g) {
  var a = String(from || '').substring(0, 10); var b = String(to || '').substring(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b) || a > b) { return []; }
  var out = []; var seen = {}; var t = Date.parse(a + 'T00:00:00Z'); var end = Date.parse(b + 'T00:00:00Z'); var guard = 0;
  while (t <= end && guard < 40000) { var bk = bucketOf(new Date(t).toISOString().substring(0, 10), g); if (!seen[bk.key]) { seen[bk.key] = true; out.push(bk); } t += 86400000; guard += 1; }
  return out;
}
