// v55.83-WN — Max, 20 Nov 2026: "1742 Here it says that it's missing shipping, but if you go into the actual invoice, it says it's
// not missing shipping ... it needs to be something ... I click on and it takes me where I'm supposed to go ... there's something
// disconnected here." The line-by-line list under "What remains open" now says the SAME reason as the numbered list and each
// reason is a button to its numbered row. Real rule functions on made-up sale lines; the real button component rendered.
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var P = require(path.join(root, 'src/lib/pnl-period.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 900))); }
console.log('WN — each missing thing on a line says the real reason and is a button');
function cell(o) { return Object.assign({ invoice_id: 'i' + o.invoice, invoice_date: '2026-06-10', customer: 'Cust', product: 'Vinyl', release_raw: '1002-1', pounds: 100, goods_revenue: 1000, base_cost: 300, transport_revenue: 0, trucking_cost: 50, freight_cost: 60, goods_profit: 500, transport_profit: -110, profit: 390 }, o); }
var blockers = [{ name: 'Mesh by yd', older: true }];
var cells = [
  cell({ invoice: 'B1' }), // complete
  // Max's case: the release HAS its trucking and freight figures (typed estimates), but they cannot be shared because another
  // description on the release has no unit; this line also has no supplier cost
  cell({ invoice: 'B2', product: 'Headliner', release_raw: '1003-9', base_cost: null, goods_profit: null, trucking_cost: null, freight_cost: null, trucking_kind: 'estimate', freight_kind: 'estimate', weight_blockers: blockers, transport_profit: null, profit: null }),
  cell({ invoice: 'B3', product: 'Headliner', base_cost: null, goods_profit: null, profit: null }),
  cell({ invoice: 'B4', release_raw: '', release: '', trucking_cost: null, freight_cost: null, transport_profit: null, profit: null, goods_revenue: 0 }),
  cell({ invoice: 'B5', release_raw: '1001-7', trucking_cost: null, transport_profit: null, profit: null })
];
var o = P.openTasks(cells); var fx = P.linesToFix(cells);
function rowOf(inv) { return fx.rows.filter(function (r) { return r.invoice === inv; })[0]; }
function fixesOf(inv) { return (o.by_line || {})[rowOf(inv).idx] || []; }
function labels(inv) { return fixesOf(inv).map(function (f) { return f.label; }); }
var b2 = fixesOf('B2');
check('every line of the list knows which sale line it is (its place among the lines)', fx.rows.every(function (r) { return typeof r.idx === 'number' && cells[r.idx].invoice === r.invoice; }));
check('Max’s line: the shipping figure IS there, so it is NOT called “not known”; it says it is not shared yet because a product has no unit', labels('B2').indexOf('Shipping cost is there, but not shared yet: a product on the release has no unit') >= 0 && labels('B2').join('|').indexOf('not known') < 0 && labels('B2').indexOf('No trucking cost for the release') < 0, labels('B2'));
check('…and the old wording for that same line was the misleading one (this is what the screen used to print)', rowOf('B2').missing_text === 'No supplier cost · Trucking cost not known · Freight cost not known');
check('…one button for the shipping (trucking and freight are one thing to fix there), one for the supplier cost', b2.length === 2 && labels('B2').indexOf('No supplier cost') >= 0, b2);
check('each button carries the NUMBER of its row in the list above, and that row is the same thing', b2.every(function (f) { var t = o.tasks[f.n - 1]; return t && t.key === f.key && t.kind === f.kind; }) && o.tasks[b2.filter(function (f) { return f.kind === 'not_shared'; })[0].n - 1].action === 'unit');
check('two lines waiting for the same product cost point at the SAME number', fixesOf('B3').length === 1 && fixesOf('B3')[0].n === b2.filter(function (f) { return f.kind === 'base_cost'; })[0].n);
check('an invoice with no release number says that — not “trucking / freight not known”', labels('B4').length === 1 && labels('B4')[0] === 'No release number on the invoice', labels('B4'));
check('a release that really has no trucking figure still says so', labels('B5').length === 1 && labels('B5')[0] === 'No trucking cost for the release');
check('a complete line has no entry; every numbered thing is reachable from at least one line', !o.by_line[0] && o.tasks.every(function (t, n) { return Object.keys(o.by_line).some(function (i) { return o.by_line[i].some(function (f) { return f.n === n + 1; }); }); }));
check('the numbered list itself is unchanged (no working field left on a row)', o.tasks.every(function (t) { return t._seen === undefined && t._inv === undefined; }) && o.lines === 4);
check('a person who may not see profit gets no list and no buttons', P.openTasks(cells, true).tasks.length === 0 && !P.openTasks(cells, true).by_line);
// ── a product kept in yards is asked for its cost per YARD
var oy = P.openTasks([cell({ invoice: 'Y1', product: 'Headliner', group_id: 'g1', keep_unit: true, base_cost: null, goods_profit: null, profit: null }), cell({ invoice: 'Y2', product: 'Mixed', group_id: 'g2', keep_unit: true, base_cost: null, goods_profit: null, profit: null }), cell({ invoice: 'Y3', product: 'Mixed', group_id: 'g2', base_cost: null, goods_profit: null, profit: null }), cell({ invoice: 'Y4', product: 'Vinyl', group_id: 'g3', base_cost: null, goods_profit: null, profit: null })]);
function ty(p) { return oy.tasks.filter(function (t) { return t.product === p; })[0]; }
check('YARDS: a product whose open lines are all kept in yards asks “per YARD” and saves per yard; a pound product asks per POUND as before; a product with both kinds stays per pound (its yard lines are costed in Set-up)', ty('Headliner').cost_unit === 'sold_unit' && /per YARD/.test(ty('Headliner').how) && !/per POUND/.test(ty('Headliner').how) && ty('Vinyl').cost_unit === 'lb' && /per POUND/.test(ty('Vinyl').how) && ty('Mixed').cost_unit === 'lb' && ty('Headliner').yd_lines === undefined, oy.tasks);
var tabY = fs.readFileSync(path.join(root, 'src/components/ProfitabilityTab.jsx'), 'utf8'); var rtY = fs.readFileSync(path.join(root, 'src/app/api/accounting/profitability/route.js'), 'utf8');
check('YARDS: the row sends that unit with the typed cost, and the server keeps a per-yard cost apart from a per-pound one', tabY.indexOf("group_id: t.group_id, cost_unit: t.cost_unit === 'sold_unit' ? 'sold_unit' : 'lb', cost_per_lb: draft[ck]") > 0 && tabY.indexOf("{t.cost_unit === 'sold_unit' ? 'per yd' : 'per lb'}") > 0 && rtY.indexOf("var perYd = body.cost_unit === 'sold_unit';") > 0);
// ── the real button component
var React = require('react'); global.React = React; var RS = require('react-dom/server'); var Chips = require(path.join(root, 'src/components/FixChips.jsx')).default;
var html = RS.renderToStaticMarkup(React.createElement(Chips, { fixes: b2, fallback: 'x' }));
check('SCREEN: each reason is a real button that ends with its number (“→ fix #n”)', (html.match(/<button/g) || []).length === 2 && b2.every(function (f) { return html.indexOf(f.label + ' → fix #' + f.n) > 0; }) && html.indexOf('not known') < 0, html);
var got = []; var el = Chips({ fixes: b2, onGo: function (f) { got.push(f.n); } }); var kids = [].concat(el.props.children);
kids.forEach(function (k) { k.props.onClick({ stopPropagation: function () {} }); });
check('SCREEN: clicking a button asks to go to exactly that number', got.join(',') === b2.map(function (f) { return f.n; }).join(','), got);
check('SCREEN: a line with no numbered fix falls back to plain words (no dead button)', RS.renderToStaticMarkup(React.createElement(Chips, { fixes: [], fallback: 'Not complete' })).indexOf('<button') < 0 && RS.renderToStaticMarkup(React.createElement(Chips, { fallback: 'Not complete' })).indexOf('Not complete') > 0);
var tab = fs.readFileSync(path.join(root, 'src/components/ProfitabilityTab.jsx'), 'utf8');
check('the tab uses the buttons (import present), gives every numbered row its anchor, and the jump finds that anchor', /import FixChips from '\.\/FixChips'/.test(tab) && tab.indexOf("<FixChips fixes={(ot.by_line || {})[w.idx]} fallback={w.missing_text} onGo={goTask} />") > 0 && tab.indexOf("id={'nt-open-task-' + (i + 1)}") > 0 && tab.indexOf("document.getElementById('nt-open-task-' + f.n)") > 0);
console.log('\nWN: ' + pass + ' passed, ' + failN + ' failed');
if (failN) { process.exit(1); }
