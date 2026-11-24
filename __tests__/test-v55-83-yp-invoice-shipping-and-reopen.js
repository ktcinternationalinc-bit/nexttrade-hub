// v55.83-YP — Max, 24 Nov 2026, on the New invoice screen: "if i enter a shpping cost. it should automatically create a shipping line
// item with that cost" · "the 7% error mssg makes no sense there since you dont evven know my costs ... You can give me that error
// message after i enter the actual costs..otherwise let it go. Also the enterer can override that 7% message. and can make it less
// or make it more. but all is audited." · "if it is exw there should be NO shipping cost or 0" · (reopen an approved invoice)
// "create a setting for this now. and make it clear and part of bank and transactions section".
var path = require('path'); var fs = require('fs'); var Module = require('module');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://placeholder.supabase.co'; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'placeholder'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder';
require(path.join(root, 'node_modules/sucrase/register'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra))); }
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
console.log('YP — new invoice: typed cost makes the shipping line; 7% only on actual costs; EXW has no cost; the reopen switch');

var S = require(path.join(root, 'src/lib/shipping-terms.js'));
var P = require(path.join(root, 'src/lib/profitability.js'));
function blank() { return { description: '', quantity: '1', unit_price: '0' }; }
var GOODS = { description: 'A grade Polyvinyl Chloride', quantity: '1000', unit_price: '1.2' };

// ── 1. the shipping line appears from the cost ──
var a1 = S.autoShippingLine([GOODS], '2222', null, 'CNF_SEPARATE', P.isTransportLine, blank);
check('1: CNF separate line + cost 2222 typed, no shipping line yet → a "Shipping Costs" line is added at 2222', a1.changed === true && a1.why === 'added' && a1.amount === 2222 && a1.items.length === 2 && a1.items[1].description === 'Shipping Costs' && a1.items[1].quantity === '1' && a1.items[1].unit_price === '2222' && P.isTransportLine(a1.items[1].description) === true, a1);
check('2: the goods line is not touched', a1.items[0] === GOODS);
var a2 = S.autoShippingLine(a1.items, '2500', 2222, 'CNF_SEPARATE', P.isTransportLine, blank);
check('3: the cost is changed to 2500 and the line is still the one the Hub put there → it follows (2500)', a2.changed === true && a2.why === 'updated' && a2.items[1].unit_price === '2500' && a2.items.length === 2, a2);
var hand = [GOODS, { description: 'Shipping Costs', quantity: '1', unit_price: '3000' }];
var a3 = S.autoShippingLine(hand, '2500', 2222, 'CNF_SEPARATE', P.isTransportLine, blank);
check('4: the person priced the line by hand (3000, more than cost) → the Hub leaves it alone', a3.changed === false && a3.why === 'priced_by_hand' && a3.items[1].unit_price === '3000', a3);
var a3b = S.autoShippingLine([GOODS, { description: 'Shipping Costs', quantity: '1', unit_price: '1800' }], '2500', 2222, 'CNF_SEPARATE', P.isTransportLine, blank);
check('5: priced by hand BELOW the cost (1800) → also left alone', a3b.changed === false && a3b.items[1].unit_price === '1800', a3b);
check('6: a shipping line that is still empty (0) is filled', (function () { var x = S.autoShippingLine([GOODS, { description: 'Ocean freight', quantity: '1', unit_price: '0' }], '900', null, 'CNF_SEPARATE', P.isTransportLine, blank); return x.changed === true && x.items[1].unit_price === '900' && x.items[1].description === 'Ocean freight'; })());
check('7: several shipping lines → nothing is changed', S.autoShippingLine([GOODS, { description: 'Trucking', quantity: '1', unit_price: '0' }, { description: 'Ocean freight', quantity: '1', unit_price: '0' }], '900', null, 'CNF_SEPARATE', P.isTransportLine, blank).changed === false);
check('8: a surcharge line is never taken for the shipping line — a new line is added beside it', (function () { var x = S.autoShippingLine([GOODS, { description: 'Overweight surcharge', quantity: '1', unit_price: '300' }], '900', null, 'CNF_SEPARATE', P.isTransportLine, blank); return x.changed === true && x.items.length === 3 && x.items[1].unit_price === '300' && x.items[2].unit_price === '900'; })());
check('9: nothing is added on EXW, on CNF in the price, with no cost, or with a cost of 0', ['EXW', 'CNF_INCLUDED'].every(function (t) { return S.autoShippingLine([GOODS], '2222', null, t, P.isTransportLine, blank).changed === false; }) && S.autoShippingLine([GOODS], '', null, 'CNF_SEPARATE', P.isTransportLine, blank).changed === false && S.autoShippingLine([GOODS], '0', null, 'CNF_SEPARATE', P.isTransportLine, blank).changed === false);
check('10: the same amount already on the line changes nothing; "$2,222.00" is read as 2222', S.autoShippingLine(a1.items, '2222', 2222, 'CNF_SEPARATE', P.isTransportLine, blank).changed === false && S.autoShippingLine([GOODS], '$2,222.00', null, 'CNF_SEPARATE', P.isTransportLine, blank).amount === 2222);

// ── 2. the 7% check waits for the actual costs ──
var LINES = [{ description: 'Goods', amount: 1200 }, { description: 'Shipping Costs', amount: 2222 }];
var est = S.checkShippingTerms('CNF_SEPARATE', '2222', LINES, P.isTransportLine);
check('11: Max\'s screen (cost 2222 typed, line 2222, no actual costs) → saves, NO 7% warning, no reason asked', est.ok === true && est.warnings.length === 0 && !est.markup && est.value.shipping_cost_estimate === 2222, est);
check('12: same with an explicit costIsActual:false', !S.checkShippingTerms('CNF_SEPARATE', '2222', LINES, P.isTransportLine, { costIsActual: false }).markup);
var act = S.checkShippingTerms('CNF_SEPARATE', '2222', LINES, P.isTransportLine, { costIsActual: true });
check('13: once the actual costs are typed the check runs: 2222 charged, 2377.54 needed, short 155.54', act.ok === true && !!act.markup && act.markup.need === 2377.54 && act.markup.short === 155.54 && act.warnings.length === 1, act);
check('14: with actual costs, charging MORE (any amount) is never a shortfall', S.markupShortfall('CNF_SEPARATE', 2222, [{ description: 'Shipping Costs', amount: 9999 }], P.isTransportLine, { costIsActual: true }) === null && S.markupShortfall('CNF_SEPARATE', 2222, [{ description: 'Shipping Costs', amount: 2377.54 }], P.isTransportLine, { costIsActual: true }) === null);
check('15: CNF still needs a cost typed (the estimate), and CNF separate with no shipping line is only a note', S.checkShippingTerms('CNF_SEPARATE', '', LINES, P.isTransportLine).ok === false && (function () { var x = S.checkShippingTerms('CNF_SEPARATE', '500', [{ description: 'Goods', amount: 100 }], P.isTransportLine); return x.ok === true && x.warnings.length === 1 && !/7%/.test(x.warnings[0]); })());

// ── 3. EXW has no shipping cost ──
['', '0', '500', 'abc'].forEach(function (c, i) {
  var x = S.checkShippingTerms('EXW', c, [{ description: 'Goods', amount: 100 }, { description: 'Trucking to port', amount: 900 }], P.isTransportLine, { costIsActual: true });
  check('16.' + (i + 1) + ': EXW with cost typed as "' + c + '" → saves with NO shipping cost, nothing checked', x.ok === true && x.value.shipping_cost_estimate === null && x.warnings.length === 0 && !x.markup, x);
});

// ── 4. which releases, and is the breakdown complete ──
check('17: release text is split the same way as the breakdown box ("1002-1176 & 1002-1177" = two releases)', JSON.stringify(S.releaseKeysOfText('1002-1176 & 1002-1177')) === '["10021176","10021177"]' && S.releaseKeysOfText('').length === 0 && JSON.stringify(S.releaseKeysOfText('1002-77, 1002-77')) === '["100277"]');
var R = function (k, p, a) { return { release_key: k, part: p, amount: a }; };
check('18: actual = trucking AND freight typed (0 counts) for the release', S.breakdownIsComplete([R('100277', 'trucking', 1500), R('100277', 'freight', 0)], '1002-77') === true);
check('19: only trucking typed, only "other"/bond typed, an empty amount, or no release → not actual', S.breakdownIsComplete([R('100277', 'trucking', 1500)], '1002-77') === false && S.breakdownIsComplete([R('100277', 'other', 5), R('100277', 'bond', 200)], '1002-77') === false && S.breakdownIsComplete([R('100277', 'trucking', 1500), R('100277', 'freight', null)], '1002-77') === false && S.breakdownIsComplete([R('100277', 'trucking', 1), R('100277', 'freight', 1)], '') === false);
check('20: two releases on the invoice → BOTH must be complete', S.breakdownIsComplete([R('10021176', 'trucking', 1), R('10021176', 'freight', 1)], '1002-1176 & 1002-1177') === false && S.breakdownIsComplete([R('10021176', 'trucking', 1), R('10021176', 'freight', 1), R('10021177', 'trucking', 1), R('10021177', 'freight', 1)], '1002-1176 & 1002-1177') === true);

// ── 5. the real route: the SERVER decides whether the costs are actual ──
var state;
function fresh(o) { state = Object.assign({ items: [{ description: 'Goods', quantity: 1000, unit_price: 1.2, line_total: 1200 }, { description: 'Shipping Costs', quantity: 1, unit_price: 2222, line_total: 2222 }], release: '1002-77', parts: [], partsError: null, audit: [], terms: null, log: [] }, o || {}); }
function run(st) {
  if (st.table === 'accounting_invoices') { return { data: { id: 'inv-1', release_number: state.release }, error: null }; }
  if (st.table === 'accounting_invoice_items') { return { data: state.items, error: null }; }
  if (st.table === 'hub_audit_log') { if (st.op === 'insert') { state.audit.push(st.row); state.log.push('audit:' + st.row.action); return { data: null, error: null }; } return { data: [], error: null }; }
  if (st.table === 'pl_release_part_estimates') { state.log.push('read-parts:' + JSON.stringify(st.filters.release_key)); return state.partsError ? { data: null, error: { message: state.partsError } } : { data: state.parts, error: null }; }
  if (st.table === 'pl_invoice_terms') { if (st.op === 'upsert') { state.terms = st.row; state.log.push('save-terms'); return { data: [st.row], error: null }; } return { data: state.terms, error: null }; }
  return { data: [], error: null };
}
function q(table) {
  var st = { table: table, op: 'select', filters: {} };
  var b = { select: function () { return b; }, eq: function (k, v) { st.filters[k] = v; return b; }, in: function (k, v) { st.filters[k] = v; return b; }, order: function () { return b; }, limit: function () { return b; },
    insert: function (row) { st.op = 'insert'; st.row = row; return b; }, upsert: function (row) { st.op = 'upsert'; st.row = row; return b; },
    maybeSingle: function () { return Promise.resolve(run(st)); }, then: function (res, rej) { return Promise.resolve(run(st)).then(res, rej); } };
  return b;
}
var realLoad = Module._load;
Module._load = function (request) {
  if (request === 'next/server') { return { NextResponse: { json: function (body, init) { return { body: body, status: (init && init.status) || 200 }; } } }; }
  if (request === '@supabase/supabase-js') { return { createClient: function () { return { from: q }; } }; }
  if (/lib\/verified-caller$/.test(request)) { return { verifiedCaller: function () { return Promise.resolve({ userId: 'user-1' }); } }; }
  if (/lib\/server-permissions$/.test(request)) { return { loadUserPermissions: async function () { return {}; }, revenueSwitchedOff: function () { return false; }, assertPermission: function () { return Promise.resolve({ ok: true }); } }; }
  if (/lib\/invoice-extract-server$/.test(request)) { return { readInvoiceFromBase64: function () { return Promise.resolve(null); } }; }
  return realLoad.apply(this, arguments);
};
var route = require(path.join(root, 'src/app/api/accounting/invoice-write/route.js'));
Module._load = realLoad;
function call(body) { return route.POST({ json: function () { return Promise.resolve(Object.assign({ invoice_id: 'inv-1' }, body)); }, headers: { get: function () { return null; } } }); }
var COMPLETE = [R('100277', 'trucking', 900), R('100277', 'freight', 1322)];

(async function () {
  fresh();
  var r = await call({ action: 'set_shipping_terms', shipping_terms: 'CNF_SEPARATE', shipping_cost_estimate: 2222 });
  check('21: server, no breakdown typed: cost 2222 with a 2222 line SAVES with no reason — no override row on the audit trail', r.status === 200 && r.body.ok === true && state.terms && state.terms.shipping_cost_estimate === 2222 && !r.body.markup_override && state.audit.filter(function (a) { return a.action === 'shipping_markup_override'; }).length === 0, [r, state.log]);
  check('22: …and the server looked the breakdown up itself, for the invoice\'s own release', state.log.indexOf('read-parts:["100277"]') >= 0, state.log);
  fresh({ parts: COMPLETE });
  r = await call({ action: 'set_shipping_terms', shipping_terms: 'CNF_SEPARATE', shipping_cost_estimate: 2222 });
  check('23: server, actual costs typed, line below cost + 7%, NO reason → refused, nothing saved', r.status !== 200 && r.body.ok === false && r.body.code === 'markup_note_needed' && state.terms === null, r);
  r = await call({ action: 'set_shipping_terms', shipping_terms: 'CNF_SEPARATE', shipping_cost_estimate: 2222, markup_override_note: 'Price agreed with the customer' });
  var row = state.audit.filter(function (a) { return a.action === 'shipping_markup_override'; })[0];
  check('24: …with a reason → saved, and the reason is on the audit trail with who, the cost, the amount charged and the shortfall', r.status === 200 && r.body.ok === true && !!row && row.actor_id === 'user-1' && row.details && JSON.stringify(row.details).indexOf('Price agreed with the customer') >= 0 && state.log.indexOf('audit:shipping_markup_override') < state.log.indexOf('save-terms'), [r, row]);
  fresh({ parts: COMPLETE, items: [{ description: 'Goods', quantity: 1, unit_price: 100, line_total: 100 }, { description: 'Shipping Costs', quantity: 1, unit_price: 5000, line_total: 5000 }] });
  r = await call({ action: 'set_shipping_terms', shipping_terms: 'CNF_SEPARATE', shipping_cost_estimate: 2222 });
  check('25: server, actual costs typed, charging MORE than cost + 7% → saved, no reason needed', r.status === 200 && r.body.ok === true && !r.body.markup_override, r);
  fresh({ parts: [R('100277', 'trucking', 900)] });
  r = await call({ action: 'set_shipping_terms', shipping_terms: 'CNF_SEPARATE', shipping_cost_estimate: 2222 });
  check('26: server, only trucking typed (breakdown not complete) → still an estimate, saves with no reason', r.status === 200 && r.body.ok === true, r);
  fresh({ release: '' , parts: COMPLETE });
  r = await call({ action: 'set_shipping_terms', shipping_terms: 'CNF_SEPARATE', shipping_cost_estimate: 2222 });
  check('27: server, invoice with no release number → nothing to be actual about, saves; the breakdown is not even read', r.status === 200 && r.body.ok === true && state.log.filter(function (l) { return l.indexOf('read-parts') === 0; }).length === 0, [r, state.log]);
  fresh({ parts: COMPLETE });
  r = await call({ action: 'set_shipping_terms', shipping_terms: 'EXW', shipping_cost_estimate: 2222 });
  check('28: server, EXW sent with a cost → saved with NO shipping cost, nothing checked, even with a shipping line and actual costs typed', r.status === 200 && r.body.ok === true && state.terms.shipping_terms === 'EXW' && state.terms.shipping_cost_estimate === null && state.audit.filter(function (a) { return a.action === 'shipping_markup_override'; }).length === 0, [r, state.terms]);
  fresh();
  r = await call({ action: 'set_shipping_terms', shipping_terms: 'CNF_SEPARATE', shipping_cost_estimate: '' });
  check('29: server, CNF with no cost at all is still refused', r.status === 400 && r.body.ok === false, r);

  // ── 6. the screen (source) ──
  var tab = read('src/components/AccountingInvoicesTab.jsx');
  check('30 (source): leaving the cost box runs the automatic shipping line; choosing "CNF separate line" does too', tab.indexOf("onBlur={function (e) { autoShipLine(e.target.value, st); }}") > 0 && tab.indexOf("if (k === 'CNF_SEPARATE') { autoShipLine(costNow, k); }") > 0 && tab.indexOf('autoShippingLine(items, costText, autoShip, terms, isTransportLine, blankItem)') > 0);
  check('31 (source): choosing EXW empties the cost; the cost box is locked on EXW', tab.indexOf("if (k === 'EXW') { n.shipping_cost_estimate = ''; }") > 0 && tab.indexOf("var noLineExw = st === 'EXW';") > 0 && tab.indexOf('disabled={locked(editing) || noLineExw}') > 0);
  check('32 (source): the 7% line and the red reason box show ONLY when the actual costs are typed; otherwise a plain grey note', tab.indexOf("{st === 'CNF_SEPARATE' && c > 0 && actual7 && <div") > 0 && tab.indexOf("{st === 'CNF_SEPARATE' && actual7 && c > 0 && shipAmt > 0 && shipAmt + 0.005 < minShippingCharge(c) && <div id=\"nt-ship-override\"") > 0 && tab.indexOf("{st === 'CNF_SEPARATE' && c > 0 && !actual7 && <div") > 0 && tab.indexOf('must total at least') < 0);
  check('33 (source): "actual" = the breakdown box reported a complete breakdown for THIS release text; Save uses the same answer', tab.indexOf("setShipActualFor(String(hdr.release_number || '').trim() || null);") > 0 && tab.indexOf("return !!r && shipActualFor === r;") > 0 && tab.indexOf('{ costIsActual: shipCostIsActual()') > 0);
  check('34 (source): a locked (approved) invoice is never changed by the automatic line', /function autoShipLine\(costText, terms\) \{\s*if \(locked\(editing\)\) \{ return; \}/.test(tab));

  // ── 7. the reopen switch ──
  var panel = read('src/components/BankingAccessPanel.jsx');
  var g3 = panel.substring(panel.indexOf("title: '3 · Bank work'"), panel.indexOf("title: '3b · Invoices"));
  check('35: the switch “Approve & reopen invoices” is in group 3 · Bank work, and says plainly what it does', g3.indexOf("key: 'accounting.reopen'") > 0 && g3.indexOf("label: 'Approve & reopen invoices'") > 0 && /REOPEN an approved \(read-only\) invoice/.test(g3) && /Create \/ edit invoices/.test(g3));
  var BP = require(path.join(root, 'src/lib/bank-permissions.js'));
  check('36: the invoice screen shows Reopen for a person with that switch — and not for a person without it', BP.canReopen(false, { 'accounting.reopen': true }, 'staff') === true && BP.canReopen(false, { 'invoice.create': true }, 'staff') === false && BP.canReopen(true, {}, 'staff') === true, [BP.canReopen(false, { 'accounting.reopen': true }, 'staff'), BP.canReopen(false, { 'invoice.create': true }, 'staff')]);
  var AL = require(path.join(root, 'src/lib/permission-aliases.js'));
  check('37: the SERVER accepts the same switch for approve / reopen (invoices.approve), and no other invoice permission gained it', AL.PERMISSION_ALIASES['invoices.approve'].indexOf('accounting.reopen') >= 0 && AL.PERMISSION_ALIASES['invoices.edit'].indexOf('accounting.reopen') < 0 && AL.PERMISSION_ALIASES['invoices.view'].indexOf('accounting.reopen') < 0);
  var rt = read('src/app/api/accounting/invoice-write/route.js');
  check('38 (source): the reopen action on the server is still gated on invoices.approve', /if \(action === 'reopen'\) \{\s*var rgate = await assertPermission\(db, by, 'invoices\.approve', req\);/.test(rt));
  check('39 (source): a person without it is told which switch to ask for', tab.indexOf('You need the “Approve & reopen invoices” switch (Settings → Banking & Accounting Access → 3 · Bank work).') > 0);

  // ── 8. housekeeping ──
  var page = read('src/app/page.jsx'); var wn = read('src/components/WhatsNewWidget.jsx');
  check('40: What\'s New has the YP entry and the badge names the newest entry on top', wn.indexOf("version: 'v55.83-YP'") > 0 && (function () { var top = /BUILD_HISTORY = \[\s*\{\s*version: '(v55\.83-[A-Z]{2}(?:\.\d+)?)'/.exec(wn); return !!top && page.indexOf('>' + top[1] + '</span>') > 0; })());
  check('41: the test is in the regression runner', read('scripts/run-accounting-bank-regression.js').indexOf('test-v55-83-yp-invoice-shipping-and-reopen.js') > 0);

  console.log('\nYP: ' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.log('CRASHED: ' + (e && e.stack || e)); process.exit(1); });
