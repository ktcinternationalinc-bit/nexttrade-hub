// v55.83-XV — Max, 23 Nov 2026: "need to have ability to override the 7% requirement with a note that is saved in the audit clearly."
// Part 1: the REAL rule functions. Part 2: the REAL route (invoice-write POST) driven against an in-memory stand-in for the
// database; the sign-in check and the permission check are stand-ins that always allow (they are not what is tested here).
// Part 3: source checks of the screen wiring (they show the wiring exists; they are not browser behaviour).
var path = require('path'); var fs = require('fs'); var Module = require('module');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://placeholder.supabase.co'; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'placeholder'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder';
require(path.join(root, 'node_modules/sucrase/register'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra))); }
console.log('XV — shipping below cost + 7%: override with a written reason, on the audit trail');

// ── Part 1: the rule ──
var S = require(path.join(root, 'src/lib/shipping-terms.js'));
var P = require(path.join(root, 'src/lib/profitability.js'));
var LINES = [{ description: 'STOCK PVC ROLLS', amount: 24335.62 }, { description: 'Shipping Costs', amount: 3966 }];
var r1 = S.checkShippingTerms('CNF_SEPARATE', '3966', LINES, P.isTransportLine);
check('1: Max\'s invoice (cost 3966, shipping line 3966) is below cost + 7%: need 4243.62, short 277.62', r1.ok === true && r1.markup && r1.markup.need === 4243.62 && r1.markup.charged === 3966 && r1.markup.short === 277.62 && r1.markup.cost === 3966 && r1.warnings.indexOf(r1.markup.warning) >= 0, r1);
check('2: charged exactly cost + 7% (or more) is not a shortfall', S.checkShippingTerms('CNF_SEPARATE', '3966', [{ description: 'Shipping Costs', amount: 4243.62 }], P.isTransportLine).markup === null && S.markupShortfall('CNF_SEPARATE', 3966, [{ description: 'Freight', amount: 5000 }], P.isTransportLine) === null);
check('3: the rule does not apply to CNF in the price, nor to EXW with no shipping line', S.markupShortfall('CNF_INCLUDED', 3966, [{ description: 'Goods', amount: 100 }], P.isTransportLine) === null && S.markupShortfall('EXW', null, [{ description: 'Goods', amount: 100 }], P.isTransportLine) === null);
check('4: EXW with a shipping line below cost + 7% is a shortfall too', (function () { var x = S.markupShortfall('EXW', 1000, [{ description: 'Trucking', amount: 1000 }], P.isTransportLine); return !!x && x.need === 1070 && x.short === 70; })());
check('5: the reason must be at least 10 characters after trimming; spaces alone do not count', S.markupOverrideNote('').ok === false && S.markupOverrideNote('   short   ').ok === false && S.markupOverrideNote(null).ok === false && S.markupOverrideNote('          ').ok === false && S.MARKUP_NOTE_MIN === 10);
check('6: a real reason is accepted, tidied, and cut at 500 characters', S.markupOverrideNote('  Price agreed   before freight rose ').note === 'Price agreed before freight rose' && S.markupOverrideNote(new Array(700).join('x')).note.length === 500);

// ── Part 2: the real route with stand-ins ──
var state;
function fresh(o) { state = Object.assign({ items: [{ description: 'STOCK PVC ROLLS', quantity: 24581.43, unit_price: 0.99, line_total: 24335.62 }, { description: 'Shipping Costs', quantity: 1, unit_price: 3966, line_total: 3966 }], itemsError: null, auditFail: false, audit: [], terms: null, log: [] }, o || {}); }
function run(st, single) {
  if (st.table === 'accounting_invoices') { return { data: { id: 'inv-1' }, error: null }; }
  if (st.table === 'accounting_invoice_items') { state.log.push('read-lines'); return state.itemsError ? { data: null, error: { message: state.itemsError } } : { data: state.items, error: null }; }
  if (st.table === 'hub_audit_log') {
    if (st.op === 'insert') { if (state.auditFail && st.row.action === 'shipping_markup_override') { state.log.push('audit-FAILED'); return { data: null, error: { message: 'audit table is down' } }; } state.audit.push(st.row); state.log.push('audit:' + st.row.action); return { data: null, error: null }; }
    return { data: state.audit.filter(function (a) { return a.action === st.filters.action && a.entity_id === st.filters.entity_id; }).slice(-1).map(function (a) { return { details: a.details, at: '2026-11-23T18:00:00Z' }; }), error: null };
  }
  if (st.table === 'pl_invoice_terms') {
    if (st.op === 'upsert') { state.terms = st.row; state.log.push('save-terms'); return { data: [st.row], error: null }; }
    return { data: state.terms, error: null };
  }
  return { data: single ? null : [], error: null };
}
function q(table) {
  var st = { table: table, op: 'select', filters: {} };
  var b = { select: function () { return b; }, eq: function (k, v) { st.filters[k] = v; return b; }, order: function () { return b; }, limit: function () { return b; },
    insert: function (row) { st.op = 'insert'; st.row = row; return b; }, upsert: function (row) { st.op = 'upsert'; st.row = row; return b; },
    maybeSingle: function () { return Promise.resolve(run(st, true)); }, then: function (res, rej) { return Promise.resolve(run(st, false)).then(res, rej); } };
  return b;
}
var realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'next/server') { return { NextResponse: { json: function (body, init) { return { body: body, status: (init && init.status) || 200 }; } } }; }
  if (request === '@supabase/supabase-js') { return { createClient: function () { return { from: q }; } }; }
  if (/lib\/verified-caller$/.test(request)) { return { verifiedCaller: function () { return Promise.resolve({ userId: 'user-1' }); } }; }
  if (/lib\/server-permissions$/.test(request)) { return { assertPermission: function () { return Promise.resolve({ ok: true }); } }; }
  if (/lib\/invoice-extract-server$/.test(request)) { return { readInvoiceFromBase64: function () { return Promise.resolve(null); } }; }
  return realLoad.apply(this, arguments);
};
var route = require(path.join(root, 'src/app/api/accounting/invoice-write/route.js'));
Module._load = realLoad;
function call(body) { return route.POST({ json: function () { return Promise.resolve(Object.assign({ invoice_id: 'inv-1' }, body)); }, headers: { get: function () { return null; } } }); }
function setTerms(extra) { return call(Object.assign({ action: 'set_shipping_terms', shipping_terms: 'CNF_SEPARATE', shipping_cost_estimate: 3966 }, extra || {})); }
var REASON = 'Price agreed with the customer before the freight went up';

(async function () {
  fresh(); var a = await setTerms();
  check('7: below cost + 7% with NO reason → refused (markup_note_needed); nothing saved, nothing on the audit trail', a.status === 400 && a.body.ok === false && a.body.code === 'markup_note_needed' && /4243\.62/.test(a.body.error) && /3966\.00/.test(a.body.error) && state.terms === null && state.audit.length === 0, [a, state.log]);
  fresh(); var b = await setTerms({ markup_override_note: '  too short ' });
  check('8: a reason shorter than 10 characters → refused the same way', b.status === 400 && b.body.code === 'markup_note_needed' && state.terms === null && state.audit.length === 0, b);
  fresh(); var c = await setTerms({ markup_override_note: '  ' + REASON + '  ' });
  var row = state.audit.filter(function (x) { return x.action === 'shipping_markup_override'; })[0];
  check('9: with a reason → saved; ONE audit row: who, which invoice, the reason, cost 3966, minimum 4243.62, charged 3966, short by 277.62', c.status === 200 && c.body.ok === true && !!row && row.actor_id === 'user-1' && row.entity === 'accounting_invoice' && row.entity_id === 'inv-1' && row.details.reason === REASON && row.details.overridden === true && row.details.shipping_cost === 3966 && row.details.minimum_required === 4243.62 && row.details.shipping_charged === 3966 && row.details.short_by === 277.62 && row.details.shipping_terms === 'CNF_SEPARATE' && state.audit.filter(function (x) { return x.action === 'shipping_markup_override'; }).length === 1, [c, row]);
  check('10: the reason is written to the audit trail BEFORE the shipping terms are saved', state.log.indexOf('audit:shipping_markup_override') >= 0 && state.log.indexOf('audit:shipping_markup_override') < state.log.indexOf('save-terms') && state.log.indexOf('read-lines') < state.log.indexOf('audit:shipping_markup_override'), state.log);
  check('11: the answer says an override was recorded, with the shortfall', !!c.body.markup_override && c.body.markup_override.short_by === 277.62 && state.terms && state.terms.shipping_terms === 'CNF_SEPARATE' && state.terms.shipping_cost_estimate === 3966, c.body);
  fresh({ auditFail: true }); var d = await setTerms({ markup_override_note: REASON });
  check('12: if the audit trail cannot be written, NOTHING is saved and the person is told', d.status === 500 && d.body.ok === false && /audit trail/.test(d.body.error) && state.terms === null, [d, state.log]);
  fresh({ items: [{ description: 'Goods', quantity: 1, unit_price: 100, line_total: 100 }, { description: 'Shipping Costs', quantity: 1, unit_price: 4243.62, line_total: 4243.62 }] }); var e = await setTerms({ markup_override_note: REASON });
  check('13: at or above cost + 7% → saved normally and NO override row, even if a reason was sent', e.status === 200 && e.body.ok === true && e.body.markup_override === null && state.audit.filter(function (x) { return x.action === 'shipping_markup_override'; }).length === 0 && state.terms !== null, [e, state.audit]);
  fresh(); var f = await call({ action: 'set_shipping_terms', shipping_terms: 'CNF_INCLUDED', shipping_cost_estimate: 3966 });
  check('14: CNF in the price is not held to the separate-line rule (no reason asked)', f.status === 200 && f.body.ok === true && state.audit.filter(function (x) { return x.action === 'shipping_markup_override'; }).length === 0, f);
  fresh({ itemsError: 'timeout' }); var g = await setTerms({ markup_override_note: REASON });
  check('15: if the invoice lines cannot be read, nothing is saved (the rule is never skipped silently)', g.status === 500 && g.body.ok === false && /invoice lines/.test(g.body.error) && state.terms === null && state.audit.length === 0, g);
  fresh({ items: [{ description: 'Goods', quantity: 1, unit_price: 100, line_total: 0 }, { description: 'Freight', quantity: 2, unit_price: 1000, line_total: null }] }); var h = await setTerms({ shipping_cost_estimate: 2000 });
  check('16: a line with no stored total is counted as quantity × price (2 × 1000 = 2000 < 2140 → reason needed)', h.status === 400 && h.body.code === 'markup_note_needed' && /2140\.00/.test(h.body.error), h);
  fresh(); await setTerms({ markup_override_note: REASON }); var i = await call({ action: 'get_shipping_terms' });
  check('17: opening the invoice again gives the saved reason back', i.status === 200 && i.body.ok === true && i.body.markup_override_note === REASON && i.body.shipping_terms === 'CNF_SEPARATE', i.body);
  fresh(); var j = await call({ action: 'get_shipping_terms' });
  check('18: an invoice with no override gives an empty reason', j.status === 200 && j.body.markup_override_note === '' && j.body.markup_override_at === null, j.body);

  // ── Part 3: source checks of the screen ──
  var tab = fs.readFileSync(path.join(root, 'src/components/AccountingInvoicesTab.jsx'), 'utf8');
  check('19 (source): the screen stops the save without a reason, before anything is written, and no longer offers a bare "Save anyway" for this rule', tab.indexOf("if (mk7 && mkNote.length < MARKUP_NOTE_MIN) {") > 0 && tab.indexOf("var otherW = shipCheck.warnings.filter(function (w) { return !(mk7 && w === mk7.warning); });") > 0 && tab.indexOf("if (mk7 && mkNote.length < MARKUP_NOTE_MIN)") < tab.indexOf('setBusy(true);', tab.indexOf('var mk7 = shipCheck.markup')));
  check('20 (source): the red reason box is shown only while the shipping is below cost + 7%, and the reason goes to the server', tab.indexOf('id="nt-ship-override"') > 0 && tab.indexOf("shipAmt > 0 && shipAmt + 0.005 < minShippingCharge(c) && <div id=\"nt-ship-override\"") > 0 && tab.indexOf("markup_override_note: shipCheck.markup ? String(hdr.markup_override_note || '') : ''") > 0);
  check('21 (source): a copy of an invoice does not inherit the reason', tab.indexOf("Object.assign({}, h, t, { markup_override_note: ''") > 0);
  var WN = fs.readFileSync(path.join(root, 'src/components/WhatsNewWidget.jsx'), 'utf8'); var PG = fs.readFileSync(path.join(root, 'src/app/page.jsx'), 'utf8');
  check('22 (source): What\'s New has the XV entry and the badge names the newest entry (XV or later)', /version: 'v55\.83-XV'/.test(WN) && (function () { var top = /BUILD_HISTORY = \[\s*\{\s*version: '(v55\.83-[A-Z]+)'/.exec(WN); return !!top && PG.indexOf('>' + top[1] + '</span>') > 0; })());
  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  if (failN) { process.exit(1); }
})().catch(function (err) { console.log('  ✗ FAIL: the test itself crashed  ' + (err && err.stack || err)); process.exit(1); });
