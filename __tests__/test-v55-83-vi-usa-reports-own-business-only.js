// v55.83-VI — Max, 19 Nov 2026, on the LUX invoice (number "1", bound to the KANDIL EGYPT business) that showed in KTC USA's
// Profitability: "keep it on ktc egypt.. remove it from the usa side". Codex said the same on 18 Nov 20:04.
// The one rule (src/lib/business-of.js) decides for every USA report. Real function; made-up invoices in the shape of the live ones.
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var B = require(path.join(root, 'src/lib/business-of.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 600))); }
console.log('VI — USA reports hold only KTC USA invoices');
var US = B.US_WAVE_BUSINESS_ID; var OTHER = 'QnVzaW5lc3M6b3RoZXItYnVzaW5lc3M=';
var bo = B.businessOfInvoice;
check('the US business id is the verified KTC one', US === 'QnVzaW5lc3M6NWRkNzI3MDctOTExNC00NjQwLTg4MGQtMjYzNmI3YzM4YTdk');
// the two leaks, in their live shape: USD, customer with no tag, bound to the other business
check('made in the Hub for the other business, USD, customer not tagged (the LUX invoice) → NOT a USA invoice', bo({ wave_business_id: OTHER, currency: 'USD', source: 'hub', accounting_customer_id: 'c1' }, {}) === 'EG');
check('imported from the other business\'s Wave, already in Wave, USD, customer not tagged (the second leak) → NOT a USA invoice', bo({ wave_business_id: OTHER, currency: 'USD', source: 'wave_import', wave_invoice_id: 'w9', accounting_customer_id: 'c2' }, {}) === 'EG');
check('…even when the customer is tagged "us": the invoice\'s own business decides', bo({ wave_business_id: OTHER, currency: 'USD', source: 'hub', accounting_customer_id: 'c3' }, { c3: 'us' }) === 'EG');
check('…and with no currency written at all', bo({ wave_business_id: OTHER, source: 'hub' }, {}) === 'EG');
// KTC USA invoices are untouched
check('KTC USA business, USD, Wave import → USA (as before)', bo({ wave_business_id: US, currency: 'USD', source: 'wave_import', wave_invoice_id: 'w1' }, {}) === 'US');
check('KTC USA business, made in the Hub, not in Wave yet → USA (as before)', bo({ wave_business_id: US, currency: 'USD', source: 'hub' }, {}) === 'US');
check('KTC USA business but the customer is tagged egypt → Egypt (as before)', bo({ wave_business_id: US, currency: 'USD', source: 'wave_import', accounting_customer_id: 'c4' }, { c4: 'egypt' }) === 'EG');
check('KTC USA business but the invoice is in EGP → Egypt (as before)', bo({ wave_business_id: US, currency: 'EGP', source: 'wave_import' }, {}) === 'EG');
// no business id at all: the old rules, unchanged
check('no business id: Wave import or already in Wave → USA; nothing linking it to Wave → Egypt; tag wins both ways (all as before)', bo({ currency: 'USD', source: 'wave_import' }, {}) === 'US' && bo({ currency: 'USD', wave_invoice_id: 'w2' }, {}) === 'US' && bo({ currency: 'USD', source: 'hub' }, {}) === 'EG' && bo({ wave_business_id: '', currency: 'USD', source: 'hub', accounting_customer_id: 'c5' }, { c5: 'us' }) === 'US' && bo({ wave_business_id: null, currency: 'USD', source: 'wave_import', accounting_customer_id: 'c6' }, { c6: 'egypt' }) === 'EG');
// a USA report built the way the routes build it: filter by the rule, then add up
var book = [
  { id: 'a', total_amount: 1000, wave_business_id: US, currency: 'USD', source: 'wave_import', accounting_customer_id: 'k1' },
  { id: 'b', total_amount: 2500, wave_business_id: US, currency: 'USD', source: 'hub', accounting_customer_id: 'k2' },
  { id: 'lux', total_amount: 293150, wave_business_id: OTHER, currency: 'USD', source: 'hub', accounting_customer_id: 'm1' },
  { id: 'one', total_amount: 1, wave_business_id: OTHER, currency: 'USD', source: 'wave_import', wave_invoice_id: 'w7', accounting_customer_id: 'm2' },
  { id: 'eg', total_amount: 900, wave_business_id: OTHER, currency: 'EGP', source: 'wave_import', accounting_customer_id: 'e1' }
];
function report(biz) { var rows = book.filter(function (i) { return bo(i, { e1: 'egypt' }) === biz; }); return { n: rows.length, total: rows.reduce(function (a, r) { return a + r.total_amount; }, 0), ids: rows.map(function (r) { return r.id; }).join(',') }; }
check('USA report: 2 invoices, 3,500 — the 293,150 and the 1.00 are gone from it', report('US').n === 2 && report('US').total === 3500 && report('US').ids === 'a,b', report('US'));
check('…and they are NOT lost: both are on the Egypt side with the other Egypt invoice', report('EG').ids === 'lux,one,eg' && report('US').n + report('EG').n === book.length, report('EG'));
// every USA report goes through this one rule
function src(p) { return fs.readFileSync(path.join(root, p), 'utf8'); }
check('Profitability / Sales report and the P&L by product filter invoices with this rule', src('src/app/api/accounting/sales-report/route.js').indexOf('inv = inv.filter(function (i) { return businessOfInvoice(i, custTag) === bizSel; });') > 0 && src('src/app/api/accounting/pnl/route.js').indexOf('inv = inv.filter(function (i) { return businessOfInvoice(i, custTag) === bizSel; });') > 0);
check('…and both load the invoice\'s business id, so the rule can see it', /from\('accounting_invoices'\)\.select\('[^']*wave_business_id/.test(src('src/app/api/accounting/sales-report/route.js')) && /from\('accounting_invoices'\)\.select\('[^']*wave_business_id/.test(src('src/app/api/accounting/pnl/route.js')));
check('Stats / income statement, reminders and the Nextrade reconciliation use the same rule', src('src/app/api/accounting/bills/route.js').split("businessOfInvoice(inv, tagById").length >= 2 && src('src/app/api/accounting/reminders/route.js').indexOf("businessOfInvoice(inv, tagById) !== 'US'") > 0 && src('src/app/api/reconcile/nexttrade/route.js').indexOf("businessOfInvoice(v, custTagR) !== 'US'") > 0);
check('the rule itself checks the business before anything else', (function () { var s = src('src/lib/business-of.js'); var a = s.indexOf("if (inv.wave_business_id && inv.wave_business_id !== US_WAVE_BUSINESS_ID) { return 'EG'; }"); var b = s.indexOf("if (tag === 'egypt')"); return a > 0 && b > a; })());
console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
