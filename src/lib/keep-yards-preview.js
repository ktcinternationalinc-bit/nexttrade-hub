// v55.83-VX — "Keep in yards" BEFORE / AFTER (Max, Nov 20 2026: "how can we implement something like that without causing
// mayhem"). Before a description is switched, the report is worked out twice from the SAME data — as it is now, and with the
// switch — and the difference on the lines of those descriptions is shown. Nothing is stored. Pure; var + concat.
import { nameKey, unitKey } from './profitability';
import { assembleProfitability } from './profitability-assemble';

function cents(x) { return Math.round((Number(x) || 0) * 100); }
function known(x) { return !(x === null || x === undefined || x === ''); }

function sums(cells) {
  var o = { lines: 0, pounds: 0, yards: 0, goods_revenue: 0, base_cost: 0, commission: 0, inbound_allowance: 0, goods_profit: 0, cost_known: 0, cost_unknown: 0, profit_known: 0 };
  (cells || []).forEach(function (c) {
    o.lines += 1;
    if (c.keep_unit === true) { o.yards += Number(c.sold_yards) || 0; } else { o.pounds += Number(c.pounds) || 0; }
    o.goods_revenue += known(c.goods_revenue) ? cents(c.goods_revenue) : 0;
    if (known(c.base_cost)) { o.base_cost += cents(c.base_cost); o.cost_known += 1; } else { o.cost_unknown += 1; }
    o.commission += known(c.commission) ? cents(c.commission) : 0;
    o.inbound_allowance += known(c.inbound_allowance) ? cents(c.inbound_allowance) : 0;
    if (known(c.goods_profit)) { o.goods_profit += cents(c.goods_profit); o.profit_known += 1; }
  });
  o.pounds = Math.round(o.pounds); o.yards = Math.round(o.yards);
  return o;
}

// input = the loader's input (without dates); o = { names: [descriptions], keep: true | false, date_from, date_to }.
// Returns { ok, error?, names: [{ name, unit, lines }], skipped: [{ name, why }], before, after (sums, money in cents),
//           cost_lost (lines that have a cost now and would have none), why_lost: { typed_per_pound, bought_by_weight },
//           other_lines_changed (lines of OTHER descriptions whose figures move — must be 0), shipping_shares_changed }.
export function keepYardsPreview(input, o) {
  var opt = o || {}; var d = input || {}; var want = {}; var skipped = []; var listed = [];
  var unitOf = {}; (d.nameUnits || []).forEach(function (u) { unitOf[u.name_key] = u.unit; });
  (opt.names || []).forEach(function (n) {
    var k = nameKey(n); if (!k) { return; }
    var u = unitKey(unitOf[k]);
    if (u !== 'yd' && u !== 'lm') { skipped.push({ name: String(n), why: u ? 'it is sold by weight (' + u + '), not in yards' : 'it has no unit yet — pick yards first' }); return; }
    if (opt.keep !== true && /head[\s-]*liner/i.test(String(n))) { skipped.push({ name: String(n), why: 'headliner is always kept in yards (rule)' }); return; }
    want[k] = opt.keep === true; listed.push({ name: String(n), unit: u, lines: 0, key: k });
  });
  if (!listed.length) { return { ok: false, error: skipped.length ? 'Nothing to switch: ' + skipped.map(function (s) { return '“' + s.name + '” — ' + s.why; }).join('; ') + '.' : 'Pick at least one description.', skipped: skipped }; }
  var dates = { date_from: opt.date_from || null, date_to: opt.date_to || null };
  var a = assembleProfitability(Object.assign({}, d, dates));
  var b = assembleProfitability(Object.assign({}, d, dates, { previewKeep: want }));
  function mine(c) { return want[nameKey(c.description)] !== undefined; }
  var ca = (a.cells || []).filter(mine); var cb = (b.cells || []).filter(mine);
  listed.forEach(function (l) { l.lines = ca.filter(function (c) { return nameKey(c.description) === l.key; }).length; delete l.key; });
  function idOf(c) { return String(c.line_id || '') + '|' + String(c.release || '') + '|' + String(c.invoice_id || ''); }
  var afterOf = {}; (b.cells || []).forEach(function (c) { afterOf[idOf(c)] = c; });
  var lost = 0; var typedPerLb = 0; var byWeight = 0; var otherChanged = 0; var shipChanged = 0;
  (a.cells || []).forEach(function (c) {
    var n = afterOf[idOf(c)]; if (!n) { return; }
    if (mine(c)) {
      if (known(c.base_cost) && !known(n.base_cost)) { lost += 1; if ((n.flags || []).indexOf('typed_cost_is_per_pound') >= 0 || (n.flags || []).indexOf('typed_cost_is_per_yard') >= 0) { typedPerLb += 1; } if ((n.flags || []).indexOf('supplier_line_by_weight_not_used') >= 0) { byWeight += 1; } }
      if (cents(c.outbound_cost) !== cents(n.outbound_cost)) { shipChanged += 1; }
    } else if (cents(c.base_cost) !== cents(n.base_cost) || cents(c.commission) !== cents(n.commission) || cents(c.inbound_allowance) !== cents(n.inbound_allowance) || cents(c.outbound_cost) !== cents(n.outbound_cost) || cents(c.goods_revenue) !== cents(n.goods_revenue)) { otherChanged += 1; }
  });
  return { ok: true, keep: opt.keep === true, names: listed, skipped: skipped, before: sums(ca), after: sums(cb), cost_lost: lost, why_lost: { typed_per_pound: typedPerLb, bought_by_weight: byWeight }, other_lines_changed: otherChanged, shipping_shares_changed: shipChanged };
}
