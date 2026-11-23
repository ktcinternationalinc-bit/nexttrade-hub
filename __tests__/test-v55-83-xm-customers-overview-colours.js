// v55.83-XM — Max, 23 Nov 2026: Customers overview — "need filter from June 1st as well and need the ones that arrived and paid
// fully in green. Partially paid in yellow."
// Real functions (buildCustomersOverview, presetRange, invoiceTone, customerTone) and the real screen component, rendered,
// on made-up customers and amounts. The last two checks are source checks and say so.
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder';
require(path.join(root, 'node_modules/sucrase/register'));
var React = require('react'); global.React = React; var RS = require('react-dom/server');
var C = require(path.join(root, 'src/lib/customers-overview.js'));
var V = require(path.join(root, 'src/components/CustomersOverviewTab.jsx'));
var B = require(path.join(root, 'src/lib/business-of.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra))); }
console.log('XM — Customers overview: since 1 June, green / yellow rows');

// 1. the date button
check('1: "Since 1 June 2026" = 1 June 2026 to today', JSON.stringify(C.presetRange('june', '2026-11-23')) === '{"from":"2026-06-01","to":"2026-11-23"}' && C.SINCE_JUNE === '2026-06-01');
check('2: the other date buttons are unchanged', JSON.stringify(C.presetRange('month', '2026-11-19')) === '{"from":"2026-10-20","to":"2026-11-19"}' && JSON.stringify(C.presetRange('year', '2026-11-19')) === '{"from":"2026-01-01","to":"2026-11-19"}' && JSON.stringify(C.presetRange('all', '2026-11-19')) === '{"from":"","to":""}' && C.presetRange('custom', '2026-11-19') === null);

// 2. the colour rule on its own
check('3: invoice — arrived and fully paid is green', C.invoiceTone({ status: 'paid', arrived: true }) === 'green');
check('4: invoice — fully paid but NOT arrived yet has no colour', C.invoiceTone({ status: 'paid', arrived: false }) === '' && C.invoiceTone({ status: 'paid' }) === '');
check('5: invoice — partially paid is yellow, arrived or not', C.invoiceTone({ status: 'partial', arrived: true }) === 'yellow' && C.invoiceTone({ status: 'partial', arrived: false }) === 'yellow');
check('6: invoice — unpaid, or payments withheld, never gets green or yellow', C.invoiceTone({ status: 'unpaid', arrived: true }) === '' && C.invoiceTone({ status: 'limited', arrived: true }) === '' && C.invoiceTone(null) === '');
check('7: customer — one partially paid invoice makes the line yellow', C.customerTone({ invoices: [{ status: 'paid', arrived: true }, { status: 'partial', arrived: false }] }) === 'yellow');
check('8: customer — green only when EVERY invoice arrived and is fully paid', C.customerTone({ invoices: [{ status: 'paid', arrived: true }, { status: 'paid', arrived: true }] }) === 'green' && C.customerTone({ invoices: [{ status: 'paid', arrived: true }, { status: 'paid', arrived: false }] }) === '' && C.customerTone({ invoices: [{ status: 'paid', arrived: true }, { status: 'unpaid', arrived: true }] }) === '');
check('9: customer — no invoices in the period, or a withheld balance, is never green', C.customerTone({ invoices: [] }) === '' && C.customerTone(null) === '' && C.customerTone({ balance_incomplete: true, invoices: [{ status: 'paid', arrived: true }] }) === '' && C.customerTone({ limited_count: 1, invoices: [{ status: 'paid', arrived: true }] }) === '');

// 3. the rule on a report the REAL builder makes
function inv(id, cust, date, total, o) { return Object.assign({ id: id, invoice_number: 'N' + id, accounting_customer_id: cust, invoice_date: date, due_date: null, total_amount: total, wave_imported_paid: 0, currency: 'USD', record_status: 'active', wave_business_id: B.US_WAVE_BUSINESS_ID, source: 'hub', release_number: '' }, o || {}); }
function pay(id, invId, date, amount) { return { id: id, accounting_invoice_id: invId, payment_date: date, amount: amount, voided: false, sync_status: 'synced' }; }
var customers = [{ id: 'a', company_name: 'Alpha Co', business_tag: null }, { id: 'b', company_name: 'Beta Ltd', business_tag: null }, { id: 'c', company_name: 'Cedar Inc', business_tag: null }];
var invoices = [
  inv(1, 'a', '2026-07-05', 1000, { release_number: '1002-0001' }),   // arrived, paid in full  → green
  inv(2, 'a', '2026-07-20', 500, { release_number: '1002-0002' }),    // arrived, paid in full  → green
  inv(3, 'b', '2026-08-01', 800, { release_number: '1002-0003' }),    // arrived, partly paid   → yellow
  inv(4, 'b', '2026-08-02', 300, { release_number: '1002-0004' }),    // not arrived, paid      → no colour
  inv(5, 'c', '2026-09-01', 900, { release_number: '1002-0005' }),    // arrived, unpaid        → no colour (red date)
  inv(6, 'c', '2026-05-15', 100, { release_number: '1002-0006' })     // BEFORE 1 June          → not in the list
];
var payments = [pay('p1', 1, '2026-07-10', 1000), pay('p2', 2, '2026-07-25', 500), pay('p3', 3, '2026-08-10', 200), pay('p4', 4, '2026-08-05', 300)];
function wh(k, d) { return { release_key: k, arrival_date: d, section: 'main', superseded: false, in_latest_feed: true, flags: [] }; }
var warehouse = [wh('10020001', '2026-08-01'), wh('10020002', '2026-08-15'), wh('10020003', '2026-09-01'), wh('10020004', '2026-12-20'), wh('10020005', '2026-10-01')];
var rng = C.presetRange('june', '2026-11-23');
var rep = C.buildCustomersOverview({ invoices: invoices, payments: payments, customers: customers, warehouse: warehouse, from: rng.from, to: rng.to, today: '2026-11-23', floor: null, business: 'US' });
function row(n) { return rep.rows.filter(function (x) { return x.name === n; })[0]; }
function iv(n, id) { return row(n).invoices.filter(function (v) { return v.id === id; })[0]; }
check('10: with the June dates the invoice of 15 May is left out and the five later ones are in', rep.rows.length === 3 && row('Cedar Inc').invoices.length === 1 && row('Alpha Co').invoices.length === 2 && row('Beta Ltd').invoices.length === 2, rep.rows.map(function (x) { return x.name + ':' + x.invoices.length; }));
check('11: real report — arrived + paid = green; partly paid = yellow; paid but not arrived and arrived but unpaid = no colour', C.invoiceTone(iv('Alpha Co', 1)) === 'green' && C.invoiceTone(iv('Alpha Co', 2)) === 'green' && C.invoiceTone(iv('Beta Ltd', 3)) === 'yellow' && C.invoiceTone(iv('Beta Ltd', 4)) === '' && C.invoiceTone(iv('Cedar Inc', 5)) === '', [iv('Alpha Co', 1), iv('Beta Ltd', 4)]);
check('12: real report — Alpha line green, Beta line yellow, Cedar line no colour; the red arrival date is still there for Cedar', C.customerTone(row('Alpha Co')) === 'green' && C.customerTone(row('Beta Ltd')) === 'yellow' && C.customerTone(row('Cedar Inc')) === '' && iv('Cedar Inc', 5).arrival_red === true);
check('13: the amounts are untouched by the colours (Alpha owes 0, Beta owes 600, Cedar owes 900)', row('Alpha Co').owed === 0 && row('Beta Ltd').owed === 600 && row('Cedar Inc').owed === 900, [row('Alpha Co').owed, row('Beta Ltd').owed, row('Cedar Inc').owed]);

// 4. the real screen, rendered
function html(props) { return RS.renderToStaticMarkup(React.createElement(V.CustomersOverviewView, Object.assign({ report: C.maskOverviewTotals(rep, true), open: null, onOpen: function () {}, search: '', onlyOwing: false, onOpenInvoice: function () {} }, props))); }
var GREEN = 'background:#86efac'; var YELLOW = 'background:#fde047';
function trOf(h, text) { var i = h.indexOf(text); if (i < 0) { return ''; } var a = h.lastIndexOf('<tr', i); return h.slice(a, h.indexOf('>', a) + 1); }
var h0 = html({});
check('14: screen — the Alpha line is green, the Beta line is yellow, the Cedar line is neither', trOf(h0, 'Alpha Co').indexOf(GREEN) > 0 && trOf(h0, 'Beta Ltd').indexOf(YELLOW) > 0 && trOf(h0, 'Cedar Inc').indexOf(GREEN) < 0 && trOf(h0, 'Cedar Inc').indexOf(YELLOW) < 0, [trOf(h0, 'Alpha Co'), trOf(h0, 'Beta Ltd'), trOf(h0, 'Cedar Inc')]);
var hb = html({ open: 'b' });
check('15: screen — opened Beta: invoice N3 (partly paid) is yellow, invoice N4 (paid, not arrived) has no colour', trOf(hb, '>N3<').indexOf(YELLOW) > 0 && trOf(hb, '>N4<').indexOf(GREEN) < 0 && trOf(hb, '>N4<').indexOf(YELLOW) < 0, [trOf(hb, '>N3<'), trOf(hb, '>N4<')]);
var ha = html({ open: 'a' });
check('16: screen — opened Alpha: both invoices are green', trOf(ha, '>N1<').indexOf(GREEN) > 0 && trOf(ha, '>N2<').indexOf(GREEN) > 0, [trOf(ha, '>N1<'), trOf(ha, '>N2<')]);

// 5. source checks (they show the wiring exists; they are not behaviour)
var tab = fs.readFileSync(path.join(root, 'src/components/CustomersOverviewTab.jsx'), 'utf8');
check('17 (source): the date button and the colour key are on the screen', tab.indexOf("['june', 'Since 1 June 2026']") > 0 && tab.indexOf('Green = arrived and fully paid') > 0 && tab.indexOf('Yellow = partially paid') > 0);
var WN = fs.readFileSync(path.join(root, 'src/components/WhatsNewWidget.jsx'), 'utf8'); var PG = fs.readFileSync(path.join(root, 'src/app/page.jsx'), 'utf8');
check('18 (source): What\'s New has the XM entry and the badge names the newest entry (XM or later)', /version: 'v55\.83-XM'/.test(WN) && (function () { var top = /BUILD_HISTORY = \[\s*\{\s*version: '(v55\.83-[A-Z]+)'/.exec(WN); return !!top && PG.indexOf('>' + top[1] + '</span>') > 0; })());
console.log('\n' + pass + ' passed, ' + failN + ' failed');
if (failN) { process.exit(1); }
