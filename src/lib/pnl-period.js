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
export function blankPeriodRow(key, label) { var r = { key: key, label: label, lines: 0, pounds: 0, yards: 0, gp_lb: 0, gp_yd: 0, lb_lines: 0, yd_lines: 0, lb_missing: 0, yd_missing: 0, incomplete: 0, uncounted: 0, combined_cost: 0, miss: {},
    // Codex 12:11 — what the two profit figures were ACTUALLY made of: only the lines whose profit is known (`used`), and the
    // revenue of the lines left out because a cost is not known yet (`excl`), per side — never one combined figure for both
    used: { goods_lines: 0, goods_revenue: 0, goods_cost: 0, transport_lines: 0, transport_revenue: 0, trucking: 0, freight: 0, other: 0, combined: 0 }, excl: { goods_lines: 0, goods_revenue: 0, transport_lines: 0, transport_revenue: 0 } };
  PERIOD_FIELDS.forEach(function (f) { r[f] = 0; }); return r; }
export function addPeriodCell(row, c) {
  row.lines++; if (c.keep_unit === true) { row.yards += Number(c.sold_yards) || 0; } else { row.pounds += Number(c.pounds) || 0; } // v55.83-VX — kept-in-yards goods are counted in yards, never as pounds
  // v55.83-WK — goods profit of the pound lines and of the yard lines, apart. (Codex 18:46) and how many lines of each unit have NO
  // known profit or no quantity: an average per unit is shown only when that unit's bucket is complete — never known profit ÷ all quantity.
  var isYd = c.keep_unit === true; var qtyOk = isYd ? (Number(c.sold_yards) > 0) : (Number(c.pounds) > 0);
  if (isYd) { row.yd_lines++; } else { row.lb_lines++; }
  if (known(c.goods_profit) && qtyOk) { if (isYd) { row.gp_yd += Math.round(Number(c.goods_profit) * 100); } else { row.gp_lb += Math.round(Number(c.goods_profit) * 100); } }
  else if (isYd) { row.yd_missing++; } else { row.lb_missing++; }
  var gc = [c.base_cost, c.commission, c.inbound_allowance, c.brokerage, c.bonded];
  var v = { goods_revenue: c.goods_revenue, goods_cost: gc.some(function (x) { return x === null || x === undefined; }) ? null : gc.reduce(function (s0, x) { return s0 + Number(x); }, 0), goods_profit: c.goods_profit,
    transport_revenue: c.transport_revenue, trucking_cost: c.trucking_cost, freight_cost: c.freight_cost, transport_profit: c.transport_profit, profit: c.profit, uncounted_revenue: c.uncounted_revenue || 0 };
  PERIOD_FIELDS.forEach(function (f) { if (v[f] === null || v[f] === undefined) { row.miss[f] = (row.miss[f] || 0) + 1; } else { row[f] += Math.round(Number(v[f]) * 100); } });
  if (known(c.shipping_combined_share)) { row.combined_cost += Math.round(Number(c.shipping_combined_share) * 100); }
  function cz(x) { return known(x) ? Math.round(Number(x) * 100) : 0; }
  if (row.used) {
    if (known(c.goods_profit)) { row.used.goods_lines++; row.used.goods_revenue += cz(c.goods_revenue); row.used.goods_cost += cz(c.goods_revenue) - cz(c.goods_profit); }
    else { row.excl.goods_lines++; row.excl.goods_revenue += cz(c.goods_revenue); }
    if (known(c.transport_profit)) { var tk = cz(c.trucking_cost); var fr = cz(c.freight_cost); row.used.transport_lines++; row.used.transport_revenue += cz(c.transport_revenue); var ot = cz(c.shipping_other); row.used.trucking += tk; row.used.freight += fr; row.used.other += ot; row.used.combined += cz(c.transport_revenue) - cz(c.transport_profit) - tk - fr - ot; }
    else { row.excl.transport_lines++; row.excl.transport_revenue += cz(c.transport_revenue); }
  }
  if (!c.complete) { row.incomplete++; }
  if (c.uncounted_lines) { row.uncounted++; }
  return row;
}
// "Avg profit" of a period row, per unit: dollars per pound over the pound lines, dollars per yard over the yard lines. A unit's
// figure is null unless EVERY line of that unit has a known goods profit and a quantity (a genuine zero profit is 0, not null).
export function avgProfitPerUnit(row) {
  var r = row || {};
  var lb = (r.lb_lines > 0 && !(r.lb_missing > 0) && r.pounds > 0) ? r.gp_lb / 100 / r.pounds : null;
  var yd = (r.yd_lines > 0 && !(r.yd_missing > 0) && r.yards > 0) ? r.gp_yd / 100 / r.yards : null;
  return { lb: lb, yd: yd, lb_lines: r.lb_lines || 0, yd_lines: r.yd_lines || 0, lb_missing: r.lb_missing || 0, yd_missing: r.yd_missing || 0 };
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
  { key: 'shipping_other', label: 'Other shipping costs (typed on the invoice)', group: 'transport', kind: 'out', optional: true },
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
      var r = by[name]; if (!r) { r = by[name] = { name: name, lines: 0, pounds: 0, yards: 0, goods_profit: 0, transport_profit: 0, profit: 0, missing: 0 }; order.push(name); }
      r.lines += 1; if (c.keep_unit === true) { r.yards += Number(c.sold_yards) || 0; } else { r.pounds += Number(c.pounds) || 0; }
      if (known(c.goods_profit)) { r.goods_profit += cents(c.goods_profit); } else { r.missing += 1; }
      if (known(c.transport_profit)) { r.transport_profit += cents(c.transport_profit); } else { r.missing += 1; }
    });
    return order.map(function (n) { var r = by[n]; r.profit = r.goods_profit + r.transport_profit; if (hidden) { r.goods_profit = null; r.transport_profit = null; r.profit = null; } return r; })
      .sort(function (a, b) { return hidden ? b.pounds - a.pounds : ((b.profit - a.profit) || (a.name < b.name ? -1 : 1)); });
  }
  var gp = cats.filter(function (x) { return x.key === 'goods_profit'; })[0].cents; var tp = cats.filter(function (x) { return x.key === 'transport_profit'; })[0].cents;
  return { hidden: hidden, lines: list.length, pounds: list.reduce(function (a, c) { return a + (c.keep_unit === true ? 0 : (Number(c.pounds) || 0)); }, 0), yards: list.reduce(function (a, c) { return a + (c.keep_unit === true ? (Number(c.sold_yards) || 0) : 0); }, 0), categories: cats,
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
// v55.83-XK — opts.revenueHidden: the server removed revenue (and profit) for this person (a RESEARCHER, answer.revenue_hidden).
// Passed by the screen from the server's own answer — never guessed from missing fields.
function revenueRemoved(opts) { return !!(opts && opts.revenueHidden === true); }
export function linesToFix(cells, forceHidden, opts) {
  var list = cells || []; var revX = revenueRemoved(opts);
  if (forceHidden === true || (!revX && list.some(function (c) { return c.goods_profit === undefined || c.profit === undefined; }))) { return { hidden: true, rows: [], reasons: [], total: list.length }; }
  var count = {}; var rows = [];
  list.forEach(function (c, ci) {
    var miss = [];
    if (!known(c.pounds)) { miss.push('pounds'); } else if (!known(c.base_cost)) { miss.push('base_cost'); }
    if (!revX && !known(c.transport_revenue)) { miss.push('transport_revenue'); }
    var comb = known(c.shipping_total_unsplit); // v55.83-VS — a combined transportation cost is known money: its parts are not "missing"
    if (!known(c.trucking_cost) && !comb) { miss.push('trucking_cost'); }
    if (!known(c.freight_cost) && !comb) { miss.push('freight_cost'); }
    if (!revX && !miss.length && (!known(c.goods_profit) || !known(c.transport_profit))) { miss.push('other'); }
    if (!miss.length) { return; }
    miss.forEach(function (k) { count[k] = (count[k] || 0) + 1; });
    rows.push({ idx: ci, invoice_id: c.invoice_id || null, invoice: c.invoice || '', invoice_date: c.invoice_date || '', customer: c.customer || '', product: c.product || c.description || '', release: c.release_raw || c.release || '',
      sold_for: !revX && known(c.goods_revenue) ? Number(c.goods_revenue) : null, missing: miss, missing_text: miss.map(function (k) { return FIX.filter(function (f) { return f.key === k; })[0].title; }).join(' · ') });
  });
  rows.sort(function (a, b) { return (b.sold_for || 0) - (a.sold_for || 0); });
  return { hidden: false, revenue_hidden: revX || undefined, total: list.length, rows: rows, reasons: FIX.filter(function (f) { return count[f.key]; }).map(function (f) { return { key: f.key, title: f.title, how: f.how, go: f.go, goLabel: f.goLabel, count: count[f.key] }; }) };
}

// v55.83-VS (Max, Nov 20: "needs MUCH more clarity on what to fix exactly. manual is accepted unless bill overturns it. but needs
// more user friendly to resolve and to update after resolved" · "it needs to be clear as to what remains open") — the same missing
// figures as linesToFix, but as a short list of THINGS TO DO: one row per release (shipping), per product (weight / supplier cost)
// or per invoice (no release number, terms). A shipping figure that exists — a bill, a typed figure or an estimate, also 0 — is
// known and is never listed; only a part with nothing at all is open.
var FIX_LABEL = { trucking: 'No trucking cost for the release', freight: 'No freight cost for the release', not_shared: 'Shipping cost is there, but not shared yet: a product on the release has no unit', no_release: 'No release number on the invoice', release_split: 'Pounds not divided between the releases', pounds: 'No weight: unit not set', base_cost: 'No supplier cost', transport_revenue: 'Shipping charged cannot be worked out', other: 'Not complete' };
export function openTasks(cells, forceHidden, opts) {
  var list = cells || []; var revX = revenueRemoved(opts);
  if (forceHidden === true || (!revX && list.some(function (c) { return c.goods_profit === undefined || c.profit === undefined; }))) { return { hidden: true, tasks: [], lines: 0, combined: [] }; }
  var map = {}; var order = []; var lineSet = {}; var combined = {}; var combinedList = [];
  // v55.83-ZN — invoice → its goods descriptions with no weight. In the engine (profitability.js) that is the ONLY reason the
  // shipping charged on an invoice cannot be shared between its lines, so the terms row names them instead of guessing "either … or".
  var noWeight = {};
  list.forEach(function (c) { if (known(c.pounds)) { return; } var iv0 = String(c.invoice || ''); var nm0 = String(c.description || c.product || '(no product name)'); var arr = noWeight[iv0] || (noWeight[iv0] = []); if (!arr.some(function (b) { return b.name === nm0; })) { arr.push({ name: nm0, task: 'pounds:' + String(c.product || c.description || '(no product name)') }); } });
  function add(key, base, c, i) {
    var t = map[key]; if (!t) { t = map[key] = Object.assign({ key: key, lines: 0, sold_for: 0, invoices: [], _inv: {}, _seen: {} }, base); order.push(key); }
    if (t._seen[i]) { return; } t._seen[i] = true;
    t.lines++; if (revX) { t.sold_for = null; } else { t.sold_for += known(c.goods_revenue) ? Number(c.goods_revenue) : 0; } lineSet[i] = true;
    if (known(c.transport_revenue)) { t.charged = (t.charged || 0) + Number(c.transport_revenue); } // v55.83-WE — what the customer is charged for shipping on these lines
    var iv = String(c.invoice || ''); if (iv && !t._inv[iv]) { t._inv[iv] = true; t.invoices.push({ invoice: iv, invoice_id: c.invoice_id || null }); }
  }
  list.forEach(function (c, i) {
    var rel = String(c.release_raw || c.release || ''); var prod = String(c.product || c.description || '(no product name)'); var inv = String(c.invoice || '');
    if (!known(c.pounds)) { add('pounds:' + prod, { kind: 'pounds', action: 'unit', product: prod, names: [String(c.description || prod)], title: prod + ' — no weight', how: 'The Hub does not know what “' + String(c.description || prod) + '” is sold in, so nothing can be worked out per pound. Pick its unit here.' }, c, i); if (map['pounds:' + prod].names.indexOf(String(c.description || prod)) < 0) { map['pounds:' + prod].names.push(String(c.description || prod)); } }
    else if (!known(c.base_cost)) { add('base_cost:' + prod, { kind: 'base_cost', action: c.group_id ? 'cost' : 'setup', product: prod, group_id: c.group_id || null, title: prod + ' — no supplier cost', how: c.group_id ? 'No supplier bill is linked to this product and no cost is typed for it. Type what it costs us per POUND here (used until a supplier bill is linked to it).' : 'This description is not under a product yet, so it has no cost. In Set-up, tick it and put it under a product; then its cost can be typed.' }, c, i); var bt = map['base_cost:' + prod]; if (c.keep_unit === true) { bt.yd_lines = (bt.yd_lines || 0) + 1; } else { bt.lb_lines = (bt.lb_lines || 0) + 1; } }
    if (!revX && !known(c.transport_revenue)) { add('terms:' + inv, { kind: 'transport_revenue', action: 'open_invoice', invoice: inv, invoice_id: c.invoice_id || null, blockers: noWeight[inv] || [], title: 'Invoice ' + inv + ' — the shipping charged cannot be worked out', how: 'Either the shipping terms of the invoice are not set (for example a CNF price with no shipping amount), or a goods line on it has no weight to share the shipping by. Open its row in By invoice: set the terms, and check every line has a unit.' }, c, i); }
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
        add(x[0] + ':' + rel, { kind: x[0], action: 'type', part: x[0], release: rel, title: 'Release ' + rel + ' — no ' + x[0] + ' cost', how: 'This asks what the ' + (x[0] === 'trucking' ? 'trucking' : 'freight / shipping') + ' COST US (not what the invoice charges the customer). There is no bill, no typed figure and no estimate for this release. Type it here — 0 if there was none — or open the invoice: if the customer arranges the shipping, choose EXW there and this is no longer asked. A bill for this release replaces a typed figure when it arrives.' }, c, i);
      });
    }
    if (!lineSet[i] && (!known(c.goods_profit) || !known(c.transport_profit))) { add('other:' + inv, { kind: 'other', action: 'open_invoice', invoice: inv, invoice_id: c.invoice_id || null, title: 'Invoice ' + inv + ' — not complete', how: 'Something else on this invoice is missing. Open it to see what.' }, c, i); }
  });
  var RANK = { trucking: 1, freight: 1, no_release: 2, release_split: 2, not_shared: 3, base_cost: 3, pounds: 3, transport_revenue: 4, unsplit_total: 5, other: 6 };
  var tasks = order.map(function (k) { return map[k]; }).sort(function (a, b) { return (RANK[a.kind] - RANK[b.kind]) || (b.sold_for - a.sold_for) || (a.key < b.key ? -1 : 1); });
  // v55.83-WN (Max, Nov 20: "it says it's missing shipping, but ... it's not missing ... something I click on and it takes me where
  // I'm supposed to go") — for every sale line, the numbered things above that it is waiting for, in the SAME words: by_line[cell
  // index] = [{ n (its number in the list), key, kind, label }]. A shipping cost that is there but not shared is never "not known".
  // WN — a product whose open lines are ALL kept in yards is costed per YARD, never asked per pound
  tasks.forEach(function (t) { if (t.kind !== 'base_cost') { return; } var allYd = t.yd_lines > 0 && !(t.lb_lines > 0); delete t.yd_lines; delete t.lb_lines;
    if (allYd && t.group_id) { t.cost_unit = 'sold_unit'; t.how = 'No supplier bill is linked to this product and no cost is typed for it. These goods are kept in YARDS, so type what it costs us per YARD here (used until a supplier bill is linked to it).'; } else { t.cost_unit = 'lb'; } });
  var byLine = {};
  tasks.forEach(function (t, n) { Object.keys(t._seen).forEach(function (i) { (byLine[i] || (byLine[i] = [])).push({ n: n + 1, key: t.key, kind: t.kind, label: FIX_LABEL[t.kind] || 'Not complete' }); }); delete t._inv; delete t._seen; });
  var numOf = {}; tasks.forEach(function (t, n) { numOf[t.key] = n + 1; });
  tasks.forEach(function (t) { explainTask(t, numOf); });
  return { hidden: false, tasks: tasks, lines: Object.keys(lineSet).length, combined: combinedList, by_line: byLine };
}

// v55.83-ZN (Max, 26 Nov: "message are not clear ... it needs to be so user friendly and so clear and concise and takes you right to
// the place to change it with direction and then a back button") — every row of the fix list gets:
//   what   one sentence: what is wrong (the real case, worked out — never "either … or")
//   todo   one sentence: exactly what to do
//   fix    the ONE place where it is fixed: { go: 'unit' | 'names' | 'link' | 'invoice' | 'invoice_row', label (the button), direction
//          (the line of direction shown THERE), name / group_id / invoice_id }
//   suggest a unit read from the description itself ("… BY KGs" → kilos), offered as a one-click "Yes"; only when the name says ONE unit
//   how    = what + ' ' + todo (older screens and the CSV keep working)
// v55.83-ZN (Max, 26 Nov, the "How Jun 2026 is worked out" pop-up: "these orange buttons have no real use … we need to have clarity
// here") — for the two NOT USED lines of the pop-up (goods with no cost yet, transport with no shipping cost yet): how many lines,
// which rows of the fix list they wait for, and in one sentence what fixing means. cells = the period's cells; ot = openTasks(cells).
// Up to 3 lines are listed one by one (invoice · release · product · what is missing) so a small row can be fixed right there.
var MEANS = {
  pounds: function (k) { return 'give ' + k + ' product' + (k === 1 ? '' : 's') + ' a unit'; },
  base_cost: function (k) { return 'link a supplier bill or type a cost for ' + k + ' product' + (k === 1 ? '' : 's'); },
  ship: function (k) { return 'type the trucking / freight cost of ' + k + ' release' + (k === 1 ? '' : 's') + ' (0 if there was none)'; },
  not_shared: function (k) { return 'give a unit to the product on ' + k + ' release' + (k === 1 ? '' : 's'); },
  transport_revenue: function (k) { return 'sort out the shipping charged on ' + k + ' invoice' + (k === 1 ? '' : 's'); },
  no_release: function (k) { return 'put the release number on ' + k + ' invoice' + (k === 1 ? '' : 's'); },
  release_split: function (k) { return 'divide the pounds between the releases of ' + k + ' invoice' + (k === 1 ? '' : 's'); },
  other: function (k) { return 'complete ' + k + ' invoice' + (k === 1 ? '' : 's'); }
};
export function formulaFixes(cells, ot) {
  var list = cells || []; var tasks = (ot && ot.tasks) || []; var byLine = (ot && ot.by_line) || {};
  var byKey = {}; tasks.forEach(function (t, n) { byKey[t.key] = { t: t, n: n + 1 }; });
  function side(test) {
    var idx = []; list.forEach(function (c, i) { if (test(c)) { idx.push(i); } });
    var seen = {}; var mine = [];
    idx.forEach(function (i) { (byLine[i] || []).forEach(function (f) { if (!seen[f.key] && byKey[f.key]) { seen[f.key] = true; mine.push(byKey[f.key]); } }); });
    var cnt = {}; mine.forEach(function (x) { var k = (x.t.kind === 'trucking' || x.t.kind === 'freight') ? 'ship:' + (x.t.release || '') : x.t.kind + ':' + x.t.key; var g = k.split(':')[0]; (cnt[g] || (cnt[g] = {}))[k] = true; });
    var parts = ['pounds', 'base_cost', 'ship', 'not_shared', 'transport_revenue', 'no_release', 'release_split', 'other'].filter(function (g) { return cnt[g]; }).map(function (g) { return MEANS[g](Object.keys(cnt[g]).length); });
    var lines = idx.length > 3 ? [] : idx.map(function (i) { var c = list[i]; var fx = (byLine[i] || []).filter(function (f) { return !!byKey[f.key]; });
      return { invoice: c.invoice || '', invoice_id: c.invoice_id || null, release: c.release_raw || c.release || '', product: c.product || c.description || '', missing: fx.map(function (f) { return f.label; }).join(' · '), task: fx.length ? byKey[fx[0].key].t : null, n: fx.length ? fx[0].n : null }; });
    return { count: idx.length, tasks: mine.map(function (x) { return x.t; }), means: parts.length ? 'Fixing means: ' + parts.join('; ') + '.' : '', lines: lines };
  }
  return {
    goods: side(function (c) { return !known(c.goods_profit); }), // the same test as addPeriodCell row.excl, so the counts match the pop-up
    transport: side(function (c) { return !known(c.transport_profit); })
  };
}

export var UNIT_NAME = { lb: 'pounds', kg: 'kilos', t: 'tons', yd: 'yards', lm: 'linear metres' };
var UNIT_IN_NAME = [
  ['kg', /(^|[^A-Z])(KGS?|KILOS?|KILOGRAMS?|KILOGRAMMES?)([^A-Z]|$)/i],
  ['lb', /(^|[^A-Z])(LBS?|POUNDS?)([^A-Z]|$)/i],
  ['t', /(^|[^A-Z])(TONS?|TONNES?|MT)([^A-Z]|$)/i],
  ['yd', /(^|[^A-Z])(YDS?|YARDS?)([^A-Z]|$)/i],
  ['lm', /(^|[^A-Z])(LM|LINEAR ?M(ETRES?|ETERS?)?)([^A-Z]|$)/i]
];
export function unitFromName(name) {
  var s = String(name || ''); var hits = UNIT_IN_NAME.filter(function (u) { return u[1].test(s); });
  return hits.length === 1 ? hits[0][0] : null;
}
function q(s) { return '“' + String(s || '') + '”'; }
function shortName(s) { var x = String(s || ''); return x.length > 34 ? x.substring(0, 32) + '…' : x; }
function unitDirection(name) { return 'Pick what ' + q(name) + ' is sold in from the highlighted box: pounds, kilos, tons, yards or linear metres. It is saved as soon as you pick.'; }
function unitFix(name, label) { return { go: 'unit', name: name, label: label || 'Set its unit →', direction: unitDirection(name) }; }
function sugOf(name) { var u = unitFromName(name); return u ? { unit: u, words: UNIT_NAME[u], name: name } : null; }
function explainTask(t, numOf) {
  var inv = t.invoice || ''; var rel = t.release || '';
  if (t.kind === 'pounds') {
    var names = t.names || [t.product]; var n1 = names[0]; var many = names.length > 1;
    t.suggest = many ? null : sugOf(n1);
    t.what = many ? names.length + ' descriptions of ' + q(t.product) + ' have no unit (' + names.map(q).join(', ') + '), so the Hub cannot work out their weight or profit.' : q(n1) + ' has no unit, so the Hub cannot work out its weight or profit.';
    t.todo = t.suggest ? 'Its name says it is sold in ' + t.suggest.words + ': click “Yes, ' + t.suggest.words + '” to save that, or set another unit in Set-up.' : 'Set what ' + (many ? 'each is' : 'it is') + ' sold in (pounds, kilos, tons, yards or linear metres) in Set-up.';
    t.fix = many ? { go: 'names', name: t.product, label: 'Set their units →', direction: 'The descriptions of ' + q(t.product) + ' are listed; pick the unit of each one marked “⚠ not set”. Each is saved as soon as you pick.' } : unitFix(n1);
  } else if (t.kind === 'transport_revenue') {
    var b = t.blockers || [];
    if (b.length) {
      var nb = numOf[b[0].task];
      t.suggest = sugOf(b[0].name); t.after = nb || null;
      t.what = 'Invoice ' + inv + ' charges shipping, but it cannot be shared between its goods lines because ' + q(b[0].name) + (b.length > 1 ? ' and ' + (b.length - 1) + ' other line(s)' : '') + ' has no unit, so its weight is not known.';
      t.todo = 'Give ' + q(b[0].name) + ' its unit' + (nb ? ' (number ' + nb + ' in this list)' : '') + ' — this row then clears by itself. Nothing needs changing on the invoice.';
      t.fix = unitFix(b[0].name, 'Set the unit of ' + q(shortName(b[0].name)) + ' →');
    } else {
      t.what = 'The shipping charged on invoice ' + inv + ' cannot be worked out.';
      t.todo = 'Open the invoice and check its shipping terms (EXW / CNF) and its shipping amount, then save it.';
      t.fix = { go: 'invoice', invoice_id: t.invoice_id || null, label: 'Open invoice ' + inv + ' →', direction: 'Check the shipping terms (EXW / CNF) and the shipping amount at the top of the invoice, then save it.' };
    }
  } else if (t.kind === 'trucking' || t.kind === 'freight') {
    var pw = t.kind === 'trucking' ? 'trucking' : 'freight / shipping';
    t.what = 'Release ' + rel + ' has no ' + pw + ' cost: no bill, no typed figure and no estimate.';
    t.todo = 'This asks what the ' + pw + ' COST US (not what the invoice charges the customer). Type it here — 0 if there was none — or, if the customer arranges the shipping, open the invoice and choose EXW there. A bill for this release replaces a typed figure when it arrives.';
    var i0 = (t.invoices || []).filter(function (x) { return !!x.invoice_id; })[0];
    t.fix = i0 ? { go: 'invoice', invoice_id: i0.invoice_id, label: 'Open invoice ' + i0.invoice + ' →', direction: 'If the customer arranges the shipping, choose EXW at the top of the invoice; otherwise type what the ' + pw + ' cost us in its shipping box. Then save.' } : null;
  } else if (t.kind === 'not_shared') {
    var wb = t.blockers || [];
    if (wb.length) {
      t.suggest = sugOf(wb[0].name);
      var where0 = wb[0].invoice ? ' (invoice ' + wb[0].invoice + ')' : (wb[0].older ? ' (on an older invoice of this release)' : '');
      t.what = 'Release ' + rel + ' has its shipping cost, but it cannot be shared between its sale lines because ' + q(wb[0].name) + where0 + (wb.length > 1 ? ' and ' + (wb.length - 1) + ' other(s)' : '') + ' has no unit, so its pounds are not known.';
      t.todo = 'Give ' + q(wb[0].name) + ' its unit — do not type the shipping again, it is already there.';
      t.fix = unitFix(wb[0].name, 'Set the unit of ' + q(shortName(wb[0].name)) + ' →');
    } else {
      t.what = 'Release ' + rel + ' has its shipping cost, but a product on it has no weight, so it cannot be shared.';
      t.todo = 'Give that product its unit in Set-up — do not type the shipping again.';
      t.fix = { go: 'names', name: '', label: 'Open the units in Set-up →', direction: 'The descriptions with no unit are marked “⚠ not set”. Pick the unit of each one.' };
    }
  } else if (t.kind === 'release_split') {
    t.what = t.title.replace(/^Invoice (\S+) — on /, 'Invoice $1 is on ').replace(', pounds not divided between them', ', and its pounds are not divided between them') + '.';
    t.todo = 'Type how many pounds went on each release on its row in By invoice. The release numbers are right — leave them.';
    t.fix = { go: 'invoice_row', invoice: inv, invoice_id: t.invoice_id || null, label: 'Open its row in By invoice →', direction: 'Open the highlighted invoice and type how many pounds went on each release, then save.' };
  } else if (t.kind === 'no_release') {
    t.what = 'Invoice ' + inv + ' has no release number, so its trucking and freight cannot be found.';
    t.todo = 'Put the release number on the invoice and save it. If it is a test invoice, void it.';
    t.fix = { go: 'invoice', invoice_id: t.invoice_id || null, label: 'Open invoice ' + inv + ' →', direction: 'Type the release number on the invoice and save it.' };
  } else if (t.kind === 'base_cost') {
    var per = t.cost_unit === 'sold_unit' ? 'YARD' : 'POUND';
    if (t.group_id) {
      t.what = q(t.product) + ' has no cost: no supplier bill is linked to it and no cost is typed for it.';
      t.todo = 'Link its supplier bill in Set-up, or type what it costs us per ' + per + ' here (used until a bill is linked).';
      t.fix = { go: 'link', group_id: t.group_id, name: t.product, label: 'Link its supplier bill →', direction: 'Tick the supplier bill line(s) that are what we pay for ' + q(t.product) + ' in the highlighted product, then click “Link ticked”.' };
    } else {
      t.what = q(t.product) + ' is not under a product yet, so it has no cost.';
      t.todo = 'In Set-up, tick it and put it under a product; then its cost can be set.';
      t.fix = { go: 'names', name: t.product, label: 'Put it under a product →', direction: 'Tick ' + q(t.product) + ' in the list, then type a product name under “Group ticked as” and click “Save group” — or add it to an existing group.' };
    }
  } else {
    t.what = 'Something else on invoice ' + inv + ' is missing.';
    t.todo = 'Open its row in By invoice to see what.';
    t.fix = { go: 'invoice_row', invoice: inv, invoice_id: t.invoice_id || null, label: 'Open its row in By invoice →', direction: 'The highlighted invoice row shows what is still missing.' };
  }
  t.how = t.what + ' ' + t.todo;
  return t;
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
