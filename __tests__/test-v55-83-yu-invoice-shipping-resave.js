// v55.83-YU — Codex 24 Nov 13:42 UTC, P2 on YP: reopen an existing CNF-separate invoice whose trucking + freight breakdown is
// complete, whose shipping line is below cost + 7% and which already has a written reason; leave "Inside the shipping" closed,
// change an ordinary field, Save. Before YU the screen stripped the saved reason and the save failed the same way every time.
var path = require('path'); var fs = require('fs'); var Module = require('module');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://placeholder.supabase.co'; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'placeholder'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder';
require(path.join(root, 'node_modules/sucrase/register'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra))); }
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
console.log('YU — an existing below-margin invoice saves again (the reason is kept; the screen knows the costs are actual when it opens)');

var state;
var R = function (k, p, a) { return { release_key: k, part: p, amount: a }; };
function fresh(o) { state = Object.assign({ items: [{ description: 'Goods', quantity: 1000, unit_price: 1.2, line_total: 1200 }, { description: 'Shipping Costs', quantity: 1, unit_price: 2222, line_total: 2222 }], release: '1002-77', parts: [R('100277', 'trucking', 900), R('100277', 'freight', 1322)], partsError: null, audit: [], terms: { invoice_id: 'inv-1', shipping_terms: 'CNF_SEPARATE', shipping_cost_estimate: 2222 }, log: [] }, o || {}); }
function run(st) {
  if (st.table === 'accounting_invoices') { return { data: { id: 'inv-1', release_number: state.release }, error: null }; }
  if (st.table === 'accounting_invoice_items') { return { data: state.items, error: null }; }
  if (st.table === 'hub_audit_log') {
    if (st.op === 'insert') { state.audit.push(st.row); state.log.push('audit:' + st.row.action); return { data: null, error: null }; }
    return { data: state.audit.filter(function (a) { return a.action === st.filters.action && a.entity_id === st.filters.entity_id; }).slice(-1).map(function (a) { return { details: a.details, at: '2026-11-24T12:00:00Z' }; }), error: null };
  }
  if (st.table === 'pl_release_part_estimates') { if (st.op !== 'select') { state.log.push('WRITE-PARTS'); } return state.partsError ? { data: null, error: { message: state.partsError } } : { data: state.parts, error: null }; }
  if (st.table === 'pl_invoice_terms') { if (st.op === 'upsert') { state.terms = st.row; state.log.push('save-terms'); return { data: [st.row], error: null }; } return { data: state.terms, error: null }; }
  return { data: [], error: null };
}
function q(table) {
  var st = { table: table, op: 'select', filters: {} };
  var b = { select: function () { return b; }, eq: function (k, v) { st.filters[k] = v; return b; }, in: function (k, v) { st.filters[k] = v; return b; }, order: function () { return b; }, limit: function () { return b; },
    insert: function (row) { st.op = 'insert'; st.row = row; return b; }, upsert: function (row) { st.op = 'upsert'; st.row = row; return b; }, update: function () { st.op = 'update'; return b; }, delete: function () { st.op = 'delete'; return b; },
    maybeSingle: function () { return Promise.resolve(run(st)); }, then: function (res, rej) { return Promise.resolve(run(st)).then(res, rej); } };
  return b;
}
var realLoad = Module._load;
Module._load = function (request) {
  if (request === 'next/server') { return { NextResponse: { json: function (body, init) { return { body: body, status: (init && init.status) || 200 }; } } }; }
  if (request === '@supabase/supabase-js') { return { createClient: function () { return { from: q }; } }; }
  if (/verified-caller$/.test(request)) { return { verifiedCaller: function () { return Promise.resolve({ userId: 'user-1' }); } }; }
  if (/server-permissions$/.test(request)) { return { loadUserPermissions: async function () { return {}; }, revenueSwitchedOff: function () { return false; }, assertPermission: function () { return Promise.resolve({ ok: true }); } }; }
  if (/invoice-extract-server$/.test(request)) { return { readInvoiceFromBase64: function () { return Promise.resolve(null); } }; }
  return realLoad.apply(this, arguments);
};
var route = require(path.join(root, 'src/app/api/accounting/invoice-write/route.js'));
Module._load = realLoad;
function call(body) { return route.POST({ json: function () { return Promise.resolve(Object.assign({ invoice_id: 'inv-1' }, body)); }, headers: { get: function () { return null; } } }); }
var REASON = 'Price agreed with customer';

(async function () {
  // ── the invoice was saved earlier, below margin, with a reason ──
  fresh();
  var r = await call({ action: 'set_shipping_terms', shipping_terms: 'CNF_SEPARATE', shipping_cost_estimate: 2222, markup_override_note: REASON });
  check('1: (set-up) the first save, below cost + 7% with a reason, is accepted and audited', r.status === 200 && r.body.ok === true && state.audit.filter(function (a) { return a.action === 'shipping_markup_override'; }).length === 1, r);

  // ── reopening it ──
  var g = await call({ action: 'get_shipping_terms' });
  check('2: opening the invoice: the server says the costs are ACTUAL (breakdown complete) and for which release — the breakdown box need not be opened', g.status === 200 && g.body.cost_is_actual === true && g.body.release_number === '1002-77', g.body);
  check('3: …and gives the earlier reason back', g.body.markup_override_note === REASON, g.body);

  // ── Codex's reproduction: what the OLD screen sent (reason stripped because its flag was not loaded) ──
  r = await call({ action: 'set_shipping_terms', shipping_terms: 'CNF_SEPARATE', shipping_cost_estimate: 2222, markup_override_note: '' });
  check('4: (the defect) saving with the reason stripped is refused by the server with markup_note_needed — every time', r.status !== 200 && r.body.code === 'markup_note_needed', r);
  // ── what the screen sends now: the saved reason, always ──
  r = await call({ action: 'set_shipping_terms', shipping_terms: 'CNF_SEPARATE', shipping_cost_estimate: 2222, markup_override_note: g.body.markup_override_note });
  check('5: (the fix) the same save with the saved reason sent goes through', r.status === 200 && r.body.ok === true, r);
  var tab = read('src/components/AccountingInvoicesTab.jsx');
  check('6 (source): the screen ALWAYS sends the reason it holds — it is never stripped on a client flag', tab.indexOf("markup_override_note: String(hdr.markup_override_note || '') /* v55.83-XV; v55.83-YU") > 0 && tab.indexOf("markup_override_note: shipCheck.markup ?") < 0);
  check('7 (source): on opening, the screen takes "actual or not" from the server answer (and clears it when the answer says not)', tab.indexOf("setShipActualFor(j.cost_is_actual === true && String(j.release_number || '').trim() ? String(j.release_number).trim() : null);") > 0);

  // ── a reason is genuinely missing: say what to do, show the box ──
  check('8 (source): markup_note_needed is handled apart from the generic partial save: the box is shown, focused, and the message says to type the reason', /if \(e && e\.termsFailed && e\.code === 'markup_note_needed'\) \{[\s\S]{0,900}setShipActualFor\(String\(hdr\.release_number \|\| ''\)\.trim\(\) \|\| null\);[\s\S]{0,700}Type the reason in the red box under the shipping cost, then press Save again\.[\s\S]{0,700}getElementById\('nt-ship-override'\)/.test(tab) && tab.indexOf("code: (j && j.code) || ''") > 0);
  check('9 (source): that branch comes BEFORE the generic "PARTLY SAVED … press Save again" message, and keeps the saved invoice id (no duplicate on the next Save)', tab.indexOf("e.code === 'markup_note_needed'") < tab.indexOf('PARTLY SAVED: the invoice is saved') && /e\.code === 'markup_note_needed'\) \{[\s\S]{0,1400}if \(editing === 'new'\) \{ setEditing\(Object\.assign\(\{\}, hdr, \{ id: e\.docId/.test(tab));
  fresh({ audit: [] });
  r = await call({ action: 'set_shipping_terms', shipping_terms: 'CNF_SEPARATE', shipping_cost_estimate: 2222, markup_override_note: '' });
  var again = await call({ action: 'set_shipping_terms', shipping_terms: 'CNF_SEPARATE', shipping_cost_estimate: 2222, markup_override_note: 'Agreed before the freight went up' });
  check('10: no reason at all → refused; then with a reason typed → saved (retry succeeds), one audit row, the 7% rule not weakened', r.body.code === 'markup_note_needed' && again.status === 200 && again.body.ok === true && state.audit.filter(function (a) { return a.action === 'shipping_markup_override'; }).length === 1, [r, again]);

  // ── complete → incomplete, and other states ──
  fresh({ parts: [R('100277', 'trucking', 900)] });
  g = await call({ action: 'get_shipping_terms' });
  r = await call({ action: 'set_shipping_terms', shipping_terms: 'CNF_SEPARATE', shipping_cost_estimate: 2222, markup_override_note: '' });
  check('11: the breakdown is no longer complete (freight removed) → opening says NOT actual, and the save needs no reason', g.body.cost_is_actual === false && r.status === 200 && r.body.ok === true, [g.body, r]);
  fresh({ release: '' });
  g = await call({ action: 'get_shipping_terms' });
  check('12: no release on the invoice → not actual', g.body.cost_is_actual === false && g.body.release_number === '', g.body);
  fresh({ partsError: 'timeout' });
  g = await call({ action: 'get_shipping_terms' });
  check('13: the breakdown cannot be read when opening → the invoice still opens (terms shown), flagged not actual', g.status === 200 && g.body.ok === true && g.body.cost_is_actual === false && g.body.shipping_terms === 'CNF_SEPARATE', g.body);
  fresh({ release: '1002-76 & 1002-77' });
  g = await call({ action: 'get_shipping_terms' });
  check('14: two releases on the invoice, only one with a complete breakdown → not actual', g.body.cost_is_actual === false, g.body);
  check('15: opening an invoice never writes the breakdown', state.log.indexOf('WRITE-PARTS') < 0 && !/from\('pl_release_part_estimates'\)\.(insert|upsert|update|delete)/.test(read('src/app/api/accounting/invoice-write/route.js')));
  check('16 (source): a NEW invoice and one read from a document start with nothing known (no stale "actual" from the invoice opened before)', (tab.match(/forgetShipActual\(\);/g) || []).length >= 2 && tab.indexOf('function forgetShipActual() { setShipActualFor(null); setAutoShip(null); }') > 0);

  var page = read('src/app/page.jsx'); var wn = read('src/components/WhatsNewWidget.jsx');
  check('17: What\'s New has the YU entry and the badge names the newest entry on top', wn.indexOf("version: 'v55.83-YU'") > 0 && (function () { var top = /BUILD_HISTORY = \[\s*\{\s*version: '(v55\.83-[A-Z]{2}(?:\.\d+)?)'/.exec(wn); return !!top && page.indexOf('>' + top[1] + '</span>') > 0; })());
  check('18: the test is in the regression runner', read('scripts/run-accounting-bank-regression.js').indexOf('test-v55-83-yu-invoice-shipping-resave.js') > 0);
  console.log('\nYU: ' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.log('CRASHED: ' + (e && e.stack || e)); process.exit(1); });
