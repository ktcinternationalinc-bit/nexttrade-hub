// v55.83-ZZ — Bills → 💸 Payments report (Max 27 Nov). Pure rules (src/lib/bill-payments-report.js), the REAL screen with a fake route
// (in-memory hook driver), and the route action's gates read from source. Run: node __tests__/test-v55-83-zz-payments-report.js
var path = require('path'); var fs = require('fs'); var Module = require('module');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
function stub(file, exp) { var id = require.resolve(file); var m0 = new Module(id); m0.filename = id; m0.loaded = true; m0.exports = exp; require.cache[id] = m0; }
stub('@supabase/supabase-js', { createClient: function () { return {}; } });
stub(path.join(root, 'src/components/BillDocViewer.jsx'), { __esModule: true, default: function (props) { return { type: 'div', props: { 'data-testid': 'doc-viewer', children: 'viewer:' + (props.bill && props.bill.attachment_path) } }; } });
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 700))); }
console.log('ZZ — Bills → Payments report');
var L = require(path.join(root, 'src/lib/bill-payments-report.js'));

// ---- fixtures shaped like the real tables
var bills = [
  { id: 'b1', vendor_name: 'NexPac Corporation', bill_number: '14743', bill_date: '2026-09-15', release_number: '1001-2210', total_amount: 5000, currency: 'USD', record_status: 'active' },
  { id: 'b2', vendor_name: 'NexPac Corporation', bill_number: '14744', bill_date: '2026-09-16', release_number: '1001-2211', total_amount: 3000, record_status: 'active' },
  { id: 'b3', vendor_name: 'Kronos Trucking', bill_number: 'K-88', bill_date: '2026-10-02', total_amount: 900, record_status: 'active' },
  { id: 'b4', vendor_name: 'NexPac Corporation', bill_number: '14800', bill_date: '2026-10-05', total_amount: 7000, record_status: 'active', paid_via: 'NextTrade Industries' },
  { id: 'b5', vendor_name: 'Old Vendor', bill_number: 'OLD-1', bill_date: '2026-03-01', total_amount: 100, record_status: 'active' }
];
var pays = [
  { id: 'p1', bill_id: 'b1', amount: 5000, paid_date: '2026-10-06', bank_transaction_id: 't1', voided: false },
  { id: 'p2', bill_id: 'b2', amount: 1000, paid_date: '2026-10-20', bank_transaction_id: 't1', voided: false },
  { id: 'p3', bill_id: 'b3', amount: 900, paid_date: '2026-11-03', bank_transaction_id: 't2', voided: false },
  { id: 'p4', bill_id: 'b2', amount: 2000, paid_date: '2026-10-21', bank_transaction_id: null, voided: true },
  { id: 'p5', bill_id: 'b5', amount: 100, paid_date: '2026-03-05', bank_transaction_id: null, voided: false },
  { id: 'p6', bill_id: 'gone', amount: 50, paid_date: '2026-10-10', voided: false }
];
var bankLines = [{ id: 't1', date: '2026-10-06', amount: -6000, amount_abs: 6000, name: 'WIRE OUT NEXPAC', wave_account_name: 'BoA Operating' }, { id: 't2', date: '2026-11-03', amount: -900, amount_abs: 900, name: 'ACH KRONOS' }];
var wires = [{ id: 'w7', seq: 7, status: 'attached', sent_date: '2026-10-05', bank_reference: 'FT2610050042', payee_name: 'NexPac Corporation' }, { id: 'w9', seq: 9, status: 'reversed', sent_date: '2026-11-02', bank_reference: 'X', payee_name: 'Kronos' }];
var wireLines = [{ package_id: 'w7', payment_id: 'p1', is_open: false, bill_id: 'b1' }, { package_id: 'w7', payment_id: 'p2', is_open: false, bill_id: 'b2' }, { package_id: 'w9', payment_id: 'p3', is_open: true, bill_id: 'b3' }];
var wireFiles = [{ id: 'f1', package_id: 'w7', kind: 'bank_confirmation', file_name: 'MT103-FT2610050042.pdf', path: 'pv/wires/w7/mt103.pdf', uploaded_at: '2026-10-06T14:00:00Z' }, { id: 'f2', package_id: 'w7', kind: 'rtm_proof', file_name: 'other.pdf', path: 'pv/x.pdf' }];
function build(o) { return L.buildPaymentsReport(Object.assign({ pays: pays, bills: bills, wireLines: wireLines, wires: wires, wireFiles: wireFiles, bankLines: bankLines }, o || {})); }

var all = build();
check('LIVE payments only: 3 rows (14743, 14744 part, K-88) + the March one; the voided p4 and the payment of a bill you cannot see (p6) are not shown', all.rows.map(function (r) { return r.payment_id; }).join() === 'p5,p1,p2,p3', all.rows.map(function (r) { return r.payment_id; }));
check('…each row carries the bill (vendor, number, date, release), the amount, the bank line (date, amount, name) and the wire that paid it', (function () { var r = all.rows[1]; return r.bill.vendor === 'NexPac Corporation' && r.bill.number === '14743' && r.bill.release === '1001-2210' && r.amount === 5000 && r.bank.date === '2026-10-06' && r.bank.amount === 6000 && r.bank.name === 'WIRE OUT NEXPAC' && r.wire.label === 'WP-0007' && r.wire.sent_date === '2026-10-05' && r.wire.bank_reference === 'FT2610050042'; })(), all.rows[1]);
check('…the wire\'s SWIFT / bank confirmation is attached (bank_confirmation only, not other files)', all.rows[1].wire.proofs.length === 1 && all.rows[1].wire.proofs[0].file_name === 'MT103-FT2610050042.pdf' && all.rows[1].wire.proofs[0].path === 'pv/wires/w7/mt103.pdf');
check('…a wire line still OPEN (not attached) is not "the wire that paid it"', all.rows[3].payment_id === 'p3' && all.rows[3].wire === null);
check('totals count live payments only: 4 payments · $7,000 (100 + 5,000 + 1,000 + 900); by vendor and by month', all.count === 4 && JSON.stringify(all.totals) === JSON.stringify([{ currency: 'USD', count: 4, total: 7000 }]) && JSON.stringify(all.by_vendor) === JSON.stringify([{ vendor: 'Kronos Trucking', currency: 'USD', count: 1, total: 900 }, { vendor: 'NexPac Corporation', currency: 'USD', count: 2, total: 6000 }, { vendor: 'Old Vendor', currency: 'USD', count: 1, total: 100 }]) && all.by_month.map(function (m) { return m.month + ':' + m.total; }).join() === '2026-03:100,2026-10:6000,2026-11:900', [all.count, all.totals, all.by_vendor, all.by_month]);
var oct = build({ from: '2026-10-01', to: '2026-10-31' });
check('a MONTH (October): only October payments — 14743 and 14744 — $6,000', oct.rows.map(function (r) { return r.payment_id; }).join() === 'p1,p2' && oct.totals[0].total === 6000, oct.rows.map(function (r) { return r.payment_id; }));
var ven = build({ vendor: 'nexpac corporation' });
check('a VENDOR (any capitals / spaces): only NexPac payments', ven.rows.every(function (r) { return r.bill.vendor === 'NexPac Corporation'; }) && ven.rows.length === 2);
var vo = build({ showVoided: true, from: '2026-10-01', to: '2026-10-31' });
check('"show voided": the voided payment appears, marked voided — and is NEVER counted (total stays $6,000; 1 voided shown)', vo.rows.some(function (r) { return r.payment_id === 'p4' && r.voided === true; }) && vo.totals[0].total === 6000 && vo.count === 2 && vo.voided_shown === 1, [vo.totals, vo.voided_shown]);
var fl = build({ floor: '2026-06-01', from: '2026-01-01' });
check('WINDOW (employees): with a floor of 1 June the March payment is never shown or counted, even when the filter asks from January; the period starts at the floor', fl.rows.every(function (r) { return r.paid_date >= '2026-06-01'; }) && fl.totals[0].total === 6900 && fl.period.from === '2026-06-01' && fl.floor === '2026-06-01', [fl.rows.map(function (r) { return r.paid_date; }), fl.period]);
check('PAID THROUGH NextTrade / RTM: their own list (14800 · paid through NextTrade Industries), never in the payments or the total', all.paid_through.length === 1 && all.paid_through[0].number === '14800' && all.paid_through[0].paid_via === 'NextTrade Industries' && !all.rows.some(function (r) { return r.bill.number === '14800'; }));
check('…and they follow the window and the vendor filter too', build({ floor: '2026-11-01' }).paid_through.length === 0 && build({ vendor: 'Kronos Trucking' }).paid_through.length === 0);
var noDate = L.buildPaymentsReport({ pays: [{ id: 'px', bill_id: 'b1', amount: 5, paid_date: null, bank_transaction_id: 't1' }], bills: bills, bankLines: bankLines });
check('a payment with no paid date takes its bank line\'s date; one with neither is not placed', noDate.rows.length === 1 && noDate.rows[0].paid_date === '2026-10-06' && L.buildPaymentsReport({ pays: [{ id: 'py', bill_id: 'b1', amount: 5 }], bills: bills }).rows.length === 0);
var csv = L.paymentsCsv(oct, '2026-11-27', 'Bill payments — NexPac Corporation');
var lines = csv.split('\r\n');
check('CSV: an "as of … period …" line, a header, one line per payment, then "Total paid"; quotes where needed', /^Bill payments — NexPac Corporation — as of 2026-11-27 — period 2026-10-01 to 2026-10-31$/.test(lines[0]) && lines[1] === 'Paid date,Vendor,Bill number,Bill date,Release,Amount,Currency,Wire,Wire sent,Bank reference,Bank line date,Bank line amount,Voided' && lines[2] === '2026-10-06,NexPac Corporation,14743,2026-09-15,1001-2210,5000.00,USD,WP-0007,2026-10-05,FT2610050042,2026-10-06,6000.00,' && lines[lines.length - 1] === 'Total paid (USD),,,,,6000.00,USD,,,,,,' && L.paymentsCsv({ rows: [{ paid_date: 'd', amount: 1, bill: { vendor: 'A, "B"', number: 'n', currency: 'USD' }, voided: true }], totals: [], period: {} }, 'x').split('\r\n')[2].indexOf('"A, ""B"""') >= 0, lines);

// Codex 13:52 ZZ-03: different currencies are NEVER added together
var mixBills = bills.concat([{ id: 'c1', vendor_name: 'NexPac Corporation', bill_number: 'CA-1', bill_date: '2026-10-01', total_amount: 100, currency: 'CAD', record_status: 'active' }]);
var mix = L.buildPaymentsReport({ pays: [{ id: 'u1', bill_id: 'b1', amount: 100, paid_date: '2026-10-05' }, { id: 'c1p', bill_id: 'c1', amount: 100, paid_date: '2026-10-06' }], bills: mixBills });
check('ZZ-03: USD 100 + CAD 100 are two totals (USD 100 · CAD 100), never 200; per vendor and per month too', JSON.stringify(mix.totals) === JSON.stringify([{ currency: 'USD', count: 1, total: 100 }, { currency: 'CAD', count: 1, total: 100 }]) && mix.by_month.length === 2 && mix.by_month.every(function (m) { return m.total === 100; }), [mix.totals, mix.by_month]);
var mixCsv = L.paymentsCsv(mix, 'x').split('\r\n');
check('…the CSV has one total line PER currency ("Total paid (USD)" 100.00 USD and "Total paid (CAD)" 100.00 CAD)', mixCsv.slice(-2).join('|') === 'Total paid (USD),,,,,100.00,USD,,,,,,|Total paid (CAD),,,,,100.00,CAD,,,,,,', mixCsv.slice(-2));
check('…amounts carry their currency: $ for USD, "CAD 100.00" for CAD', L.moneyCur(100, 'USD') === '$100.00' && L.moneyCur(100, 'CAD') === 'CAD 100.00' && L.moneyCur(null, 'CAD') === '•••');
// Codex 13:52 ZZ-02: hidden totals — never a crash, never a total anywhere
var hid = L.hideTotals(build({ from: '2026-10-01', to: '2026-10-31' }));
var hidCsv; var hidErr = null; try { hidCsv = L.paymentsCsv(hid, 'x'); } catch (e) { hidErr = e.message; }
check('ZZ-02: with totals hidden the CSV still downloads (no crash), keeps the rows, and its last line says "Totals not shown" — no total amount', hidErr === null && hidCsv.split('\r\n').length === 5 && /^"?Totals not shown/.test(hidCsv.split('\r\n')[4]) && !/6000\.00,USD,,,,,,$/.test(hidCsv), [hidErr, hidCsv && hidCsv.split('\r\n')]);
// ---- the REAL screen with a fake route
var C = require(path.join(root, 'src/components/BillPaymentsReport.jsx'));
var html = C.vendorPrintHtml(oct, 'NexPac Corporation', '2026-11-27');
var hidHtml = C.vendorPrintHtml(L.hideTotals(build({ from: '2026-10-01', to: '2026-10-31' })), 'NexPac Corporation', 'x');
var cadHtml = C.vendorPrintHtml(mix, 'NexPac Corporation', 'x');
check('PRINT for one vendor: KTC header, the period, each payment with bill number / wire / bank reference, and the total; voided never on it', /KTC International — payments to NexPac Corporation/.test(html) && /Period 2026-10-01 to 2026-10-31/.test(html) && /<td>14743<\/td>/.test(html) && /FT2610050042/.test(html) && /Total paid \(USD\)<\/td><td class="n">\$6,000\.00/.test(html) && !/VOIDED/.test(C.vendorPrintHtml(vo, 'NexPac Corporation', 'x')) && (C.vendorPrintHtml(vo, 'NexPac Corporation', 'x').match(/<tr><td>2026/g) || []).length === 2, html.substring(0, 300));
check('ZZ-02: the vendor page for a person without See Money Totals shows the rows but NO total ("Totals not shown", no $6,000)', /Totals not shown/.test(hidHtml) && !/\$6,000\.00/.test(hidHtml) && /<td>14743<\/td>/.test(hidHtml));
check('ZZ-03: a vendor page with USD and CAD payments shows "CAD 100.00" on the CAD row and one total per currency (never $200)', /CAD 100\.00/.test(cadHtml) && /Total paid \(USD\)/.test(cadHtml) && /Total paid \(CAD\)/.test(cadHtml) && !/\$200\.00/.test(cadHtml));
check('…a vendor name with < > & is escaped on the print page', C.vendorPrintHtml({ rows: [], period: {}, totals: [], by_vendor: [] }, 'A<b>&', 'x').indexOf('A&lt;b&gt;&amp;') >= 0);
check('month helpers: October = 10-01 … 10-31; February 2028 ends on the 29th; last month of January is December', JSON.stringify(C.monthRange('2026-10')) === JSON.stringify({ from: '2026-10-01', to: '2026-10-31' }) && C.monthRange('2028-02').to === '2028-02-29' && C.lastMonth(new Date(2027, 0, 15)) === '2026-12' && C.monthRange('bad') === null);
var React = require('react');
var H = { states: [], effects: [], idx: 0, dirty: false, pending: [] };
React.useState = function (init) { var i = H.idx++; if (!(i in H.states)) { H.states[i] = typeof init === 'function' ? init() : init; } return [H.states[i], function (v) { H.states[i] = typeof v === 'function' ? v(H.states[i]) : v; H.dirty = true; }]; };
React.useEffect = function (fn, deps) { var i = H.idx++; var prev = H.effects[i]; var changed = !prev || !deps || deps.some(function (d, k) { return d !== prev.deps[k]; }); if (changed) { H.effects[i] = { deps: deps }; H.pending.push(fn); } };
var calls = []; var answer = null;
function api(b) { calls.push(b); return Promise.resolve(typeof answer === 'function' ? answer(b) : answer); }
var tree = null;
function expand(n) { if (n === null || n === undefined || typeof n === 'boolean') { return null; } if (typeof n === 'string' || typeof n === 'number') { return String(n); } if (Array.isArray(n)) { return n.map(expand); } if (typeof n.type === 'function') { return expand(n.type(n.props || {})); } if (typeof n.type !== 'string') { return expand(n.props && n.props.children); } return { type: n.type, props: n.props || {}, kids: expand(n.props && n.props.children) }; }
function render() { H.idx = 0; H.pending = []; tree = expand(C.default({ api: api })); var fx = H.pending; H.pending = []; fx.forEach(function (f) { f(); }); }
async function flush() { for (var i = 0; i < 40; i++) { await new Promise(function (r) { setImmediate(r); }); if (H.dirty) { H.dirty = false; render(); i = 0; } } }
function text(n) { if (n === null) { return ''; } if (typeof n === 'string') { return n; } if (Array.isArray(n)) { return n.map(text).join(''); } return text(n.kids); }
function find(pred, n, out) { out = out || []; n = n === undefined ? tree : n; if (!n || typeof n === 'string') { return out; } if (Array.isArray(n)) { n.forEach(function (x) { find(pred, x, out); }); return out; } if (pred(n)) { out.push(n); } find(pred, n.kids, out); return out; }
function byId(id) { return find(function (n) { return n.props && n.props['data-testid'] === id; }); }
function byLabel(l) { return find(function (n) { return n.props && n.props['aria-label'] === l; })[0]; }
async function click(el) { el.props.onClick({ stopPropagation: function () {} }); await flush(); }
async function change(el, v) { el.props.onChange({ target: { value: v, checked: v } }); await flush(); }
(async function () {
  // first load: empty report (as today) → plain words, no table
  answer = { ok: true, report: L.buildPaymentsReport({ pays: [], bills: [] }), can_totals: true, vendors: ['Kronos Trucking', 'NexPac Corporation'] };
  render(); await flush();
  check('opening the tab loads the report once for this month (payments_report, show_voided false)', calls.length === 1 && calls[0].action === 'payments_report' && /^\d{4}-\d{2}-01$/.test(calls[0].date_from) && calls[0].show_voided === false, calls);
  check('EMPTY (as today — every earlier payment was voided): it says so in plain words, no table', byId('payments-empty').length === 1 && text(byId('payments-empty')[0]) === C.EMPTY_WORDS && byId('payment-row').length === 0);
  // October, NexPac, show voided
  answer = function (b) { return { ok: true, report: build({ from: b.date_from, to: b.date_to, vendor: b.vendor, showVoided: b.show_voided }), can_totals: true, vendors: ['Kronos Trucking', 'NexPac Corporation'] }; };
  await change(byLabel('Month'), '2026-10'); await change(byLabel('Vendor'), 'NexPac Corporation'); await change(byLabel('Show voided'), true);
  calls = []; await click(byId('payments-show')[0]);
  check('Show sends the chosen month (2026-10-01 … 2026-10-31), the vendor and show_voided', calls.length === 1 && calls[0].date_from === '2026-10-01' && calls[0].date_to === '2026-10-31' && calls[0].vendor === 'NexPac Corporation' && calls[0].show_voided === true, calls);
  var rowsT = byId('payment-row').map(text);
  check('the table: 3 rows (2 live + 1 voided, crossed out "VOIDED"); the wire "WP-0007 · sent 2026-10-05 · ref FT2610050042"; the bank line', rowsT.length === 3 && rowsT.some(function (t) { return /VOIDED/.test(t); }) && rowsT.some(function (t) { return /WP-0007 · sent 2026-10-05 · ref FT2610050042/.test(t) && /2026-10-06 · \$6,000\.00 · WIRE OUT NEXPAC/.test(t); }), rowsT);
  check('the summary line: "October 2026 · NexPac Corporation — 2 payments · $6,000.00 · 1 voided shown, not counted"', text(byId('payments-summary')[0]) === 'October 2026 · NexPac Corporation — 2 payments · $6,000.00 · 1 voided shown, not counted', text(byId('payments-summary')[0]));
  check('totals by vendor and by month are shown, each vendor with "🖨 for the vendor"', byId('vendor-total').length === 1 && /NexPac Corporation2 · \$6,000\.00/.test(text(byId('vendor-total')[0])) && byId('print-vendor').length === 1 && /October 2026: 2 · \$6,000\.00/.test(text(byId('month-total')[0])));
  check('the paid-through section lists 14800 (paid through NextTrade Industries)', /14800/.test(text(byId('paid-through')[0] || null)) && /paid through NextTrade Industries/.test(text(byId('paid-through')[0] || null)));
  await click(byId('open-proof')[0]);
  var pop = byId('proof-popup');
  check('📄 SWIFT opens the bank confirmation in a POP-UP (the wire\'s own file); Close ✕ returns to the same report, nothing reloaded', pop.length === 1 && /WP-0007 — MT103-FT2610050042\.pdf/.test(text(pop[0])) && /viewer:pv\/wires\/w7\/mt103\.pdf/.test(text(pop[0])) && calls.length === 1, pop.map(text));
  await click(byId('close-proof')[0]);
  check('…closed: the report is still there, still 3 rows', byId('proof-popup').length === 0 && byId('payment-row').length === 3 && calls.length === 1);
  // Codex 13:52 ZZ-01: a filter changed WITHOUT pressing Show never relabels the list that is still shown
  var sumBefore = text(byId('payments-summary')[0]);
  await change(byLabel('Vendor'), 'Kronos Trucking');
  var csvB = byId('payments-csv')[0]; var prB = byId('print-vendor')[0];
  check('ZZ-01: choosing Kronos WITHOUT pressing Show: the heading still says NexPac (the rows shown), an amber "press Show" note appears, and CSV / vendor page are disabled', text(byId('payments-summary')[0]) === sumBefore && /NexPac Corporation/.test(sumBefore) && byId('payments-stale').length === 1 && csvB.props.disabled === true && prB.props.disabled === true && calls.length === 1, [text(byId('payments-summary')[0]), csvB.props.disabled]);
  answer = { ok: false, error: 'The server could not read the payments just now.' };
  await click(byId('payments-show')[0]);
  check('…a FAILED Show keeps the last list with ITS heading (still October · NexPac), says why in red, and exports stay disabled (the filters on screen are not what is shown)', text(byId('payments-summary')[0]) === sumBefore && find(function (n) { return n.props && n.props.role === 'alert'; }).some(function (n) { return /could not read the payments/.test(text(n)); }) && byId('payments-csv')[0].props.disabled === true, [text(byId('payments-summary')[0])]);
  answer = function (b) { return { ok: true, report: build({ from: b.date_from, to: b.date_to, vendor: b.vendor, showVoided: b.show_voided }), can_totals: true, vendors: ['Kronos Trucking', 'NexPac Corporation'] }; };
  await change(byLabel('Vendor'), 'NexPac Corporation');
  check('…choosing NexPac again (the applied filters) clears the note and allows the CSV again — no reload needed', byId('payments-stale').length === 0 && byId('payments-csv')[0].props.disabled === false);
  await change(byLabel('Vendor'), 'Kronos Trucking'); await click(byId('payments-show')[0]);
  check('…pressing Show for Kronos: the heading now says Kronos, the rows are Kronos, exports allowed', /· Kronos Trucking —/.test(text(byId('payments-summary')[0])) && byId('payment-row').every(function (n) { return /Kronos Trucking/.test(text(n)); }) && byId('payments-csv')[0].props.disabled === false, text(byId('payments-summary')[0]));
  check('…filterKey treats the month, custom dates, vendor and show-voided as the applied identity', C.filterKey({ mode: 'month', ym: '2026-10', vendor: 'A', showVoided: false }) !== C.filterKey({ mode: 'month', ym: '2026-11', vendor: 'A', showVoided: false }) && C.filterKey({ mode: 'custom', from: '2026-10-01', to: '2026-10-31', vendor: '', showVoided: true }) !== C.filterKey({ mode: 'custom', from: '2026-10-01', to: '2026-10-31', vendor: '', showVoided: false }));
  // masked totals (no "See Money Totals")
  answer = function (b) { var r = L.hideTotals(build({ from: b.date_from, to: b.date_to })); return { ok: true, report: r, can_totals: false, vendors: [] }; };
  await change(byLabel('Vendor'), ''); await click(byId('payments-show')[0]);
  check('without "See Money Totals" the totals read ••• (the rows stay), as elsewhere in Bills', /— 2 payments · •••/.test(text(byId('payments-summary')[0])) && /•••/.test(text(byId('vendor-total')[0])), text(byId('payments-summary')[0]));
  // a refusal
  answer = { ok: false, error: 'This needs the "Bills: View" permission — grant it in Settings → 🏦 Banking & Accounting Access.' };
  await click(byId('payments-show')[0]);
  check('a refusal from the server is shown in red, in its own words', find(function (n) { return n.props && n.props.role === 'alert'; }).some(function (n) { return /Bills: View/.test(text(n)); }));
  // ---- the route action (source)
  var rt = fs.readFileSync(path.join(root, 'src/app/api/accounting/bills/route.js'), 'utf8');
  check('ROUTE: payments_report is a READ action behind the same Bills: View / Manage gate as the list', /var READ_LIKE_LIST = \{[^}]*payments_report: 1[^}]*\}/.test(rt) && /if \(action === 'payments_report'\) \{/.test(rt));
  check('ROUTE: the history window (windowFloorFor) is applied and a failure stops it (503, nothing shown); the payroll-scoped bills (loadBills on the scoped db)', /var winP = await windowFloorFor\(db, \(gate && gate\.ctx\) \|\| null\);\s*\n?\s*if \(winP\.error\) \{ return NextResponse\.json\(\{ error: winP\.error \}, \{ status: 503 \}\); \}/.test(rt) && /var LP = await loadBills\(db\);/.test(rt) && /floor: winP\.floor \|\| null/.test(rt) && /db = payrollFilteredDb\(db, payZD\);/.test(rt));
  check('ROUTE: show_voided only when it is exactly true; isPaymentVoid decides voided; totals masked (null) without view_totals; no write in the action', /showVoided: body\.show_voided === true, isVoid: isPaymentVoid/.test(rt) && /if \(!canTotals\) \{ hideTotals\(repP\); \}/.test(rt) && !/payments_report[\s\S]{0,2500}\.(insert|update|delete|upsert)\(/.test(rt.substring(rt.indexOf("if (action === 'payments_report')"), rt.indexOf('// ── save_bill'))));
  var bt = fs.readFileSync(path.join(root, 'src/components/BillsTab.jsx'), 'utf8');
  check('BILLS: a "💸 Payments" button for anyone who may view bills, opening the report panel', /\{canView && <button data-testid="payments-tab"[^\n]*💸 Payments<\/button>\}/.test(bt) && /\{panel === 'payments' && canView && <BillPaymentsReport api=\{api\}/.test(bt));
  var page = fs.readFileSync(path.join(root, 'src/app/page.jsx'), 'utf8'); var wn = fs.readFileSync(path.join(root, 'src/components/WhatsNewWidget.jsx'), 'utf8');
  var topV = (/version: '([^']+)'/.exec(wn.substring(wn.indexOf('BUILD_HISTORY = ['))) || [])[1];
  check('badge and What\'s New name the newest entry, and the ZZ entry exists', wn.indexOf("version: 'v55.83-ZZ'") > 0 && page.indexOf('>' + topV + '</span>') >= 0, topV);
  console.log('\nZZ payments report: ' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.log('  ✗ FAIL: crashed ' + (e && e.stack)); process.exit(1); });
