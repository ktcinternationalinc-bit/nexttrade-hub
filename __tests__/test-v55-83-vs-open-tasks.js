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
check('no weight and no supplier cost are grouped by product; v55.83-VT: the unit is picked right in the row (no trip to Set-up)', T('pounds:Foam roll').action === 'unit' && T('pounds:Foam roll').names.length >= 1 && T('base_cost:Carpet').lines === 2 && T('base_cost:Carpet').invoices.length === 2 && T('base_cost:Foam roll') === undefined);
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
check('ENGINE: a bill wins, then a typed figure, then the warehouse estimate — and a typed or estimated 0 is a figure (numOrNull keeps 0)', asm.indexOf("if (bl.length) { return { amount: r2(bl.reduce(") > 0 && asm.indexOf("var tp = typedPart[rel] && typedPart[rel][name]; if (tp) { return { amount: tp.amount, kind: 'manual'") > asm.indexOf("if (bl.length) { return { amount: r2(bl.reduce(") && asm.indexOf("var u = numOrNull(wRow[name + '_used']); if (u !== null)") > asm.indexOf("var tp = typedPart[rel] && typedPart[rel][name];") && asm.indexOf("function numOrNull(v) { return v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : r2(v); }") > 0 && asm.indexOf("} else if (pu && relTot === 0 && c.outbound_cost === 0) { if (pu.trucking) { c.trucking_cost = 0; } if (pu.freight) { c.freight_cost = 0; }") > 0);

// ── Codex 07:00 — the REAL engine, then the list, then the save the list would send, then the engine again (no database)
var A = require(path.join(root, 'src/lib/profitability-assemble.js')); var PR = require(path.join(root, 'src/lib/profitability.js'));
function run(o) {
  var items = o.items || [{ id: 'l1', invoice_id: 'i1', wave_product_name: 'Paper', description: 'Paper', quantity: 100, unit_price: 10 }];
  return A.assembleProfitability({ date_from: '2026-01-01', date_to: '', windowDays: 90, warehouseOn: false,
    invoices: [{ id: 'i1', invoice_number: 'INV 1', accounting_customer_id: 'c1', invoice_date: '2026-06-10', record_status: 'active', currency: 'USD', release_number: o.release || '1001-9001' }],
    items: items, customerNames: { c1: 'Alpha' }, terms: o.terms || [{ invoice_id: 'i1', shipping_terms: 'EXW' }],
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
check('…the list has NOTHING to fix for it: no missing-cost row, no typing box, no request to divide it — only a grey note that the release uses a combined cost', t1.tasks.length === 0 && !hasType(t1) && t1.combined.length === 1 && t1.combined[0].release === '1001-9001' && t1.combined[0].amount === 1000 && P.linesToFix((e1.cells || []).map(function (c) { return Object.assign({}, c, { base_cost: 1 }); })).rows.every(function (r) { return r.missing.indexOf('trucking_cost') < 0 && r.missing.indexOf('freight_cost') < 0; }));
// Max to Codex, 20 Nov — combined $1,000, then a manual trucking of 0: the total stays, trucking is 0, nothing is counted twice
var e1b = run({ estimates: [{ release_key: RK, outbound_estimate: 1000 }], partEstimates: [{ release_key: RK, part: 'trucking', amount: 0 }] }); var c1b = (e1b.cells || [])[0]; var t1b = tasksOf(e1b);
check('Max to Codex: combined $1,000 + manual trucking $0 → outbound stays 1,000, trucking is explicitly 0 (manual, not missing), counted ONCE', c1b.outbound_cost === 1000 && c1b.trucking_cost === 0 && c1b.trucking_kind === 'manual' && (e1b.totals ? true : true), [c1b.outbound_cost, c1b.trucking_cost, c1b.trucking_kind]);
check('…the remaining 1,000 keeps its combined provenance: it is NOT relabelled as freight (freight stays empty, kind empty), it is marked combined / not separated', c1b.freight_cost === null && !c1b.freight_kind && c1b.shipping_total_unsplit === 1000 && c1b.shipping_combined === true);
check('…and no false task appears: nothing says "no freight cost", no typing box', t1b.tasks.length === 0 && t1b.combined.length === 1 && t1b.combined[0].amount === 1000);
var e1c = run({ estimates: [{ release_key: RK, outbound_estimate: 1000 }], partEstimates: [{ release_key: RK, part: 'trucking', amount: 300 }] }); var c1c = (e1c.cells || [])[0];
check('…combined $1,000 + trucking $300: total still 1,000 (not 1,300, not 300); trucking 300; 700 stays combined / not separated', c1c.outbound_cost === 1000 && c1c.trucking_cost === 300 && c1c.freight_cost === null && c1c.shipping_total_unsplit === 700 && tasksOf(e1c).tasks.length === 0);
var e1d = run({ estimates: [{ release_key: RK, outbound_estimate: 1000 }], partEstimates: [{ release_key: RK, part: 'trucking', amount: 300 }, { release_key: RK, part: 'freight', amount: 500 }] }); var c1d = (e1d.cells || [])[0];
check('…BOTH parts typed (300 + 500): the explicit split replaces the combined total — 800, nothing combined left', c1d.outbound_cost === 800 && c1d.trucking_cost === 300 && c1d.freight_cost === 500 && c1d.shipping_total_unsplit === null && tasksOf(e1d).combined.length === 0);
var e1e = run({ estimates: [{ release_key: RK, outbound_estimate: 1000 }], partEstimates: [{ release_key: RK, part: 'freight', amount: 1400 }] }); var c1e = (e1e.cells || [])[0];
check('…one part ALONE larger than the combined total (freight 1,400 vs 1,000): the larger known figure is the cost, and it is flagged for a person', c1e.outbound_cost === 1400 && c1e.freight_cost === 1400 && c1e.shipping_total_unsplit === 0 && (e1e.flags || []).some(function (f) { return f.kind === 'part_exceeds_combined_total' && f.combined_total === 1000 && f.part_amount === 1400; }));
var e1f = run({ estimates: [{ release_key: RK, outbound_estimate: 1000 }], partEstimates: [{ release_key: RK, part: 'trucking', amount: null }] });
check('…CLEARING the trucking box (empty, not 0) is not a zero: back to the plain combined 1,000 with trucking empty', (e1f.cells || [])[0].outbound_cost === 1000 && (e1f.cells || [])[0].trucking_cost === null && !(e1f.cells || [])[0].trucking_kind && (e1f.cells || [])[0].shipping_total_unsplit === 1000);
var e1g = run({ estimates: [{ release_key: RK, outbound_estimate: 0 }], partEstimates: [{ release_key: RK, part: 'trucking', amount: 0 }] });
check('…combined 0 + trucking 0: known 0, nothing open', (e1g.cells || [])[0].outbound_cost === 0 && (e1g.cells || [])[0].trucking_cost === 0 && tasksOf(e1g).tasks.length === 0);
var e1h = run({ estimates: [{ release_key: RK, outbound_estimate: 1000 }], bills: [{ id: 'b1', bill_number: 'TR-1', vendor_name: 'Trucker', bill_type: 'trucking', shipment_direction: 'outbound', release_number: '1001-9001', total_amount: 300, record_status: 'active', bill_date: '2026-06-12' }] }); var c1h = (e1h.cells || [])[0];
check('…a trucking BILL of 300 next to a combined 1,000: same rule — total 1,000, trucking 300 from the bill, 700 combined; the total is an estimate, not called final', c1h.outbound_cost === 1000 && c1h.trucking_cost === 300 && c1h.trucking_kind === 'bill' && c1h.shipping_total_unsplit === 700, [c1h.outbound_cost, c1h.trucking_cost, c1h.shipping_total_unsplit]);
check('…the same answer when the report is built again from the same input (reload)', JSON.stringify(run({ estimates: [{ release_key: RK, outbound_estimate: 1000 }], partEstimates: [{ release_key: RK, part: 'trucking', amount: 0 }] }).cells) === JSON.stringify(e1b.cells));
var e1z = run({ estimates: [{ release_key: RK, outbound_estimate: 0 }] });
check('…a single total of 0 is known too: nothing to fix', tasksOf(e1z).tasks.length === 0 && (e1z.cells || [])[0].shipping_total_unsplit === 0 && (e1z.cells || [])[0].outbound_cost === 0);
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
// ── Codex 07:20 P1 — the FREIGHT mirror: a known freight part is its own amount, never the whole combined total
function cellsOfRun(o) { return run(o).cells || []; }
function rec(c) { return Math.abs((c.trucking_cost || 0) + (c.freight_cost || 0) + (c.shipping_combined_share || 0) - c.outbound_cost) < 0.006; }
var f0 = cellsOfRun({ estimates: [{ release_key: RK, outbound_estimate: 1000 }], partEstimates: [{ release_key: RK, part: 'freight', amount: 0 }] })[0];
check('Codex 07:20: combined $1,000 + manual freight $0 → total 1,000, freight is 0 (it was shown as 1,000), trucking empty with no kind, 1,000 stays combined', f0.outbound_cost === 1000 && f0.freight_cost === 0 && f0.freight_kind === 'manual' && f0.trucking_cost === null && !f0.trucking_kind && f0.shipping_total_unsplit === 1000 && f0.shipping_combined_share === 1000 && rec(f0), [f0.outbound_cost, f0.freight_cost, f0.shipping_combined_share]);
var f250 = cellsOfRun({ estimates: [{ release_key: RK, outbound_estimate: 1000 }], partEstimates: [{ release_key: RK, part: 'freight', amount: 250 }] })[0];
check('…combined $1,000 + manual freight $250 → freight 250 (not 1,000), 750 combined, parts + remainder = total', f250.outbound_cost === 1000 && f250.freight_cost === 250 && f250.shipping_total_unsplit === 750 && f250.shipping_combined_share === 750 && rec(f250), [f250.freight_cost, f250.shipping_combined_share]);
var shipBill = { id: 'b9', bill_number: 'FR-1', vendor_name: 'Forwarder', bill_type: 'shipping', shipment_direction: 'outbound', release_number: '1001-9001', total_amount: 250, record_status: 'active', bill_date: '2026-06-12' };
var fb = cellsOfRun({ estimates: [{ release_key: RK, outbound_estimate: 1000 }], bills: [shipBill] })[0];
check('…the same with a freight BILL of $250 as the source: freight 250 from the bill, 750 combined, total 1,000; the remainder has no source kind of its own', fb.outbound_cost === 1000 && fb.freight_cost === 250 && fb.freight_kind === 'bill' && fb.trucking_cost === null && !fb.trucking_kind && fb.shipping_combined_share === 750 && rec(fb), [fb.outbound_cost, fb.freight_cost, fb.freight_kind]);
var twoP = [{ id: 'l1', invoice_id: 'i1', wave_product_name: 'Paper', description: 'Paper', quantity: 100, unit_price: 10 }, { id: 'l2', invoice_id: 'i1', wave_product_name: 'Paper', description: 'Paper', quantity: 200, unit_price: 10 }];
[['freight', 250], ['freight', 0], ['trucking', 250], ['trucking', 0], ['freight', 333.33]].forEach(function (cs) {
  var cl = cellsOfRun({ items: twoP, estimates: [{ release_key: RK, outbound_estimate: 1000 }], partEstimates: [{ release_key: RK, part: cs[0], amount: cs[1] }] });
  var sum = function (k) { return Math.round(cl.reduce(function (a, c) { return a + (c[k] || 0); }, 0) * 100) / 100; };
  check('…two sale lines sharing the release (100 lb + 200 lb), combined $1,000 + ' + cs[0] + ' $' + cs[1] + ': every line reconciles to the cent, the lines add up to 1,000, the ' + cs[0] + ' shares add up to ' + cs[1] + ', and the other part stays empty', cl.length === 2 && cl.every(rec) && sum('outbound_cost') === 1000 && Math.abs(sum(cs[0] + '_cost') - cs[1]) < 0.011 && Math.abs(sum('shipping_combined_share') - (1000 - cs[1])) < 0.011 && cl.every(function (c) { return c[(cs[0] === 'freight' ? 'trucking' : 'freight') + '_cost'] === null && !c[(cs[0] === 'freight' ? 'trucking' : 'freight') + '_kind']; }), cl.map(function (c) { return [c.outbound_cost, c.trucking_cost, c.freight_cost, c.shipping_combined_share]; }));
});
var both2 = cellsOfRun({ items: twoP, partEstimates: [{ release_key: RK, part: 'trucking', amount: 100 }, { release_key: RK, part: 'freight', amount: 200.01 }] });
check('…WITHOUT a combined total nothing changed: trucking + freight = outbound to the cent on every line, no combined share', both2.every(function (c) { return Math.abs((c.trucking_cost + c.freight_cost) - c.outbound_cost) < 0.001 && c.shipping_combined_share === undefined; }));
check('…a combined total with NO part: the whole share of each line is combined', cellsOfRun({ items: twoP, estimates: [{ release_key: RK, outbound_estimate: 1000 }] }).every(function (c) { return c.shipping_combined_share === c.outbound_cost && c.trucking_cost === null && c.freight_cost === null; }));
// Codex 07:20 P2 — the neutral note is shown on its own, also when the period has nothing to fix
var React = require('react'); var RS = require('react-dom/server'); var Note = require(path.join(root, 'src/components/CombinedShippingNote.jsx')).default;
function complete(cl) { return cl.map(function (c) { return Object.assign({}, c, { base_cost: 100, commission: 0, goods_profit: 1, transport_profit: 1, profit: 2 }); }); }
var okCells = complete(cellsOfRun({ estimates: [{ release_key: RK, outbound_estimate: 1000 }] })); var okT = P.openTasks(okCells); var okFx = P.linesToFix(okCells);
var okHtml = RS.renderToStaticMarkup(React.createElement(Note, { combined: okT.combined }));
check('Codex 07:20 P2: a period that is complete except that its transportation is one combined amount — NO task, NO line to fix (so no amber box), and the neutral note IS rendered with the release and the amount', okT.tasks.length === 0 && okFx.rows.length === 0 && okHtml.indexOf('1 release(s) use a combined transportation cost; breakdown not separated (1001-9001 $1,000.00)') > 0 && okHtml.indexOf('nothing to fix') > 0, [okT.tasks.length, okFx.rows.length, okHtml]);
var okCells0 = complete(cellsOfRun({ estimates: [{ release_key: RK, outbound_estimate: 1000 }], partEstimates: [{ release_key: RK, part: 'trucking', amount: 0 }] })); var okT0 = P.openTasks(okCells0);
check('…the same with an explicit trucking $0: no task, no line to fix, note rendered', okT0.tasks.length === 0 && P.linesToFix(okCells0).rows.length === 0 && RS.renderToStaticMarkup(React.createElement(Note, { combined: okT0.combined })).indexOf('1001-9001 $1,000.00') > 0);
check('…no combined release → the note renders nothing; a person who may not see profit gets no list to render', RS.renderToStaticMarkup(React.createElement(Note, { combined: [] })) === '' && P.openTasks(okCells, true).combined.length === 0);
var tabSrc = fs.readFileSync(path.join(root, 'src/components/ProfitabilityTab.jsx'), 'utf8');
check('…on the screen the note sits OUTSIDE the amber Lines-to-fix box, right after it, so it shows when that box is absent', tabSrc.indexOf('<CombinedShippingNote combined={ot.combined} />') > tabSrc.indexOf('        {fixBox}') && tabSrc.indexOf('{combNote}') < 0 && /import CombinedShippingNote from '\.\/CombinedShippingNote';/.test(tabSrc));

// ── Codex 07:30 — the shipping cost typed ON THE INVOICE is a combined amount too: the same rule, the same marks
var IT = [{ invoice_id: 'i1', shipping_terms: 'CNF_INCLUDED', shipping_cost_estimate: 1000 }]; var I20 = [{ id: 'l1', invoice_id: 'i1', wave_product_name: 'Paper', description: 'Paper', quantity: 100, unit_price: 20 }];
function irun(o) { return run(Object.assign({ terms: IT, items: I20 }, o || {})); }
function shipOnly(r) { var o3 = P.openTasks(r.cells || []); o3.tasks = o3.tasks.filter(function (k) { return k.kind === 'trucking' || k.kind === 'freight' || k.kind === 'not_shared' || k.kind === 'no_release' || k.kind === 'release_split'; }); return o3; }
var i0 = irun(); var ci0 = (i0.cells || [])[0];
check('Codex 07:30: invoice-form combined $1,000 alone → cost 1,000, marked combined (from the invoice form), NO trucking / freight task', ci0.outbound_cost === 1000 && ci0.shipping_total_unsplit === 1000 && ci0.shipping_combined_from === 'invoice form' && ci0.shipping_combined_share === 1000 && shipOnly(i0).tasks.length === 0 && shipOnly(i0).combined.length === 1, [ci0.outbound_cost, ci0.shipping_total_unsplit, shipOnly(i0).tasks.map(function (k) { return k.key; })]);
var i1 = irun({ partEstimates: [{ release_key: RK, part: 'trucking', amount: 0 }] }); var ci1 = (i1.cells || [])[0];
check('…+ manual trucking $0 → the total STAYS 1,000 (it was dropping to 0), trucking is 0 manual, freight stays empty with no kind, 1,000 stays combined, no missing-freight task', ci1.outbound_cost === 1000 && ci1.trucking_cost === 0 && ci1.trucking_kind === 'manual' && ci1.freight_cost === null && !ci1.freight_kind && ci1.shipping_total_unsplit === 1000 && ci1.shipping_combined_from === 'invoice form' && shipOnly(i1).tasks.length === 0 && rec(ci1), [ci1.outbound_cost, ci1.trucking_cost, ci1.freight_cost, shipOnly(i1).tasks.map(function (k) { return k.key; })]);
var i2 = irun({ partEstimates: [{ release_key: RK, part: 'freight', amount: 0 }] }); var ci2 = (i2.cells || [])[0];
check('…+ manual freight $0 → total 1,000, freight 0, trucking empty, 1,000 combined, no task', ci2.outbound_cost === 1000 && ci2.freight_cost === 0 && ci2.trucking_cost === null && ci2.shipping_combined_share === 1000 && shipOnly(i2).tasks.length === 0 && rec(ci2));
var i3 = irun({ partEstimates: [{ release_key: RK, part: 'trucking', amount: 300 }] }); var ci3 = (i3.cells || [])[0];
check('…+ trucking $300 → total 1,000, trucking 300, 700 combined', ci3.outbound_cost === 1000 && ci3.trucking_cost === 300 && ci3.shipping_total_unsplit === 700 && rec(ci3) && shipOnly(i3).tasks.length === 0);
var i4 = irun({ partEstimates: [{ release_key: RK, part: 'trucking', amount: null }] });
check('…clearing the box is not a zero: plain combined 1,000 again', (i4.cells || [])[0].outbound_cost === 1000 && (i4.cells || [])[0].trucking_cost === null && (i4.cells || [])[0].shipping_total_unsplit === 1000);
var i5 = irun({ partEstimates: [{ release_key: RK, part: 'trucking', amount: 300 }, { release_key: RK, part: 'freight', amount: 500 }] }); var ci5 = (i5.cells || [])[0];
check('…both parts typed (300 + 500) replace the invoice-form amount: 800, nothing combined', ci5.outbound_cost === 800 && ci5.trucking_cost === 300 && ci5.freight_cost === 500 && ci5.shipping_total_unsplit === null && shipOnly(i5).combined.length === 0);
var i6 = irun({ bills: [{ id: 'b1', bill_number: 'TR-1', vendor_name: 'Trucker', bill_type: 'trucking', shipment_direction: 'outbound', release_number: '1001-9001', total_amount: 300, record_status: 'active', bill_date: '2026-06-12' }] }); var ci6 = (i6.cells || [])[0];
check('…a trucking BILL of $300 beside the invoice-form 1,000: total 1,000, trucking 300 from the bill, 700 combined', ci6.outbound_cost === 1000 && ci6.trucking_cost === 300 && ci6.trucking_kind === 'bill' && ci6.shipping_total_unsplit === 700 && rec(ci6));
var i7 = irun({ estimates: [{ release_key: RK, outbound_estimate: 600 }], partEstimates: [{ release_key: RK, part: 'trucking', amount: 0 }] });
check('…two combined sources: the total typed for the release (600) still comes before the invoice form (1,000), as before', (i7.cells || [])[0].outbound_cost === 600 && (i7.cells || [])[0].shipping_combined_from === 'typed for the release');
var RK2 = PR.relKey('1001-9002');
var i8in = { release: '1001-9001 / 1001-9002', lineReleasePounds: [{ invoice_item_id: 'l1', release_key: RK, pounds: 60 }, { invoice_item_id: 'l1', release_key: RK2, pounds: 40 }] };
var i8 = irun(i8in); var i8b = irun(Object.assign({ partEstimates: [{ release_key: RK, part: 'trucking', amount: 0 }] }, i8in));
function relCells(r, raw) { return (r.cells || []).filter(function (c) { return (c.release_raw || '') === raw; }); }
check('…an invoice on two releases (60 lb / 40 lb): the 1,000 is still divided 600 / 400 by pounds, each marked combined', relCells(i8, '1001-9001')[0].outbound_cost === 600 && relCells(i8, '1001-9002')[0].outbound_cost === 400 && (i8.cells || []).every(function (c) { return c.shipping_combined === true; }) && shipOnly(i8).tasks.length === 0, (i8.cells || []).map(function (c) { return [c.release_raw, c.outbound_cost, c.shipping_total_unsplit]; }));
check('…and trucking $0 typed on ONE of them leaves both shares as they were (600 and 400)', relCells(i8b, '1001-9001')[0].outbound_cost === 600 && relCells(i8b, '1001-9001')[0].trucking_cost === 0 && relCells(i8b, '1001-9002')[0].outbound_cost === 400 && shipOnly(i8b).tasks.length === 0);
check('…reload: the same input gives the same cells', JSON.stringify(irun({ partEstimates: [{ release_key: RK, part: 'trucking', amount: 0 }] }).cells) === JSON.stringify(i1.cells));
check('…the neutral note is rendered for the invoice source as well', (function () { var React2 = require('react'); var RS2 = require('react-dom/server'); var N2 = require(path.join(root, 'src/components/CombinedShippingNote.jsx')).default; return RS2.renderToStaticMarkup(React2.createElement(N2, { combined: shipOnly(i1).combined })).indexOf('1001-9001 $1,000.00') > 0; })());

// P2 — known parts, but a sibling line has no weight
var two = [{ id: 'l1', invoice_id: 'i1', wave_product_name: 'Paper', description: 'Paper', quantity: 100, unit_price: 10 }, { id: 'l2', invoice_id: 'i1', wave_product_name: 'Mystery', description: 'Mystery', quantity: 5, unit_price: 10 }];
var e2 = run({ items: two, partEstimates: [{ release_key: RK, part: 'trucking', amount: 100 }, { release_key: RK, part: 'freight', amount: 0 }] }); var t2 = tasksOf(e2);
check('Codex P2, ENGINE: typed trucking $100 / freight 0, one line without weight → the parts are known (manual) but the shares are empty', (e2.cells || []).some(function (c) { return c.trucking_kind === 'manual' && c.trucking_cost === null; }), (e2.cells || []).map(function (c) { return [c.trucking_kind, c.trucking_cost, c.pounds]; }));
check('…the list does NOT say "no trucking cost" and offers NO typing: it says the figure is known and the weight is what is missing', !hasType(t2) && !t2.tasks.some(function (k) { return k.kind === 'trucking' || k.kind === 'freight'; }) && t2.tasks.some(function (k) { return k.kind === 'not_shared' && k.action === 'unit' && /do not type it again/.test(k.how) && /Mystery/.test(k.how) && k.names.indexOf('Mystery') >= 0; }) && t2.tasks.some(function (k) { return k.kind === 'pounds' && /Mystery/.test(k.title); }), t2.tasks.map(function (k) { return k.key; }));
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
