// v55.83-VQ — Max, 19 Nov 2026: "headliner is 1.25 lbs per yard... please fix that in profit sections".
// Real engine functions (Profitability cells and the Sales Report use the same picker); made-up invoices.
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var P = require(path.join(root, 'src/lib/profitability.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 700))); }
console.log('VQ — headliner weighs 1.25 lb per yard');
function lb(name, desc, qty, unit, factors) { return P.toPounds(qty, unit, null, P.weightFactorsFor(name, desc, factors || null)); }
check('the number is 1.25', P.HEADLINER_LB_PER_YARD === 1.25);
check('100 yards of headliner = 125 lb (it was 250 at the standard 2.5)', lb('Headliner Grey', '', 100, 'yd') === 125 && lb('Vinyl', '', 100, 'yd') === 250);
check('found in the product name OR the description, any case, also "head liner" and "head-liner"', lb('', 'HEADLINER 60in black', 10, 'yd') === 12.5 && lb('Head Liner', '', 10, 'yd') === 12.5 && lb('head-liner fabric', '', 10, 'yd') === 12.5 && lb('Auto HeadLiner', '', 10, 'yd') === 12.5 && P.isHeadlinerLine('Headliner', '') === true && P.isHeadlinerLine('', 'head  liner') === true);
check('a line that is not headliner is untouched: header, liner, headboard are not headliner', P.isHeadlinerLine('Header board', '') === false && P.isHeadlinerLine('Trunk liner', '') === false && P.isHeadlinerLine('Headboard', 'liner') === false && lb('Trunk liner', '', 10, 'yd') === 25);
check('only YARDS change: headliner sold by the pound, kilo, ton or linear metre keeps its real / standard weight', lb('Headliner', '', 100, 'lb') === 100 && Math.abs(lb('Headliner', '', 10, 'kg') - 22.0462) < 0.0001 && lb('Headliner', '', 1, 't') === 2204.62 && lb('Headliner', '', 100, 'lm') === 250);
check('foam is still 3 lb per yard (and per linear metre); a line that says headliner AND foam is counted as HEADLINER, 1.25', lb('Foam laminated', '', 100, 'yd') === 300 && lb('Foam laminated', '', 100, 'lm') === 300 && lb('Headliner foam backed', '', 100, 'yd') === 125 && lb('Headliner', 'with foam', 100, 'yd') === 125);
check('"no foam" headliner is headliner too', lb('Headliner no foam', '', 100, 'yd') === 125);
check('the standard table is not changed by asking (a second, ordinary line still weighs 2.5)', (function () { var f = { units: Object.assign({}, P.DEFAULT_UNIT_FACTORS) }; P.weightFactorsFor('Headliner', '', f); return f.units.yd === P.DEFAULT_UNIT_FACTORS.yd && P.toPounds(10, 'yd', null, f) === 25; })());
check('a pounds-per-yard set for one product in Set-up still wins over the rule, as it does for foam', P.toPounds(10, 'yd', 'g:1', P.weightFactorsFor('Headliner', '', { units: P.DEFAULT_UNIT_FACTORS, byProduct: { 'g:1': { yd: 2 } } })) === 20);
// the engine: cells built from invoices
function cellsOf(lines) { return P.buildCells({ invoices: [{ id: 'i1', number: '1', date: '2026-11-01', customer: 'A', releases: [], lines: lines }], factors: { units: P.DEFAULT_UNIT_FACTORS } }); }
var out = cellsOf([{ id: 'l1', description: 'Headliner Grey', qty: 100, unit: 'yd', unit_price: 2, amount: 200 }, { id: 'l2', description: 'Vinyl roll', qty: 100, unit: 'yd', unit_price: 2, amount: 200 }, { id: 'l3', description: 'Headliner foam backed', qty: 100, unit: 'yd', unit_price: 2, amount: 200, foam: true }, { id: 'l4', description: 'Custom name', qty: 100, unit: 'yd', unit_price: 2, amount: 200, headliner: true }, { id: 'l5', description: 'Headliner sample', qty: 100, unit: 'yd', unit_price: 2, amount: 200, headliner: false }]);
var cells = out.cells || out; var byLine = {}; (cells || []).forEach(function (c) { byLine[c.line_id] = c; });
check('Profitability cells: the headliner line has 125 lb, the vinyl line 250 lb', byLine.l1 && byLine.l1.pounds === 125 && byLine.l2 && byLine.l2.pounds === 250, Object.keys(byLine).map(function (k) { return k + ':' + byLine[k].pounds; }));
check('…what the screen worked out from the product name is respected: marked headliner → 125 lb even when the description does not say it; marked NOT headliner → 250 lb', byLine.l4.pounds === 125 && byLine.l5.pounds === 250);
check('…a headliner + foam line is 125 lb and is flagged for a person to look at', byLine.l3.pounds === 125 && (out.flags || []).some(function (f) { return f.kind === 'headliner_and_foam'; }), (out.flags || []).map(function (f) { return f.kind; }));
// wiring
var asm = fs.readFileSync(path.join(root, 'src/lib/profitability-assemble.js'), 'utf8'); var sr = fs.readFileSync(path.join(root, 'src/app/api/accounting/sales-report/route.js'), 'utf8'); var tab = fs.readFileSync(path.join(root, 'src/components/ProfitabilityTab.jsx'), 'utf8');
check('Profitability marks each invoice line from its product name + description (runtime import present)', asm.indexOf('headliner: isHeadlinerLine(it.wave_product_name, it.description)') > 0 && /import \{[^}]*isHeadlinerLine[^}]*\} from '\.\/profitability'/.test(asm));
check('the Sales Report uses the same picker (runtime import present), in the plain server style', sr.indexOf('toPounds(qty, unit, null, weightFactorsFor(it.wave_product_name, it.description, factors))') > 0 && /import \{[^}]*weightFactorsFor[^}]*\} from '\.\.\/\.\.\/\.\.\/\.\.\/lib\/profitability'/.test(sr));
check('the flag has plain words on the screen', /headliner_and_foam: 'A line says both headliner and foam\. It is counted as HEADLINER \(1\.25 lb per yard\)/.test(tab));
console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
