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
