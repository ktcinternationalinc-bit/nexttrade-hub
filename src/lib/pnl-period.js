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
  { key: 'transport_profit', label: 'TRANSPORT PROFIT', group: 'transport', kind: 'profit' }
];

// One period opened up. cells = the cells of that period (already filtered). Returns:
//   categories: one row per category — { key, label, group, kind, cents, missing, lines }
//   products / customers: [{ name, lines, pounds, goods_profit, transport_profit, profit, missing }] (cents), biggest profit first
//   total: { goods_profit, transport_profit, profit } (cents) — profit is ALWAYS goods profit + transport profit
//   hidden: true when the profit figures were not sent to this person (no permission) — then no profit is worked out at all
export function periodBreakdown(cells) {
  var list = cells || [];
  var hidden = list.some(function (c) { return c.goods_profit === undefined || c.profit === undefined; });
  var cats = CATEGORIES.map(function (d) {
    var row = { key: d.key, label: d.label, group: d.group, kind: d.kind, cents: 0, missing: 0, lines: 0 };
    list.forEach(function (c) { var v = c[d.key]; if (!known(v)) { row.missing += 1; return; } row.cents += cents(v); row.lines += 1; });
    if (hidden && d.kind === 'profit') { row.cents = null; }
    return row;
  });
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
export function linesToFix(cells) {
  var list = cells || [];
  if (list.some(function (c) { return c.goods_profit === undefined || c.profit === undefined; })) { return { hidden: true, rows: [], reasons: [], total: list.length }; }
  var count = {}; var rows = [];
  list.forEach(function (c) {
    var miss = [];
    if (!known(c.pounds)) { miss.push('pounds'); } else if (!known(c.base_cost)) { miss.push('base_cost'); }
    if (!known(c.transport_revenue)) { miss.push('transport_revenue'); }
    if (!known(c.trucking_cost)) { miss.push('trucking_cost'); }
    if (!known(c.freight_cost)) { miss.push('freight_cost'); }
    if (!miss.length && (!known(c.goods_profit) || !known(c.transport_profit))) { miss.push('other'); }
    if (!miss.length) { return; }
    miss.forEach(function (k) { count[k] = (count[k] || 0) + 1; });
    rows.push({ invoice_id: c.invoice_id || null, invoice: c.invoice || '', invoice_date: c.invoice_date || '', customer: c.customer || '', product: c.product || c.description || '', release: c.release_raw || c.release || '',
      sold_for: known(c.goods_revenue) ? Number(c.goods_revenue) : null, missing: miss, missing_text: miss.map(function (k) { return FIX.filter(function (f) { return f.key === k; })[0].title; }).join(' · ') });
  });
  rows.sort(function (a, b) { return (b.sold_for || 0) - (a.sold_for || 0); });
  return { hidden: false, total: list.length, rows: rows, reasons: FIX.filter(function (f) { return count[f.key]; }).map(function (f) { return { key: f.key, title: f.title, how: f.how, go: f.go, goLabel: f.goLabel, count: count[f.key] }; }) };
}
