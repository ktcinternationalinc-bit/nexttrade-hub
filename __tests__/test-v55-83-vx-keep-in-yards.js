// v55.83-VX — Max, 20 Nov 2026: "certain groups to be in yards ... certain things are not converted to lbs ... we can give cost in
// yards ... without causing mayhem" · commission on them: "NO" · the $0.02 inbound allowance: "NO" · "Headliner and everything
// else that is not PVC related leather. we should have a radio button to those items in yards excluded from the lb conversion."
// Real engine (assembleProfitability), real preview function; made-up names and amounts.
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';
require(path.join(root, 'node_modules/sucrase/register'));
var A = require(path.join(root, 'src/lib/profitability-assemble.js')); var PR = require(path.join(root, 'src/lib/profitability.js'));
var P = require(path.join(root, 'src/lib/pnl-period.js')); var K = require(path.join(root, 'src/lib/keep-yards-preview.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 1100))); }
console.log('VX — goods kept in yards (not converted to pounds)');

// One Houston release (1002-…: the inbound allowance applies) carrying two sales on one invoice:
//   • 'Fabric by yd'  — 1,000 yd at $2.00, bought from the supplier IN YARDS: 4,000 yd for $3,200 (+ $80 real commission on the bill)
//   • 'PVC roll'      — 5,000 lb at $1.00, bought by the pound: 10,000 lb for $4,000
// Trucking for the release is typed: $600.
function input(o) {
  var opt = o || {};
  return { windowDays: 90, warehouseOn: false,
    invoices: [{ id: 'i1', invoice_number: 'INV 1', accounting_customer_id: 'c1', invoice_date: '2026-06-10', record_status: 'active', currency: 'USD', release_number: '1002-9001' }],
    items: [{ id: 'l1', invoice_id: 'i1', description: 'Fabric by yd', quantity: 1000, unit_price: 2 }, { id: 'l2', invoice_id: 'i1', description: 'PVC roll', quantity: 5000, unit_price: 1 }],
    customerNames: { c1: 'Alpha' }, terms: [{ invoice_id: 'i1', shipping_terms: 'EXW' }],
    nameUnits: [{ name_key: PR.nameKey('Fabric by yd'), raw_name: 'Fabric by yd', unit: 'yd', keep_unit: opt.keep === true }, { name_key: PR.nameKey('PVC roll'), raw_name: 'PVC roll', unit: 'lb', keep_unit: opt.keepPvc === true }],
    groups: [{ id: 'g1', display_name: 'Fabric', active: true }, { id: 'g2', display_name: 'PVC', active: true }],
    groupNames: [{ group_id: 'g1', source: 'invoice', name_key: PR.nameKey('Fabric by yd'), raw_name: 'Fabric by yd', active: true }, { group_id: 'g1', source: 'bill', name_key: PR.nameKey('Fabric supplier'), raw_name: 'Fabric supplier', active: true },
      { group_id: 'g2', source: 'invoice', name_key: PR.nameKey('PVC roll'), raw_name: 'PVC roll', active: true }, { group_id: 'g2', source: 'bill', name_key: PR.nameKey('PVC supplier'), raw_name: 'PVC supplier', active: true }],
    bills: [{ id: 'b1', vendor_name: 'Mill', bill_number: 'M1', bill_date: '2026-06-01', total_amount: 1, record_status: 'active', bill_type: 'supplier', release_number: '' }],
    billLines: [{ bill_id: 'b1', line_kind: 'item', description: 'Fabric supplier', qty: opt.fabricBillQty || 4000, unit: opt.fabricBillUnit || 'yd', cost_amount: 3200, commission_amount: 80 }, { bill_id: 'b1', line_kind: 'item', description: 'PVC supplier', qty: 10000, unit: 'lb', cost_amount: 4000, commission_amount: 0 }],
    warehouseRows: [], estimates: [], partEstimates: [{ release_key: PR.relKey('1002-9001'), part: 'trucking', amount: 600 }, { release_key: PR.relKey('1002-9001'), part: 'freight', amount: 0 }], lineReleasePounds: [],
    lineCosts: opt.lineCosts || [], groupCosts: [], keep_unit_ready: true };
}
function run(o) { return A.assembleProfitability(Object.assign({ date_from: '2026-01-01', date_to: '' }, input(o))); }
function cellOf(r, desc) { return (r.cells || []).filter(function (c) { return c.description === desc; })[0]; }
var off = run({}); var on = run({ keep: true });
var f0 = cellOf(off, 'Fabric by yd'); var f1 = cellOf(on, 'Fabric by yd'); var p0 = cellOf(off, 'PVC roll'); var p1 = cellOf(on, 'PVC roll');

check('switched OFF (the default) nothing is different from today: converted to 2,500 lb, inbound allowance $50, cost $800, commission $20', f0.keep_unit === false && f0.pounds === 2500 && f0.inbound_allowance === 50 && f0.base_cost === 800 && f0.commission === 20 && f0.sold_qty === null, [f0.pounds, f0.inbound_allowance, f0.base_cost, f0.commission]);
check('KEPT IN YARDS: the line is 1,000 yd, its cost is still $800 (bill $3,200 ÷ 4,000 yd × 1,000 yd — no weight involved) = $0.80 per yard', f1.keep_unit === true && f1.sold_qty === 1000 && f1.sold_unit === 'yd' && f1.base_cost === 800 && f1.base_cost_per_sold_unit === 0.8, [f1.sold_qty, f1.base_cost, f1.base_cost_per_sold_unit]);
check('…the $0.02 inbound allowance is NOT charged on it (Max: NO) — $50 → $0', f1.inbound_allowance === 0 && f0.inbound_allowance === 50);
check('…no commission RATE is added; the real commission dollars on its supplier bill are kept exactly ($20, same as before)', f1.commission === 20 && f1.commission === f0.commission);
check('…so its goods profit goes up by exactly the allowance that no longer applies, nothing else', Math.round((f1.goods_profit - f0.goods_profit) * 100) === 5000, [f0.goods_profit, f1.goods_profit]);
check('the PVC line on the same invoice is untouched: same pounds, cost, commission, allowance and profit', ['pounds', 'base_cost', 'commission', 'inbound_allowance', 'goods_profit', 'goods_revenue'].every(function (k) { return p0[k] === p1[k]; }) && p1.keep_unit === false && p1.inbound_allowance === 100);
check('the release’s shipping cost is shared exactly as before (by shipping weight 2,500 : 5,000) — $200 / $400, dollars conserved', f1.trucking_cost === f0.trucking_cost && p1.trucking_cost === p0.trucking_cost && Math.round((f1.trucking_cost + p1.trucking_cost) * 100) === 60000 && f1.trucking_cost === 200, [f1.trucking_cost, p1.trucking_cost]);
check('the choice is ignored for a description sold by weight (only yards / linear metres can be kept)', cellOf(run({ keepPvc: true }), 'PVC roll').keep_unit === false && cellOf(run({ keepPvc: true }), 'PVC roll').inbound_allowance === 100);

// ── supplier line by weight: never converted
var w = cellOf(run({ keep: true, fabricBillUnit: 'lb', fabricBillQty: 10000 }), 'Fabric by yd'); var wOff = cellOf(run({ fabricBillUnit: 'lb', fabricBillQty: 10000 }), 'Fabric by yd');
check('kept in yards but the only supplier line is by the POUND: the cost is NOT known (not converted), and the line says why', w.base_cost === null && w.goods_profit === null && w.flags.indexOf('supplier_line_by_weight_not_used') >= 0 && wOff.base_cost === 800, [w.base_cost, w.flags, wOff.base_cost]);
// ── typed costs
var tLb = cellOf(run({ keep: true, fabricBillUnit: 'lb', lineCosts: [{ invoice_item_id: 'l1', cost_per_lb: 0.3, commission_per_lb: 0.05 }] }), 'Fabric by yd');
check('a cost typed per POUND is never reinterpreted as per yard: cost not known, flagged', tLb.base_cost === null && tLb.flags.indexOf('typed_cost_is_per_pound') >= 0, [tLb.base_cost, tLb.flags]);
var tYd = cellOf(run({ keep: true, fabricBillUnit: 'lb', lineCosts: [{ invoice_item_id: 'l1', cost_per_lb: 0.9, commission_per_lb: 0.05, cost_unit: 'sold_unit' }] }), 'Fabric by yd');
check('a cost typed per YARD ($0.90): cost = 1,000 yd × 0.90 = $900, no commission (Max: NO), marked typed by hand', tYd.base_cost === 900 && tYd.commission === 0 && tYd.cost_method === 'manual' && tYd.base_cost_per_sold_unit === 0.9, [tYd.base_cost, tYd.commission, tYd.cost_method]);
var tMix = cellOf(run({ fabricBillUnit: 'box', lineCosts: [{ invoice_item_id: 'l1', cost_per_lb: 0.9, cost_unit: 'sold_unit' }] }), 'Fabric by yd');
check('the reverse too: a per-yard figure is never used as dollars per pound on a converted line', tMix.base_cost === null && tMix.flags.indexOf('typed_cost_is_per_yard') >= 0, [tMix.base_cost, tMix.flags]);

// ── totals: pounds and yards are never added together
var bp = (on.by_product || []); var rowF = bp.filter(function (r) { return /Fabric/.test(r.label); })[0]; var rowP = bp.filter(function (r) { return /PVC/.test(r.label); })[0];
check('By product: Fabric shows 1,000 YARDS and 0 pounds with per-YARD averages ($2.00 price, $0.80 cost); PVC shows 5,000 lb with per-lb averages', !!rowF && rowF.yards === 1000 && rowF.pounds === 0 && rowF.unit_mix === 'yd' && rowF.avg_goods_price_per_yd === 2 && rowF.avg_base_cost_per_yd === 0.8 && rowF.avg_goods_price_per_lb === null && rowP.pounds === 5000 && rowP.unit_mix === 'lb' && rowP.avg_goods_price_per_lb === 1 && rowP.yards === 0, [rowF, rowP && rowP.pounds]);
var byInv = (on.by_invoice || [])[0];
check('a row that mixes both (the invoice): 5,000 lb and 1,000 yd side by side; v55.83-WK: its averages are worked out SEPARATELY — $1.00 per lb on the pound goods and $2.00 per yd on the yard goods, never one blended figure; dollar totals still add up', !!byInv && byInv.pounds === 5000 && byInv.yards === 1000 && byInv.unit_mix === 'mixed' && byInv.avg_goods_price_per_lb === 1 && byInv.avg_goods_price_per_yd === 2 && byInv.avg_base_cost_per_lb === 0.4 && byInv.avg_base_cost_per_yd === 0.8 && byInv.goods_revenue === 7000 && byInv.base_cost === 2800, byInv && [byInv.pounds, byInv.yards, byInv.unit_mix, byInv.goods_revenue, byInv.base_cost]);
var pr = P.blankPeriodRow('2026-06', 'Jun 2026'); on.cells.forEach(function (c) { P.addPeriodCell(pr, c); });
var pr0 = P.blankPeriodRow('2026-06', 'Jun 2026'); off.cells.forEach(function (c) { P.addPeriodCell(pr0, c); });
check('P&L by period: Pounds = 5,000 and Yards = 1,000 (it was 7,500 "pounds"); switched off it is 7,500 lb and 0 yd as today', pr.pounds === 5000 && pr.yards === 1000 && pr0.pounds === 7500 && pr0.yards === 0);
check('the opened period and its product list count the same way', P.periodBreakdown(on.cells, false).pounds === 5000 && P.periodBreakdown(on.cells, false).yards === 1000 && P.periodBreakdown(on.cells, false).products.filter(function (x) { return /Fabric/.test(x.name); })[0].yards === 1000);
check('nothing is listed as "to fix" because of the switch (the weight is still there for sharing shipping)', P.openTasks(on.cells).tasks.length === P.openTasks(off.cells).tasks.length);

// ── before / after preview
var pv = K.keepYardsPreview(input({}), { names: ['Fabric by yd'], keep: true, date_from: '2026-01-01' });
check('PREVIEW (nothing stored): 1 line · 2,500 lb → 1,000 yd · inbound allowance $50 → $0 · cost $800 → $800 · commission $20 → $20 · no line loses its cost · no other line moves · shipping shares unchanged', pv.ok === true && pv.before.lines === 1 && pv.before.pounds === 2500 && pv.after.yards === 1000 && pv.after.pounds === 0 && pv.before.inbound_allowance === 5000 && pv.after.inbound_allowance === 0 && pv.before.base_cost === 80000 && pv.after.base_cost === 80000 && pv.before.commission === 2000 && pv.after.commission === 2000 && pv.cost_lost === 0 && pv.other_lines_changed === 0 && pv.shipping_shares_changed === 0 && pv.after.goods_profit - pv.before.goods_profit === 5000, pv);
var pv2 = K.keepYardsPreview(input({ fabricBillUnit: 'lb', fabricBillQty: 10000 }), { names: ['Fabric by yd'], keep: true, date_from: '2026-01-01' });
check('the preview warns BEFORE the switch when a line would lose its cost because it was bought by weight', pv2.ok === true && pv2.cost_lost === 1 && pv2.why_lost.bought_by_weight === 1 && pv2.before.cost_known === 1 && pv2.after.cost_unknown === 1);
var pv3 = K.keepYardsPreview(input({}), { names: ['PVC roll'], keep: true });
check('a description sold by weight cannot be switched: refused with the reason', pv3.ok === false && /sold by weight/.test(pv3.error));
var pv4 = K.keepYardsPreview(input({ keep: true }), { names: ['Fabric by yd'], keep: false, date_from: '2026-01-01' });
check('switching BACK is previewed the same way and restores today’s figures exactly (allowance $0 → $50, 1,000 yd → 2,500 lb)', pv4.ok === true && pv4.before.yards === 1000 && pv4.after.pounds === 2500 && pv4.after.inbound_allowance === 5000 && JSON.stringify(run({}).cells) === JSON.stringify(off.cells));
check('the preview itself changes nothing: the same input gives the same report afterwards', JSON.stringify(run({}).cells) === JSON.stringify(off.cells));
// ── headliner keeps its own shipping weight
var hl = A.assembleProfitability(Object.assign({ date_from: '2026-01-01', date_to: '' }, input({ keep: true }), { items: [{ id: 'l1', invoice_id: 'i1', description: 'Headliner by yd', quantity: 1000, unit_price: 2 }, { id: 'l2', invoice_id: 'i1', description: 'PVC roll', quantity: 5000, unit_price: 1 }], nameUnits: [{ name_key: PR.nameKey('Headliner by yd'), raw_name: 'Headliner by yd', unit: 'yd', keep_unit: true }, { name_key: PR.nameKey('PVC roll'), raw_name: 'PVC roll', unit: 'lb' }] }));
var hc = (hl.cells || []).filter(function (c) { return c.line_id === 'l1'; })[0];
check('a headliner line kept in yards: 1,000 yd, shipping weight 1,250 lb (1.25 per yard) used only for sharing shipping, no allowance', hc.keep_unit === true && hc.sold_qty === 1000 && hc.pounds === 1250 && hc.inbound_allowance === 0, [hc.sold_qty, hc.pounds, hc.inbound_allowance]);

// ── v55.83-WG — Max, 20 Nov: headliner is ALWAYS kept in yards (bought in yards); only PVC / PVC foam is converted to pounds
function runH(o) { var opt = o || {}; var inp = input({});
  inp.items = [{ id: 'l1', invoice_id: 'i1', description: 'Headliner BY YD', quantity: 1000, unit_price: 2 }, { id: 'l2', invoice_id: 'i1', description: 'PVC roll', quantity: 5000, unit_price: 1 }, { id: 'l3', invoice_id: 'i1', description: 'Foam PVC by yd', quantity: 100, unit_price: 3 }];
  inp.nameUnits = [{ name_key: PR.nameKey('Headliner BY YD'), raw_name: 'Headliner BY YD', unit: 'yd', keep_unit: false }, { name_key: PR.nameKey('PVC roll'), raw_name: 'PVC roll', unit: 'lb' }, { name_key: PR.nameKey('Foam PVC by yd'), raw_name: 'Foam PVC by yd', unit: 'yd', keep_unit: false }];
  inp.groupNames = inp.groupNames.concat([{ group_id: 'g1', source: 'invoice', name_key: PR.nameKey('Headliner BY YD'), raw_name: 'Headliner BY YD', active: true }]);
  if (opt.notReady) { inp.keep_unit_ready = false; }
  return A.assembleProfitability(Object.assign({ date_from: '2026-01-01', date_to: '' }, inp)); }
var hR = runH({}); var hC = cellOf(hR, 'Headliner BY YD'); var fC = cellOf(hR, 'Foam PVC by yd');
check('WG: a HEADLINER line is kept in yards by rule, with no switch set: 1,000 yd, cost per yard from the yard bill ($0.80 → $800), no inbound allowance; its shipping weight stays 1.25 lb per yard', hC.keep_unit === true && hC.sold_qty === 1000 && hC.base_cost === 800 && hC.inbound_allowance === 0 && hC.pounds === 1250, [hC.keep_unit, hC.sold_qty, hC.base_cost, hC.inbound_allowance, hC.pounds]);
check('WG: PVC foam sold in yards is still CONVERTED to pounds (3 lb per yard) and pays the inbound allowance — only headliner changed', fC.keep_unit === false && fC.pounds === 300 && fC.inbound_allowance === 6, [fC.keep_unit, fC.pounds, fC.inbound_allowance]);
check('WG: Set-up lists the headliner description as kept in yards by rule; the PVC foam one is not', (hR.invoice_names || []).filter(function (n) { return n.name === 'Headliner BY YD'; })[0].keep_rule === true && (hR.invoice_names || []).filter(function (n) { return n.name === 'Foam PVC by yd'; })[0].keep_rule === false && fs.readFileSync(path.join(root, 'src/components/ProfitabilityTab.jsx'), 'utf8').indexOf('kept in yards — headliner rule') > 0);
check('WG: before the keep-in-yards columns exist the rule is off (headliner converted at 1.25 as before) — nothing changes without the database step', cellOf(runH({ notReady: true }), 'Headliner BY YD').keep_unit === false && cellOf(runH({ notReady: true }), 'Headliner BY YD').pounds === 1250);
check('WG: a headliner description cannot be switched back to pounds through the preview (it says why)', K.keepYardsPreview(input({}), { names: ['Headliner BY YD'], keep: false }).ok === false);

// ── v55.83-WK — averages on mixed rows, and nothing changes for rows of one kind
check('WK: the all-in cost per unit is separate too: pound goods (cost + commission + $0.02 allowance) per lb, yard goods (cost + commission, no allowance) per yd', byInv.avg_all_cost_per_lb === 0.42 && byInv.avg_all_cost_per_yd === 0.82, [byInv.avg_all_cost_per_lb, byInv.avg_all_cost_per_yd]);
check('WK: a row of ONE kind has exactly the averages it had before (PVC: per lb only; Fabric: per yd only)', rowP.avg_goods_price_per_lb === 1 && rowP.avg_goods_price_per_yd === null && rowP.avg_all_cost_per_lb === 0.42 && rowF.avg_goods_price_per_yd === 2 && rowF.avg_goods_price_per_lb === null && rowF.avg_all_cost_per_yd === 0.82);
check('WK: switched off, the same invoice is all pounds and its averages are the old blended per-lb figures (7,000 ÷ 7,500 lb)', (function () { var r = (off.by_invoice || [])[0]; return r.unit_mix === 'lb' && r.avg_goods_price_per_lb === 0.9333 && r.avg_goods_price_per_yd === null; })());
check('WK: P&L by period keeps the goods profit of the pound lines and of the yard lines apart, and they add up to the goods profit', pr.gp_lb + pr.gp_yd === pr.goods_profit && pr.gp_yd > 0 && pr.gp_lb > 0 && pr0.gp_yd === 0 && pr0.gp_lb === pr0.goods_profit);
check('WK: a missing figure on the YARD lines hides only the per-yard average — the per-pound average of the same row is still shown', (function () { var r = (run({ keep: true, fabricBillUnit: 'lb', fabricBillQty: 10000 }).by_invoice || [])[0]; return r.avg_base_cost_per_yd === null && r.avg_base_cost_per_lb === 0.4 && r.avg_goods_price_per_yd === 2; })());
check('WK: the screen shows both figures on a mixed row (per lb, and per yd under it)', fs.readFileSync(path.join(root, 'src/components/ProfitabilityTab.jsx'), 'utf8').indexOf('{perUnit(r.avg_goods_price_per_lb, r.avg_goods_price_per_yd)}') > 0 && fs.readFileSync(path.join(root, 'src/components/ProfitabilityTab.jsx'), 'utf8').indexOf("{fmt4(r.gp_lb / 100 / r.pounds) + ' / lb'}") > 0);

// ── route + loader + SQL
var route = fs.readFileSync(path.join(root, 'src/app/api/accounting/profitability/route.js'), 'utf8');
check('server: keep_preview and set_name_keep sit AFTER the edit-costs gate, refuse until the SQL was run, and the save is recorded in the audit trail', route.indexOf("if (action === 'keep_preview' || action === 'set_name_keep') {") > route.indexOf("var pe = await assertPermission(db, userId, 'pnl.edit_costs', req);") && route.indexOf('sql/v55-83-VX-keep-in-yards.sql') > 0 && route.indexOf("'pl_name_keep_unit_set'") > 0 && route.indexOf(".in('unit', ['yd', 'lm'])") > 0);
check('server: profit figures in the preview are removed for a person who may not see profit', route.indexOf("(seeK && seeK.ok === true) ? pvK : stripProfit(pvK)") > 0 && require(path.join(root, 'src/lib/margin-visibility.js')).stripProfit(pv).before.goods_profit === undefined);
var loader = fs.readFileSync(path.join(root, 'src/lib/profitability-load-server.js'), 'utf8');
check('the report still runs before the SQL: the new columns are read fail-soft and the feature is simply off', loader.indexOf("select('name_key, raw_name, unit, keep_unit')") > 0 && loader.indexOf('catch (eKU) { setup.keep_unit_ready = false; }') > 0 && on.keep_unit_ready === true && A.assembleProfitability(Object.assign({ date_from: '2026-01-01' }, input({}), { keep_unit_ready: undefined })).keep_unit_ready === false);
var sql = fs.readFileSync(path.join(root, 'sql/v55-83-VX-keep-in-yards.sql'), 'utf8');
check('ONE small SQL: adds columns only (default = converted, as today), deletes nothing, no comment lines', /add column if not exists keep_unit boolean not null default false/.test(sql) && /cost_unit text not null default 'lb'/.test(sql) && !/delete from|drop table|truncate|^--/im.test(sql));
// ── Codex 12:57 — a linear metre is not a yard; a pounds factor is never used to convert a length
function runLm(o) { var opt = o || {}; var inp = input({ keep: true, fabricBillUnit: opt.billUnit || 'yd', fabricBillQty: opt.billQty || 4000 });
  inp.nameUnits = [{ name_key: PR.nameKey('Fabric by yd'), raw_name: 'Fabric by yd', unit: opt.saleUnit || 'lm', keep_unit: true }, { name_key: PR.nameKey('PVC roll'), raw_name: 'PVC roll', unit: 'lb' }];
  inp.items = [{ id: 'l1', invoice_id: 'i1', description: 'Fabric by yd', quantity: 100, unit_price: 2 }, { id: 'l2', invoice_id: 'i1', description: 'PVC roll', quantity: 5000, unit_price: 1 }];
  return A.assembleProfitability(Object.assign({ date_from: '2026-01-01', date_to: '' }, inp)); }
var lmR = runLm({}); var lmC = cellOf(lmR, 'Fabric by yd'); var lmRow = (lmR.by_product || []).filter(function (r) { return /Fabric/.test(r.label); })[0];
check('a line of 100 LINEAR METRES kept as it is: the line says 100 (metres), and the Yards total counts it as 109.361 yd — never as 100 yd', lmC.keep_unit === true && lmC.sold_unit === 'lm' && lmC.sold_qty === 100 && lmC.sold_yards === 109.361 && lmRow.yards === 109.361 && P.periodBreakdown(lmR.cells, false).yards === 109.361, [lmC.sold_qty, lmC.sold_yards, lmRow && lmRow.yards]);
check('…sold in METRES, bought in YARDS at $0.80 / yd: cost = 109.361 yd × 0.80 = $87.49 (length conversion 1.09361, not the pounds table)', lmC.base_cost === 87.49 && lmC.base_cost_per_sold_unit === 0.8749, [lmC.base_cost, lmC.base_cost_per_sold_unit]);
var ydM = cellOf(runLm({ saleUnit: 'yd', billUnit: 'lm', billQty: 4000 }), 'Fabric by yd');
check('…sold in YARDS, bought in METRES (4,000 m for $3,200 = 4,374.44 yd): cost = 100 yd × 3,200 ÷ 4,374.44 = $73.15', ydM.sold_yards === 100 && ydM.base_cost === 73.15, [ydM.sold_yards, ydM.base_cost]);
check('the weight tables play no part in it: with other pounds-per-yard / per-metre figures the cost of a kept line is the same', (function () { var a1 = input({ keep: true }); var a2 = input({ keep: true }); a2.factors = [{ unit: 'yd', pounds_per_unit: 7 }, { unit: 'lm', pounds_per_unit: 11 }]; var c1 = cellOf(A.assembleProfitability(Object.assign({ date_from: '2026-01-01' }, a1)), 'Fabric by yd'); var c2 = cellOf(A.assembleProfitability(Object.assign({ date_from: '2026-01-01' }, a2)), 'Fabric by yd'); return c1.base_cost === 800 && c2.base_cost === 800 && c2.pounds === 7000 && c2.sold_yards === 1000; })());
check('the screen labels a kept metre line in metres (m, / m) and shows its yards beside it', fs.readFileSync(path.join(root, 'src/components/ProfitabilityTab.jsx'), 'utf8').indexOf("(c.sold_unit === 'lm' ? ' m' : ' yd')") > 0 && fs.readFileSync(path.join(root, 'src/components/ProfitabilityTab.jsx'), 'utf8').indexOf("'kept in metres (= ' + fmt0(c.sold_yards) + ' yd)'") > 0);

// ── the before / after panel and the screen
var React = require('react'); global.React = React; var RS = require('react-dom/server'); var KP = require(path.join(root, 'src/components/KeepYardsPreview.jsx')).default;
var h1 = RS.renderToStaticMarkup(React.createElement(KP, { ask: { names: ['Fabric by yd'], keep: true, preview: pv } }));
check('rendered preview: 2,500 lb → 1,000 yd, inbound allowance $50.00 → $0.00, cost $800.00 both sides, “no other line changes”, and a Yes button', h1.indexOf('2,500 lb') > 0 && h1.indexOf('1,000 yd') > 0 && h1.indexOf('$50.00') > 0 && h1.indexOf('$0.00') > 0 && h1.split('$800.00').length - 1 === 2 && h1.indexOf('no other line changes') > 0 && h1.indexOf('Yes, keep in yards') > 0 && h1.indexOf('Cancel — change nothing') > 0, h1.substring(0, 500));
var h2 = RS.renderToStaticMarkup(React.createElement(KP, { ask: { names: ['Fabric by yd'], keep: true, preview: pv2 } }));
check('rendered preview warns in amber when a line would lose its cost (bought by weight) and says what to do after', h2.indexOf('1 line would lose its cost') > 0 && h2.indexOf('bought by weight') > 0 && h2.indexOf('type the cost per yard') > 0);
check('loading and error states render plainly; no preview → no Yes button', RS.renderToStaticMarkup(React.createElement(KP, { ask: { names: ['x'], keep: true, loading: true } })).indexOf('Working out what this changes') > 0 && RS.renderToStaticMarkup(React.createElement(KP, { ask: { names: ['x'], keep: true, error: 'Not possible.' } })).indexOf('Yes, keep in yards') < 0);
var tab = fs.readFileSync(path.join(root, 'src/components/ProfitabilityTab.jsx'), 'utf8');
check('Set-up: two radio buttons per yard description; choosing one only ASKS (preview) — the save happens on Yes; before the SQL the choice is not offered', tab.indexOf("onChange={function () { if (!n.keep_unit) { askKeep([n.name], true); } }} />keep in yards</label>") > 0 && tab.indexOf("call({ action: 'keep_preview', names: names, keep: keep") > 0 && tab.indexOf("act({ action: 'set_name_keep', names: k.preview.names.map(") > 0 && tab.indexOf('data.keep_unit_ready ? <span className="flex gap-2 items-center" role="radiogroup"') > 0);
check('a typed cost on a kept-in-yards sale is sent as per YARD, with no commission box', tab.indexOf("cost_unit: c.keep_unit ? 'sold_unit' : 'lb'") > 0 && tab.indexOf("commission_per_lb: c.keep_unit ? '' :") > 0);
check('pounds and yards are shown apart: summary rows, the period table, the opened period and the CSV', tab.indexOf('{qtyText(r.pounds, r.yards)}') > 0 && tab.indexOf("{'+ ' + fmt0(r.yards) + ' yd'}") > 0 && tab.indexOf("'Yards (kept in yards)'") > 0 && tab.indexOf('{qtyText(it.pounds, it.yards)}') > 0);
check('server: a cost typed per yard is validated and stored as per yard (never as per pound), with no commission', route.indexOf("var perYd = body.cost_unit === 'sold_unit';") > 0 && route.indexOf("if (perYd) { rowM.cost_unit = 'sold_unit'; }") > 0 && route.indexOf('commission_per_lb: perYd ? 0 : mpl') > 0);

console.log('\nVX: ' + pass + ' passed, ' + failN + ' failed');
if (failN) { process.exit(1); }
