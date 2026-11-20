// v55.83-VS — Max, 20 Nov 2026: "for june it says there is 4 trucking that are unknown. if there is an estimate or manual number
// including 0 there is no unknown ... it needs to be clear as to what remains open" · "needs MUCH more clarity on what to fix
// exactly. manual is accepted unless bill overturns it. but needs more user friendly to resolve and to update after resolved".
// The real rule functions on made-up sale lines, the real engine for the 0 / estimate / bill order, and the screen wiring.
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var P = require(path.join(root, 'src/lib/pnl-period.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 700))); }
console.log('VS — what remains open in a period');
function cell(o) { return Object.assign({ invoice_id: 'i' + o.invoice, invoice_date: '2026-06-10', customer: 'Cust', product: 'Vinyl', release_raw: '1002-1', pounds: 100, goods_revenue: 1000, base_cost: 300, transport_revenue: 0, trucking_cost: 50, freight_cost: 60, goods_profit: 500, transport_profit: -110, profit: 390 }, o); }
var cells = [
  cell({ invoice: 'A1' }),                                                         // complete
  cell({ invoice: 'A2', release_raw: '1001-1588', trucking_cost: null, transport_profit: null, profit: null }),
  cell({ invoice: 'A3', release_raw: '1001-1588', trucking_cost: null, transport_profit: null, profit: null, goods_revenue: 500 }),
  cell({ invoice: 'A4', release_raw: '1001-1568', trucking_cost: null, freight_cost: null, transport_profit: null, profit: null }),
  cell({ invoice: 'A5', release_raw: '', release: '', trucking_cost: null, freight_cost: null, transport_profit: null, profit: null }),
  cell({ invoice: 'A6', trucking_cost: 0, freight_cost: 0, transport_profit: 0 }),  // typed 0 = known
  cell({ invoice: 'A7', product: 'Foam roll', pounds: null, base_cost: null, goods_profit: null, profit: null }),
  cell({ invoice: 'A8', product: 'Carpet', base_cost: null, goods_profit: null, profit: null }),
  cell({ invoice: 'A9', product: 'Carpet', base_cost: null, goods_profit: null, profit: null }),
  cell({ invoice: 'A10', transport_revenue: null, transport_profit: null, profit: null })
];
var o = P.openTasks(cells);
function T(k) { return o.tasks.filter(function (t) { return t.key === k; })[0]; }
check('a complete line and a line whose trucking and freight are 0 are NOT open', !o.tasks.some(function (t) { return t.invoices.some(function (x) { return x.invoice === 'A1' || x.invoice === 'A6'; }); }));
check('two sale lines on one release with no trucking = ONE thing to fix, naming the release, both invoices, and the money behind it', T('trucking:1001-1588').lines === 2 && T('trucking:1001-1588').sold_for === 1500 && T('trucking:1001-1588').invoices.map(function (x) { return x.invoice; }).join() === 'A2,A3' && T('trucking:1001-1588').title === 'Release 1001-1588 — no trucking cost' && T('trucking:1001-1588').action === 'type' && T('trucking:1001-1588').part === 'trucking' && T('trucking:1001-1588').release === '1001-1588');
check('its freight is known, so freight is not listed for that release', T('freight:1001-1588') === undefined);
check('a release with neither figure gives two rows: trucking and freight, each typed on its own', T('trucking:1001-1568').part === 'trucking' && T('freight:1001-1568').part === 'freight');
check('the words say what to type, that 0 is a figure, and that a bill replaces it', /Type the trucking cost here — type 0 if there was none\. A trucking bill for this release replaces it when it arrives\./.test(T('trucking:1001-1568').how) && /no trucking bill, no typed figure and no estimate/.test(T('trucking:1001-1568').how));
check('a sale with no release number is its own kind of row: nothing to type, the invoice needs its release number', T('norelease:A5').action === 'open_invoice' && T('norelease:A5').invoice_id === 'iA5' && /put the release number on it/.test(T('norelease:A5').how) && T('trucking:') === undefined && T('freight:') === undefined);
check('no weight and no supplier cost are grouped by product and point to Set-up', T('pounds:Foam roll').action === 'setup' && T('base_cost:Carpet').lines === 2 && T('base_cost:Carpet').invoices.length === 2 && T('base_cost:Foam roll') === undefined);
check('shipping terms not known is one row per invoice', T('terms:A10').action === 'open_invoice' && T('terms:A10').kind === 'transport_revenue' && /Either the shipping terms of the invoice are not set .* or a goods line on it has no weight/.test(T('terms:A10').how));
check('the count of sale lines covered counts each line once, even when it lacks two things', o.lines === 8 && o.tasks.length === 7, { lines: o.lines, tasks: o.tasks.length });
check('shipping first, then missing release numbers, then product costs', o.tasks[0].kind === 'trucking' || o.tasks[0].kind === 'freight', o.tasks.map(function (t) { return t.kind; }));
check('every line that linesToFix lists is covered by a task, and the other way round', (function () { var fx = P.linesToFix(cells); return fx.rows.length === o.lines; })());
check('a person who may not see profit gets no list', P.openTasks(cells, true).hidden === true && P.openTasks(cells, true).tasks.length === 0 && P.openTasks([{ invoice: 'x' }]).hidden === true);
check('nothing open → an empty list', P.openTasks([cell({ invoice: 'Z' })]).tasks.length === 0 && P.openTasks([]).tasks.length === 0);
var o2 = P.openTasks(cells.map(function (c) { return c.release_raw === '1001-1588' ? Object.assign({}, c, { trucking_cost: 0, transport_profit: 0, profit: 100 }) : c; }));
check('after the trucking of 1001-1588 is typed as 0, that row is gone and the rest stays', o2.tasks.length === 6 && !o2.tasks.some(function (t) { return t.key === 'trucking:1001-1588'; }) && o2.lines === 6);

// the engine's own order: bill > typed figure (also 0) > estimate; nothing at all = unknown
var asm = fs.readFileSync(path.join(root, 'src/lib/profitability-assemble.js'), 'utf8');
check('ENGINE: a bill wins, then a typed figure, then the warehouse estimate — and a typed or estimated 0 is a figure (numOrNull keeps 0)', asm.indexOf("if (bl.length) { return { amount: r2(bl.reduce(") > 0 && asm.indexOf("var tp = typedPart[rel] && typedPart[rel][name]; if (tp) { return { amount: tp.amount, kind: 'manual'") > asm.indexOf("if (bl.length) { return { amount: r2(bl.reduce(") && asm.indexOf("var u = numOrNull(wRow[name + '_used']); if (u !== null)") > asm.indexOf("var tp = typedPart[rel] && typedPart[rel][name];") && asm.indexOf("function numOrNull(v) { return v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : r2(v); }") > 0 && asm.indexOf("} else if (pu && relTot === 0 && c.outbound_cost === 0) { if (pu.trucking) { c.trucking_cost = 0; } if (pu.freight) { c.freight_cost = 0; } }") > 0);

// ── Codex 07:00 — the REAL engine, then the list, then the save the list would send, then the engine again (no database)
var A = require(path.join(root, 'src/lib/profitability-assemble.js')); var PR = require(path.join(root, 'src/lib/profitability.js'));
function run(o) {
  var items = o.items || [{ id: 'l1', invoice_id: 'i1', wave_product_name: 'Paper', description: 'Paper', quantity: 100, unit_price: 10 }];
  return A.assembleProfitability({ date_from: '2026-01-01', date_to: '', windowDays: 90, warehouseOn: false,
    invoices: [{ id: 'i1', invoice_number: 'INV 1', accounting_customer_id: 'c1', invoice_date: '2026-06-10', record_status: 'active', currency: 'USD', release_number: o.release || '1001-9001' }],
    items: items, customerNames: { c1: 'Alpha' }, terms: [{ invoice_id: 'i1', shipping_terms: 'EXW' }],
    nameUnits: [{ name_key: PR.nameKey('Paper'), unit: 'lb' }], groups: [], groupNames: [], bills: o.bills || [], billLines: [], warehouseRows: [],
    estimates: o.estimates || [], partEstimates: o.partEstimates || [], lineReleasePounds: o.lineReleasePounds || [] });
}
var RK = PR.relKey('1001-9001');
// the made-up product has no supplier bill, so every run also lists "no supplier cost" — that row is not what these checks are about
function tasksOf(r) { var o2 = P.openTasks(r.cells || []); o2.tasks = o2.tasks.filter(function (k) { return k.kind !== 'base_cost'; }); return o2; }
function hasType(t) { return t.tasks.some(function (k) { return k.action === 'type'; }); }
// P1 — an existing single shipping total
var e1 = run({ estimates: [{ release_key: RK, outbound_estimate: 1000 }] }); var t1 = tasksOf(e1); var c1 = (e1.cells || [])[0];
check('Codex P1, ENGINE: a release with one shipping total of $1,000 and no parts — the money is used (outbound 1,000), the parts are empty, and the cell says the total is not divided', c1 && c1.outbound_cost === 1000 && c1.trucking_cost === null && c1.freight_cost === null && c1.shipping_total_unsplit === 1000, c1 && [c1.outbound_cost, c1.trucking_cost, c1.shipping_total_unsplit]);
check('…the list does NOT call it missing and offers NO typing box: one row, "one shipping total, not divided", with the $1,000 and a button to Containers', t1.tasks.length === 1 && t1.tasks[0].kind === 'unsplit_total' && t1.tasks[0].action === 'containers' && t1.tasks[0].amount === 1000 && !hasType(t1) && /IS used in the profit\. Nothing is missing/.test(t1.tasks[0].how) && /type both/.test(t1.tasks[0].how));
var e1b = run({ estimates: [{ release_key: RK, outbound_estimate: 1000 }], partEstimates: [{ release_key: RK, part: 'trucking', amount: 0 }] });
check('…(why it matters) a one-part save of trucking = 0 WOULD drop the $1,000 in the engine — which is exactly why the list never offers it here', (e1b.cells || [])[0].outbound_cost !== 1000);
var e1z = run({ estimates: [{ release_key: RK, outbound_estimate: 0 }] });
check('…a single total of 0 is known too: no typing offered', !hasType(tasksOf(e1z)) && (e1z.cells || [])[0].shipping_total_unsplit === 0);
// nothing at all → typing IS offered, and the save the list sends closes it
var e0 = run({}); var t0 = tasksOf(e0);
check('ENGINE: nothing at all for the release → two typing rows (trucking, freight)', t0.tasks.filter(function (k) { return k.action === 'type'; }).map(function (k) { return k.part; }).sort().join() === 'freight,trucking' && t0.tasks.every(function (k) { return k.release === '1001-9001'; }));
var sent = t0.tasks.filter(function (k) { return k.action === 'type'; }).map(function (k) { return { release_key: PR.relKey(k.release), part: k.part, amount: k.part === 'trucking' ? 0 : 250 }; });
var e0b = run({ partEstimates: sent }); var c0b = (e0b.cells || [])[0];
check('…engine → list → the save payload (release as shown, through relKey; trucking 0, freight 250) → engine: both parts known (0 and 250), and the list is empty', c0b.trucking_cost === 0 && c0b.freight_cost === 250 && c0b.trucking_kind === 'manual' && tasksOf(e0b).tasks.length === 0, [c0b.trucking_cost, c0b.freight_cost, tasksOf(e0b).tasks]);
var e0c = run({ partEstimates: [{ release_key: RK, part: 'trucking', amount: 0 }, { release_key: RK, part: 'freight', amount: 0 }] });
check('…both typed as 0: known, nothing open', (e0c.cells || [])[0].trucking_cost === 0 && (e0c.cells || [])[0].freight_cost === 0 && tasksOf(e0c).tasks.length === 0);
var e0d = run({ partEstimates: [{ release_key: RK, part: 'freight', amount: 400 }] }); var t0d = tasksOf(e0d);
check('…freight typed, trucking nothing: ONE typing row, for trucking only', t0d.tasks.length === 1 && t0d.tasks[0].action === 'type' && t0d.tasks[0].part === 'trucking');
var bill = { id: 'b1', bill_number: 'TR-1', vendor_name: 'Trucker', bill_type: 'trucking', shipment_direction: 'outbound', release_number: '1001-9001', total_amount: 300, record_status: 'active', bill_date: '2026-06-12' };
var eB = run({ bills: [bill], partEstimates: [{ release_key: RK, part: 'trucking', amount: 111 }, { release_key: RK, part: 'freight', amount: 0 }] }); var cB = (eB.cells || [])[0];
check('…a trucking BILL overrules the typed figure (300, not 111) and nothing is listed', cB.trucking_cost === 300 && cB.trucking_kind === 'bill' && tasksOf(eB).tasks.length === 0, [cB.trucking_cost, cB.trucking_kind]);
// P2 — known parts, but a sibling line has no weight
var two = [{ id: 'l1', invoice_id: 'i1', wave_product_name: 'Paper', description: 'Paper', quantity: 100, unit_price: 10 }, { id: 'l2', invoice_id: 'i1', wave_product_name: 'Mystery', description: 'Mystery', quantity: 5, unit_price: 10 }];
var e2 = run({ items: two, partEstimates: [{ release_key: RK, part: 'trucking', amount: 100 }, { release_key: RK, part: 'freight', amount: 0 }] }); var t2 = tasksOf(e2);
check('Codex P2, ENGINE: typed trucking $100 / freight 0, one line without weight → the parts are known (manual) but the shares are empty', (e2.cells || []).some(function (c) { return c.trucking_kind === 'manual' && c.trucking_cost === null; }), (e2.cells || []).map(function (c) { return [c.trucking_kind, c.trucking_cost, c.pounds]; }));
check('…the list does NOT say "no trucking cost" and offers NO typing: it says the figure is known and the weight is what is missing', !hasType(t2) && !t2.tasks.some(function (k) { return k.kind === 'trucking' || k.kind === 'freight'; }) && t2.tasks.some(function (k) { return k.kind === 'not_shared' && k.action === 'setup' && /Do not type the figure again/.test(k.how); }) && t2.tasks.some(function (k) { return k.kind === 'pounds' && /Mystery/.test(k.title); }), t2.tasks.map(function (k) { return k.key; }));
var e2b = run({ items: two, bills: [bill], partEstimates: [{ release_key: RK, part: 'freight', amount: 0 }] });
check('…the same with a trucking bill as the source: no typing offered', !hasType(tasksOf(e2b)));
// P3 — two releases on the invoice, pounds not divided
var e3 = run({ release: '1001-9001 / 1001-9002' }); var t3 = tasksOf(e3);
check('Codex P3, ENGINE: an invoice on two releases without pounds per release → the cell has no release AND says why', (e3.cells || []).length > 0 && (e3.cells || []).every(function (c) { return !c.release && (c.flags || []).indexOf('release_split_missing') >= 0 && c.releases_on_invoice === 2; }), (e3.cells || []).map(function (c) { return [c.release, c.flags, c.releases_on_invoice]; }));
check('…the list says "on 2 releases, pounds not divided" and to LEAVE the release numbers — never "no release number", never a typing box', t3.tasks.length === 1 && t3.tasks[0].kind === 'release_split' && /on 2 releases, pounds not divided/.test(t3.tasks[0].title) && /leave them/.test(t3.tasks[0].how) && !t3.tasks.some(function (k) { return k.kind === 'no_release'; }) && !hasType(t3), t3.tasks);
var e3b = run({ release: '1001-9001 / 1001-9002', lineReleasePounds: [{ invoice_item_id: 'l1', release_key: PR.relKey('1001-9001'), pounds: 60 }, { invoice_item_id: 'l1', release_key: PR.relKey('1001-9002'), pounds: 40 }] }); var t3b = tasksOf(e3b);
check('…once the pounds are divided (60 / 40) each release is its own row to type, and the split row is gone', !t3b.tasks.some(function (k) { return k.kind === 'release_split'; }) && t3b.tasks.filter(function (k) { return k.action === 'type'; }).length === 4, t3b.tasks.map(function (k) { return k.key; }));
var e3c = (function () { var r = A.assembleProfitability({ date_from: '2026-01-01', date_to: '', windowDays: 90, warehouseOn: false, invoices: [{ id: 'i1', invoice_number: 'INV 1', accounting_customer_id: 'c1', invoice_date: '2026-06-10', record_status: 'active', currency: 'USD', release_number: '' }], items: [{ id: 'l1', invoice_id: 'i1', wave_product_name: 'Paper', description: 'Paper', quantity: 100, unit_price: 10 }], customerNames: { c1: 'Alpha' }, terms: [{ invoice_id: 'i1', shipping_terms: 'EXW' }], nameUnits: [{ name_key: PR.nameKey('Paper'), unit: 'lb' }], groups: [], groupNames: [], bills: [], billLines: [], warehouseRows: [] }); return tasksOf(r); })();
check('…an invoice that truly has NO release number still says so', e3c.tasks.filter(function (k) { return k.kind === 'no_release'; }).length <= 1 && !e3c.tasks.some(function (k) { return k.kind === 'release_split'; }) && !hasType(e3c), e3c.tasks.map(function (k) { return k.key; }));

// the screen
var tab = fs.readFileSync(path.join(root, 'src/components/ProfitabilityTab.jsx'), 'utf8');
var route = fs.readFileSync(path.join(root, 'src/app/api/accounting/profitability/route.js'), 'utf8');
check('the screen imports openTasks and shows the list at the top of the Lines-to-fix box', /import \{ [^}]*openTasks[^}]* \} from '\.\.\/lib\/pnl-period';/.test(tab) && tab.indexOf('var ot = openTasks(cs, hidden);') > 0 && tab.indexOf('{openBox}') > 0 && tab.indexOf("'What remains open in ' + r.label + ': '") > 0);
check('trucking / freight are typed right in the list and saved with the existing action; an empty box cannot be saved', tab.indexOf("act({ action: 'set_part_estimate', release: t.release, part: t.part, amount: draft[tk] }") > 0 && tab.indexOf("disabled={draft[tk] === undefined || String(draft[tk]).trim() === ''}") > 0);
check('saving reloads the report, so a resolved row leaves the list by itself', /function act\(payload, okMsg\) \{[\s\S]{0,260}load\(\); return true;/.test(tab));
check('the server accepts 0 as an amount (only a negative or a non-number is refused)', route.indexOf("if (isNaN(pv) || pv < 0) { return bad('The amount must be a number, zero or more.'); }") > 0);
check('a person without the edit permission sees why they cannot type, and the invoice rows open the invoice on top', tab.indexOf('needs “P&L: Edit Product Costs”') > 0 && tab.indexOf("if (t.action === 'open_invoice') { return <span>{t.invoice_id ? <button onClick={function (e) { e.stopPropagation(); setPeekId(t.invoice_id); }}") > 0);
check('the list says the rule in plain words', tab.indexOf('A figure that is already there — a bill, a typed figure or an estimate, also 0 — counts as known and is not listed. A bill for the release always replaces a typed figure or an estimate.') > 0);

console.log('\n' + pass + ' passed, ' + failN + ' failed');
if (failN > 0) { process.exit(1); }
