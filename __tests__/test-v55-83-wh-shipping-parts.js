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
// Codex 17:40 — the box is a COST-ENTRY box: it shows what was typed, never a margin and never an "effective cost"
var tp = BOX.typedParts({ trucking: { amount: 1400 }, freight: { amount: 0 }, bond: { amount: 200 } });
check('the box’s own helper returns only what was typed (1,400 over 2 of 3 parts, bond 200 as a note) — no margin field exists any more', tp.typed === 1400 && tp.known === 2 && tp.bond === 200 && tp.margin === undefined && tp.after_bond === undefined && BOX.shippingMargin === undefined);
check('nothing typed → 0 parts; a typed 0 counts as known; an empty figure does not; the bond is never part of the typed cost', BOX.typedParts({}).known === 0 && BOX.typedParts({ trucking: { amount: 0 } }).known === 1 && BOX.typedParts({ trucking: { amount: null } }).known === 0 && BOX.typedParts({ trucking: { amount: '' } }).known === 0 && BOX.typedParts({ bond: { amount: 200 } }).typed === 0);
var RSS = require('react-dom/server'); var Box = BOX.default;
function render(parts, extra) { return RSS.renderToStaticMarkup(React.createElement(Box, Object.assign({ releaseText: '1002-7001', charged: 2100, terms: 'CNF_SEPARATE', initialOpen: true, initialData: { ok: true, can_edit: true, parts: { '10027001': parts } } }, extra || {}))); }
var hPartial = render({ trucking: { amount: 400 } });
check('RENDERED, Codex’s case (combined 1,000 on the invoice, trucking 400 typed, freight blank): the box shows $400.00 typed (1 of 3 parts) and the $2,100.00 shipping line — and NO margin, no $1,700, no “effective” cost', hPartial.indexOf('Typed here for this release: $400.00 (1 of 3 parts)') > 0 && hPartial.indexOf('shipping line(s) on this invoice: $2,100.00') > 0 && !/margin/i.test(hPartial) && hPartial.indexOf('1,700') < 0 && hPartial.indexOf('This is not the final shipping cost and no profit is shown here') > 0, hPartial.substring(0, 400));
var hBill = render({ trucking: { amount: 1400 }, freight: { amount: 0 }, bond: { amount: 200 } });
check('RENDERED, a bill may have arrived (typed 1,400 / 0, bond 200): the box still only says what was TYPED ($1,400.00, 2 of 3) and sends the reader to Profitability for the cost in use — it claims no 700 and no 600', hBill.indexOf('Typed here for this release: $1,400.00 (2 of 3 parts)') > 0 && hBill.indexOf('$700') < 0 && hBill.indexOf('$600') < 0 && hBill.indexOf('$500') < 0 && !/margin/i.test(hBill) && hBill.indexOf('Accounting → Profitability') > 0 && hBill.indexOf('not counted a second time as a shipping cost') > 0);
var hZero = render({ trucking: { amount: 0 } }); var hClear = render({ trucking: { amount: null } });
check('RENDERED: a typed 0 shows as a known part ($0.00, 1 of 3); a cleared figure shows “Nothing typed yet”', hZero.indexOf('Typed here for this release: $0.00 (1 of 3 parts)') > 0 && hClear.indexOf('Nothing typed yet for this release') > 0 && !/margin/i.test(hZero + hClear));
var hNoEdit = RSS.renderToStaticMarkup(React.createElement(Box, { releaseText: '1002-7001', charged: 2100, terms: 'CNF_SEPARATE', initialOpen: true, initialData: { ok: true, can_edit: false, parts: { '10027001': { trucking: { amount: 400 } } } } }));
check('RENDERED for a person who may view but not edit costs (and may not see margins): figures read-only, no Save button, no profit of any kind', hNoEdit.indexOf('changing them needs “Invoices: Edit” or “P&amp;L: Edit Product Costs”') > 0 /* v55.83-XV realign: the invoicing permission is enough */ && hNoEdit.indexOf('>Save<') < 0 && !/margin/i.test(hNoEdit) && hNoEdit.split('disabled=""').length - 1 >= 5);
check('RENDERED: the box says the figures belong to the RELEASE (another invoice on it shows and changes the same figures); inside-the-price invoices show no charge', hPartial.indexOf('any other invoice on release 1002-7001 shows and changes the same figures') > 0 && render({ trucking: { amount: 400 } }, { terms: 'CNF_INCLUDED' }).indexOf('the shipping is inside the price') > 0 && render({ trucking: { amount: 400 } }, { terms: 'CNF_INCLUDED' }).indexOf('shipping line(s) on this invoice') < 0);
check('the Release # box may hold several releases: each gets its own row', BOX.releasesOfText('1002-7001 / 1002-7002').length === 2 && BOX.releasesOfText('').length === 0);
// v55.83-XS — two releases on one invoice written with "&" (AMERICA 1771), "and" or "+" are two releases, the same as Profitability reads them
var PA = require(path.join(root, 'src/lib/profitability-assemble.js'));
function keysOf(a) { return a.map(function (x) { return String(x).toUpperCase().replace(/[^A-Z0-9]/g, ''); }).join('|'); }
check('XS: "1002-1176 & 1002-1177" gives TWO releases in the box (not one made-up release)', JSON.stringify(BOX.releasesOfText('1002-1176 & 1002-1177')) === JSON.stringify(['1002-1176', '1002-1177']));
check('XS: "and", "+", comma, slash, semicolon all split; the same release twice is one row', BOX.releasesOfText('1002-1 and 1002-2 + 1002-3, 1002-4 / 1002-5; 1002-1').length === 5 && BOX.releasesOfText('1002-7001,1002-7001').length === 1);
['1002-1176 & 1002-1177', '1003-055 & 1003-056', '1002-1 and 1002-2', '1002-1+1002-2', '1002-7001 / 1002-7002', '1002-9, 1002-9', ' 1002-5 ; ', ''].forEach(function (t) {
  check('XS: the box and Profitability read "' + t + '" as the same releases', keysOf(BOX.releasesOfText(t)) === PA.splitReleases(t).map(function (r) { return r.key; }).join('|'));
});
var PT = fs.readFileSync(path.join(root, 'src/components/ProfitabilityTab.jsx'), 'utf8');
var cellsSrc = PT.slice(PT.indexOf('function cellsTable('), PT.indexOf('function customerPanel('));
var cpSrc = PT.slice(PT.indexOf('function cellPartInput('), PT.indexOf('function cellsTable('));
check('XS: the detail table has view invoice on every line (the same viewer as the report rows)', cellsSrc.indexOf('setPeekId(c.invoice_id)') > 0 && cellsSrc.indexOf('>view invoice</button>') > 0);
check('XS: the detail table offers trucking AND freight entry, saved with the SAME action as Containers (set_part_estimate for the release)', cellsSrc.indexOf("cellPartInput(c, 'trucking')") > 0 && cellsSrc.indexOf("cellPartInput(c, 'freight')") > 0 && cpSrc.indexOf("action: 'set_part_estimate', release: rel, part: partName") > 0);
check('XS: no entry box without Edit permission, without a release, when that part already has a bill, or before the TL SQL; an empty box cannot be saved (it would clear the figure)', /if (!canEdit || !c.release || (partName === 'trucking' ? c.trucking_kind : c.freight_kind) === 'bill')/.test(cpSrc) && cpSrc.indexOf('if (!data.part_estimates_ready) { return null; }') > 0 && cpSrc.indexOf("draft[k] === undefined || String(draft[k]).trim() === ''") > 0);
// sources: never printed, permissions, SQL
var box = fs.readFileSync(path.join(root, 'src/components/ShippingPartsBox.jsx'), 'utf8'); var inv = fs.readFileSync(path.join(root, 'src/components/AccountingInvoicesTab.jsx'), 'utf8'); var route = fs.readFileSync(path.join(root, 'src/app/api/accounting/profitability/route.js'), 'utf8');
check('the box saves through the Profitability route only (set_part_estimate / release_parts) — it never calls the invoice save, so the invoice, its PDF and Wave are untouched', box.indexOf("'/api/accounting/profitability'") > 0 && box.indexOf('invoice-write') < 0 && box.indexOf("action: 'set_part_estimate'") > 0 && inv.indexOf('releaseText={hdr.release_number} charged={shipAmt} terms={st}') > 0 && inv.indexOf('<ShippingPartsBox key=') > 0);
check('nothing on the print / Wave side reads the parts: the table name appears only in the profitability loader and route', (function () { var hits = []; (function walkDir(dir) { fs.readdirSync(dir).forEach(function (n) { var fp = path.join(dir, n); var st = fs.statSync(fp); if (st.isDirectory()) { walkDir(fp); } else if (/\.(js|jsx)$/.test(n) && fs.readFileSync(fp, 'utf8').indexOf('pl_release_part_estimates') >= 0) { hits.push(path.relative(root, fp).replace(/\\/g, '/')); } }); })(path.join(root, 'src')); return hits.filter(function (h) { return !/WhatsNewWidget/.test(h); }).sort().join(',') === 'src/app/api/accounting/profitability/route.js,src/lib/profitability-load-server.js'; })());
check('server: reading the parts sits behind "P&L: View" and before the edit gate; saving any part stays behind "P&L: Edit Product Costs"; a staff member without P&L access gets nothing', route.indexOf("if (action === 'release_parts') {") > route.indexOf("assertPermission(db, userId, 'pnl.view', req)") && route.indexOf("if (action === 'release_parts') {") < route.indexOf("var pe = await assertPermission(db, userId, 'pnl.edit_costs', req);") && route.indexOf("if (action === 'set_part_estimate') {") > route.indexOf("var pe = await assertPermission(db, userId, 'pnl.edit_costs', req);") && (function () { var a = route.indexOf("if (action === 'release_parts') {"); var blk = route.substring(a, route.indexOf("if (action === 'inbound_trucking') {")); return !/\.(insert|update|upsert|delete|rpc)\(/.test(blk); })());
check('server: bond / other saved before the database step → a plain "NOT SAVED — run the script" message, never a silent loss', route.indexOf("NOT SAVED — the database does not accept “' + part + '” yet. Run sql/v55-83-WH-shipping-parts.sql") > 0 && route.indexOf("body.part === 'bond' || body.part === 'other'") > 0);
var sql = fs.readFileSync(path.join(root, 'sql/v55-83-WH-shipping-parts.sql'), 'utf8');
check('ONE small SQL: it only widens the allowed parts (trucking, freight, bond, other); no row is touched, no comment lines', /check \(part in \('trucking', 'freight', 'bond', 'other'\)\)/.test(sql) && !/delete from|drop table|truncate|update |insert |^--/im.test(sql));
check('wording on the box: internal, never printed; the combined amount stays on a partial breakdown; inside-the-price invoices do not show a made-up charge', box.indexOf('INTERNAL: never printed, never sent to the customer or to Wave') > 0 && box.indexOf('typing one part, also 0, never wipes it out; both parts typed replace it') > 0 && box.indexOf("props.terms === 'CNF_INCLUDED'") > 0 && !/margin\s*[:=]|after_bond/.test(box));
// ── the REAL route, run with stubs (Codex 17:40: "test the real request/response permission path, not just source string ordering")
var Module = require('module');
function stub(file, exportsObj) { var id = require.resolve(file); var m0 = new Module(id); m0.filename = id; m0.loaded = true; m0.exports = exportsObj; require.cache[id] = m0; }
var world = { who: { userId: 'u1' }, perms: {}, tables: { pl_release_part_estimates: [{ release_key: '10027001', part: 'trucking', amount: 400, note: null, updated_at: 't' }, { release_key: '10027001', part: 'bond', amount: 200, note: null, updated_at: 't' }, { release_key: '99999999', part: 'trucking', amount: 77, note: null, updated_at: 't' }] }, writes: 0, upserts: [] };
function chain(table) { var q = { ins: null };
  ['select', 'order', 'eq'].forEach(function (k) { q[k] = function () { return q; }; });
  q.in = function (c, vals) { q.ins = [c, vals]; return q; };
  q.upsert = function (rowU) { world.writes += 1; world.upserts.push(rowU); return Promise.resolve({ error: world.upsertError || null }); };
  ['insert', 'update', 'delete'].forEach(function (k) { q[k] = function () { world.writes += 1; return q; }; });
  q.maybeSingle = function () { return Promise.resolve({ data: null, error: null }); };
  q.then = function (ok, no) { var rows = (world.tables[table] || []).filter(function (r) { return !q.ins || q.ins[1].indexOf(r[q.ins[0]]) >= 0; }); return Promise.resolve({ data: rows, error: null }).then(ok, no); };
  return q; }
stub(path.join(root, 'node_modules/next/server.js'), { NextResponse: { json: function (body, init) { return { status: (init && init.status) || 200, body: body }; } } });
stub('@supabase/supabase-js', { createClient: function () { return { from: chain, rpc: function () { world.writes += 1; return Promise.resolve({}); } }; } });
stub(path.join(root, 'src/lib/verified-caller.js'), { verifiedCaller: async function () { return world.who; } });
stub(path.join(root, 'src/lib/server-permissions.js'), { assertPermission: async function (db, userId, key) { return world.perms[key] ? { ok: true, ctx: {} } : { ok: false }; } });
stub(path.join(root, 'src/lib/visibility-window-server.js'), { windowFloorFor: async function () { return { floor: null }; }, clampFrom: function (d0) { return d0; } });
stub(path.join(root, 'src/lib/audit-server.js'), { audit: async function () { world.audits = (world.audits || 0) + 1; } });
var ROUTE = require(path.join(root, 'src/app/api/accounting/profitability/route.js'));
function post(body) { return ROUTE.POST({ json: async function () { return body; }, headers: { get: function () { return 'Bearer x'; } } }); }
(async function () {
  world.perms = {}; var r0 = await post({ user_id: 'u1', action: 'release_parts', releases: ['1002-7001'] });
  check('ROUTE: a person with NO P&L access (for example invoice staff) asking for the parts → 403 and not one figure in the answer', r0.status === 403 && JSON.stringify(r0.body).indexOf('400') < 0 && !r0.body.parts);
  world.perms = { 'pnl.view': true }; var r1 = await post({ user_id: 'u1', action: 'release_parts', releases: ['1002-7001'] }); var r1s = JSON.stringify(Object.assign({}, r1.body, { api_build_marker: '' })); // the marker is the route's own name (…profitability), not a figure
  check('ROUTE: P&L View without Edit and WITHOUT the margin permission → the typed parts of THAT release only, can_edit false, and no profit / margin field of any kind in the answer', r1.status === 200 && r1.body.ok === true && r1.body.can_edit === false && r1.body.parts['10027001'].trucking.amount === 400 && r1.body.parts['10027001'].bond.amount === 200 && r1s.indexOf('77') < 0 && !/profit|margin/i.test(r1s), r1.body);
  world.perms = { 'pnl.view': true, 'pnl.view_margin': true, 'pnl.edit_costs': true }; var r2 = await post({ user_id: 'u1', action: 'release_parts', releases: ['1002-7001'] });
  check('ROUTE: with the margin permission the answer is the SAME (the box never carries profit for anyone); can_edit true with Edit Product Costs', r2.body.can_edit === true && !/profit|margin/i.test(JSON.stringify(Object.assign({}, r2.body, { api_build_marker: '' }))) && JSON.stringify(r2.body.parts) === JSON.stringify(r1.body.parts) && world.writes === 0);
  world.perms = { 'pnl.view': true }; var w0 = await post({ user_id: 'u1', action: 'set_part_estimate', release: '1002-7001', part: 'other', amount: '150', note: 'chassis fee' });
  check('ROUTE: saving a part without “P&L: Edit Product Costs” → refused, nothing written', w0.status === 403 && world.writes === 0, w0);
  world.perms = { 'pnl.view': true, 'pnl.edit_costs': true }; var w1 = await post({ user_id: 'u1', action: 'set_part_estimate', release: '1002-7001', part: 'other', amount: '150', note: 'chassis fee' });
  check('ROUTE: with the permission, “other 150 — chassis fee” is saved for the release (one upsert, audited); bond is accepted as a part too', w1.status === 200 && w1.body.ok === true && world.upserts.length === 1 && world.upserts[0].release_key === '10027001' && world.upserts[0].part === 'other' && world.upserts[0].amount === 150 && world.upserts[0].note === 'chassis fee' && world.audits === 1 && (await post({ user_id: 'u1', action: 'set_part_estimate', release: '1002-7001', part: 'bond', amount: '200' })).status === 200);
  world.upsertError = { message: 'new row for relation "pl_release_part_estimates" violates check constraint "pl_release_part_estimates_part_check"' }; var w2 = await post({ user_id: 'u1', action: 'set_part_estimate', release: '1002-7001', part: 'other', amount: '150' });
  check('ROUTE: before the database step, saving “other” answers NOT SAVED with the script to run — never a silent success', w2.status === 400 && /NOT SAVED/.test(w2.body.error) && /v55-83-WH-shipping-parts\.sql/.test(w2.body.error));
  world.upsertError = null; var w3 = await post({ user_id: 'u1', action: 'set_part_estimate', release: '1002-7001', part: 'fuel', amount: '1' }); var w4 = await post({ user_id: 'u1', action: 'set_part_estimate', release: '1002-7001', part: 'other', amount: '-5' });
  check('ROUTE: an unknown part and a negative amount are refused', w3.status === 400 && w4.status === 400);
  console.log('\nWH: ' + pass + ' passed, ' + failN + ' failed');
  if (failN) { process.exit(1); }
})().catch(function (err) { console.log('  ✗ FAIL: route run threw ' + ((err && err.stack) || err)); process.exit(1); });
