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
check('shipping terms not known is one row per invoice', T('terms:A10').action === 'open_invoice' && T('terms:A10').kind === 'transport_revenue');
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
