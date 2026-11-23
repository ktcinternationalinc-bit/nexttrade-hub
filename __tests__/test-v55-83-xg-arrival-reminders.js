// v55.83-XG — Max, 22 Nov 2026: arrival + final-payment reminders, Phase 1 (e-mail, sent by hand).
// "for each order, message the customer the expected arrival and ask them to prepare final payment; connected to the real
// invoices so it knows what's received / partially received / how much remains; by the arrival day-counter phase; in the
// customer's language". The REAL helpers and the REAL route on an in-memory database, a made-up warehouse feed and a mail
// server stand-in (nothing leaves this machine). All customers, orders and amounts are made up.
var path = require('path'); var Module = require('module'); var fs = require('fs');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'x';
process.env.NEXTRADE_FEED_URL = 'https://fix.nextrade-staging.com/api/hub-feed/shipping';
process.env.NEXTRADE_FEED_TOKEN = 'test-token-0123456789-0123456789-0123456789';
process.env.COMMERCIAL_MAIL_USER = 'info@ktcus.com'; process.env.COMMERCIAL_MAIL_PASSWORD = 'not-a-real-password';
delete process.env.CRON_SECRET;
require(path.join(root, 'node_modules/sucrase/register'));
var MemDB = require('./helpers/memdb-wires.js');
var L = require(path.join(root, 'src/lib/arrival-reminders.js'));
var S = require(path.join(root, 'src/lib/arrival-reminders-server.js'));

var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 900))); }
console.log('XG — arrival + final-payment reminders');

// ── 1. the day counter, phases and slots ──
check('days: 2026-11-22 → 2026-12-13 is 21', L.daysBetween('2026-11-22', '2026-12-13') === 21);
check('days: across the clock change (1 Nov → 8 Nov) is 7', L.daysBetween('2026-11-01', '2026-11-08') === 7);
check('days: a past date is negative', L.daysBetween('2026-11-22', '2026-11-20') === -2);
check('days: no date → null', L.daysBetween('2026-11-22', null) === null && L.daysBetween('2026-11-22', '') === null);
check('today in New York: 03:30 UTC is still the day before', L.todayInNewYork(Date.UTC(2026, 10, 22, 3, 30)) === '2026-11-21');
check('today in New York: 15:00 UTC is the same day', L.todayInNewYork(Date.UTC(2026, 10, 22, 15, 0)) === '2026-11-22');
var ph = {}; [-30, -1, 0, 7, 8, 14, 15, 21, 22, 90].forEach(function (d) { ph[d] = L.phaseOf(d); });
check('phases match the warehouse Day Counter (past / 0-7 / 8-14 / 15-21 / later)', ph[-30] === 'overdue' && ph[-1] === 'overdue' && ph[0] === 'urgent' && ph[7] === 'urgent' && ph[8] === 'firmer' && ph[14] === 'firmer' && ph[15] === 'friendly' && ph[21] === 'friendly' && ph[22] === null && ph[90] === null, ph);
check('phase: no day counter → none', L.phaseOf(null) === null && L.phaseOf(undefined) === null && L.phaseOf('x') === null);
var slots = {}; for (var dd = 21; dd >= 0; dd--) { slots[L.slotOf(dd, '2026-11-22')] = true; }
check('slots: 1 friendly + 2 firmer + 4 urgent = 7 before arrival (Max: 1 / 2 / 4)', Object.keys(slots).sort().join(',') === 'firmer-1,firmer-2,friendly-1,urgent-1,urgent-2,urgent-3,urgent-4', Object.keys(slots));
check('slots: past the date = one per calendar day', L.slotOf(-1, '2026-11-22') === 'overdue-2026-11-22' && L.slotOf(-9, '2026-11-23') === 'overdue-2026-11-23' && L.slotOf(-1, '2026-11-22') !== L.slotOf(-2, '2026-11-23'));
check('slots: same slot all through its days', L.slotOf(14, 'x') === L.slotOf(12, 'x') && L.slotOf(11, 'x') === L.slotOf(8, 'x') && L.slotOf(7, 'x') === L.slotOf(6, 'x') && L.slotOf(1, 'x') === L.slotOf(0, 'x'));

// ── 2. the balance ──
var b1 = L.balanceOf([{ number: 'A', total: 1000.10, paid: 400.05 }]);
check('balance: partly paid → total / received / remaining to the cent', b1.ok && b1.total === 1000.10 && b1.received === 400.05 && b1.remaining === 600.05 && !b1.paid_in_full, b1);
var b2 = L.balanceOf([{ number: 'A', total: 0.1, paid: 0 }, { number: 'B', total: 0.2, paid: 0 }]);
check('balance: no floating-point drift (0.1 + 0.2 = 0.30)', b2.total === 0.3 && b2.remaining === 0.3, b2);
var b3 = L.balanceOf([{ number: 'A', total: 500, paid: 700 }, { number: 'B', total: 300, paid: 0 }]);
check('balance: an overpaid invoice never hides what another still owes', b3.remaining === 300 && b3.received === 500 && b3.overpaid === 200 && !b3.paid_in_full, b3);
check('balance: paid in full', L.balanceOf([{ number: 'A', total: 500, paid: 500 }]).paid_in_full === true);
check('balance: no invoice → nothing can be stated', L.balanceOf([]).ok === false && /No invoice/.test(L.balanceOf([]).reason));
check('balance: another currency → refused, never mixed into dollars', L.balanceOf([{ number: 'A', total: 5, paid: 0, currency: 'EGP' }]).ok === false);

// ── 3. the 16 approved texts ──
var F = { name: 'Sara Lopez', release: '1002-0456', pol: 'USA', destination: 'Guatemala', container: 'MSKU1234567', arrival_date: '2026-12-10', days: 18, total: 25000, received: 10000, remaining: 15000 };
var n16 = 0; var bad16 = [];
L.LANGS.forEach(function (lg) { L.PHASES.forEach(function (p) {
  var days = p === 'friendly' ? 18 : (p === 'firmer' ? 10 : (p === 'urgent' ? 5 : -3));
  var r = L.composeReminder(lg, p, Object.assign({}, F, { days: days }));
  var okR = r.ok && r.subject === '1002-0456 · KTC · USA → Guatemala · Container MSKU1234567' && r.body.indexOf('{') < 0 && r.body.indexOf('}') < 0
    && r.body.indexOf('$25,000.00') > 0 && r.body.indexOf('$10,000.00') > 0 && r.body.indexOf('$15,000.00') > 0 && r.body.indexOf('1002-0456') > 0 && r.body.indexOf('MSKU1234567') > 0
    && r.body.indexOf('Sara Lopez') > 0 && r.body.indexOf('KTC International') > 0 && r.body.indexOf('undefined') < 0 && r.body.indexOf('null') < 0 && r.body.indexOf('NaN') < 0;
  if (okR) { n16++; } else { bad16.push(lg + '/' + p); }
}); });
check('all 16 messages (4 stages x 4 languages): subject, release, container, name, the three amounts, no blank or unfilled field', n16 === 16, bad16);
var en = {}; L.PHASES.forEach(function (p) { en[p] = L.composeReminder('en', p, Object.assign({}, F, { days: p === 'friendly' ? 18 : (p === 'firmer' ? 10 : (p === 'urgent' ? 5 : -3)) })).body; });
check('EN friendly is the approved wording', en.friendly.indexOf('Good news — your shipment is on the way. Release 1002-0456 (USA → Guatemala, container MSKU1234567) is expected to arrive on December 10, 2026, about 18 days from now.') > 0 && en.friendly.indexOf('please begin preparing the final payment ahead of arrival') > 0 && /Warm regards,\nKTC International$/.test(en.friendly), en.friendly);
check('EN firmer is the approved wording', en.firmer.indexOf('is expected to arrive on December 10, 2026, in about 10 days.') > 0 && en.firmer.indexOf('Cleared funds are needed before release of the container.') > 0);
check('EN urgent is the approved wording', en.urgent.indexOf('is expected on December 10, 2026 — 5 days away.') > 0 && en.urgent.indexOf('please send the final payment today') > 0);
check('EN beyond urgent is the approved wording', en.overdue.indexOf('has arrived (expected December 10, 2026) and the balance below is now overdue.') > 0 && en.overdue.indexOf('Please send the outstanding balance immediately.') > 0);
check('EN account block', en.friendly.indexOf('Your account for this shipment:\n• Invoice total: $25,000.00\n• Received to date: $10,000.00\n• Balance remaining: $15,000.00') > 0);
var u0 = L.composeReminder('en', 'urgent', Object.assign({}, F, { days: 0 })).body; var u1 = L.composeReminder('en', 'urgent', Object.assign({}, F, { days: 1 })).body;
check('urgent on the day / the day before never prints "0 days" or "1 days"', u0.indexOf('— today.') > 0 && u1.indexOf('— tomorrow.') > 0 && u0.indexOf('0 days') < 0 && u1.indexOf('1 days') < 0);
var es = L.composeReminder('es', 'urgent', Object.assign({}, F, { days: 5 })); var fr = L.composeReminder('fr', 'friendly', Object.assign({}, F, { days: 18 })); var ar = L.composeReminder('ar', 'firmer', Object.assign({}, F, { days: 10 })); var ar2 = L.composeReminder('ar', 'friendly', Object.assign({}, F, { days: 18 }));
check('ES: date in Spanish, "dentro de 5 días"', es.body.indexOf('10 de diciembre de 2026, dentro de 5 días.') > 0 && es.body.indexOf('Saldo pendiente: $15,000.00') > 0, es.body);
check('FR: date in French, "dans environ 18 jours"', fr.body.indexOf('10 décembre 2026, dans environ 18 jours.') > 0 && fr.body.indexOf('Solde restant : $15,000.00') > 0, fr.body);
check('AR: right-to-left, Arabic month, Latin digits, 10 → أيام, 18 → يومًا', ar.rtl === true && ar.body.indexOf('10 أيام') > 0 && ar2.body.indexOf('18 يومًا') > 0 && ar.body.indexOf('ديسمبر') > 0 && /2026/.test(ar.body) && ar.body.indexOf('الرصيد المتبقي: $15,000.00') > 0, ar.body);
var sh = {}; L.LANGS.forEach(function (lg) { sh[lg] = L.composeReminder(lg, 'overdue', Object.assign({}, F, { days: -3, releases: ['1002-0456', '1002-0457', '1002 0456', '1002-0458'] })); });
check('one invoice for several releases (Max: "just list all releases on that invoice and balance totals"): EN lists every release once and keeps the three totals', sh.en.ok && sh.en.shared_invoice === true && sh.en.body.indexOf('Your account for releases 1002-0456, 1002-0457, 1002-0458, which are invoiced together:\n• Invoice total: $25,000.00\n• Received to date: $10,000.00\n• Balance remaining: $15,000.00') > 0 && sh.en.body.indexOf('Your account for this shipment') < 0, sh.en.body);
check('…the same in Spanish, French and Arabic', sh.es.body.indexOf('Estado de su cuenta para los embarques 1002-0456, 1002-0457, 1002-0458, facturados conjuntamente:\n• Total de la factura: $25,000.00') > 0 && sh.fr.body.indexOf('État de votre compte pour les envois 1002-0456, 1002-0457, 1002-0458, facturés ensemble :\n• Total de la facture : $25,000.00') > 0 && sh.ar.body.indexOf('حالة حسابكم للشحنات 1002-0456, 1002-0457, 1002-0458 المفوترة معًا:\n• إجمالي الفاتورة: $25,000.00') > 0 && [sh.es, sh.fr, sh.ar].every(function (x) { return x.body.indexOf('{') < 0; }), [sh.es.body, sh.fr.body, sh.ar.body]);
var one = L.composeReminder('en', 'overdue', Object.assign({}, F, { days: -3, releases: ['1002-0456'] })); var none = L.composeReminder('en', 'overdue', Object.assign({}, F, { days: -3 }));
check('…an invoice for this release only keeps the approved line "Your account for this shipment:" unchanged', one.shared_invoice === false && one.body === none.body && none.body.indexOf('Your account for this shipment:\n• Invoice total') > 0);
var many = []; for (var mi = 0; mi < 13; mi++) { many.push('1002-9' + (100 + mi)); }
check('…a release name cannot inject a field or a line; more than 12 releases is refused rather than sent as a wall of numbers', L.composeReminder('en', 'overdue', Object.assign({}, F, { days: -3, releases: ['1002-0456', '1002-0457 {total}\nBcc: x'] })).body.indexOf('1002-0456, 1002-0457 total Bcc: x, which') > 0 && L.composeReminder('en', 'overdue', Object.assign({}, F, { days: -3, releases: many })).ok === false);
check('language: unknown / empty → English', L.langOf('de') === 'en' && L.langOf('') === 'en' && L.langOf(null) === 'en' && L.langOf('ES') === 'es' && L.langOf('fr-CA') === 'fr');
check('a missing field refuses the message (no blank ever sent)', L.composeReminder('en', 'urgent', Object.assign({}, F, { container: '' })).ok === false && L.composeReminder('en', 'urgent', Object.assign({}, F, { container: '0' })).ok === false && L.composeReminder('en', 'urgent', Object.assign({}, F, { destination: null })).ok === false && L.composeReminder('en', 'urgent', Object.assign({}, F, { name: ' ' })).ok === false);
check('no stage → no message', L.composeReminder('en', null, F).ok === false && L.composeReminder('en', 'nonsense', F).ok === false);
var inj = L.composeReminder('en', 'friendly', Object.assign({}, F, { name: 'Evil {remaining}\nBcc: x@y.z', container: 'C1 {total}' }));
check('a value containing {field} or a line break is not filled again and cannot add a line', inj.ok && inj.body.indexOf('Evil {remaining} Bcc: x@y.z,') > 0 && inj.subject.indexOf('\n') < 0 && inj.body.indexOf('C1 {total}') > 0, inj.body);
var h = L.htmlOf('a < b & "c"\nnext', true);
check('HTML copy: escaped, line breaks kept, right-to-left for Arabic', h.indexOf('a &lt; b &amp; &quot;c&quot;<br/>next') > 0 && h.indexOf('dir="rtl"') > 0 && L.htmlOf('x', false).indexOf('dir="ltr"') > 0);

// ── 4. the rows: the warehouse feed joined to the Hub's invoices ──
var TODAY = L.todayInNewYork();
function plus(n) { var m = /^(\d+)-(\d+)-(\d+)/.exec(TODAY); return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n)).toISOString().substring(0, 10); }
function ord(id, rel, cust, o) { return Object.assign({ id: id, release_number: rel, customer_id: id, customer_name: cust, warehouse_id: 1, warehouse_name: 'USA', status: 'shipped', country: 'Guatemala', container: 'CONT' + id, order_closed: 0, is_draft: 0, in_house_order: 0, payment_made: 0 }, o || {}); }
function stage(orderId, arrival, o) { return Object.assign({ id: orderId * 10, order_id: orderId, order_status: 'shipping_in_process', arrival_date: arrival, updated_at: '2026-11-01 10:00:00' }, o || {}); }
function inv(id, rel, cust, total, o) { return Object.assign({ id: 'i' + id, invoice_number: 'INV-' + id, release_number: rel, po_so_number: null, accounting_customer_id: cust, total_amount: total, wave_imported_paid: 0, currency: 'USD', record_status: 'active', approval_status: 'approved', wave_status: null, wave_business_id: US_BIZ, invoice_date: '2026-10-01' }, o || {}); }
function pay(id, invId, amount, o) { return Object.assign({ id: 'p' + id, accounting_invoice_id: 'i' + invId, amount: amount, voided: false, sync_status: 'synced' }, o || {}); }
var US_BIZ = require(path.join(root, 'src/lib/business-of.js')).US_WAVE_BUSINESS_ID; var OTHER_BIZ = 'QnVzaW5lc3M6b3RoZXI=';
var feed = { ok: true, source: 'nextrade-staging', site: 'fix.nextrade-staging.com', orders: [
  ord(1, '1002-0001', 'Alpha Trading', {}),                                   // 18 days: friendly, partly paid
  ord(2, '1002-0002', 'Beta Imports', {}),                                    // 10 days: firmer, unpaid
  ord(3, '1002-0003', 'Gamma SA', {}),                                        // 3 days: urgent, paid in full → nothing to ask
  ord(4, '1002-0004', 'Delta Co', {}),                                        // 4 days past: overdue
  ord(5, '1002-0005', 'Epsilon Ltd', {}),                                     // 40 days: not in the window
  ord(6, '1002-0006', 'Zeta LLC', { status: 'pending' }),                     // not shipped
  ord(7, '1002-0007', 'Eta Inc', { order_closed: 1 }),                        // closed
  ord(8, '1002-0008', 'Theta', {}),                                           // in the window, NO invoice
  ord(9, '1002-0009', 'Completely Different Name', { payment_made: 1, customer_contact_person: 'Warehouse Person' }),      // name differs from the Hub invoice; warehouse tick on
  ord(10, '1002-0010', 'Kappa', { container: '0' }),                          // no container
  ord(11, '1002-0011', 'Lambda', {}),                                         // void invoice only
  ord(12, '1002-0012', 'Mu Group', { customer_language: 'es', customer_email: 'compras@mu.example', customer_contact_person: 'Ana Ruiz' }), // warehouse sends language / e-mail / contact
  ord(13, '1002-0013', 'Nu Trading', {}), ord(14, '1002-0013', 'Nu Trading', {}), // one release on two orders
  ord(15, '1002-0015', 'test customer', {}),                                  // test order
  ord(16, '1002-0016', 'Omicron', {}),                                        // invoice in another currency
  ord(17, '1001-0017', 'Rho Canada', { warehouse_name: 'CANADA' }),           // 1001 = Canada
  ord(18, '1003-0018', 'Sigma', { warehouse_name: 'Non-Bonded USA' }),        // 1003: the port of loading must be confirmed by a person
  ord(19, '1002-0019', 'Tau', {}),                                            // invoice and payment inside a November window
  ord(20, '1002-0020', 'Upsilon', {}),                                        // current invoice, but a payment dated BEFORE the window
  ord(21, '1002-0021', 'Phi', {}),                                            // current invoice, a payment with NO date
  ord(22, '1002-0022', 'Chi', {}),                                            // invoice dated 15 March 2026: before the system
  ord(23, '1002-0023', 'Psi Egypt', {}),                                      // a dollar invoice of the OTHER Wave business (Egypt books)
  ord(24, '1002-0024', 'Omega', {})                                           // no business on the invoice, customer tagged egypt
], requirements: [stage(1, plus(18)), stage(2, plus(10)), stage(3, plus(3)), stage(4, plus(-4)), stage(5, plus(40)), stage(6, plus(5)), stage(7, plus(5)), stage(8, plus(6)), stage(9, plus(12)), stage(10, plus(2)), stage(11, plus(2)),
  stage(12, plus(20)), stage(13, plus(9)), stage(14, plus(9)), stage(15, plus(1)), stage(16, plus(1)), stage(17, plus(13)), stage(18, plus(5)), stage(19, plus(16)), stage(20, plus(16)), stage(21, plus(16)), stage(22, plus(16)), stage(23, plus(16)), stage(24, plus(16)),
  { id: 999, order_id: 1, order_status: 'shipping_in_process', arrival_date: plus(60), updated_at: '2026-10-01 10:00:00' }, // an OLDER stage row for order 1: the latest one wins
  { id: 998, order_id: 2, order_status: 'end_stage', arrival_date: plus(1), updated_at: '2026-11-20 10:00:00' }],           // another stage's row is never the arrival
  status_history: [] };
var customers = [{ id: 'c1', company_name: 'Alpha Trading Inc', contact_name: 'Sara Lopez', email: 'sara@alpha.example' }, { id: 'c2', company_name: 'Beta Imports', contact_name: null, email: null },
  { id: 'c3', company_name: 'Gamma SA', contact_name: 'G', email: 'g@gamma.example' }, { id: 'c4', company_name: 'Delta Co', contact_name: 'D', email: 'd@delta.example' }, { id: 'c9', company_name: 'Iota Holdings', contact_name: 'I', email: 'i@iota.example' },
  { id: 'c10', company_name: 'Kappa', contact_name: 'K', email: 'k@kappa.example' }, { id: 'c12', company_name: 'Mu Group', contact_name: 'Old Contact', email: 'old@mu.example' }, { id: 'c13', company_name: 'Nu Trading', contact_name: 'N', email: 'n@nu.example' },
  { id: 'c15', company_name: 'test customer', contact_name: 'T', email: 't@t.example' }, { id: 'c16', company_name: 'Omicron', contact_name: 'O', email: 'o@o.example' }, { id: 'c17', company_name: 'Rho Canada', contact_name: 'R', email: 'r@rho.example' }, { id: 'c18', company_name: 'Sigma', contact_name: 'S', email: 's@sigma.example' }, { id: 'c19', company_name: 'Tau', contact_name: 'T', email: 't@tau.example' }, { id: 'c20', company_name: 'Upsilon', contact_name: 'U', email: 'u@ups.example' }, { id: 'c21', company_name: 'Phi', contact_name: 'P', email: 'p@phi.example' }, { id: 'c22', company_name: 'Chi', contact_name: 'C', email: 'c@chi.example' }, { id: 'c23', company_name: 'Psi Egypt', contact_name: 'P', email: 'p@psi.example' }, { id: 'c24', company_name: 'Omega', contact_name: 'O', email: 'o@omega.example', business_tag: 'egypt' }];
var invoices = [inv(1, '1002-0001', 'c1', 25000.10, { wave_imported_paid: 5000 }), inv(2, '1002-0002', 'c2', 8000), inv(3, '1002-0003', 'c3', 900), inv(4, '1002-0004 & 1002-0099', 'c4', 12000), inv(5, '1002-0005', 'c1', 100),
  inv(9, '1002-0009', 'c9', 4000), inv(10, '1002-0010', 'c10', 700), inv(11, '1002-0011', 'c1', 600, { record_status: 'void' }), inv(12, null, 'c12', 3000, { po_so_number: '1002-0012' }),
  inv(13, '1002-0013', 'c13', 500), inv(15, '1002-0015', 'c15', 500), inv(16, '1002-0016', 'c16', 500, { currency: 'EGP' }), inv(17, '1002-0001', 'c1', 999, { wave_status: 'DRAFT' }), inv(18, '1001-0017', 'c17', 2000), inv(19, '1003-0018', 'c18', 3000), inv(20, '1002-0019', 'c19', 6000, { invoice_date: '2026-11-10' }), inv(21, '1002-0020', 'c20', 7000, { invoice_date: '2026-11-10' }), inv(22, '1002-0021', 'c21', 8000, { invoice_date: '2026-11-10' }), inv(23, '1002-0022', 'c22', 9000, { invoice_date: '2026-03-15' }), inv(24, '1002-0023', 'c23', 4000, { wave_business_id: OTHER_BIZ }), inv(25, '1002-0024', 'c24', 4100, { wave_business_id: null })];
var payments = [pay(1, 1, 5000.05), pay(2, 1, 777, { voided: true }), pay(3, 1, 888, { sync_status: 'reversed' }), pay(4, 3, 900), pay(5, 4, 2000), pay(6, 20, 1500, { payment_date: '2026-11-12' }), pay(7, 21, 1000, { payment_date: '2026-10-15' }), pay(8, 22, 1000, { payment_date: null })];
var built = S.buildReminderRows({ feed: feed, invoices: invoices, payments: payments, customers: customers, log: [], today: TODAY });
var by = {}; built.rows.forEach(function (r) { by[r.order_id] = r; });
check('only shipped, open orders with an arrival 21 days away or less (or past) are listed', !by[5] && !by[6] && !by[7] && built.rows.length === 21, built.rows.map(function (r) { return r.order_id; }));
check('order 1: friendly, 18 days — the LATEST shipping row gives the arrival date', by[1].phase === 'friendly' && by[1].days === 18 && by[1].arrival_date === plus(18) && by[1].slot === 'friendly-1');
check('order 1: total 25,000.10 · received 10,000.05 (Wave 5,000 + payment 5,000.05; void and reversed payments ignored; the Wave draft invoice ignored) · owed 15,000.05', by[1].balance.total === 25000.10 && by[1].balance.received === 10000.05 && by[1].balance.remaining === 15000.05 && by[1].invoices.length === 1, by[1].balance);
check('order 1: ready — Hub e-mail, contact person from the Hub, English by default', by[1].blocks.length === 0 && by[1].email === 'sara@alpha.example' && by[1].email_from === 'hub' && by[1].fields.name === 'Sara Lopez' && by[1].language === 'en' && by[1].language_from_warehouse === false, by[1]);
check('order 1: "Alpha Trading" vs "Alpha Trading Inc" is the same customer (no warning)', by[1].warnings.length === 0, by[1].warnings);
check('order 2: firmer, unpaid, no e-mail on file → still ready (the person types the address), company name used', by[2].phase === 'firmer' && by[2].balance.remaining === 8000 && by[2].email === null && by[2].blocks.length === 0 && by[2].fields.name === 'Beta Imports' && by[2].arrival_date === plus(10));
check('order 3: paid in full → cannot be sent', by[3].phase === 'urgent' && by[3].blocks.some(function (b) { return /paid in full/.test(b); }), by[3].blocks);
check('order 4: past the date → beyond urgent, one slot per day; an invoice covering two releases carries a warning', by[4].phase === 'overdue' && by[4].days === -4 && by[4].slot === 'overdue-' + TODAY && by[4].balance.remaining === 10000 && by[4].warnings.some(function (w) { return /WHOLE invoice/.test(w) && /1002-0004, 1002-0099/.test(w); }) && by[4].fields.releases.join('|') === '1002-0004|1002-0099' && by[1].fields.releases.length === 0, by[4]);
check('order 8: no invoice → cannot be sent, no figures', by[8].balance === null && by[8].blocks.some(function (b) { return /No invoice/.test(b); }));
check('order 9: customer name differs + warehouse "Payment Received" ticked → two warnings to tick, still sendable', by[9].blocks.length === 0 && by[9].fields.name === 'I' && by[9].warnings.length === 2 && /Completely Different Name/.test(by[9].warnings[0]) && /Payment Received/.test(by[9].warnings[1]), by[9].warnings);
check('order 10: container "0" → cannot be sent', by[10].blocks.some(function (b) { return /container number/.test(b); }), by[10].blocks);
check('order 11: a void invoice is never stated → no invoice', by[11].blocks.some(function (b) { return /No invoice/.test(b); }));
check('order 12: the warehouse language / contact are used; found by P.O./S.O. (warning); a different warehouse e-mail is flagged, the Hub one stays first', by[12].language === 'es' && by[12].language_from_warehouse === true && by[12].fields.name === 'Ana Ruiz' && by[12].email === 'old@mu.example' && by[12].warnings.some(function (w) { return /P\.O\.\/S\.O\./.test(w); }) && by[12].warnings.some(function (w) { return /compras@mu\.example/.test(w); }), by[12]);
check('orders 13 + 14: one release on two warehouse orders → neither can be sent', by[13].blocks.some(function (b) { return /2 warehouse orders/.test(b); }) && by[14].blocks.length > 0);
check('order 15: a test order → cannot be sent', by[15].blocks.some(function (b) { return /test order/.test(b); }));
check('order 16: an invoice in pounds → cannot be sent', by[16].blocks.some(function (b) { return /not in US dollars/.test(b); }), by[16].blocks);
check('port of loading: 1002 = Houston, 1001 = Canada, taken from the release number without asking (never from the warehouse name)', by[1].pol === 'Houston' && by[1].fields.pol === 'Houston' && by[1].pol_needs_confirm === false && by[17].pol === 'Canada' && by[17].fields.pol === 'Canada' && by[17].pol_needs_confirm === false && by[17].blocks.length === 0, [by[1].pol, by[17]]);
check('port of loading: 1003 is NOT guessed — it waits for a person; the warehouse name is only a suggestion; the order is not blocked', by[18].pol === null && by[18].fields.pol === '' && by[18].pol_needs_confirm === true && by[18].pol_suggestion === 'Non-Bonded USA' && by[18].release_prefix === '1003' && by[18].blocks.length === 0, by[18]);
var pr = [L.polOfRelease('1002-0456'), L.polOfRelease(' 1001-7'), L.polOfRelease('1003-1'), L.polOfRelease('10020456'), L.polOfRelease(''), L.polOfRelease('constructor-1'), L.polOfRelease('1002'), L.polOfRelease('21002-5')];
check('release prefix rule: only an exact 1002- / 1001- prefix is certain; anything else (1003-, no dash, empty, odd text, a longer number) is not', pr[0].certain && pr[0].pol === 'Houston' && pr[1].certain && pr[1].pol === 'Canada' && !pr[2].certain && pr[2].prefix === '1003' && !pr[3].certain && !pr[4].certain && !pr[5].certain && !pr[6].certain && !pr[7].certain, pr);
check('an invoice dated before 1 April 2026 is never reminded about (the existing rule of the late-invoice reminders) — for everyone', by[22].blocks.some(function (b) { return /before 1 April 2026 \(INV-23\)/.test(b); }) && by[22].limited === false, by[22].blocks);
check('KTC USA only: a dollar invoice bound to the OTHER Wave business, and an unbound invoice of a customer tagged egypt, are never reminded about; a KTC USA invoice is', by[23].blocks.some(function (b) { return /not a KTC USA invoice \(INV-24\)/.test(b); }) && by[24].blocks.some(function (b) { return /not a KTC USA invoice \(INV-25\)/.test(b); }) && by[1].blocks.length === 0 && by[19].blocks.length === 0, [by[23].blocks, by[24].blocks]);
// the history window (floor = 2026-11-01): a person limited to it gets NO figure of an order whose balance depends on older history
var builtW = S.buildReminderRows({ feed: feed, invoices: invoices, payments: payments, customers: customers, today: TODAY, floor: '2026-11-01', log: [{ order_id: 1, status: 'sent', mode: 'manual', channel: 'email', phase: 'friendly', slot: 'friendly-1', language: 'en', sent_to: 'sara@alpha.example', sent_at: '2026-11-20T10:00:00Z', total: 25000.10, received: 10000.05, remaining: 15000.05 }] });
var bw = {}; builtW.rows.forEach(function (r) { bw[r.order_id] = r; });
var j1 = JSON.stringify(bw[1]);
check('window: an October invoice → the order is limited: no balance, no invoices, no figure in the fields or in the last reminder, one plain reason, not sendable', bw[1].limited === true && bw[1].balance === null && bw[1].invoices.length === 0 && bw[1].fields.total === null && bw[1].fields.remaining === null && bw[1].reminders.last.remaining === null && bw[1].reminders.last.total === null && bw[1].blocks.length === 1 && bw[1].blocks[0] === S.LIMITED_WORDS && bw[1].warnings.length === 0, bw[1]);
check('window: none of the hidden amounts appears anywhere in the row', !/25000|15000|10000\.05|5000/.test(j1), j1);
check('window: the limited order is still LISTED (arrival, day counter, last reminder date) so nothing silently disappears', bw[1].days === 18 && bw[1].reminders.sent === 1 && !!bw[1].reminders.last.at);
check('window: a paid-in-full or pre-April order says only "limited" (no hint about the hidden balance)', bw[3].blocks.length === 1 && bw[3].blocks[0] === S.LIMITED_WORDS && bw[22].blocks.length === 1 && bw[22].blocks[0] === S.LIMITED_WORDS);
check('window: invoice and payment both inside the window → shown in full and sendable (6,000 − 1,500 = 4,500)', bw[19].limited === false && bw[19].balance.remaining === 4500 && bw[19].blocks.length === 0, bw[19]);
check('window: a current invoice with a payment dated BEFORE the window → limited (never an overstated 7,000)', bw[20].limited === true && bw[20].balance === null && !/7000|6000/.test(JSON.stringify(bw[20])), bw[20]);
check('window: a current invoice with a payment that has NO date → limited', bw[21].limited === true && bw[21].balance === null && !/8000|7000/.test(JSON.stringify(bw[21])), bw[21]);
check('no window (super admin): the same orders in full', by[1].limited === false && by[20].balance.remaining === 6000 && by[21].balance.remaining === 7000 && by[19].balance.remaining === 4500);
var builtS = S.buildReminderRows({ feed: feed, invoices: invoices, payments: payments, customers: customers, today: TODAY, log: [{ order_id: 2, status: 'sending', mode: 'manual', channel: 'email', slot: 'firmer-2', created_at: '2026-11-22T10:00:00Z', sent_to: 'x@y.example' }, { order_id: 17, status: 'unknown', mode: 'manual', channel: 'email', slot: 'firmer-1', created_at: '2026-11-22T10:00:00Z' }, { order_id: 19, status: 'unknown', mode: 'test', channel: 'email', slot: 'friendly-1' }, { order_id: 20, status: 'failed', mode: 'manual', channel: 'email', slot: 'friendly-1' }] });
var bs = {}; builtS.rows.forEach(function (r) { bs[r.order_id] = r; });
check('a send that never finished (still "sending") and one with no answer ("unknown") are DELIVERY UNCONFIRMED for the stage — never counted as sent, never ignored', bs[2].slot_unconfirmed === true && bs[2].slot_sent === false && bs[2].reminders.sent === 0 && bs[2].reminders.unconfirmed.count === 1 && bs[2].reminders.unconfirmed.sent_to === 'x@y.example' && bs[17].slot_unconfirmed === true, [bs[2].reminders, bs[17].slot, bs[17].slot_unconfirmed]);
check('…a test with no answer and a definite failure are not', bs[19].slot_unconfirmed === false && bs[19].reminders.unconfirmed === null && bs[20].slot_unconfirmed === false && bs[20].reminders.unconfirmed === null);
check('sorted most urgent first', built.rows[0].order_id === 4 && built.rows[built.rows.length - 1].order_id === 12, built.rows.map(function (r) { return r.order_id + ':' + r.days; }));
check('counts', built.counts.overdue === 1 && built.counts.friendly === 8 && built.counts.ready + built.counts.blocked === 21 && built.counts.ready === 10, built.counts);
var st = L.statusOf([{ status: 'sent', mode: 'manual', phase: 'friendly', slot: 'friendly-1', channel: 'email', language: 'en', sent_at: '2026-11-20T10:00:00Z', remaining: 15000 }, { status: 'sent', mode: 'test', phase: 'firmer', sent_at: '2026-11-21T10:00:00Z' }, { status: 'failed', mode: 'manual', phase: 'firmer', created_at: '2026-11-22T10:00:00Z' }, { status: 'sent', mode: 'manual', phase: 'firmer', slot: 'firmer-1', channel: 'email', language: 'es', sent_at: '2026-11-21T09:00:00Z', remaining: 9000 }]);
check('status for the warehouse: tests and failed sends never count; the last real one is shown', st.sent === 2 && st.last.phase === 'firmer' && st.last.language === 'es' && st.last.remaining === 9000, st);

// ── 5. the REAL route ──
var sentMail = []; var lostMail = []; var appended = []; var smtpMode = 'ok';
var fakeNodemailer = { createTransport: function () { return { sendMail: function (m) { if (smtpMode === 'timeout') { lostMail.push(m); var e = new Error('Connection timeout'); e.code = 'ETIMEDOUT'; return Promise.reject(e); } /* the server took the message; its answer never came back */ if (smtpMode === 'refused') { return Promise.resolve({ accepted: [], response: '550 no such user' }); } sentMail.push(m); return Promise.resolve({ accepted: [m.to], response: '250 OK queued' }); } }; } };
function FakeComposer(m) { this.m = m; } FakeComposer.prototype.compile = function () { var m = this.m; return { build: function (cb) { cb(null, Buffer.from('raw:' + m.subject)); } }; };
function FakeImap() { } FakeImap.prototype.connect = function () { return Promise.resolve(); }; FakeImap.prototype.list = function () { return Promise.resolve([{ path: 'INBOX' }, { path: 'INBOX.Sent', specialUse: '\\Sent' }]); };
FakeImap.prototype.append = function (p, raw) { appended.push(p + '|' + String(raw)); return Promise.resolve(); }; FakeImap.prototype.logout = function () { return Promise.resolve(); };
var origLoad = Module._load;
Module._load = function (req) { if (req === 'nodemailer') { return fakeNodemailer; } if (req === 'nodemailer/lib/mail-composer') { return FakeComposer; } if (req === 'imapflow') { return { ImapFlow: FakeImap }; } return origLoad.apply(this, arguments); };
var orig = Module._resolveFilename; var mockPath = path.join(__dirname, 'helpers', 'mock-supabase-js.js');
Module._resolveFilename = function (req) { if (req === '@supabase/supabase-js') { return mockPath; } if (/lib[\/]verified-caller(.js)?$/.test(req)) { return path.join(__dirname, 'helpers', 'stub-verified-caller.js'); } return orig.apply(this, arguments); };
fs.writeFileSync(mockPath, 'module.exports={createClient:function(){return global.__db;}};');
function perms(u, list) { return list.map(function (k) { return { user_id: u, module_name: k, has_access: true }; }); }
var db = new MemDB({ users: [{ id: 'u-send', name: 'Sender', email: 'sender@ktc.example', role: 'staff', active: true }, { id: 'u-view', name: 'Viewer', email: 'viewer@ktc.example', role: 'staff', active: true }, { id: 'u-none', name: 'Nobody', email: 'n@ktc.example', role: 'staff', active: true }, { id: 'u-admin', name: 'Admin', email: 'admin@ktc.example', role: 'admin', active: true }, { id: 'u-super', name: 'Max', email: 'max@ktc.example', role: 'super_admin', active: true }],
  module_permissions: [].concat(perms('u-send', ['accounting.clickbooks.access', 'accounting.view_invoicing', 'ar.view_invoice_balances', 'ar.send_reminders']), perms('u-view', ['accounting.clickbooks.access', 'accounting.view_invoicing', 'ar.view_invoice_balances']), perms('u-none', ['accounting.clickbooks.access']), perms('u-admin', ['accounting.clickbooks.access', 'accounting.view_invoicing', 'ar.view_invoice_balances', 'ar.send_reminders'])),
  accounting_invoices: invoices, accounting_invoice_payments: payments, accounting_customers: customers, arrival_reminders: [], hub_audit_log: [], app_settings: [] });
global.__db = db;
var feedCalls = []; var feedNow = feed;
global.fetch = function (url, init) { feedCalls.push({ url: String(url), token: init && init.headers && init.headers['X-Hub-Feed-Token'], method: (init && init.method) || 'GET' }); return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(feedNow); } }); };
var route = require(path.join(root, 'src/app/api/accounting/arrival-reminders/route.js'));
async function call(user, body) { var res = await route.POST({ json: function () { return Promise.resolve(Object.assign({ user_id: user }, body)); }, headers: new Map() }); var j = await res.json(); j._status = res.status; return j; }
function logRows() { return db.t.arrival_reminders; }

(async function () {
  check('the route has no GET (no timer can call it) and only POST', typeof route.GET === 'undefined' && typeof route.POST === 'function');
  var noTok = await call('u-send', { action: 'list', _no_token: true });
  check('no sign-in → 401', noTok._status === 401 && noTok.ok === false);
  var none = await call('u-none', { action: 'list' });
  check('without "AR: View invoice balances" → refused, no figures', none._status === 403 && !none.rows, none);
  var list = await call('u-view', { action: 'list' });
  check('list: 13 orders, the warehouse copy named, mailbox known, log ready', list.ok && list.rows.length === 21 && list.source === 'nextrade-staging' && list.mailbox.configured === true && list.mailbox.from === 'info@ktcus.com' && list.log_ready === true && list.today === TODAY, list.error || list.counts);
  check('the feed was read from the approved staging address with the feed token, read-only', feedCalls.length > 0 && feedCalls.every(function (c) { return c.url.indexOf('https://fix.nextrade-staging.com/api/hub-feed/shipping') === 0 && c.token === process.env.NEXTRADE_FEED_TOKEN && c.method === 'GET'; }), feedCalls[0]);
  var pv = await call('u-view', { action: 'preview', order_id: 1, lang: 'en' });
  check('preview (order 1, English): subject + approved text + figures + the address on file', pv.ok && pv.can_send === true && pv.subject === '1002-0001 · KTC · Houston → Guatemala · Container CONT1' && pv.body.indexOf('Balance remaining: $15,000.05') > 0 && pv.body.indexOf('Dear Sara Lopez,') === 0 && pv.to === 'sara@alpha.example' && /^[0-9a-f]{64}$/.test(pv.draft_hash), pv);
  var pvAr = await call('u-view', { action: 'preview', order_id: 1, lang: 'ar' });
  check('preview in Arabic: another text, another fingerprint, right-to-left', pvAr.ok && pvAr.rtl === true && pvAr.draft_hash !== pv.draft_hash && pvAr.subject === pv.subject);
  var pv12 = await call('u-view', { action: 'preview', order_id: 12 });
  check('preview with no language picked uses the customer’s language from the warehouse (Spanish)', pv12.ok && pv12.lang === 'es' && pv12.body.indexOf('Estimado/a Ana Ruiz:') === 0, pv12.body);
  var pv3 = await call('u-view', { action: 'preview', order_id: 3 });
  check('preview of a paid-in-full order: no text, the reason', pv3.ok && pv3.can_send === false && !pv3.body && /paid in full/.test(pv3.blocks.join(' ')));
  var pv5 = await call('u-view', { action: 'preview', order_id: 5 });
  check('an order outside the window → 404', pv5._status === 404);
  check('nothing was sent or logged by list / preview', sentMail.length === 0 && logRows().length === 0);

  var sendBody = { action: 'send', order_id: 1, lang: 'en', draft_hash: pv.draft_hash, to: 'sara@alpha.example', confirm_to: 'sara@alpha.example', confirm: true };
  var v = await call('u-view', sendBody);
  check('a viewer without "AR: Send reminders" cannot send', v._status === 403 && sentMail.length === 0 && logRows().length === 0, v);
  var s1 = await call('u-send', Object.assign({}, sendBody, { confirm: false }));
  var s2 = await call('u-send', Object.assign({}, sendBody, { draft_hash: 'deadbeef' }));
  var s3 = await call('u-send', Object.assign({}, sendBody, { draft_hash: undefined }));
  var s4 = await call('u-send', Object.assign({}, sendBody, { to: 'not-an-address', confirm_to: 'not-an-address' }));
  var s5 = await call('u-send', Object.assign({}, sendBody, { confirm_to: 'someone@else.example' }));
  var s6 = await call('u-send', Object.assign({}, sendBody, { lang: 'ar' })); // the English fingerprint with the Arabic text
  var s7 = await call('u-send', Object.assign({}, sendBody, { order_id: 3 }));
  check('refused, nothing sent, nothing logged: no confirmation · wrong fingerprint · no fingerprint · bad address · unconfirmed address · another language than the one looked at · paid-in-full order',
    !s1.ok && s2._status === 409 && s2.changed === true && s3._status === 409 && !s4.ok && !s5.ok && s6._status === 409 && s7._status === 409 && sentMail.length === 0 && logRows().length === 0, [s1, s2, s3, s4, s5, s6, s7].map(function (x) { return x._status + ' ' + x.error; }));

  // a test send: only to the signed-in person, never counted
  var t1 = await call('u-send', Object.assign({}, sendBody, { test: true, to: 'sara@alpha.example' }));
  check('test send: goes to the sender’s OWN address, marked TEST, the customer gets nothing', t1.ok && t1.test === true && t1.to === 'sender@ktc.example' && sentMail.length === 1 && sentMail[0].to === 'sender@ktc.example' && /^\[TEST/.test(sentMail[0].subject), t1);
  var afterTest = await call('u-view', { action: 'list' }); var r1 = afterTest.rows.filter(function (r) { return r.order_id === 1; })[0];
  check('a test never counts as a reminder and never blocks the real one', r1.reminders.sent === 0 && r1.slot_sent === false && logRows().length === 1 && logRows()[0].mode === 'test' && logRows()[0].status === 'sent');

  // the real send
  var ok1 = await call('u-send', sendBody);
  var m1 = sentMail[1] || {};
  check('send: accepted, from "KTC International" <info@ktcus.com>, to the customer, the approved subject and text, reply-to the mailbox', ok1.ok && ok1.sent === true && ok1.to === 'sara@alpha.example' && m1.from === '"KTC International" <info@ktcus.com>' && m1.to === 'sara@alpha.example' && m1.subject === pv.subject && m1.text === pv.body && m1.replyTo === 'info@ktcus.com' && m1.html.indexOf('Balance remaining: $15,000.05') > 0, ok1.error || m1);
  check('send: Message-ID is ours and is NOT a sourcing-desk id (the sourcing inbox reader will not pick up the replies)', /^<arrival-[a-z0-9]+@ktcus\.com>$/.test(m1.messageId || '') && m1.messageId.indexOf('sourcing-') < 0, m1.messageId);
  check('send: a copy was put in the Sent folder', ok1.copied_to_sent === true && appended.length === 2 && appended[1].indexOf('INBOX.Sent|raw:1002-0001') === 0, appended);
  var lg = logRows()[1] || {};
  check('send: logged with who, to whom, stage, slot, language, the exact text and the balance stated', lg.status === 'sent' && lg.mode === 'manual' && lg.channel === 'email' && lg.source === 'nextrade-staging' && lg.order_id === 1 && lg.release_number === '1002-0001' && lg.phase === 'friendly' && lg.slot === 'friendly-1' && lg.language === 'en' && lg.sent_to === 'sara@alpha.example'
    && lg.subject === pv.subject && lg.body === pv.body && lg.total === 25000.10 && lg.received === 10000.05 && lg.remaining === 15000.05 && lg.sent_by === 'u-send' && lg.sent_by_name === 'Sender' && !!lg.sent_at && lg.message_id === m1.messageId && lg.days_to_arrival === 18, lg);
  var au = db.t.hub_audit_log.filter(function (a) { return a.action === 'arrival_reminder_sent'; })[0] || {};
  check('send: written to the audit trail (who, order, to whom, stage, balance); the test send is recorded as a test', au.actor_id === 'u-send' && au.entity === 'warehouse_order' && au.entity_id === '1' && au.details.to === 'sara@alpha.example' && au.details.remaining === 15000.05 && db.t.hub_audit_log.some(function (a) { return a.action === 'arrival_reminder_test_sent'; }), au);
  var after = await call('u-view', { action: 'list' }); var r1b = after.rows.filter(function (r) { return r.order_id === 1; })[0];
  check('list afterwards: last reminder shown, this stage marked as sent', r1b.reminders.sent === 1 && r1b.reminders.last.phase === 'friendly' && r1b.reminders.last.remaining === 15000.05 && r1b.slot_sent === true, r1b.reminders);
  var again = await call('u-send', sendBody);
  check('the same stage is not sent twice by accident', again._status === 409 && again.already_sent === true && sentMail.length === 2 && logRows().length === 2, again);
  var again2 = await call('u-send', Object.assign({}, sendBody, { again: true }));
  check('…unless the person says "send another one anyway"', again2.ok && sentMail.length === 3 && logRows().length === 3);

  // the balance changes between looking and sending
  db.t.accounting_invoice_payments.push(pay(99, 1, 1000));
  var stale = await call('u-send', Object.assign({}, sendBody, { again: true }));
  check('a payment arrives after the person looked → the old text is refused, nothing sent', stale._status === 409 && stale.changed === true && sentMail.length === 3 && logRows().length === 3, stale);
  var pvNew = await call('u-view', { action: 'preview', order_id: 1, lang: 'en' });
  check('…and a fresh look states the new balance (14,000.05)', pvNew.body.indexOf('Received to date: $11,000.05') > 0 && pvNew.body.indexOf('Balance remaining: $14,000.05') > 0);

  // one invoice for two releases: the message the customer gets lists both and gives the invoice totals
  var pv4s = await call('u-view', { action: 'preview', order_id: 4, lang: 'en' });
  check('route: the shared-invoice order previews with both releases named and the whole-invoice totals (12,000 − 2,000)', pv4s.ok && pv4s.body.indexOf('Your account for releases 1002-0004, 1002-0099, which are invoiced together:\n• Invoice total: $12,000.00\n• Received to date: $2,000.00\n• Balance remaining: $10,000.00') > 0 && pv4s.warnings.length === 1 && pv4s.subject.indexOf('1002-0004 · KTC') === 0, pv4s.body);

  // warnings must be ticked
  var pv9 = await call('u-view', { action: 'preview', order_id: 9, lang: 'en' });
  var w0 = await call('u-send', { action: 'send', order_id: 9, lang: 'en', draft_hash: pv9.draft_hash, to: 'i@iota.example', confirm_to: 'i@iota.example', confirm: true });
  var w1 = await call('u-send', { action: 'send', order_id: 9, lang: 'en', draft_hash: pv9.draft_hash, to: 'i@iota.example', confirm_to: 'i@iota.example', confirm: true, ack_warnings: true });
  check('an order with warnings is refused until they are ticked, then sent', w0._status === 409 && w0.warnings.length === 2 && w1.ok && sentMail.length === 4, [w0, w1]);

  // a release that is not 1002 / 1001: the port of loading is confirmed by a person
  var p18a = await call('u-view', { action: 'preview', order_id: 18, lang: 'en' });
  check('1003 release, nothing confirmed: no text is written, the screen is told to ask', p18a.ok && p18a.can_send === false && p18a.needs_pol === true && !p18a.body && /confirm the port of loading/.test(p18a.blocks.join(' ')), p18a);
  var s18a = await call('u-send', { action: 'send', order_id: 18, lang: 'en', draft_hash: 'x', to: 's@sigma.example', confirm_to: 's@sigma.example', confirm: true });
  check('1003 release, nothing confirmed: cannot be sent', s18a._status === 409 && sentMail.length === 4, s18a);
  var p18b = await call('u-view', { action: 'preview', order_id: 18, lang: 'en', pol: '  New York {total}\n<b> ' });
  check('1003 release, confirmed as typed (cleaned): it is in the subject and the text', p18b.ok && p18b.can_send === true && p18b.subject === '1003-0018 · KTC · New York total b → Guatemala · Container CONT18' && p18b.body.indexOf('(New York total b → Guatemala, container CONT18)') > 0, p18b.subject);
  var p18c = await call('u-view', { action: 'preview', order_id: 18, lang: 'en', pol: 'New York' });
  var s18b = await call('u-send', { action: 'send', order_id: 18, lang: 'en', pol: 'Savannah', draft_hash: p18c.draft_hash, to: 's@sigma.example', confirm_to: 's@sigma.example', confirm: true });
  check('…a different port than the one looked at → refused (the fingerprint covers it)', s18b._status === 409 && s18b.changed === true && sentMail.length === 4);
  var s18c = await call('u-send', { action: 'send', order_id: 18, lang: 'en', pol: 'New York', draft_hash: p18c.draft_hash, to: 's@sigma.example', confirm_to: 's@sigma.example', confirm: true });
  var au18 = db.t.hub_audit_log.filter(function (a) { return a.entity_id === '18' && a.action === 'arrival_reminder_sent'; })[0] || { details: {} };
  check('…the confirmed port → sent, subject carries it, the audit trail says a person confirmed it', s18c.ok && sentMail.length === 5 && sentMail[4].subject === '1003-0018 · KTC · New York → Guatemala · Container CONT18' && au18.details.port_of_loading_confirmed_by_person === 'New York', [s18c, au18]);
  var p17 = await call('u-view', { action: 'preview', order_id: 17, lang: 'en', pol: 'Somewhere Else' });
  check('a 1001 release ignores a typed port: always Canada', p17.ok && p17.subject === '1001-0017 · KTC · Canada → Guatemala · Container CONT17', p17.subject);

  // mail server trouble
  var pv2 = await call('u-view', { action: 'preview', order_id: 2, lang: 'fr' });
  var b2s = { action: 'send', order_id: 2, lang: 'fr', draft_hash: pv2.draft_hash, to: 'achats@beta.example', confirm_to: 'achats@beta.example', confirm: true };
  smtpMode = 'refused'; var rf = await call('u-send', b2s); var lr = logRows()[logRows().length - 1];
  check('the mail server refuses the address → "Not sent", logged as failed, not counted', rf._status === 502 && rf.outcome_unknown === false && lr.status === 'failed' && /did not accept/.test(lr.error) && sentMail.length === 5, rf);
  smtpMode = 'timeout'; var to2 = await call('u-send', b2s); var lt = logRows()[logRows().length - 1]; var nLog = logRows().length;
  check('the mail server takes the message but its answer is lost → "Delivery unconfirmed" (never "Not sent"), logged as unknown — not as a plain failure', to2._status === 502 && to2.delivery_unconfirmed === true && to2.outcome_unknown === true && /^Delivery unconfirmed: DELIVERY UNCONFIRMED/.test(to2.error) && !/Not sent/.test(to2.error) && lt.status === 'unknown' && /may or may not have reached the customer/.test(lt.error) && lostMail.length === 1 && lostMail[0].to === 'achats@beta.example' && sentMail.length === 5, to2);
  smtpMode = 'ok'; var re1 = await call('u-send', b2s); var re1b = await call('u-send', Object.assign({}, b2s, { again: true }));
  check('…a plain retry is REFUSED (the customer may already have it), and the ordinary "send another" tick is not enough either', re1._status === 409 && re1.delivery_unconfirmed === true && re1b._status === 409 && re1b.delivery_unconfirmed === true && sentMail.length === 5 && logRows().length === nLog, [re1, re1b]);
  var lu = await call('u-view', { action: 'list' }); var r2u = lu.rows.filter(function (r) { return r.order_id === 2; })[0];
  check('…the list shows it as delivery unconfirmed, and it is not counted as sent', r2u.reminders.sent === 0 && r2u.reminders.unconfirmed.count === 1 && r2u.reminders.unconfirmed.sent_to === 'achats@beta.example' && r2u.slot_unconfirmed === true && r2u.slot_sent === false, r2u.reminders);
  var hu = await call('u-view', { action: 'history', order_id: 2 });
  check('…the history shows the unconfirmed attempt with its text and the reason (and the earlier definite failure)', hu.ok && hu.rows.length === 2 && hu.rows[0].status === 'unknown' && /DELIVERY UNCONFIRMED/.test(hu.rows[0].error) && hu.rows[0].body.indexOf('Cher/Chère Beta Imports,') === 0 && hu.rows[1].status === 'failed', hu.rows.map(function (r) { return r.status; }));
  var re2 = await call('u-send', Object.assign({}, b2s, { resend_after_unconfirmed: true }));
  var au2 = db.t.hub_audit_log.filter(function (x) { return x.entity_id === '2' && x.action === 'arrival_reminder_sent'; })[0] || { details: {} };
  check('…a deliberate "I checked — send another one" is allowed, sent once, and the audit trail records that decision', re2.ok && sentMail.length === 6 && sentMail[5].to === 'achats@beta.example' && sentMail[5].text.indexOf('Cher/Chère Beta Imports,') === 0 && au2.details.sent_after_checking_an_unconfirmed_delivery === true && db.t.hub_audit_log.some(function (x) { return x.action === 'arrival_reminder_delivery_unconfirmed' && x.entity_id === '2'; }), [re2, au2]);
  check('…the unconfirmed attempt stays in the log as it was (never rewritten, never removed)', logRows().filter(function (r) { return r.order_id === 2 && r.status === 'unknown'; }).length === 1);
  var pv17b = await call('u-view', { action: 'preview', order_id: 17, lang: 'en' }); var b17 = { action: 'send', order_id: 17, lang: 'en', draft_hash: pv17b.draft_hash, to: 'r@rho.example', confirm_to: 'r@rho.example', confirm: true };
  smtpMode = 'refused'; var rj = await call('u-send', b17); smtpMode = 'ok'; var rj2 = await call('u-send', b17);
  check('a DEFINITE refusal by the mail server stays an ordinary failure: "Not sent", and it can simply be sent again with no tick', rj._status === 502 && /^Not sent: /.test(rj.error) && rj.delivery_unconfirmed === false && rj2.ok && sentMail.length === 7 && sentMail[6].to === 'r@rho.example', [rj, rj2]);
  check('nothing in this build retries by itself: every message that left was one person\u2019s click', sentMail.length === 7 && lostMail.length === 1);

  // no log table → nothing is sent
  var keep = db.t.arrival_reminders; var realFrom = db.from.bind(db);
  db.from = function (name) { if (name === 'arrival_reminders') { var q = realFrom(name); q.run = function () { return { data: null, error: { message: 'relation "public.arrival_reminders" does not exist' } }; }; return q; } return realFrom(name); };
  var nl = await call('u-view', { action: 'list' }); var nlp = await call('u-view', { action: 'preview', order_id: 2, lang: 'fr' });
  var nls = await call('u-send', Object.assign({}, b2s, { again: true, resend_after_unconfirmed: true, draft_hash: nlp.draft_hash }));
  check('before the SQL is installed: the list still shows, says what to run, and NOTHING can be sent', nl.ok && nl.log_ready === false && /v55-83-XG/.test(nl.sql_hint) && nlp.can_send === false && nls._status === 503 && sentMail.length === 7, [nl.sql_hint, nls]);
  db.from = realFrom; db.t.arrival_reminders = keep;

  // mailbox not connected → nothing is sent
  var pw = process.env.COMMERCIAL_MAIL_PASSWORD; delete process.env.COMMERCIAL_MAIL_PASSWORD;
  var nm = await call('u-view', { action: 'list' }); var pv4 = await call('u-view', { action: 'preview', order_id: 4, lang: 'en' });
  var nms = await call('u-send', { action: 'send', order_id: 4, lang: 'en', draft_hash: pv4.draft_hash, to: 'd@delta.example', confirm_to: 'd@delta.example', confirm: true, ack_warnings: true });
  check('mailbox not connected: said on the list, send refused, nothing logged as sent', nm.mailbox.configured === false && pv4.can_send === false && nms._status === 503 && sentMail.length === 7, nms);
  process.env.COMMERCIAL_MAIL_PASSWORD = pw;

  // the feed is the wrong copy / not set up
  feedNow = Object.assign({}, feed, { source: 'nextrade-live' });
  var wrong = await call('u-view', { action: 'list' });
  check('a feed that says it is another copy is refused', wrong.ok === false && /refused/.test(wrong.error), wrong);
  feedNow = feed;
  var url = process.env.NEXTRADE_FEED_URL; process.env.NEXTRADE_FEED_URL = 'https://evil.example/api/hub-feed/shipping'; var before = feedCalls.length;
  var evil = await call('u-view', { action: 'list' });
  check('an unapproved warehouse address: refused before the token is sent', evil.ok === false && feedCalls.length === before, evil);
  process.env.NEXTRADE_FEED_URL = url;

  var hist = await call('u-view', { action: 'history', order_id: 1 });
  check('history of order 1: every attempt with its text (test + 2 real)', hist.ok && hist.rows.length === 3 && hist.rows.every(function (r) { return r.order_id === 1 && !!r.body; }), hist);
  // ── the history window on the REAL route (Codex 22 Nov P1): staff and an ordinary admin are limited, the super admin is not ──
  var sup0 = await call('u-super', { action: 'list' }); var s1 = sup0.rows.filter(function (r) { return r.order_id === 1; })[0];
  check('super admin, no window set: everything in full', sup0.ok && sup0.window_floor === null && s1.limited === false && s1.balance.remaining === 14000.05, s1);
  db.t.app_settings = [{ key: 'accounting_visibility_window', value: { window: 'custom', customFrom: '2026-11-01' } }];
  var HIDDEN = /25,?000|14,?000\.05|11,?000\.05|15,?000\.05|10,?000\.05/;
  var wl = await call('u-view', { action: 'list' }); var w1 = wl.rows.filter(function (r) { return r.order_id === 1; })[0]; var w19 = wl.rows.filter(function (r) { return r.order_id === 19; })[0];
  check('staff with a window from 1 Nov: the October-invoice order is limited — listed, but no figure anywhere in the answer', wl.ok && wl.window_floor === '2026-11-01' && w1.limited === true && w1.balance === null && w1.invoices.length === 0 && w1.reminders.sent >= 1 && w1.reminders.last.remaining === null && !HIDDEN.test(JSON.stringify(wl)), JSON.stringify(w1).substring(0, 600));
  check('…an order whose invoice and payments are all inside the window is shown in full', w19.limited === false && w19.balance.total === 6000 && w19.balance.remaining === 4500);
  var wp = await call('u-view', { action: 'preview', order_id: 1, lang: 'en' });
  check('…preview of the limited order: no text, no fingerprint, the reason', wp.ok && wp.can_send === false && !wp.body && !wp.draft_hash && /history you may see/.test(wp.blocks.join(' ')) && !HIDDEN.test(JSON.stringify(wp)), wp);
  var nBefore = sentMail.length; var nLogB = logRows().length;
  var ws = await call('u-send', { action: 'send', order_id: 1, lang: 'en', draft_hash: pvNew.draft_hash, to: 'sara@alpha.example', confirm_to: 'sara@alpha.example', confirm: true, again: true, ack_warnings: true });
  check('…send of the limited order (even with a fingerprint from before): refused, nothing sent, nothing logged', ws._status === 409 && /history you may see/.test(ws.error) && sentMail.length === nBefore && logRows().length === nLogB && !HIDDEN.test(JSON.stringify(ws)), ws);
  var wh = await call('u-view', { action: 'history', order_id: 1 });
  check('…history of the limited order: the entries are listed (when, to whom, outcome) but every text and amount is withheld — although the log rows are dated today', wh.ok && wh.rows.length === 3 && wh.rows.every(function (r) { return r.withheld === true && r.body === null && r.subject === null && r.total === null && r.remaining === null && !!r.sent_to && !!r.created_at; }) && !HIDDEN.test(JSON.stringify(wh)), JSON.stringify(wh).substring(0, 500));
  var pv19 = await call('u-view', { action: 'preview', order_id: 19, lang: 'en' });
  var s19 = await call('u-send', { action: 'send', order_id: 19, lang: 'en', draft_hash: pv19.draft_hash, to: 't@tau.example', confirm_to: 't@tau.example', confirm: true });
  var h19 = await call('u-view', { action: 'history', order_id: 19 });
  check('…a fully visible order can still be previewed, sent and read back by the same staff member', pv19.can_send === true && pv19.body.indexOf('Balance remaining: $4,500.00') > 0 && s19.ok && sentMail.length === nBefore + 1 && h19.rows.length === 1 && h19.rows[0].withheld === false && h19.rows[0].body.indexOf('$4,500.00') > 0, [pv19.blocks, s19]);
  var al = await call('u-admin', { action: 'list' }); var a1 = al.rows.filter(function (r) { return r.order_id === 1; })[0]; var ah = await call('u-admin', { action: 'history', order_id: 1 });
  check('an ordinary ADMIN is limited exactly like staff (only the super admin sees all history)', al.ok && al.window_floor === '2026-11-01' && a1.limited === true && !HIDDEN.test(JSON.stringify(al)) && ah.rows.every(function (r) { return r.withheld === true; }) && !HIDDEN.test(JSON.stringify(ah)));
  var sl = await call('u-super', { action: 'list' }); var sl1 = sl.rows.filter(function (r) { return r.order_id === 1; })[0]; var sh = await call('u-super', { action: 'history', order_id: 1 }); var sp = await call('u-super', { action: 'preview', order_id: 1, lang: 'en' });
  check('the super admin still sees and can prepare everything with the window set', sl.window_floor === null && sl1.limited === false && sl1.balance.remaining === 14000.05 && sh.rows.every(function (r) { return r.withheld === false && !!r.body; }) && sp.can_send === true && sp.body.indexOf('$14,000.05') > 0);
  db.t.app_settings = [{ key: 'accounting_visibility_window', value: { window: 'nonsense' } }];
  var bad1 = await call('u-view', { action: 'list' }); var bad2 = await call('u-send', { action: 'send', order_id: 19, lang: 'en', draft_hash: pv19.draft_hash, to: 't@tau.example', confirm_to: 't@tau.example', confirm: true, again: true }); var bad3 = await call('u-view', { action: 'history', order_id: 19 });
  check('an unreadable window setting fails CLOSED for staff: nothing listed, nothing sent, no history', bad1._status === 503 && !bad1.rows && bad2._status === 503 && bad3._status === 503 && !bad3.rows && sentMail.length === nBefore + 1, [bad1, bad2, bad3]);
  var realFrom2 = db.from.bind(db); db.from = function (name) { if (name === 'app_settings') { var q = realFrom2(name); q.run = function () { return { data: null, error: { message: 'permission denied for table app_settings' } }; }; return q; } return realFrom2(name); };
  var bad4 = await call('u-admin', { action: 'preview', order_id: 19, lang: 'en' }); var sup4 = await call('u-super', { action: 'list' });
  check('the setting cannot be read at all → staff / admin get nothing (503); the super admin is unaffected', bad4._status === 503 && !bad4.body && sup4.ok && sup4.rows.length === 21, [bad4, sup4.error]);
  db.from = realFrom2; db.t.app_settings = [];
  var o22 = await call('u-super', { action: 'preview', order_id: 22, lang: 'en' });
  check('an invoice from before 1 April 2026 is not reminded about, even by the super admin', o22.can_send === false && /before 1 April 2026/.test(o22.blocks.join(' ')), o22.blocks);

  // ── the send DIALOG itself (Codex 22 Nov 14:19): the REAL dialog logic (createReminderActions / canSendNow) driving the REAL route ──
  var React0 = require('react'); global.React = React0;
  var UI0 = require(path.join(root, 'src/components/ArrivalRemindersTab.jsx'));
  var box = { open: null, loads: 0, toasts: [], confirms: 0, sends: 0, failNextSendAnswer: false };
  var io = { getOpen: function () { return box.open; }, setOpen: function (v) { box.open = typeof v === 'function' ? v(box.open) : v; }, load: function () { box.loads++; }, toast: function (m) { box.toasts.push(m); }, confirm: function () { box.confirms++; return true; },
    call: function (body) { if (body.action === 'send') { box.sends++; } var p = call('u-send', body); if (body.action === 'send' && box.failNextSendAnswer) { box.failNextSendAnswer = false; return p.then(function () { throw new Error('network lost'); }); } return p; } };
  var act = UI0.createReminderActions(io);
  var l20 = await call('u-send', { action: 'list' }); var row20 = l20.rows.filter(function (r) { return r.order_id === 20; })[0];
  await act.prepare(row20);
  check('dialog: a fresh, never-sent order is written and can be sent', !!box.open.draft && box.open.row.slot_unconfirmed === false && box.open.to === 'u@ups.example' && UI0.canSendNow(box.open) === true, box.open && box.open.note);
  var m0 = sentMail.length; var lost0 = lostMail.length; var loads0 = box.loads;
  smtpMode = 'timeout'; await act.send(false); smtpMode = 'ok';
  check('dialog: the reply is "delivery unconfirmed" → THIS SAME dialog switches state: the order is read again into it, the row is unconfirmed, the check path shows, no tick is set, Send is OFF; the list is refreshed', box.open !== null && box.open.row.order_id === 20 && box.open.row.slot_unconfirmed === true && box.open.check === true && !!box.open.draft && box.open.unsure === false && box.open.again === false && box.open.sending === false && /DELIVERY UNCONFIRMED/.test(box.open.note) && UI0.canSendNow(box.open) === false && box.loads === loads0 + 1 && lostMail.length === lost0 + 1 && sentMail.length === m0, box.open);
  check('dialog: the freshly read order itself reports the unconfirmed attempt (so History has it)', box.open.row.reminders.unconfirmed && box.open.row.reminders.unconfirmed.count === 1 && box.open.row.reminders.unconfirmed.sent_to === 'u@ups.example', box.open.row.reminders);
  var sends0 = box.sends; var conf0 = box.confirms; await act.send(false);
  check('dialog: clicking Send again without the tick does nothing at all — no question, no request, no e-mail', box.sends === sends0 && box.confirms === conf0 && sentMail.length === m0 && lostMail.length === lost0 + 1);
  io.setOpen(function (o) { return Object.assign({}, o, { again: true }); });
  check('dialog: the ordinary "send another one" tick does not unlock it', UI0.canSendNow(box.open) === false);
  io.setOpen(function (o) { return Object.assign({}, o, { again: false, unsure: true }); });
  check('dialog: "I checked — send another one" unlocks Send', UI0.canSendNow(box.open) === true);
  await act.send(false);
  var l20rows = logRows().filter(function (r) { return r.order_id === 20; }); var au20 = db.t.hub_audit_log.filter(function (x) { return x.entity_id === '20' && x.action === 'arrival_reminder_sent'; })[0] || { details: {} };
  check('dialog: the deliberate retry is sent once, the dialog closes, the unconfirmed row stays in the log, and the audit trail records the decision', box.open === null && sentMail.length === m0 + 1 && sentMail[m0].to === 'u@ups.example' && l20rows.length === 2 && l20rows[0].status === 'unknown' && l20rows[1].status === 'sent' && au20.details.sent_after_checking_an_unconfirmed_delivery === true && box.toasts.length === 1, [l20rows.map(function (r) { return r.status; }), au20]);
  // the answer from the Hub itself is lost (the reminder DID go out)
  var row21 = l20.rows.filter(function (r) { return r.order_id === 21; })[0]; await act.prepare(row21);
  var m1 = sentMail.length; box.failNextSendAnswer = true; await act.send(false);
  check('dialog: the Hub\u2019s answer is lost → the dialog reads the order again, shows the check path and the real state (it was sent), Send is OFF until "send another one" is ticked; nothing is sent twice', sentMail.length === m1 + 1 && box.open !== null && box.open.check === true && /answer from the Hub was lost/.test(box.open.note) && !!box.open.draft && box.open.row.slot_sent === true && box.open.row.slot_unconfirmed === false && UI0.canSendNow(box.open) === false, box.open);
  var sends1 = box.sends; await act.send(false);
  check('dialog: …and a second click sends nothing', box.sends === sends1 && sentMail.length === m1 + 1);
  var srcU = fs.readFileSync(path.join(root, 'src/components/ArrivalRemindersTab.jsx'), 'utf8');
  check('dialog: the component uses exactly this logic, and shows "Open the history" + "Read this order again" as soon as the state is unconfirmed (also while the order is being read)', srcU.indexOf('var act = createReminderActions({') > 0 && srcU.indexOf('var canSend = canSendNow(open);') > 0 && srcU.indexOf('{open.check && <div') > 0 && srcU.indexOf('>Open the history</button>') > 0 && srcU.indexOf('>Read this order again</button>') > 0 && srcU.indexOf('disabled={!canSend}') > 0);
  box.open = null;

  var unk = await call('u-send', { action: 'delete_everything' });
  check('unknown action refused', unk.ok === false && unk._status === 400);
  check('no row was ever removed from the log', logRows().length === 14 && logRows().filter(function (r) { return r.status === 'sent'; }).length === 10 && logRows().filter(function (r) { return r.status === 'unknown'; }).length === 2 && logRows().filter(function (r) { return r.status === 'failed'; }).length === 2, logRows().map(function (r) { return r.mode + ':' + r.status; }));

  // the screen
  var React = require('react'); global.React = React; var RS = require('react-dom/server');
  var UI = require(path.join(root, 'src/components/ArrivalRemindersTab.jsx'));
  var html = RS.renderToStaticMarkup(React.createElement(UI.ArrivalRemindersView, { rows: after.rows, onPrepare: function () { } }));
  check('screen: a ready order has "Prepare reminder"; a blocked one says why and has no button', html.indexOf('Prepare reminder') > 0 && html.indexOf('Cannot send: The invoice is paid in full') > 0 && (html.match(/Prepare reminder/g) || []).length === after.rows.filter(function (r) { return !r.blocks.length; }).length, (html.match(/Prepare reminder/g) || []).length);
  check('screen: figures, day counter and last reminder shown', html.indexOf('$15,000.05') > 0 && html.indexOf('18 days') > 0 && html.indexOf('4 days past') > 0 && html.indexOf('1 sent') > 0 && html.indexOf('Houston → Guatemala') > 0 && html.indexOf('Canada → Guatemala') > 0 && html.indexOf('? → Guatemala') > 0 && html.indexOf('Port of loading to confirm (release 1003)') > 0);
  var htmlW = RS.renderToStaticMarkup(React.createElement(UI.ArrivalRemindersView, { rows: wl.rows, onPrepare: function () { }, onHistory: function () { } }));
  check('screen: a limited order shows "not shown" (never a zero or a dash) and no Prepare button; History is offered where something was sent', htmlW.indexOf('not shown') > 0 && htmlW.indexOf('history you may see') > 0 && htmlW.indexOf('>History<') > 0 && !HIDDEN.test(htmlW));
  var htmlU = RS.renderToStaticMarkup(React.createElement(UI.ArrivalRemindersView, { rows: lu.rows, onPrepare: function () { }, onHistory: function () { } }));
  check('screen: the list says "Delivery unconfirmed" on the order, with the address and "It may have reached the customer"', htmlU.indexOf('Delivery unconfirmed — ') > 0 && htmlU.indexOf('to achats@beta.example') > 0 && htmlU.indexOf('It may have reached the customer.') > 0);
  var htmlH = RS.renderToStaticMarkup(React.createElement(UI.ReminderHistoryView, { rows: hu.rows.concat(wh.rows) }));
  check('screen: the history lists each attempt with its outcome — unconfirmed, not sent, sent, test — and says when a text is withheld', htmlH.indexOf('Delivery unconfirmed') > 0 && htmlH.indexOf('>Not sent<') > 0 && htmlH.indexOf('>Sent<') > 0 && htmlH.indexOf('TEST — not to the customer') > 0 && htmlH.indexOf('outside the history you may see') > 0 && htmlH.indexOf('Cher/Chère Beta Imports,') > 0);
  var uiSrc = fs.readFileSync(path.join(root, 'src/components/ArrivalRemindersTab.jsx'), 'utf8');
  check('screen: the unconfirmed tick is its own control and is sent as its own field; the history opens from the list and from the send box', uiSrc.indexOf('resend_after_unconfirmed: o.unsure') > 0 && uiSrc.indexOf('(!open.row.slot_unconfirmed || open.unsure)') > 0 && uiSrc.indexOf('onHistory={history}') > 0 && uiSrc.indexOf('history(open.row)') > 0);
  var uiZ = fs.readFileSync(path.join(root, 'src/components/ArrivalRemindersTab.jsx'), 'utf8'); var css = fs.readFileSync(path.join(root, 'src/app/globals.css'), 'utf8');
  var txtInputs = uiZ.match(/<input (?!type="checkbox")[^>]*>/g) || [];
  check('v55.83-XZ (Max: "you cannot see the email as font is too bright"): every text box on the reminders screen has the nt-light class (dark text on white under the dark skin too), dark ink and a visible border', txtInputs.length === 2 && txtInputs.every(function (x) { return /className="[^"]*\bnt-light\b/.test(x) && x.indexOf('color: INK') > 0 && x.indexOf("background: '#ffffff'") > 0 && x.indexOf("border: '1px solid #64748b'") > 0; }) && /input\.nt-light, select\.nt-light, textarea\.nt-light \{[^}]*color: #0f172a !important/.test(css.replace(/\s+/g, ' ')) && !/<select|<textarea/.test(uiZ), txtInputs);
  check('screen: day-counter words', UI.counterWords(0) === 'today' && UI.counterWords(1) === '1 day' && UI.counterWords(-1) === '1 day past' && UI.counterWords(-3) === '3 days past');
  var tab = fs.readFileSync(path.join(root, 'src/components/AccountingTab.jsx'), 'utf8');
  check('the screen is imported and mounted in Accounting (the import line exists)', /import ArrivalRemindersTab from '\.\/ArrivalRemindersTab'/.test(tab) && tab.indexOf("sub === 'arrival_reminders' && <div className=\"p-3\"><ArrivalRemindersTab") > 0 && tab.indexOf("['arrival_reminders', ") > 0 && tab.indexOf("['orders', 'arrival_reminders', 'invoices'") > 0);
  var rs = fs.readFileSync(path.join(root, 'src/app/api/accounting/arrival-reminders/route.js'), 'utf8'); var ls = fs.readFileSync(path.join(root, 'src/lib/arrival-reminders-server.js'), 'utf8'); var lp = fs.readFileSync(path.join(root, 'src/lib/arrival-reminders.js'), 'utf8');
  check('server files are not client modules and import nothing from a client module', !/^'use client'/m.test(rs) && !/^'use client'/m.test(ls) && !/^'use client'/m.test(lp) && !/components\//.test(rs + ls + lp));
  check('route style: var + concatenation only (no let / const / arrow / template strings)', !/\blet\s|\bconst\s(?!maxDuration)|=>|`/.test(rs.replace(/export const maxDuration/, '')) && !/\blet\s|\bconst\s|=>|`/.test(ls) && !/\blet\s|\bconst\s|=>|`/.test(lp));
  var sql = fs.readFileSync(path.join(root, 'sql/v55-83-XG-arrival-reminders.sql'), 'utf8');
  check('SQL: one new table only, re-runnable, no delete right, nothing dropped or altered elsewhere', /CREATE TABLE IF NOT EXISTS public\.arrival_reminders/.test(sql) && /status IN \('sending','sent','failed','unknown'\)/.test(sql) && /WHERE mode = 'auto' AND status IN \('sending','sent','unknown'\)/.test(sql) && !/DROP |DELETE|TRUNCATE|ALTER TABLE public\.(?!arrival_reminders)/i.test(sql.replace(/--.*$/gm, '')) && /GRANT SELECT, INSERT, UPDATE ON public\.arrival_reminders TO service_role/.test(sql) && /REVOKE ALL ON public\.arrival_reminders FROM PUBLIC, anon, authenticated/.test(sql));
  var page = fs.readFileSync(path.join(root, 'src/app/page.jsx'), 'utf8'); var wn = fs.readFileSync(path.join(root, 'src/components/WhatsNewWidget.jsx'), 'utf8');
  check('badge and What’s New say XG', (function () { var top = /BUILD_HISTORY = \[\s*\{\s*version: '(v55\.83-[A-Z]+)'/.exec(wn); return !!top && page.indexOf('>' + top[1] + '</span>') > 0; })() /* a later build moves the badge on; it always names the newest What's New entry (XG or later) */ && wn.indexOf("version: 'v55.83-XG'") > 0);

  Module._load = origLoad; Module._resolveFilename = orig;
  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.log('CRASH', e && e.stack); process.exit(1); });
