// v55.83-WH — Max, 20 Nov 2026: "we also need a way to signify what the charges are for in terms of shipping to break it down
// internally when creating invoice but not what is shown or printed to the client. So when you get bills you can match where
// they belong. Because right now, you might get a bill that's for trucking, which is different than the 2100, because the 2100
// also includes bond fees. It might include something else, and you'll just replace it with the actual, but it's not really
// actual because it included other charges" · "the breakdown of the shipping charges ... not printed ... it needs to be built now".
// Codex 17:33: a partial breakdown never replaces a combined amount; bond is subtracted exactly once (goods + transport = total);
// "charged" is the resolved transport revenue. Real engine; the box's own function; the route source.
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';
require(path.join(root, 'node_modules/sucrase/register'));
var React = require('react'); global.React = React;
var A = require(path.join(root, 'src/lib/profitability-assemble.js')); var PR = require(path.join(root, 'src/lib/profitability.js')); var P = require(path.join(root, 'src/lib/pnl-period.js')); var D = require(path.join(root, 'src/lib/pnl-expense-detail.js'));
var BOX = require(path.join(root, 'src/components/ShippingPartsBox.jsx'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 1100))); }
console.log('WH — the internal breakdown of a shipping charge');

// A Houston release (1002-…: the $200 bond is in goods cost). The invoice sells 1,000 lb at $10 and charges "TRUCKING and BROKERAGE FEES" $2,100.
var RK = PR.relKey('1002-7001');
function run(o) { var opt = o || {};
  return A.assembleProfitability({ date_from: '2026-01-01', date_to: '', windowDays: 90, warehouseOn: false,
    invoices: [{ id: 'i1', invoice_number: 'INV 1', accounting_customer_id: 'c1', invoice_date: '2026-06-17', record_status: 'active', currency: 'USD', release_number: opt.release || '1002-7001' }],
    items: [{ id: 'l1', invoice_id: 'i1', description: 'PVC roll', quantity: 1000, unit_price: 10 }, { id: 'l2', invoice_id: 'i1', description: 'TRUCKING and BROKERAGE FEES', quantity: 1, unit_price: 2100 }],
    customerNames: { c1: 'Alpha' }, terms: [{ invoice_id: 'i1', shipping_terms: 'CNF_SEPARATE', shipping_cost_estimate: opt.combined === undefined ? null : opt.combined }],
    nameUnits: [{ name_key: PR.nameKey('PVC roll'), unit: 'lb' }], groups: [], groupNames: [], bills: opt.bills || [], billLines: [], warehouseRows: [], estimates: [], partEstimates: opt.parts || [], lineReleasePounds: [],
    lineCosts: [{ invoice_item_id: 'l1', cost_per_lb: 4, commission_per_lb: 0 }] }); }
function part(p0, amt, note) { return { release_key: RK, part: p0, amount: amt, note: note || null }; }
function cell(r) { return (r.cells || [])[0]; }
function bill(n, type, amt) { return { id: n, bill_number: n, vendor_name: 'V', bill_type: type, shipment_direction: 'outbound', release_number: '1002-7001', total_amount: amt, record_status: 'active', bill_date: '2026-06-20' }; }
var base = cell(run({ parts: [part('trucking', 1400), part('freight', 0)] }));
var withBond = cell(run({ parts: [part('trucking', 1400), part('freight', 0), part('bond', 200)] }));
check('Max’s example — charged 2,100, trucking estimated 1,400, freight 0: transport profit is 700 (2,100 − 1,400)', base.transport_revenue === 2100 && base.trucking_cost === 1400 && base.freight_cost === 0 && base.outbound_cost === 1400 && base.transport_profit === 700, [base.transport_revenue, base.outbound_cost, base.transport_profit]);
check('typing the BOND inside the charge (200) changes NO figure: it is a note — the bond cost is already in goods cost (200 for the Houston container), taken off once', withBond.bond_inside_shipping === 200 && withBond.transport_profit === 700 && withBond.outbound_cost === 1400 && withBond.bonded === base.bonded && base.bonded === 200 && withBond.goods_profit === base.goods_profit && withBond.profit === base.profit, [withBond.bonded, withBond.transport_profit, withBond.goods_profit]);
check('goods profit + transport profit = total profit, with the bond subtracted exactly once (10,000 − 4,000 − inbound − 200 bond, + 700)', Math.round((withBond.goods_profit + withBond.transport_profit) * 100) === Math.round(withBond.profit * 100) && Math.round(withBond.goods_profit * 100) === Math.round((10000 - 4000 - withBond.inbound_allowance - withBond.commission - 200) * 100), [withBond.goods_profit, withBond.transport_profit, withBond.profit]);
var afterBill = cell(run({ parts: [part('trucking', 1400), part('freight', 0), part('bond', 200)], bills: [bill('TR-1', 'trucking', 1500)] }));
check('the trucking BILL arrives (1,500): it replaces ONLY the trucking figure — transport profit 600, the charge is still 2,100, freight still 0 as typed, bond note untouched', afterBill.trucking_cost === 1500 && afterBill.trucking_kind === 'bill' && afterBill.freight_cost === 0 && afterBill.transport_revenue === 2100 && afterBill.transport_profit === 600 && afterBill.bond_inside_shipping === 200 && afterBill.goods_profit === base.goods_profit);
var twoBills = cell(run({ parts: [part('freight', 0)], bills: [bill('TR-1', 'trucking', 900), bill('TR-2', 'trucking', 600)] }));
check('two trucking bills for the release add up (900 + 600 = 1,500) — the later one does not replace the earlier', twoBills.trucking_cost === 1500 && twoBills.transport_profit === 600);
var oth = cell(run({ parts: [part('trucking', 1400), part('freight', 0), part('other', 150, 'chassis fee')] }));
check('"Other" (150, chassis fee) is a real shipping cost, counted ONCE: shipping cost 1,550, transport profit 550, shown as its own labelled part; trucking + freight + other = shipping cost to the cent', oth.outbound_cost === 1550 && oth.shipping_other === 150 && oth.shipping_other_label === 'chassis fee' && oth.trucking_cost === 1400 && oth.freight_cost === 0 && oth.transport_profit === 550 && Math.round((oth.trucking_cost + oth.freight_cost + oth.shipping_other) * 100) === Math.round(oth.outbound_cost * 100), [oth.outbound_cost, oth.shipping_other, oth.freight_cost]);
var othBill = cell(run({ parts: [part('trucking', 1400), part('freight', 300), part('other', 150, 'chassis fee')], bills: [bill('TR-1', 'trucking', 1500)] }));
check('…with a trucking bill beside freight 300 and other 150: 1,500 + 300 + 150 = 1,950; each part keeps its own figure', othBill.outbound_cost === 1950 && othBill.trucking_cost === 1500 && othBill.freight_cost === 300 && othBill.shipping_other === 150);
// Codex 17:33 (1) — a partial breakdown never replaces a combined amount
var c1 = cell(run({ combined: 1000, parts: [part('trucking', 400)] }));
check('Codex: combined 1,000 on the invoice, only trucking 400 typed → the cost STAYS 1,000; trucking 400 is detail; freight is not silently 0; no profit is created', c1.outbound_cost === 1000 && c1.trucking_cost === 400 && c1.freight_cost === null && c1.shipping_total_unsplit === 600 && c1.transport_profit === 1100);
var c0 = cell(run({ combined: 1000, parts: [part('trucking', 0)] }));
check('Codex: a typed trucking ZERO is a known zero and does not erase the combined 1,000', c0.outbound_cost === 1000 && c0.trucking_cost === 0 && c0.shipping_total_unsplit === 1000);
var cO = cell(run({ combined: 1000, parts: [part('trucking', 400), part('other', 150, 'x')] }));
check('…and "other" is NOT added on top of a combined amount that is still kept (the combined amount already covers everything): cost stays 1,000', cO.outbound_cost === 1000 && (cO.shipping_other === null || cO.shipping_other === undefined));
var cB = cell(run({ combined: 1000, parts: [part('trucking', 400), part('freight', 500)] }));
check('both trucking and freight typed (400 + 500): the breakdown is complete and replaces the combined amount → 900', cB.outbound_cost === 900 && cB.shipping_total_unsplit === null);
var cN = cell(run({ combined: 1000, parts: [part('trucking', null)] }));
check('a cleared figure (empty) is not a zero: plain combined 1,000 again; and the same input gives the same cells (reload)', cN.outbound_cost === 1000 && cN.trucking_cost === null && JSON.stringify(run({ combined: 1000, parts: [part('trucking', 400)] }).cells) === JSON.stringify(run({ combined: 1000, parts: [part('trucking', 400)] }).cells));
var canada = cell(run({ release: '1001-7001', parts: [{ release_key: PR.relKey('1001-7001'), part: 'trucking', amount: 1400 }, { release_key: PR.relKey('1001-7001'), part: 'freight', amount: 0 }, { release_key: PR.relKey('1001-7001'), part: 'bond', amount: 200 }] }));
check('a typed bond note on a CANADA release creates no bond expense anywhere (Houston-only rule unchanged)', canada.bonded === 0 && canada.bond_inside_shipping === 200 && canada.transport_profit === 700);
// the period row and the formula
var row = P.blankPeriodRow('2026-06', 'Jun 2026'); P.addPeriodCell(row, oth); P.settlePeriodRow(row); var f = D.pnlFormula(row, null, false);
var i0 = -1, i1 = -1; f.lines.forEach(function (l, i) { if (/^Transport charged/.test(l.label)) { i0 = i; } if (l.label === 'TRANSPORT PROFIT') { i1 = i; } }); var left = f.lines[i0].cents; for (var i = i0 + 1; i < i1; i++) { left -= f.lines[i].cents; }
check('P&L by period: "Other shipping costs" is its own line in the formula and the opened period, and charged − trucking − freight − other = transport profit', row.used.other === 15000 && f.lines.some(function (l) { return /Other shipping costs/.test(l.label) && l.cents === 15000; }) && left === f.lines[i1].cents && P.periodBreakdown([oth], false).categories.some(function (k) { return k.key === 'shipping_other' && k.cents === 15000; }) && !P.periodBreakdown([base], false).categories.some(function (k) { return k.key === 'shipping_other'; }));
// the box's own arithmetic (Codex 17:33 (2): two views, never added)
var m = BOX.shippingMargin(2100, { trucking: { amount: 1400 }, freight: { amount: 0 }, bond: { amount: 200 } });
check('the box: charged 2,100 − parts 1,400 = ESTIMATED margin 700 (the transport figure); "after the 200 bond counted with the goods" = 500, shown as the same money another way', m.cost === 1400 && m.margin === 700 && m.bond === 200 && m.after_bond === 500 && m.estimated === true);
var m2 = BOX.shippingMargin(2100, { trucking: { amount: 1500 }, freight: { amount: 0 }, bond: { amount: 200 } });
check('…with trucking 1,500: 600 and 400 (Codex’s figures)', m2.margin === 600 && m2.after_bond === 400);
check('nothing typed → no margin is invented; a typed 0 counts as known; the bond is never part of the cost', BOX.shippingMargin(2100, {}).margin === null && BOX.shippingMargin(2100, { trucking: { amount: 0 } }).margin === 2100 && BOX.shippingMargin(2100, { bond: { amount: 200 } }).margin === null && BOX.shippingMargin(2100, { bond: { amount: 200 } }).cost === 0);
check('the Release # box may hold several releases: each gets its own row', BOX.releasesOfText('1002-7001 / 1002-7002').length === 2 && BOX.releasesOfText('').length === 0);
// sources: never printed, permissions, SQL
var box = fs.readFileSync(path.join(root, 'src/components/ShippingPartsBox.jsx'), 'utf8'); var inv = fs.readFileSync(path.join(root, 'src/components/AccountingInvoicesTab.jsx'), 'utf8'); var route = fs.readFileSync(path.join(root, 'src/app/api/accounting/profitability/route.js'), 'utf8');
check('the box saves through the Profitability route only (set_part_estimate / release_parts) — it never calls the invoice save, so the invoice, its PDF and Wave are untouched', box.indexOf("'/api/accounting/profitability'") > 0 && box.indexOf('invoice-write') < 0 && box.indexOf("action: 'set_part_estimate'") > 0 && inv.indexOf('<ShippingPartsBox releaseText={hdr.release_number} charged={shipAmt} terms={st}') > 0);
check('nothing on the print / Wave side reads the parts: the table name appears only in the profitability loader and route', (function () { var hits = []; (function walkDir(dir) { fs.readdirSync(dir).forEach(function (n) { var fp = path.join(dir, n); var st = fs.statSync(fp); if (st.isDirectory()) { walkDir(fp); } else if (/\.(js|jsx)$/.test(n) && fs.readFileSync(fp, 'utf8').indexOf('pl_release_part_estimates') >= 0) { hits.push(path.relative(root, fp).replace(/\\/g, '/')); } }); })(path.join(root, 'src')); return hits.filter(function (h) { return !/WhatsNewWidget/.test(h); }).sort().join(',') === 'src/app/api/accounting/profitability/route.js,src/lib/profitability-load-server.js'; })());
check('server: reading the parts sits behind "P&L: View" and before the edit gate; saving any part stays behind "P&L: Edit Product Costs"; a staff member without P&L access gets nothing', route.indexOf("if (action === 'release_parts') {") > route.indexOf("assertPermission(db, userId, 'pnl.view', req)") && route.indexOf("if (action === 'release_parts') {") < route.indexOf("var pe = await assertPermission(db, userId, 'pnl.edit_costs', req);") && route.indexOf("if (action === 'set_part_estimate') {") > route.indexOf("var pe = await assertPermission(db, userId, 'pnl.edit_costs', req);") && (function () { var a = route.indexOf("if (action === 'release_parts') {"); var blk = route.substring(a, route.indexOf("if (action === 'inbound_trucking') {")); return !/\.(insert|update|upsert|delete|rpc)\(/.test(blk); })());
check('server: bond / other saved before the database step → a plain "NOT SAVED — run the script" message, never a silent loss', route.indexOf("NOT SAVED — the database does not accept “' + part + '” yet. Run sql/v55-83-WH-shipping-parts.sql") > 0 && route.indexOf("body.part === 'bond' || body.part === 'other'") > 0);
var sql = fs.readFileSync(path.join(root, 'sql/v55-83-WH-shipping-parts.sql'), 'utf8');
check('ONE small SQL: it only widens the allowed parts (trucking, freight, bond, other); no row is touched, no comment lines', /check \(part in \('trucking', 'freight', 'bond', 'other'\)\)/.test(sql) && !/delete from|drop table|truncate|update |insert |^--/im.test(sql));
check('wording on the box: internal, never printed; the combined amount stays on a partial breakdown; inside-the-price invoices do not show a made-up charge', box.indexOf('INTERNAL: never printed, never sent to the customer or to Wave') > 0 && box.indexOf('typing one part, also 0, never wipes it out; both parts typed replace it') > 0 && box.indexOf("props.terms === 'CNF_INCLUDED'") > 0 && box.indexOf('it is not added to anything') > 0);
console.log('\nWH: ' + pass + ' passed, ' + failN + ' failed');
if (failN) { process.exit(1); }
