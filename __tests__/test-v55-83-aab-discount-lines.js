// v55.83-AAB — Max, 27 Nov (Profitability → By product → PVC Artificial Leather, invoice AMERICA 1846): "why is this unknown when the
// shipping line is clear in the invoice". The invoice: PVC ARTIFICIAL LEATHER … BY LBs 55,156 @ 0.55 = $30,335.80; Shipping Costs
// $5,900; "Discount cash on hand to Mr. Kandil" −$30,325 (CNF). The engine took the NEGATIVE line for a goods line with no unit, so
// the $5,900 could not be shared by weight → "unknown". Runs the REAL buildCells (src/lib/profitability.js) and the REAL openTasks.
// Line descriptions are the ones found on live invoices (read-only, 27 Nov); amounts and customers here are made up except 1846's lines.
// Narrowed after Max's answer (27 Nov, "no.. we will update that discount ourselves"): a minus line is never a product and never blocks the
// shipping share; it keeps its revenue meaning (lowers goods revenue like a discount); no money-received rule by wording.
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var E = require(path.join(root, 'src/lib/profitability.js'));
var P = require(path.join(root, 'src/lib/pnl-period.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 600))); }
console.log('AAB — a negative invoice line is never a goods line (real engine)');
function run(lines, extra) { return E.buildCells({ invoices: [Object.assign({ id: 'i1', number: 'AMERICA 1846', date: '2026-06-20', basis: 'CNF', releases: ['1002-1219'], lines: lines }, extra || {})], factors: {} }); }
var GOODS = { description: 'PVC ARTIFICIAL LEATHER BY LBs', qty: 55156, unit: 'lb', unit_price: 0.55, amount: 30335.80 };
var SHIP = { description: 'Shipping Costs', qty: 1, unit_price: 5900, amount: 5900 };
var CASH = { description: 'Discount cash on hand to Mr. Kandil', qty: 1, unit_price: -30325, amount: -30325 };
function kinds(o) { return o.flags.map(function (f) { return f.kind; }); }

// 1) AMERICA 1846 exactly
var o = run([GOODS, SHIP, CASH]);
check('1846: ONE sale line only — the −$30,325 line is not a product (no "Discount cash on hand…" product line)', o.cells.length === 1 && o.cells[0].description === GOODS.description, o.cells.map(function (c) { return c.description; }));
check('1846: TRANSPORT CHARGED is the $5,900 shipping line (was "unknown")', o.cells[0].transport_revenue === 5900 && o.cells[0].flags.indexOf('allocation_unresolved_missing_weight') < 0, o.cells[0]);
check('1846: the minus line keeps its revenue meaning — it lowers goods revenue like a discount (30,335.80 − 30,325 = 10.80), no reading of its words (Max 27 Nov: "we will update that discount ourselves")', o.cells[0].goods_revenue === 10.8 && o.cells[0].invoiced === 10.8 && kinds(o).indexOf('discount_shared_over_goods') >= 0 && kinds(o).indexOf('negative_line_is_payment') < 0, o.cells[0]);
check('1846: no "unit not set" for the cash line, nothing left unshared', !o.flags.some(function (f) { return f.kind === 'unit_unknown'; }) && !o.unallocated.some(function (u) { return u.what === 'transport_revenue'; }));
var ot = P.openTasks(o.cells.map(function (c) { return Object.assign({ goods_profit: 1, transport_profit: 1, profit: 2 }, c); }), false, {});
check('1846: the fix list no longer has "the shipping charged cannot be worked out" nor a "no weight" row for the cash line', !ot.tasks.some(function (t) { return t.kind === 'transport_revenue' || (t.kind === 'pounds' && /cash on hand/i.test(t.title)); }), ot.tasks.map(function (t) { return t.key; }));

// 2) a real price cut lowers goods revenue (live wording "Discount" −950, AMERICA 1818)
var o2 = run([GOODS, SHIP, { description: 'Discount', qty: 1, unit_price: -950, amount: -950 }]);
check('a real "Discount" −$950: goods revenue = $30,335.80 − $950 = $29,385.80; shipping still $5,900; flagged as a discount taken off', o2.cells.length === 1 && o2.cells[0].goods_revenue === 29385.8 && o2.cells[0].transport_revenue === 5900 && kinds(o2).indexOf('discount_shared_over_goods') >= 0, o2.cells[0]);
// 3) shared over several goods lines by their value, to the cent
var o3 = run([{ description: 'Grey foam', qty: 1000, unit: 'lb', unit_price: 1, amount: 1000 }, { description: 'Black PVC', qty: 3000, unit: 'lb', unit_price: 1, amount: 3000 }, SHIP, { description: 'SPECIAL ONETIME DISCOUNT', qty: 1, unit_price: -1100, amount: -1100 }]);
var gsum = o3.cells.reduce(function (s, c) { return s + Math.round(c.goods_revenue * 100); }, 0);
check('a discount over two goods lines is shared by their value (−275 / −825) and adds up to the cent (4,000 − 1,100 = 2,900)', o3.cells.length === 2 && o3.cells[0].invoiced === 725 && o3.cells[1].invoiced === 2175 && gsum === 290000, o3.cells.map(function (c) { return c.invoiced; }));
check('…and the shipping is still shared by weight over the two goods lines (1,475 + 4,425 = 5,900)', o3.cells[0].transport_revenue === 1475 && o3.cells[1].transport_revenue === 4425);
// 4) a discount on an invoice with no goods line: not invented anywhere, listed as unallocated
var o4 = run([SHIP, { description: 'deduction', qty: 1, unit_price: -500, amount: -500 }]);
check('a discount on an invoice with no goods line: no sale line is made for it, it is listed (discount_without_goods)', o4.cells.length === 0 && kinds(o4).indexOf('discount_without_goods') >= 0 && o4.unallocated.some(function (u) { return u.what === 'discount' && u.amount === -500; }));
// 5) no sale line is ever negative / a "product" made of a negative line
var o5 = run([GOODS, SHIP, CASH, { description: 'Previous credit', qty: 1, unit_price: -2519.4, amount: -2519.4 }, { description: 'deduction', qty: 1, unit_price: -100, amount: -100 }]);
check('mixed: only the real goods line is a sale line; EVERY minus line lowers its revenue, all three listed: 30,335.80 − 30,325 − 2,519.40 − 100 = −2,608.60 (shown as it is, not hidden); the shipping is still 5,900', o5.cells.length === 1 && o5.cells[0].goods_revenue === -2608.6 && o5.cells[0].transport_revenue === 5900 && o5.flags.filter(function (f) { return f.kind === 'discount_shared_over_goods'; })[0].lines.length === 3, o5.cells.map(function (c) { return c.invoiced; }));

// 6) no reading of the words (Max 27 Nov): every live negative wording is a discount; the engine has no payment rule
var LIVE = ['deduction', 'As a pervious sale by KG', 'Discount', 'Previous credit', 'SPECIAL ONETIME DISCOUNT', 'Discount cash on hand to Mr. Kandil', 'part of march 2nd transfer', 'Port and Doc charges for container transfer to new booking'];
var allDisc = LIVE.every(function (w) { var ox = run([GOODS, { description: w, qty: 1, unit_price: -100, amount: -100 }]); return ox.cells.length === 1 && ox.cells[0].goods_revenue === 30235.8; });
check('every live minus-line wording (incl. cash on hand / previous credit / transfer) lowers goods revenue the same way — no text matching', allDisc && E.adjustmentKind === undefined && fs.readFileSync(path.join(root, 'src/lib/profitability.js'), 'utf8').indexOf('negative_line_is_payment') < 0);
check('the live shipping credits stay SHIPPING (“Shipping Credit 5%”, “shipping amendment”), unchanged', E.isTransportLine('Shipping Credit 5%') && E.isTransportLine('shipping amendment '));
// 7) the escape hatch: a negative line explicitly marked as goods stays goods
var o7 = run([GOODS, Object.assign({}, CASH, { goods: true })]);
check('a negative line explicitly marked as goods (ln.goods = true) is left as it was (a goods line)', o7.cells.length === 2);

console.log('\nAAB: ' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
