// v55.83-XD (Max, 21 Nov 2026: a customs invoice "with ZEROR implications on any underlying reported data") — the proof that
// every Hub report answers EXACTLY the same with and without customs invoices.
// Two identical in-memory databases (A and B) with paid, part-paid, unpaid and voided invoices, their lines and payments.
// Customs invoices are made, edited (new versions) and voided ONLY in B, through the REAL /api/accounting/customs-invoices route.
// Then the REAL report routes run on A and on B and must give the same answers (status + JSON): customers overview, sales report,
// P&L (report + typed), Profitability (report + customer balances), Orders report, reminders (suggest), accountant pack, AI reports.
// Again after the parent invoice is voided, and after a parent invoice is deleted (in both). Plus: no report reads a customs table,
// and the invoice / line / payment rows of B are byte-for-byte what they were before.
// Only the sign-in check, the Supabase client and outside calls (fetch) are stand-ins; permissions and the window are real.
var path = require('path'); var crypto = require('crypto');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var FakeDb = require('./fake-supabase.js').FakeDb;
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 600))); }
console.log('XD — every report is unchanged by customs invoices');

var CUSTOMS = ['accounting_customs_invoices', 'accounting_customs_invoice_versions'];
var state = { db: null, who: { userId: null } };
function stub(rel, exportsObj) { var p = require.resolve(path.join(root, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj }; }
stub('src/lib/verified-caller.js', { verifiedCaller: function () { return Promise.resolve(state.who); } });
var supa = require.resolve('@supabase/supabase-js', { paths: [root] });
require.cache[supa] = { id: supa, filename: supa, loaded: true, exports: { createClient: function () { return state.db; } } };
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test'; process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test';
// no outside calls (Wave, warehouse feed, AI): every fetch answers "unavailable", the same for A and B
// the warehouse feed (Orders report) answers a small staging feed: one shipped order whose release has an invoice, one with none
process.env.NEXTRADE_FEED_URL = 'https://nextrade-staging.com/api/hub/shipping'; process.env.NEXTRADE_FEED_TOKEN = 'feed-token';
var FEED = { orders: [
  { id: 801, release_number: '1002-111', customer_name: 'Alpha Trading', country: 'Egypt', status: 'shipped', shipped_date: '2026-10-02' },
  { id: 802, release_number: '1002-999', customer_name: 'No Invoice Co', country: 'Egypt', status: 'shipped', shipped_date: '2026-10-03' }], requirements: [], status_history: [], obsolete_orders: [] };
var aiSent = []; // what the accountant pack / AI reports would send out (their gathered numbers), compared A vs B
global.fetch = function (url, opts) {
  if (opts && opts.body && !/nextrade-staging/.test(String(url))) { aiSent.push(String(opts.body).replace(/d{4}-d{2}-d{2}Td{2}:d{2}:d{2}(.d+)?Z/g, '<ts>')); }
  var host = ''; try { host = new URL(String(url)).host; } catch (e) { host = ''; }
  if (/nextrade-staging\.com$/.test(host)) { return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(Object.assign({ ok: true, source: 'nextrade-staging', site: host }, JSON.parse(JSON.stringify(FEED)))); } }); }
  return Promise.resolve(new Response(JSON.stringify({ ok: false, error: 'offline in test' }), { status: 503, headers: { 'content-type': 'application/json' } }));
};
process.env.ANTHROPIC_API_KEY = 'test-key-offline'; // the accountant pack / AI reports gather their numbers first, then the (offline) AI call fails the same way for A and B

var U = function (n) { return '00000000-0000-4000-8000-' + ('000000000000' + n).slice(-12); };
var SUPER = U(1), EDIT = U(3);
var CA = U(301), CB = U(302);
var W_US = 'QnVzaW5lc3M6NWRkNzI3MDctOTExNC00NjQwLTg4MGQtMjYzNmI3YzM4YTdk'; var W_EG = 'QnVzaW5lc3M6RUdZUFQtVEVTVA'; // the real US Wave business id (business-of.js) and a stand-in for Egypt
var I_UNPAID = U(201), I_PART = U(202), I_PAID = U(203), I_VOID = U(204), I_EG = U(205);

// a FakeDb that also understands the few query words the report routes use, and RECORDS every table it is asked for
function makeDb() {
  var db = new FakeDb({});
  var proto = Object.getPrototypeOf(db.from('x'));
  ['lt', 'gt'].forEach(function (op) { if (!proto[op]) { proto[op] = function (k, v) { this.filters.push(function (r) { return op === 'lt' ? String(r[k]) < String(v) : String(r[k]) > String(v); }); return this; }; } });
  ['ilike', 'like', 'contains', 'filter', 'match', 'returns', 'abortSignal', 'textSearch', 'overlaps', 'containedBy'].forEach(function (op) { if (!proto[op]) { proto[op] = function () { return this; }; } });
  if (!proto.csv) { proto.csv = function () { return this; }; }
  db.reads = {};
  var raw = db.from;
  db.from = function (t) { db.reads[t] = (db.reads[t] || 0) + 1; return raw(t); };
  db.storage = { from: function () { return { createSignedUrl: function () { return Promise.resolve({ data: null, error: { message: 'no store' } }); } }; } };
  db.t.users = [{ id: SUPER, role: 'super_admin', name: 'Max', email: 'max@example.test', is_active: true }, { id: EDIT, role: 'staff', name: 'Eddie', email: 'e@example.test', is_active: true }];
  db.t.module_permissions = [{ user_id: EDIT, module_name: 'invoice.create', has_access: true }, { user_id: EDIT, module_name: 'invoice.view', has_access: true }];
  db.t.app_settings = [];
  db.t.wave_business_registry = [{ id: 'r1', wave_business_id: W_US, name: 'KTC INTERNATIONAL ENTERPRISES LLC', is_active: true }, { id: 'r2', wave_business_id: W_EG, name: 'KANDIL EGYPT', is_active: true }];
  db.t.businesses = [{ id: 'b1', name: 'KTC International Inc.' }];
  db.t.company_profile = [{ id: 'cp', company_name: 'KTC International Inc.' }];
  db.t.accounting_customers = [
    { id: CA, company_name: 'Alpha Trading', email: 'a@example.test', business_tag: 'US', wave_business_id: W_US, created_at: '2026-01-01' },
    { id: CB, company_name: 'Beta Imports', email: 'b@example.test', business_tag: 'EG', wave_business_id: W_EG, created_at: '2026-01-01' }];
  function inv(id, num, date, cust, total, paid, status, rs, rel, biz) {
    return { id: id, invoice_number: num, invoice_date: date, due_date: date, accounting_customer_id: cust, business_id: 'b1', wave_business_id: biz || W_US, currency: 'USD',
      total_amount: total, amount_paid: paid, balance_due: total - paid, payment_status: status, approval_status: 'approved', record_status: rs || 'active', source: 'hub',
      release_number: rel, wave_imported_paid: 0, wave_invoice_id: 'wv-' + num, wave_sync_status: 'synced', created_at: date + 'T10:00:00Z', updated_at: date + 'T10:00:00Z' };
  }
  db.t.accounting_invoices = [
    inv(I_UNPAID, 'INV-100', '2026-10-01', CA, 1200, 0, 'unpaid', 'active', '1002-111'),
    inv(I_PART, 'INV-101', '2026-10-05', CA, 2000, 500, 'partial', 'active', '1002-112'),
    inv(I_PAID, 'INV-102', '2026-09-15', CA, 800, 800, 'paid', 'active', '1001-113'),
    inv(I_VOID, 'INV-103', '2026-09-20', CA, 300, 0, 'unpaid', 'void', '1002-114'),
    inv(I_EG, 'INV-100', '2026-10-02', CB, 950, 0, 'unpaid', 'active', '1002-115', W_EG)]; // the same number in another business
  function item(id, invId, d, q, p) { return { id: id, invoice_id: invId, business_id: 'b1', description: d, quantity: q, unit_price: p, line_total: q * p, sort_order: 0 }; }
  db.t.accounting_invoice_items = [item('it1', I_UNPAID, 'Kraft paper 120 gsm', 1000, 1.2), item('it2', I_PART, 'Testliner rolls', 4000, 0.5), item('it3', I_PAID, 'Air freight', 1, 800),
    item('it4', I_VOID, 'Pallets', 3, 100), item('it5', I_EG, 'Sack paper', 950, 1)];
  db.t.accounting_invoice_payments = [
    { id: 'p1', accounting_invoice_id: I_PART, amount: 500, payment_date: '2026-10-10', voided: false, sync_status: 'synced' },
    { id: 'p2', accounting_invoice_id: I_PAID, amount: 800, payment_date: '2026-09-20', voided: false, sync_status: 'synced' }];
  db.t.payment_matches = [{ id: 'm1', invoice_id: I_PAID, voided: false }];
  // the three locked database steps, as the SQL does them (the SQL itself is proven in Postgres by test-v55-83-xd-customs-sql.mjs)
  db.rpcs.hub_customs_invoice_create = function (a) {
    var p = a.p; var rows = db.t.accounting_customs_invoices || (db.t.accounting_customs_invoices = []);
    var seq = rows.filter(function (r) { return r.invoice_id === p.invoice_id; }).length + 1; var id = crypto.randomUUID();
    rows.push({ id: id, invoice_id: p.invoice_id, seq: seq, invoice_number_at_creation: p.invoice_number, invoice_date_at_creation: p.invoice_date, accounting_customer_id: p.accounting_customer_id, business_id: p.business_id, wave_business_id: p.wave_business_id, created_by: p.actor_id, created_by_name: p.actor_name, created_at: '2026-11-21T00:00:00Z', voided_at: null });
    (db.t.accounting_customs_invoice_versions = db.t.accounting_customs_invoice_versions || []).push({ id: crypto.randomUUID(), customs_invoice_id: id, version: 1, doc: p.doc, total: p.total, currency: p.currency, note: p.note || null, saved_by: p.actor_id, saved_by_name: p.actor_name, saved_at: '2026-11-21T00:00:00Z' });
    return { data: { id: id, seq: seq, version: 1 }, error: null };
  };
  db.rpcs.hub_customs_invoice_save = function (a) {
    var p = a.p; var vs = (db.t.accounting_customs_invoice_versions || []).filter(function (v) { return v.customs_invoice_id === p.customs_invoice_id; });
    var newest = vs.reduce(function (m, v) { return Math.max(m, v.version); }, 0);
    if (Number(p.base_version) !== newest) { return { data: null, error: { message: 'HUB_STALE: someone saved version ' + newest + ' meanwhile.' } }; }
    db.t.accounting_customs_invoice_versions.push({ id: crypto.randomUUID(), customs_invoice_id: p.customs_invoice_id, version: newest + 1, doc: p.doc, total: p.total, currency: p.currency, note: p.note || null, saved_by: p.actor_id, saved_by_name: p.actor_name, saved_at: '2026-11-21T01:00:00Z' });
    return { data: { id: p.customs_invoice_id, version: newest + 1 }, error: null };
  };
  db.rpcs.hub_customs_invoice_void = function (a) {
    var p = a.p; var r = (db.t.accounting_customs_invoices || []).filter(function (x) { return x.id === p.customs_invoice_id; })[0];
    if (!r) { return { data: null, error: { message: 'HUB_NOT_FOUND: no' } }; }
    if (r.voided_at) { return { data: null, error: { message: 'HUB_VOIDED: already' } }; }
    r.voided_at = '2026-11-21T02:00:00Z'; r.voided_by = p.actor_id; r.voided_by_name = p.actor_name; r.void_reason = p.reason;
    return { data: { id: r.id, voided: true }, error: null };
  };
  return db;
}

var REPORTS = [
  { name: 'Customers overview', route: 'src/app/api/accounting/customers-overview/route.js', body: { date_from: '2026-01-01', date_to: '2026-12-31', business: 'US' } },
  { name: 'Customers overview (Egypt)', route: 'src/app/api/accounting/customers-overview/route.js', body: { date_from: '2026-01-01', date_to: '2026-12-31', business: 'EG' } },
  { name: 'Sales report', route: 'src/app/api/accounting/sales-report/route.js', body: { date_from: '2026-01-01', date_to: '2026-12-31' } },
  { name: 'P&L report', route: 'src/app/api/accounting/pnl/route.js', body: { action: 'report', date_from: '2026-01-01', date_to: '2026-12-31' } },
  { name: 'P&L typed (by period)', route: 'src/app/api/accounting/pnl/route.js', body: { action: 'report_typed', date_from: '2026-01-01', date_to: '2026-12-31' } },
  { name: 'Profitability report', route: 'src/app/api/accounting/profitability/route.js', body: { action: 'report' } },
  { name: 'Profitability customer balances', route: 'src/app/api/accounting/profitability/route.js', body: { action: 'customer_balances' } },
  { name: 'Orders report', route: 'src/app/api/accounting/order-monitor/route.js', body: { action: 'report' } },
  { name: 'Reminders (who is owed)', route: 'src/app/api/accounting/reminders/route.js', body: { action: 'suggest' } },
  { name: 'Accountant pack', route: 'src/app/api/accountant/route.js', body: { question: 'What is the open balance per customer?' } },
  { name: 'AI reports', route: 'src/app/api/ai/reports/route.js', body: { question: 'Sales by month', report: 'sales' } },
];
var CUSTOMS_ROUTE = require(path.join(root, 'src/app/api/accounting/customs-invoices/route.js'));
REPORTS.forEach(function (r) { try { r.mod = require(path.join(root, r.route)); } catch (e) { r.loadError = e.message; } });

// volatile parts of an answer (the clock) are the same kind on both sides; everything else must match exactly
function norm(x) {
  if (Array.isArray(x)) { return x.map(norm); }
  if (x && typeof x === 'object') { var o = {}; Object.keys(x).sort().forEach(function (k) { o[k] = norm(x[k]); }); return o; }
  if (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(x)) { var d = new Date(x); return Math.abs(Date.now() - d.getTime()) < 600000 ? '<now>' : x; }
  return x;
}
function post(mod, body) {
  var handler = mod.POST;
  var req = new Request('http://x/api', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', authorization: 'Bearer t' } });
  return Promise.resolve().then(function () { return handler(req); }).then(function (res) {
    return res.text().then(function (t) { var j; try { j = JSON.parse(t); } catch (e) { j = { raw: t.substring(0, 200) }; } return { status: res.status, json: norm(j) }; });
  }).catch(function (e) { return { status: 'threw', json: String(e && e.message) }; });
}
function asUser(db, uid) { state.db = db; state.who = { userId: uid }; }
async function runAll(db) {
  var out = {}; db.reads = {}; aiSent = [];
  for (var i = 0; i < REPORTS.length; i++) {
    var r = REPORTS[i]; if (!r.mod) { out[r.name] = { status: 'not loaded', json: r.loadError }; continue; }
    asUser(db, SUPER); out[r.name] = await post(r.mod, r.body);
  }
  out.__reads = Object.assign({}, db.reads);
  out.__ai = aiSent.slice();
  return out;
}
function snapshotMoney(db) { return JSON.stringify(['accounting_invoices', 'accounting_invoice_items', 'accounting_invoice_payments', 'payment_matches', 'accounting_customers'].map(function (t) { return db.t[t] || []; })); }
function customsCall(db, uid, body) { asUser(db, uid); return post(CUSTOMS_ROUTE, body); }
function sameAnswers(label, a, b) {
  check(label + ' — what the accountant pack / AI reports send out is the same with and without customs invoices', a.__ai.length > 0 && JSON.stringify(a.__ai) === JSON.stringify(b.__ai), { a: a.__ai.length, b: b.__ai.length });
  REPORTS.forEach(function (r) {
    var x = JSON.stringify(a[r.name]); var y = JSON.stringify(b[r.name]);
    check(label + ' — ' + r.name + ': the same answer with and without customs invoices', x === y, { without: x.substring(0, 250), with: y.substring(0, 250) });
  });
}

(async function main() {
  REPORTS.forEach(function (r) { check('report route loads: ' + r.name, !!r.mod, r.loadError); });
  var A = makeDb(), B = makeDb();
  var before = await runAll(B);
  // the answers are real answers, not errors (otherwise "unchanged" would prove nothing)
  ['Customers overview', 'Sales report', 'P&L report', 'Profitability report', 'Profitability customer balances', 'Reminders (who is owed)'].forEach(function (n) {
    check('the ' + n + ' route really answers on this data (HTTP 200)', before[n].status === 200, before[n]);
  });
  var moneyBefore = snapshotMoney(B);

  // ── customs invoices in B only: made, edited twice, one voided, on paid / part-paid / unpaid invoices and on the same number in another business
  var doc = function (n, price) { return { title: 'CUSTOMS INVOICE', printed_number: n, doc_date: '2026-10-01', currency: 'USD', exporter: 'KTC', consignee: 'Alpha', lines: [{ description: 'Kraft paper', quantity: 1000, unit_price: price, hs_code: '4804.11' }], freight: 150, insurance: 20 }; };
  var c1 = await customsCall(B, EDIT, { action: 'create', invoice_id: I_UNPAID, doc: doc('INV-100', 0.4) });
  check('customs invoice made under the unpaid invoice', c1.status === 200 && c1.json.ok === true, c1);
  var c2 = await customsCall(B, EDIT, { action: 'create', invoice_id: I_PART, doc: doc('INV-101-CUSTOMS', 0.1) });
  check('customs invoice made under the part-paid invoice (own printed number)', c2.status === 200, c2);
  var c3 = await customsCall(B, SUPER, { action: 'create', invoice_id: I_PAID, doc: doc('INV-102', 9.99) });
  check('customs invoice made under the paid invoice', c3.status === 200, c3);
  var c4 = await customsCall(B, EDIT, { action: 'create', invoice_id: I_EG, doc: doc('INV-100', 2) });
  check('customs invoice made under the other business invoice with the same number INV-100', c4.status === 200, c4);
  var c5 = await customsCall(B, EDIT, { action: 'create', invoice_id: I_UNPAID, doc: doc('INV-100', 5) });
  check('a second customs invoice under the same invoice = Customs #2', c5.status === 200 && c5.json.seq === 2, c5);
  var s1 = await customsCall(B, EDIT, { action: 'save', id: c1.json.id, base_version: 1, doc: doc('INV-100', 0.55) });
  var s2 = await customsCall(B, EDIT, { action: 'save', id: c1.json.id, base_version: 2, doc: doc('INV-100', 0.6) });
  check('edited twice = versions 2 and 3', s1.json.version === 2 && s2.json.version === 3, [s1, s2]);
  var v1 = await customsCall(B, EDIT, { action: 'void', id: c2.json.id, reason: 'made in error' });
  check('one voided', v1.status === 200, v1);
  check('the customs papers are in B only', (B.t.accounting_customs_invoices || []).length === 5 && (B.t.accounting_customs_invoice_versions || []).length === 7 && !(A.t.accounting_customs_invoices || []).length);
  check('invoices, lines, payments, matches and customers in B are exactly what they were before', snapshotMoney(B) === moneyBefore);

  var a1 = await runAll(A), b1 = await runAll(B);
  sameAnswers('after create / edit / void', a1, b1);
  check('B answers exactly as before the customs invoices were made', JSON.stringify(REPORTS.map(function (r) { return before[r.name]; })) === JSON.stringify(REPORTS.map(function (r) { return b1[r.name]; })));
  check('no report read a customs table', CUSTOMS.every(function (t) { return !b1.__reads[t] && !a1.__reads[t]; }), b1.__reads);
  check('the reports read the invoice tables (so the comparison means something)', !!b1.__reads.accounting_invoices, b1.__reads);

  // ── the parent invoice is voided (in both)
  [A, B].forEach(function (db) { db.t.accounting_invoices.forEach(function (r) { if (r.id === I_UNPAID) { r.record_status = 'void'; } }); });
  var a2 = await runAll(A), b2 = await runAll(B);
  sameAnswers('after the parent invoice is voided', a2, b2);
  // ── a parent invoice is deleted (in both): no foreign key, the delete is the same as today; the customs paper stays on record
  [A, B].forEach(function (db) {
    db.t.accounting_invoices = db.t.accounting_invoices.filter(function (r) { return r.id !== I_PAID; });
    db.t.accounting_invoice_items = db.t.accounting_invoice_items.filter(function (r) { return r.invoice_id !== I_PAID; });
  });
  var a3 = await runAll(A), b3 = await runAll(B);
  sameAnswers('after a parent invoice is deleted', a3, b3);
  var kept = await customsCall(B, SUPER, { action: 'get', id: c3.json.id });
  check('the customs paper of the deleted invoice is still on record and readable (super admin), its printed number kept', kept.status === 200 && kept.json.invoice_exists === false && kept.json.versions[0].doc.printed_number === 'INV-102', kept);
  var noNew = await customsCall(B, EDIT, { action: 'create', invoice_id: I_PAID, doc: doc('X', 1) });
  check('no new customs paper under a deleted invoice', noNew.status === 404, noNew);

  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.log('CRASH', e && e.stack); process.exit(1); });
